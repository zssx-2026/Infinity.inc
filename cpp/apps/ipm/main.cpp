// main.cpp - InfinityPackageManager, in C++.
//
// One program, several faces, and the file name decides which one runs - the
// same contract the other two applications keep:
//
//   ipm_cli        a command line
//   ipm_tui        a full screen terminal interface
//   ipm_gui        a native window
//   ipm_launcher   a menu that starts one of the other three
//
// The catalogue is the whole application. Every package is a release asset in
// one repository, and what this program adds is the index, the digest check
// and the launch. A build is only ever run after its SHA-256 has been checked
// against the digest GitHub reports for the asset, because an installer that
// runs without that check is just a download that happens to end in .exe.
//
// The window is direct manipulation - a filter, a list, and buttons that act
// on the selected row. There is no command box: a package manager that makes
// you type a package name has not been given an interface, it has been given
// a terminal with a title bar.

#include "inc/env.hpp"
#include "inc/github.hpp"
#include "inc/http.hpp"
#include "inc/json.hpp"
#include "inc/mode.hpp"
#include "inc/ansi.hpp"
#include "inc/str.hpp"
#include "inc/uiserver.hpp"
#include "unblock.hpp"

#include "ui.hpp"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>
#include <commctrl.h>
#include <commdlg.h>
#include <shellapi.h>

using namespace inc;

static const char* APP = "InfinityPackageManager";

namespace {

const char* kOwner = "zssx-2026";
const char* kRepo = "applications";

// ---------------------------------------------------------------- output

void out(const std::string& text) {
  fwrite(text.data(), 1, text.size(), stdout);
  fputc('\n', stdout);
}

// ---------------------------------------------------------------- profile

// `--profile` makes the catalogue load say where its wall time went, on
// stderr. The expensive part of this program is a set of network round trips
// that no local measurement can see, so the split comes before the change
// rather than after it.
bool gProfile = false;

double nowMs() {
  static const double frequency = [] {
    LARGE_INTEGER value;
    QueryPerformanceFrequency(&value);
    return static_cast<double>(value.QuadPart);
  }();
  LARGE_INTEGER counter;
  QueryPerformanceCounter(&counter);
  return static_cast<double>(counter.QuadPart) * 1000.0 / frequency;
}

void profileMark(const std::string& label, double ms) {
  if (!gProfile) return;
  fprintf(stderr, "ipm-profile  %-34s %9.1f ms\n", label.c_str(), ms);
}

void profileCount(const std::string& label, long long value) {
  if (!gProfile) return;
  fprintf(stderr, "ipm-profile  %-34s %9lld\n", label.c_str(), value);
}

// Runs body(i) for every i in [0, count) and returns when they all have.
// CreateThread rather than std::thread: the suite links -static and this keeps
// the thread model out of the link flags, and the work here is HTTP and string
// building, not anything that needs a C++ runtime thread.
void parallelFor(size_t count, unsigned workers, const std::function<void(size_t)>& body) {
  if (count == 0) return;
  if (count == 1 || workers <= 1) {
    for (size_t i = 0; i < count; ++i) body(i);
    return;
  }
  if (static_cast<size_t>(workers) > count) workers = static_cast<unsigned>(count);

  struct Shared {
    size_t count;
    const std::function<void(size_t)>* body;
    volatile LONG next;
  } shared = { count, &body, 0 };

  std::vector<HANDLE> threads;
  threads.reserve(workers);
  for (unsigned w = 0; w < workers; ++w) {
    HANDLE thread = CreateThread(nullptr, 0, [](LPVOID parameter) -> DWORD {
      Shared* s = static_cast<Shared*>(parameter);
      for (;;) {
        const LONG index = InterlockedIncrement(&s->next) - 1;
        if (static_cast<size_t>(index) >= s->count) break;
        (*s->body)(static_cast<size_t>(index));
      }
      return 0;
    }, &shared, 0, nullptr);
    if (thread) threads.push_back(thread);
  }
  if (threads.empty()) {
    for (size_t i = 0; i < count; ++i) body(i);
    return;
  }
  WaitForMultipleObjects(static_cast<DWORD>(threads.size()), threads.data(), TRUE, INFINITE);
  for (HANDLE thread : threads) CloseHandle(thread);
}

// How many manifests are in flight at once. The GitHub API is the limit here,
// not the machine, and eight keeps the burst inside an ordinary page load.
const unsigned kCatalogWorkers = 8;

// The same number, overridable so a measurement can reproduce the old
// sequential order on the same binary: IPM_CATALOG_WORKERS=1.
unsigned catalogWorkers() {
  const std::string asked = getEnv("IPM_CATALOG_WORKERS");
  if (!asked.empty()) {
    const int value = atoi(asked.c_str());
    if (value > 0 && value <= 32) return static_cast<unsigned>(value);
  }
  return kCatalogWorkers;
}

// ---------------------------------------------------------------- model

struct Build {
  std::string package;
  std::string version;
  std::string platform;
  std::string filename;
  std::string url;
  std::string releaseTag;
  std::string digest;
  std::string contentType;
  std::string installKind;
  long long assetId = 0;
  long long size = 0;
};

struct Asset {
  std::string name;
  std::string url;
  std::string digest;
  std::string contentType;
  long long id = 0;
  long long size = 0;
};

void help() {
  out(std::string(APP) + " [v" + version() + "]  ·  Infinity.Inc");
  out("");
  out("  ipm                       open the terminal interface");
  out("  ipm cli                   open the command line");
  out("  ipm gui                   open the window");
  out("  ipm login                 show which token is in use");
  out("  ipm repos                 repositories you own");
  out("  ipm catalog               every package in the index");
  out("  ipm search <keyword>      packages whose name matches");
  out("  ipm info <name>           the builds of one package");
  out("  ipm download <name> <platform> <destination>");
  out("  ipm install <name> <platform>   download, verify, run");
  out("  ipm --version             print the version");
  out("  ipm --paths               where this program keeps things");
  out("  ipm --profile <command>   where the catalogue load spent its time");
}

std::string canonicalPlatform(std::string value) {
  value = lower(trim(value));
  std::replace(value.begin(), value.end(), '_', '-');
  if (value == "win64" || value == "winx64" || value == "win-x64" || value == "windows-x64") return "windows-x64";
  if (value == "winx86" || value == "win32" || value == "win-x86" || value == "windows-x86") return "windows-x86";
  if (value == "win-arm64" || value == "windows-arm64") return "windows-arm64";
  if (value == "linux-aarch64" || value == "linux-arm64") return "linux-arm64";
  if (value == "linux-amd64" || value == "linux-x86-64" || value == "linux-x64") return "linux-x64";
  if (value == "mac-arm64" || value == "macos-arm64" || value == "darwin-arm64") return "macos-arm64";
  if (value == "mac-intel" || value == "macos-x64" || value == "darwin-x64") return "macos-x64";
  return value;
}

std::string inferPlatform(const std::string& filename) {
  const std::string name = lower(filename);
  const char* tokens[][2] = {
    {"windows-arm64", "windows-arm64"}, {"win-arm64", "windows-arm64"}, {"win_arm64", "windows-arm64"},
    {"windows-x64", "windows-x64"}, {"win64", "windows-x64"}, {"winx64", "windows-x64"}, {"win-x64", "windows-x64"},
    {"windows-x86", "windows-x86"}, {"winx86", "windows-x86"}, {"win32", "windows-x86"}, {"win-x86", "windows-x86"},
    {"linux-arm64", "linux-arm64"}, {"linux-aarch64", "linux-arm64"},
    {"linux-x64", "linux-x64"}, {"linux-amd64", "linux-x64"}, {"linux-x86_64", "linux-x64"},
    {"macos-arm64", "macos-arm64"}, {"mac-arm64", "macos-arm64"}, {"darwin-arm64", "macos-arm64"},
    {"macos-x64", "macos-x64"}, {"mac-intel", "macos-x64"}, {"darwin-x64", "macos-x64"}
  };
  for (const auto& token : tokens) if (name.find(token[0]) != std::string::npos) return token[1];
  return "any";
}

std::string stripExtension(const std::string& filename) {
  size_t slash = filename.find_last_of("/\\");
  size_t dot = filename.find_last_of('.');
  return dot != std::string::npos && (slash == std::string::npos || dot > slash)
      ? filename.substr(0, dot) : filename;
}

bool isBuildAsset(const std::string& filename) {
  const std::string name = lower(filename);
  static const char* extensions[] = {".exe", ".msi", ".zip", ".7z", ".rar", ".tar", ".gz", ".dmg", ".pkg", ".deb", ".rpm", ".appimage"};
  for (const char* ext : extensions) if (endsWith(name, ext)) return true;
  return false;
}

Build fallbackBuild(const Asset& asset, const std::string& releaseTag) {
  Build build;
  build.filename = asset.name;
  build.url = asset.url;
  build.digest = asset.digest;
  build.contentType = asset.contentType;
  build.assetId = asset.id;
  build.size = asset.size;
  build.releaseTag = releaseTag;
  build.version = releaseTag.empty() ? "unknown" : releaseTag;
  build.platform = inferPlatform(asset.name);

  const std::string stem = stripExtension(asset.name);
  const std::string lowerStem = lower(stem);
  size_t marker = lowerStem.find("_v");
  size_t markerLength = 2;
  if (marker == std::string::npos) {
    marker = lowerStem.find("-v");
    markerLength = 2;
  }
  if (marker != std::string::npos) {
    build.package = stem.substr(0, marker);
    size_t versionStart = marker + markerLength;
    size_t versionEnd = stem.find('_', versionStart);
    if (versionEnd == std::string::npos) versionEnd = stem.find('-', versionStart);
    build.version = stem.substr(versionStart, versionEnd == std::string::npos ? std::string::npos : versionEnd - versionStart);
  } else {
    build.package = stem;
  }
  while (!build.package.empty() && (build.package.back() == '_' || build.package.back() == '-')) build.package.pop_back();
  if (build.package.empty()) build.package = stem;
  if (!build.version.empty() && (build.version[0] == 'v' || build.version[0] == 'V')) build.version.erase(0, 1);
  return build;
}

std::string fetchNameTxt(GitHub& github, const Asset& asset) {
  if (asset.id <= 0) return std::string();
  RequestOptions options;
  options.token = github.token();
  options.headers.push_back("Accept: application/octet-stream");
  options.headers.push_back("User-Agent: Infinity.Inc");
  const std::string url = std::string(GitHub::apiBase()) + "/repos/" + kOwner + "/" + kRepo +
                          "/releases/assets/" + std::to_string(asset.id);
  Response response = httpRequest(url, options);
  return response.ok() ? response.body : std::string();
}

std::vector<Asset> releaseAssets(const Release& release) {
  std::vector<Asset> assets;
  if (release.assets.isArray()) {
    for (const Json& value : release.assets.items()) {
      Asset asset;
      asset.name = value.s("name");
      asset.url = value.s("browser_download_url");
      asset.digest = value.s("digest");
      asset.contentType = value.s("content_type");
      asset.id = value.i("id");
      asset.size = value.i("size");
      if (!asset.name.empty()) assets.push_back(asset);
    }
  }
  return assets;
}

// One release and the manifest text once it has been fetched. Splitting the
// fetch out of the parse is what lets the fetches run together: parsing is
// pure, and nothing in it needs another release to have finished.
struct ReleaseUnit {
  const Release* release = nullptr;
  std::vector<Asset> assets;
  size_t manifest = 0;
  bool hasManifest = false;
  std::string manifestText;
};

std::vector<Build> buildsFromUnit(const ReleaseUnit& unit) {
  const std::vector<Asset>& assets = unit.assets;
  const Release& release = *unit.release;

  std::vector<Build> builds;
  if (unit.hasManifest) {
    for (const std::string& rawLine : split(unit.manifestText, '\n')) {
      const std::string line = trim(rawLine);
      if (line.empty() || line[0] == '#') continue;
      const std::vector<std::string> columns = words(line);
      if (columns.size() < 4) continue;
      auto asset = std::find_if(assets.begin(), assets.end(), [&](const Asset& candidate) {
        return candidate.name == columns[0];
      });
      if (asset == assets.end()) continue;
      Build build;
      build.filename = asset->name;
      build.url = asset->url;
      build.digest = asset->digest;
      build.contentType = asset->contentType;
      build.assetId = asset->id;
      build.size = asset->size;
      build.releaseTag = release.tag;
      build.version = columns[1];
      if (!build.version.empty() && (build.version[0] == 'v' || build.version[0] == 'V')) build.version.erase(0, 1);
      build.package = columns[2];
      build.installKind = columns.size() >= 6 ? lower(columns[3]) : std::string();
      build.platform = columns.size() >= 6 && !columns[5].empty() ? lower(columns[5]) : "any";
      builds.push_back(build);
    }
  }

  if (builds.empty()) {
    for (const Asset& asset : assets) {
      if (iequals(asset.name, "name.txt") || iequals(asset.name, "README.md") || !isBuildAsset(asset.name)) continue;
      builds.push_back(fallbackBuild(asset, release.tag));
    }
  }
  return builds;
}

bool loadBuilds(const std::string& token, std::vector<Build>* builds, std::string* error) {
  const double startedAt = nowMs();
  GitHub github(token);
  std::vector<Release> releases = github.listReleases(kOwner, kRepo, 100, error);
  const double listedAt = nowMs();
  if (releases.empty()) return false;

  std::vector<ReleaseUnit> units;
  units.reserve(releases.size());
  for (const Release& release : releases) {
    if (release.draft) continue;
    ReleaseUnit unit;
    unit.release = &release;
    unit.assets = releaseAssets(release);
    for (size_t i = 0; i < unit.assets.size(); ++i) {
      if (iequals(unit.assets[i].name, "name.txt")) { unit.manifest = i; unit.hasManifest = true; break; }
    }
    units.push_back(std::move(unit));
  }

  // One manifest per release, each an independent request. Sequentially the
  // catalogue cost the SUM of a round trip per release; together it costs the
  // slowest one.
  std::vector<size_t> pending;
  for (size_t i = 0; i < units.size(); ++i) {
    if (units[i].hasManifest && units[i].assets[units[i].manifest].id > 0) pending.push_back(i);
  }
  parallelFor(pending.size(), catalogWorkers(), [&](size_t index) {
    ReleaseUnit& unit = units[pending[index]];
    unit.manifestText = fetchNameTxt(github, unit.assets[unit.manifest]);
  });
  const double fetchedAt = nowMs();

  for (const ReleaseUnit& unit : units) {
    std::vector<Build> releaseBuilds = buildsFromUnit(unit);
    builds->insert(builds->end(), releaseBuilds.begin(), releaseBuilds.end());
  }
  const double parsedAt = nowMs();

  profileMark("listReleases (1 request)", listedAt - startedAt);
  profileMark("name.txt (" + std::to_string(pending.size()) + " requests)", fetchedAt - listedAt);
  profileMark("parse assets+manifest", parsedAt - fetchedAt);
  profileMark("loadBuilds total", parsedAt - startedAt);
  profileCount("http requests", static_cast<long long>(1 + pending.size()));
  profileCount("releases / manifests", static_cast<long long>(units.size()));
  profileCount("builds", static_cast<long long>(builds->size()));
  return true;
}

// A stable order, so the list does not reshuffle between two refreshes of the
// same data. Package first, then platform, then version descending.
void sortBuilds(std::vector<Build>* builds) {
  std::sort(builds->begin(), builds->end(), [](const Build& a, const Build& b) {
    if (!iequals(a.package, b.package)) return lower(a.package) < lower(b.package);
    if (a.platform != b.platform) return a.platform < b.platform;
    return a.version > b.version;
  });
}

void printBuild(const Build& build, bool includePackage) {
  std::string line;
  if (includePackage) line = build.package + "\t";
  line += build.version + "\t" + build.platform + "\t" + humanSize(static_cast<uint64_t>(std::max(0LL, build.size))) + "\t" + build.url;
  out(line);
}

// ---------------------------------------------------------------- download

std::string ansiPath(const std::wstring& wide) {
  const UINT codePage = GetACP();
  const DWORD flags = codePage == CP_UTF8 ? 0 : WC_NO_BEST_FIT_CHARS;
  BOOL usedDefault = FALSE;
  int count = WideCharToMultiByte(codePage, flags, wide.c_str(), -1, nullptr, 0, nullptr,
                                  codePage == CP_UTF8 ? nullptr : &usedDefault);
  if (!count || usedDefault) return std::string();
  std::vector<char> buffer(static_cast<size_t>(count));
  usedDefault = FALSE;
  if (!WideCharToMultiByte(codePage, flags, wide.c_str(), -1, buffer.data(), count, nullptr,
                           codePage == CP_UTF8 ? nullptr : &usedDefault) || usedDefault) return std::string();
  return std::string(buffer.data());
}

bool hasSha256Digest(const Build& build) {
  const std::string digest = lower(trim(build.digest));
  if (digest.size() != 71 || digest.compare(0, 7, "sha256:") != 0) return false;
  return std::all_of(digest.begin() + 7, digest.end(), [](unsigned char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
  });
}

bool isRunnable(const Build& build) {
  return iequals(build.installKind, "setup") && hasSha256Digest(build);
}

std::string sha256File(const std::wstring& path, std::string* error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot open downloaded file for SHA-256"; return std::string(); }

  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  auto fail = [&](const char* message) {
    if (hash) BCryptDestroyHash(hash);
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
    CloseHandle(file);
    *error = message;
    return std::string();
  };

  NTSTATUS status = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0);
  if (!BCRYPT_SUCCESS(status)) return fail("cannot initialize SHA-256 verification");

  DWORD objectLength = 0;
  DWORD hashLength = 0;
  DWORD resultLength = 0;
  status = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength),
                             sizeof(objectLength), &resultLength, 0);
  if (!BCRYPT_SUCCESS(status)) return fail("cannot initialize SHA-256 verification");
  status = BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashLength),
                             sizeof(hashLength), &resultLength, 0);
  if (!BCRYPT_SUCCESS(status)) return fail("cannot initialize SHA-256 verification");

  std::vector<UCHAR> hashObject(objectLength);
  std::vector<UCHAR> hashBytes(hashLength);
  status = BCryptCreateHash(algorithm, &hash, hashObject.data(), objectLength, nullptr, 0, 0);
  if (!BCRYPT_SUCCESS(status)) return fail("cannot initialize SHA-256 verification");

  UCHAR buffer[65536];
  DWORD bytesRead = 0;
  do {
    if (!ReadFile(file, buffer, sizeof(buffer), &bytesRead, nullptr)) return fail("cannot read downloaded file for SHA-256");
    if (bytesRead && !BCRYPT_SUCCESS(BCryptHashData(hash, buffer, bytesRead, 0)))
      return fail("cannot calculate SHA-256 digest");
  } while (bytesRead);

  if (!BCRYPT_SUCCESS(BCryptFinishHash(hash, hashBytes.data(), hashLength, 0)))
    return fail("cannot calculate SHA-256 digest");
  BCryptDestroyHash(hash);
  hash = nullptr;
  BCryptCloseAlgorithmProvider(algorithm, 0);
  algorithm = nullptr;
  CloseHandle(file);

  static const char hex[] = "0123456789abcdef";
  std::string result;
  result.reserve(hashBytes.size() * 2);
  for (UCHAR byte : hashBytes) {
    result.push_back(hex[byte >> 4]);
    result.push_back(hex[byte & 0x0f]);
  }
  return result;
}

bool safeInstallerFilename(const std::string& filename, std::wstring* wideFilename) {
  *wideFilename = toWide(filename);
  if (wideFilename->empty() || *wideFilename == L"." || *wideFilename == L".." ||
      wideFilename->back() == L'.' || wideFilename->back() == L' ') return false;
  for (wchar_t c : *wideFilename) {
    if (c < 32 || wcschr(L"<>:\"/\\|?*", c)) return false;
  }
  std::wstring stem = wideFilename->substr(0, wideFilename->find(L'.'));
  std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t c) {
    return c >= L'a' && c <= L'z' ? static_cast<wchar_t>(c - L'a' + L'A') : c;
  });
  if (stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL" ||
      (stem.size() == 4 && (stem.compare(0, 3, L"COM") == 0 || stem.compare(0, 3, L"LPT") == 0) &&
       stem[3] >= L'1' && stem[3] <= L'9')) return false;
  return true;
}

bool createDirectoryIfNeeded(const std::wstring& path) {
  if (CreateDirectoryW(path.c_str(), nullptr)) return true;
  if (GetLastError() != ERROR_ALREADY_EXISTS) return false;
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

// Where an installer is staged before it is run. Kept beside the program's
// other state rather than in the temp directory, because a 400 MB download
// that a cleanup pass deletes halfway through is worse than a folder the user
// can see and empty themselves.
bool downloadsDirectory(std::wstring* directory, std::string* error) {
  DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
  if (!length) { *error = "LOCALAPPDATA is not available"; return false; }
  std::vector<wchar_t> buffer(length);
  DWORD written = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), length);
  if (!written || written >= length) { *error = "cannot read LOCALAPPDATA"; return false; }
  std::wstring root(buffer.data(), written);
  if (!root.empty() && root.back() != L'\\' && root.back() != L'/') root.push_back(L'\\');

  const std::wstring managerDirectory = root + L"InfinityPackageManager";
  const std::wstring downloads = managerDirectory + L"\\downloads";
  if (!createDirectoryIfNeeded(managerDirectory) || !createDirectoryIfNeeded(downloads)) {
    *error = "cannot create installer download directory";
    return false;
  }
  *directory = downloads;
  return true;
}

bool installDestination(const std::string& filename, std::wstring* destination, std::string* error) {
  std::wstring wideFilename;
  if (!safeInstallerFilename(filename, &wideFilename)) {
    *error = "unsafe installer filename";
    return false;
  }
  std::wstring downloads;
  if (!downloadsDirectory(&downloads, error)) return false;
  *destination = downloads + L"\\" + wideFilename;
  return true;
}

bool downloadBuild(const Build& build, const std::string& token, const std::wstring& destination,
                   bool* verified, std::string* error) {
  if (verified) *verified = false;
  if (build.assetId <= 0) { *error = "asset has no GitHub id"; return false; }

  const std::wstring& requested = destination;
  std::vector<wchar_t> fullBuffer(32768);
  DWORD fullLength = GetFullPathNameW(requested.c_str(), static_cast<DWORD>(fullBuffer.size()), fullBuffer.data(), nullptr);
  if (!fullLength || fullLength >= fullBuffer.size()) { *error = "invalid destination path"; return false; }
  std::wstring fullPath(fullBuffer.data(), fullLength);
  if (GetFileAttributesW(fullPath.c_str()) != INVALID_FILE_ATTRIBUTES) {
    *error = "destination already exists";
    return false;
  }

  size_t separator = fullPath.find_last_of(L"\\/");
  if (separator == std::wstring::npos) { *error = "invalid destination path"; return false; }
  std::wstring directory = fullPath.substr(0, separator + 1);
  if (directory.empty()) { *error = "invalid destination path"; return false; }

  std::wstring tempPath;
  HANDLE file = INVALID_HANDLE_VALUE;
  for (unsigned int attempt = 0; attempt < 64; ++attempt) {
    tempPath = directory + L".ipm-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(attempt) + L".part";
    file = CreateFileW(tempPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_TEMPORARY, nullptr);
    if (file != INVALID_HANDLE_VALUE) break;
    if (GetLastError() != ERROR_FILE_EXISTS && GetLastError() != ERROR_ALREADY_EXISTS) {
      *error = "cannot create temporary download file";
      return false;
    }
  }
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot reserve a temporary download file"; return false; }
  CloseHandle(file);

  DWORD shortLength = GetShortPathNameW(tempPath.c_str(), nullptr, 0);
  std::wstring streamPath = tempPath;
  if (shortLength) {
    std::vector<wchar_t> shortBuffer(static_cast<size_t>(shortLength) + 1);
    DWORD written = GetShortPathNameW(tempPath.c_str(), shortBuffer.data(), static_cast<DWORD>(shortBuffer.size()));
    if (written && written < shortBuffer.size()) streamPath.assign(shortBuffer.data(), written);
  }
  const std::string narrowPath = ansiPath(streamPath);
  if (narrowPath.empty()) {
    DeleteFileW(tempPath.c_str());
    *error = "destination path is not supported by the streaming downloader";
    return false;
  }

  const std::string url = std::string(GitHub::apiBase()) + "/repos/" + kOwner + "/" + kRepo +
                          "/releases/assets/" + std::to_string(build.assetId);
  std::vector<std::string> headers = {"Accept: application/octet-stream"};
  Response response = httpDownloadFile(url, narrowPath, token, headers);
  if (!response.ok()) {
    DeleteFileW(tempPath.c_str());
    *error = response.error.empty() ? "HTTP " + std::to_string(response.status) : response.error;
    return false;
  }

  const std::string digest = lower(trim(build.digest));
  if (digest.compare(0, 7, "sha256:") == 0) {
    if (!hasSha256Digest(build)) {
      DeleteFileW(tempPath.c_str());
      *error = "invalid SHA-256 asset digest";
      return false;
    }
    const std::string actualDigest = sha256File(tempPath, error);
    if (actualDigest.empty()) {
      DeleteFileW(tempPath.c_str());
      return false;
    }
    if (actualDigest != digest.substr(7)) {
      DeleteFileW(tempPath.c_str());
      *error = "SHA-256 digest mismatch";
      return false;
    }
    if (verified) *verified = true;
  }

  if (!MoveFileExW(tempPath.c_str(), fullPath.c_str(), MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(tempPath.c_str());
    *error = "cannot move download to destination";
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- session

struct Session {
  GitHub gh;
  std::string tokenSourceName;
  bool ready = false;

  explicit Session(const std::string& token) : gh(token) {}

  bool signIn(std::string* error) {
    // Two requests that do not depend on each other: one round trip each, and
    // no reason for the second to wait for the first. The error order is the
    // same as the sequential form's, so a failure reads as it always did.
    std::string meError;
    std::string identityError;
    bool meOk = false;
    bool identityOk = false;
    parallelFor(2, 2, [&](size_t index) {
      if (index == 0) meOk = gh.me(&meError);
      else identityOk = gh.verifyIdentity(&identityError);
    });
    if (!meOk) { if (error) *error = meError; return false; }
    if (!identityOk) { if (error) *error = identityError; return false; }
    ready = true;
    return true;
  }
};

// The index, loaded once and then kept. Reading it costs six API calls plus
// one request per release for its name.txt, which is not something a keystroke
// should pay for.
struct Catalog {
  std::vector<Build> builds;
  std::string error;
  bool loaded = false;

  bool refresh(const std::string& token) {
    std::vector<Build> fresh;
    std::string failure;
    const bool ok = loadBuilds(token, &fresh, &failure);
    if (!ok) {
      error = failure.empty() ? "cannot read the catalogue" : failure;
      return false;
    }
    sortBuilds(&fresh);
    builds.swap(fresh);
    error.clear();
    loaded = true;
    return true;
  }

  std::vector<int> matching(const std::string& filter) const {
    std::vector<int> rows;
    const std::string needle = lower(trim(filter));
    for (size_t i = 0; i < builds.size(); ++i) {
      if (needle.empty()) { rows.push_back((int)i); continue; }
      const Build& b = builds[i];
      const std::string haystack = lower(b.package + " " + b.version + " " + b.platform + " " + b.filename);
      if (haystack.find(needle) != std::string::npos) rows.push_back((int)i);
    }
    return rows;
  }

  std::string summary() const {
    if (!loaded) return error.empty() ? "not loaded" : error;
    size_t runnable = 0;
    for (const Build& b : builds) if (isRunnable(b)) runnable++;
    return std::to_string(builds.size()) + " builds  ·  " + std::to_string(runnable) + " installable";
  }
};

}  // namespace

// ---------------------------------------------------------------- cli

namespace {

int cliMain(const std::vector<std::string>& args) {
  if (!args.empty()) {
    const std::string& a = args[0];
    if (a == "--version" || a == "-v") { out(std::string(APP) + " " + version()); return 0; }
    if (a == "--paths") {
      std::wstring downloads;
      std::string error;
      const bool ok = downloadsDirectory(&downloads, &error);
      out("exe        " + exeDir());
      out("version    " + std::string(version()));
      out("token      " + (tokenSource().empty() ? std::string("(none)") : tokenSource()));
      out("downloads  " + (ok ? toUtf8(downloads) : "(unavailable: " + error + ")"));
      return 0;
    }
    if (a == "help" || a == "--help" || a == "-h") { help(); return 0; }
  }

  const std::string token = tokenFromEnv();
  if (token.empty()) {
    out(color(C_RED, "not signed in") + " - set gittoken_zssx-2026_1 (or EV_GH_TOKEN) first.");
    return 1;
  }
  Session session(token);
  session.tokenSourceName = tokenSource();
  std::string error;
  if (!session.signIn(&error)) {
    out(color(C_RED, "not signed in") + " (" + error + ")");
    return 1;
  }

  if (args.empty() || args[0] == "whoami" || args[0] == "login") {
    out(color(C_GREEN, session.gh.login()) + "  " + color(C_DIM, "via " + session.tokenSourceName));
    return 0;
  }

  if (args[0] == "repos") {
    std::vector<std::string> repos = session.gh.listRepos(&error);
    if (repos.empty()) { out(color(C_DIM, "no repositories")); return 0; }
    for (const std::string& r : repos) out("  " + r);
    return 0;
  }

  const bool known = args[0] == "catalog" || args[0] == "search" || args[0] == "info" ||
                     args[0] == "download" || args[0] == "install";
  if (!known) {
    out(color(C_RED, args[0] + ": command not found"));
    return 2;
  }
  if (args[0] == "search" && args.size() != 2) { out(color(C_RED, "usage: ipm search <keyword>")); return 2; }
  if (args[0] == "info" && args.size() != 2) { out(color(C_RED, "usage: ipm info <name>")); return 2; }
  if (args[0] == "download" && args.size() != 4) { out(color(C_RED, "usage: ipm download <name> <platform> <destination>")); return 2; }
  if (args[0] == "install" && args.size() != 3) { out(color(C_RED, "usage: ipm install <name> <platform>")); return 2; }

  Catalog catalog;
  if (!catalog.refresh(token)) { out(color(C_RED, "ipm: " + catalog.error)); return 1; }

  if (args[0] == "catalog") {
    if (catalog.builds.empty()) { out(color(C_DIM, "no packages")); return 0; }
    for (const Build& build : catalog.builds) printBuild(build, true);
    return 0;
  }

  if (args[0] == "search") {
    const std::vector<int> rows = catalog.matching(args[1]);
    if (rows.empty()) { out(color(C_DIM, "no match for " + args[1])); return 1; }
    for (int index : rows) printBuild(catalog.builds[index], true);
    return 0;
  }

  if (args[0] == "info") {
    bool found = false;
    for (const Build& build : catalog.builds) {
      if (!iequals(build.package, args[1])) continue;
      printBuild(build, false);
      found = true;
    }
    if (!found) { out(color(C_RED, "ipm: package not found: " + args[1])); return 1; }
    return 0;
  }

  const bool installing = args[0] == "install";
  const std::string wantedName = args[1];
  const std::string wantedPlatform = canonicalPlatform(args[2]);
  auto selected = std::find_if(catalog.builds.begin(), catalog.builds.end(), [&](const Build& build) {
    return iequals(build.package, wantedName) &&
           (canonicalPlatform(build.platform) == wantedPlatform || canonicalPlatform(build.platform) == "any") &&
           (!installing || isRunnable(build));
  });
  if (selected == catalog.builds.end()) {
    out(color(C_RED, installing ? "ipm: no setup build with a valid SHA-256 digest for " + wantedName + " on " + args[2]
                                : "ipm: no build for " + wantedName + " on " + args[2]));
    return 1;
  }

  std::wstring destination;
  std::string destinationLabel;
  if (installing) {
    if (!installDestination(selected->filename, &destination, &error)) { out(color(C_RED, "ipm: " + error)); return 1; }
    destinationLabel = toUtf8(destination);
  } else {
    destination = toWide(args[3]);
    destinationLabel = args[3];
  }

  bool verified = false;
  if (!downloadBuild(*selected, token, destination, &verified, &error)) { out(color(C_RED, "ipm: " + error)); return 1; }
  if (!verified) {
    if (installing) {
      DeleteFileW(destination.c_str());
      out(color(C_RED, "ipm: refusing to run an installer without a verified SHA-256 digest"));
      return 1;
    }
    out("downloaded " + selected->filename + " -> " + destinationLabel + " (SHA-256 could not be verified; file was not run)");
    return 0;
  }
  if (!installing) {
    out("downloaded and verified " + selected->filename + " -> " + destinationLabel);
    return 0;
  }

  HINSTANCE launchResult = ShellExecuteW(nullptr, L"open", destination.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<INT_PTR>(launchResult) <= 32) {
    out(color(C_RED, "ipm: verified installer downloaded but could not be opened"));
    return 1;
  }
  out("launched verified installer " + selected->filename);
  return 0;
}

// ---------------------------------------------------------------- ui

/*
 * The window is Electron; this process is what it talks to.
 *
 * The page never decides whether a build may be installed - it reads
 * `installable` and disables the button, but the gate that matters is the one
 * in the handler below, because a page is a suggestion and the server is the
 * rule. Nothing reaches ShellExecuteW without a verified digest.
 */

std::string queryValue(const UiRequest& request, const std::string& key) {
  auto it = request.query.find(key);
  return it == request.query.end() ? std::string() : it->second;
}

UiResponse uiFailure(const std::string& message, int status) {
  Json j = Json::object();
  j.set("error", message);
  return UiResponse::withStatus(UiResponse::json(j.dump(2)), status);
}

std::string hostPlatformName() {
  SYSTEM_INFO info;
  GetNativeSystemInfo(&info);
  switch (info.wProcessorArchitecture) {
    case PROCESSOR_ARCHITECTURE_ARM64: return "windows-arm64";
    case PROCESSOR_ARCHITECTURE_INTEL: return "windows-x86";
    default: return "windows-x64";
  }
}

Json buildJson(const Build& build) {
  Json j = Json::object();
  j.set("package", build.package);
  j.set("version", build.version);
  j.set("platform", build.platform);
  j.set("size", build.size);
  j.set("kind", build.installKind.empty() ? std::string("port") : build.installKind);
  j.set("page", build.releaseTag);
  j.set("digest", build.digest);
  j.set("url", build.url);
  // The page uses this to disable Install. It is a convenience, not the gate.
  j.set("installable", isRunnable(build));
  return j;
}

Json stateJson(const Catalog& catalog, const Session& session, const std::vector<int>& rows) {
  Json packages = Json::array();
  for (int index : rows) packages.push(buildJson(catalog.builds[index]));

  size_t installableCount = 0;
  for (const Build& build : catalog.builds) if (isRunnable(build)) installableCount++;

  Json summary = Json::object();
  summary.set("loaded", catalog.loaded);
  summary.set("builds", (long long)catalog.builds.size());
  summary.set("installable", (long long)installableCount);
  if (!catalog.error.empty()) summary.set("error", catalog.error);

  Json j = Json::object();
  j.set("app", APP);
  j.set("version", version());
  j.set("login", session.gh.login());
  j.set("tokenSource", session.tokenSourceName);
  j.set("platform", hostPlatformName());
  j.set("summary", summary);
  j.set("packages", packages);
  return j;
}

std::vector<int> allRows(const Catalog& catalog) {
  std::vector<int> all;
  for (size_t i = 0; i < catalog.builds.size(); ++i) all.push_back((int)i);
  return all;
}

int serveUi(int port) {
  const std::string token = tokenFromEnv();
  if (token.empty()) {
    out(color(C_RED, "not signed in") + " - set gittoken_zssx-2026_1 (or EV_GH_TOKEN) first.");
    return 1;
  }
  Session session(token);
  session.tokenSourceName = tokenSource();

  // Signing in and reading the catalogue are independent and both are waits on
  // the network, so they run together and the interface is ready when the
  // slower one is instead of when both have been. A failure to sign in still
  // stops the program exactly as it did, and a catalogue that fails to load is
  // still reported by the page rather than by the exit code.
  std::string error;
  Catalog catalog;
  bool signedIn = false;
  parallelFor(2, 2, [&](size_t index) {
    if (index == 0) signedIn = session.signIn(&error);
    else catalog.refresh(token);
  });
  if (!signedIn) {
    out(color(C_RED, "not signed in") + " (" + error + ")");
    return 1;
  }

  UiServer server;
  server.route("GET", "/", [](const UiRequest&) { return UiResponse::html(uiHtml()); });
  server.route("GET", "/app.css", [](const UiRequest&) { return UiResponse::css(uiCss()); });
  server.route("GET", "/app.js", [](const UiRequest&) { return UiResponse::js(uiJs()); });

  server.route("GET", "/api/state", [&](const UiRequest&) {
    return UiResponse::json(stateJson(catalog, session, allRows(catalog)).dump(2));
  });

  server.route("GET", "/api/search", [&](const UiRequest& request) {
    return UiResponse::json(stateJson(catalog, session, catalog.matching(queryValue(request, "q"))).dump(2));
  });

  server.route("POST", "/api/refresh", [&](const UiRequest&) {
    const bool ok = catalog.refresh(token);
    return UiResponse::withStatus(
        UiResponse::json(stateJson(catalog, session, allRows(catalog)).dump(2)), ok ? 200 : 502);
  });

  /*
   * Find the build the page asked for. The page sends the exact package and
   * platform of a row it was shown, so this is an exact lookup - falling back
   * to "the best one for this platform" would install something the user did
   * not point at.
   */
  auto locate = [&](const UiRequest& request, const Build** found, std::string* why) -> bool {
    const std::string package = queryValue(request, "package");
    const std::string platform = queryValue(request, "platform");
    if (package.empty()) { *why = "no package given"; return false; }
    for (const Build& build : catalog.builds) {
      if (!iequals(build.package, package)) continue;
      if (!platform.empty() && !iequals(build.platform, platform)) continue;
      *found = &build;
      return true;
    }
    *why = "no build for " + package + (platform.empty() ? "" : " on " + platform);
    return false;
  };

  server.route("POST", "/api/download", [&](const UiRequest& request) {
    const Build* build = nullptr;
    std::string why;
    if (!locate(request, &build, &why)) return uiFailure(why, 404);

    std::wstring directory;
    if (!downloadsDirectory(&directory, &why)) return uiFailure(why, 500);
    const std::wstring destination = directory + L"\\" + toWide(build->filename);
    if (GetFileAttributesW(destination.c_str()) != INVALID_FILE_ATTRIBUTES) DeleteFileW(destination.c_str());

    bool verified = false;
    if (!downloadBuild(*build, token, destination, &verified, &why)) return uiFailure(why, 502);

    Json j = Json::object();
    j.set("message", "Downloaded " + build->filename +
                     (verified ? " and the SHA-256 matches." : " but no digest was reported."));
    j.set("verified", verified);
    j.set("path", toUtf8(destination));
    return UiResponse::json(j.dump(2));
  });

  server.route("POST", "/api/install", [&](const UiRequest& request) {
    const Build* build = nullptr;
    std::string why;
    if (!locate(request, &build, &why)) return uiFailure(why, 404);

    // The gate. Everything above this line is a lookup; this is the rule.
    if (!isRunnable(*build)) {
      return uiFailure(build->package + " has no setup build with a valid SHA-256 digest on " +
                       build->platform + "; refusing to install", 400);
    }

    std::wstring destination;
    if (!installDestination(build->filename, &destination, &why)) return uiFailure(why, 500);
    if (GetFileAttributesW(destination.c_str()) != INVALID_FILE_ATTRIBUTES) DeleteFileW(destination.c_str());

    bool verified = false;
    if (!downloadBuild(*build, token, destination, &verified, &why)) return uiFailure(why, 502);
    if (!verified) {
      DeleteFileW(destination.c_str());
      return uiFailure("the SHA-256 could not be verified; the installer was deleted and not run", 400);
    }

    HINSTANCE launched = ShellExecuteW(nullptr, L"open", destination.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(launched) <= 32) {
      return uiFailure("the verified installer was downloaded but could not be opened", 500);
    }
    Json j = Json::object();
    j.set("message", "Verified " + build->filename + " and started it.");
    return UiResponse::json(j.dump(2));
  });

  server.route("POST", "/api/open-folder", [&](const UiRequest&) {
    std::wstring directory;
    std::string why;
    if (!downloadsDirectory(&directory, &why)) return uiFailure(why, 500);
    ShellExecuteW(nullptr, L"open", directory.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    Json j = Json::object();
    j.set("message", "Opened " + toUtf8(directory));
    return UiResponse::json(j.dump(2));
  });

  if (!server.start(port, &error)) {
    out(color(C_RED, "cannot start the interface server: " + error));
    return 1;
  }
  out(color(C_GREEN, session.gh.login()) + "  " + color(C_DIM, "via " + session.tokenSourceName));
  out("InfinityPackageManager interface  " + server.url());
  out("open it in the window, or point a browser at it; close this to stop.");
  server.wait();
  return 0;
}

// ---------------------------------------------------------------- gui

const int ID_STATUS = 3001;
const int ID_FILTER = 3002;
const int ID_REFRESH = 3003;
const int ID_INSTALL = 3004;
const int ID_DOWNLOAD = 3005;
const int ID_FOLDER = 3006;
const int ID_LIST = 3007;

// IDC_ARROW and IDC_WAIT are the ANSI forms here, because this file does not
// define UNICODE; the wide resource ids are what LoadCursorW wants.
#define IPM_CURSOR_ARROW MAKEINTRESOURCEW(32512)
#define IPM_CURSOR_WAIT  MAKEINTRESOURCEW(32514)

struct GuiState {
  Session* session = nullptr;
  Catalog* catalog = nullptr;
  std::string filter;
  std::string status;
  std::vector<int> rows;      // index into catalog->builds, in the order shown
  HWND statusLabel = nullptr;
  HWND list = nullptr;
  HWND filterEdit = nullptr;
  HWND installButton = nullptr;
};

int selectedBuild(GuiState* st) {
  if (!st->list) return -1;
  int item = (int)SendMessageW(st->list, LVM_GETNEXTITEM, (WPARAM)-1, LVNI_SELECTED);
  if (item < 0 || item >= (int)st->rows.size()) return -1;
  return st->rows[item];
}

void updateInstallButton(GuiState* st) {
  const int index = selectedBuild(st);
  const bool canRun = index >= 0 && isRunnable(st->catalog->builds[index]);
  EnableWindow(st->installButton, canRun ? TRUE : FALSE);
}

void setGuiStatus(GuiState* st, const std::string& status) {
  st->status = status;
  if (!st->statusLabel) return;
  std::string text = st->catalog->summary();
  if (!status.empty()) text += "    " + status;
  SetWindowTextW(st->statusLabel, toWide(text).c_str());
}

// Rebuild the list from the filter. The catalogue itself is untouched: this
// only decides which of its rows are on screen.
void refreshGui(GuiState* st) {
  if (!st->list) return;
  SendMessageW(st->list, WM_SETREDRAW, FALSE, 0);
  SendMessageW(st->list, LVM_DELETEALLITEMS, 0, 0);
  st->rows = st->catalog->matching(st->filter);

  for (size_t i = 0; i < st->rows.size(); ++i) {
    const Build& build = st->catalog->builds[st->rows[i]];
    LVITEMW item = {};
    item.mask = LVIF_TEXT | LVIF_PARAM;
    item.iItem = (int)i;
    item.lParam = (LPARAM)i;
    std::wstring package = toWide(build.package);
    item.pszText = &package[0];
    SendMessageW(st->list, LVM_INSERTITEMW, 0, (LPARAM)&item);

    const std::wstring cells[4] = {
      toWide(build.version),
      toWide(build.platform),
      toWide(humanSize((uint64_t)std::max(0LL, build.size))),
      toWide(build.installKind.empty() ? "port" : build.installKind)
    };
    for (int column = 0; column < 4; ++column) {
      LVITEMW sub = {};
      sub.mask = LVIF_TEXT;
      sub.iItem = (int)i;
      sub.iSubItem = column + 1;
      sub.pszText = const_cast<LPWSTR>(cells[column].c_str());
      SendMessageW(st->list, LVM_SETITEMW, 0, (LPARAM)&sub);
    }
  }
  SendMessageW(st->list, WM_SETREDRAW, TRUE, 0);
  InvalidateRect(st->list, nullptr, TRUE);
  updateInstallButton(st);
}

void reloadCatalog(HWND hwnd, GuiState* st) {
  SetCursor(LoadCursorW(nullptr, IPM_CURSOR_WAIT));
  const bool ok = st->catalog->refresh(st->session->gh.token());
  SetCursor(LoadCursorW(nullptr, IPM_CURSOR_ARROW));
  if (hwnd) refreshGui(st);
  setGuiStatus(st, ok ? "" : st->catalog->error);
}

bool saveDestination(HWND hwnd, const Build& build, std::wstring* destination) {
  std::vector<wchar_t> path(32768, L'\0');
  const std::wstring suggested = toWide(build.filename);
  if (suggested.size() < path.size()) std::copy(suggested.begin(), suggested.end(), path.begin());

  OPENFILENAMEW dialog = {};
  dialog.lStructSize = sizeof(dialog);
  dialog.hwndOwner = hwnd;
  dialog.lpstrFile = path.data();
  dialog.nMaxFile = static_cast<DWORD>(path.size());
  dialog.lpstrFilter = L"Installers\0*.exe;*.msi\0All files\0*.*\0\0";
  dialog.lpstrDefExt = L"exe";
  dialog.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
  if (!GetSaveFileNameW(&dialog)) return false;
  *destination = path.data();
  return true;
}

// Install and download differ in exactly one place: where the file lands, and
// whether it is opened afterwards. The verification is the same for both.
void runBuild(HWND hwnd, GuiState* st, bool install) {
  const int index = selectedBuild(st);
  if (index < 0) return;
  const Build& build = st->catalog->builds[index];
  if (install && !isRunnable(build)) {
    setGuiStatus(st, build.package + " has no verified setup build on " + build.platform);
    return;
  }

  std::wstring destination;
  std::string error;
  if (install) {
    if (!installDestination(build.filename, &destination, &error)) { setGuiStatus(st, error); return; }
    if (GetFileAttributesW(destination.c_str()) != INVALID_FILE_ATTRIBUTES) DeleteFileW(destination.c_str());
  } else {
    if (!saveDestination(hwnd, build, &destination)) return;
  }

  setGuiStatus(st, (install ? "Downloading and verifying " : "Downloading ") + build.filename);
  UpdateWindow(hwnd);
  SetCursor(LoadCursorW(nullptr, IPM_CURSOR_WAIT));

  bool verified = false;
  const bool ok = downloadBuild(build, st->session->gh.token(), destination, &verified, &error);
  SetCursor(LoadCursorW(nullptr, IPM_CURSOR_ARROW));

  if (!ok) { setGuiStatus(st, error); return; }
  if (!install) {
    setGuiStatus(st, "Downloaded " + build.filename + (verified ? " (SHA-256 verified)" : " (unverified; not run)"));
    return;
  }
  if (!verified) {
    DeleteFileW(destination.c_str());
    setGuiStatus(st, "Refused: no verified SHA-256 digest for " + build.filename);
    return;
  }

  HINSTANCE launched = ShellExecuteW(nullptr, L"open", destination.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  if (reinterpret_cast<INT_PTR>(launched) <= 32) { setGuiStatus(st, "Verified installer downloaded but could not be opened"); return; }
  setGuiStatus(st, "Launched verified installer " + build.filename);
}

void openDownloadsFolder(HWND hwnd, GuiState* st) {
  std::wstring directory;
  std::string error;
  if (!downloadsDirectory(&directory, &error)) { setGuiStatus(st, error); return; }
  ShellExecuteW(hwnd, L"open", directory.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  setGuiStatus(st, "Opened the download folder");
}

LRESULT CALLBACK guiProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  GuiState* st = (GuiState*)GetWindowLongPtrW(hwnd, GWLP_USERDATA);
  switch (msg) {
    case WM_CREATE: {
      CREATESTRUCTW* cs = (CREATESTRUCTW*)lp;
      st = (GuiState*)cs->lpCreateParams;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, (LONG_PTR)st);

      st->statusLabel = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_LEFT,
                                        12, 10, 900, 22, hwnd, (HMENU)(INT_PTR)ID_STATUS, cs->hInstance, nullptr);

      CreateWindowExW(0, L"BUTTON", L"Refresh", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      12, 40, 82, 28, hwnd, (HMENU)(INT_PTR)ID_REFRESH, cs->hInstance, nullptr);
      st->installButton = CreateWindowExW(0, L"BUTTON", L"Install", WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON,
                      102, 40, 82, 28, hwnd, (HMENU)(INT_PTR)ID_INSTALL, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"Download", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      192, 40, 96, 28, hwnd, (HMENU)(INT_PTR)ID_DOWNLOAD, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"Open folder", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      296, 40, 108, 28, hwnd, (HMENU)(INT_PTR)ID_FOLDER, cs->hInstance, nullptr);
      st->filterEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL,
                                       560, 42, 352, 24, hwnd, (HMENU)(INT_PTR)ID_FILTER, cs->hInstance, nullptr);
      SendMessageW(st->filterEdit, EM_SETCUEBANNER, TRUE, (LPARAM)L"Filter packages");

      st->list = CreateWindowExW(WS_EX_CLIENTEDGE, WC_LISTVIEWW, L"",
                                 WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS,
                                 12, 78, 900, 470, hwnd, (HMENU)(INT_PTR)ID_LIST, cs->hInstance, nullptr);
      ListView_SetExtendedListViewStyle(st->list, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_LABELTIP);

      LVCOLUMNW col = {};
      col.mask = LVCF_TEXT | LVCF_WIDTH;
      const wchar_t* titles[5] = { L"Package", L"Version", L"Platform", L"Size", L"Kind" };
      const int widths[5] = { 300, 130, 150, 120, 90 };
      for (int i = 0; i < 5; ++i) {
        col.pszText = const_cast<LPWSTR>(titles[i]);
        col.cx = widths[i];
        ListView_InsertColumn(st->list, i, &col);
      }
      refreshGui(st);
      return 0;
    }
    case WM_SIZE: {
      if (!st) break;
      const int width = LOWORD(lp), height = HIWORD(lp);
      MoveWindow(st->statusLabel, 12, 10, width - 24, 22, TRUE);
      MoveWindow(st->filterEdit, std::max(440, width - 364), 42, 352, 24, TRUE);
      MoveWindow(st->list, 12, 78, width - 24, height - 112, TRUE);
      return 0;
    }
    case WM_COMMAND:
      if (!st) break;
      switch (LOWORD(wp)) {
        case ID_REFRESH: reloadCatalog(hwnd, st); return 0;
        case ID_INSTALL: runBuild(hwnd, st, true); return 0;
        case ID_DOWNLOAD: runBuild(hwnd, st, false); return 0;
        case ID_FOLDER: openDownloadsFolder(hwnd, st); return 0;
        case ID_FILTER:
          if (HIWORD(wp) == EN_CHANGE) {
            wchar_t text[256] = {};
            GetWindowTextW(st->filterEdit, text, 256);
            st->filter = toUtf8(text);
            refreshGui(st);
          }
          return 0;
      }
      break;
    case WM_NOTIFY: {
      if (!st) break;
      NMHDR* hdr = (NMHDR*)lp;
      if (!hdr || hdr->idFrom != ID_LIST) break;
      if (hdr->code == NM_DBLCLK) {
        const int index = selectedBuild(st);
        if (index >= 0) runBuild(hwnd, st, isRunnable(st->catalog->builds[index]));
        return 0;
      }
      if (hdr->code == LVN_ITEMCHANGED) { updateInstallButton(st); return 0; }
      break;
    }
    case WM_GETMINMAXINFO: {
      MINMAXINFO* info = (MINMAXINFO*)lp;
      info->ptMinTrackSize.x = 820;
      info->ptMinTrackSize.y = 480;
      return 0;
    }
    case WM_ERASEBKGND: {
      HDC dc = (HDC)wp;
      RECT rc; GetClientRect(hwnd, &rc);
      HBRUSH b = CreateSolidBrush(RGB(245, 247, 250));
      FillRect(dc, &rc, b); DeleteObject(b); return 1;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

int guiMain() {
  const std::string token = tokenFromEnv();
  if (token.empty()) { out("not signed in - set gittoken_zssx-2026_1 first."); return 1; }

  Session session(token);
  session.tokenSourceName = tokenSource();
  std::string error;
  if (!session.signIn(&error)) { out("not signed in (" + error + ")"); return 1; }

  // The catalogue is not fetched here any more. The window is what the user
  // asked for, and it does not need the index to exist: it is created and
  // painted first, and the load happens with it already on screen.
  Catalog catalog;

  INITCOMMONCONTROLSEX controls = { sizeof(controls), ICC_LISTVIEW_CLASSES };
  InitCommonControlsEx(&controls);

  GuiState state;
  state.session = &session;
  state.catalog = &catalog;
  state.status = catalog.error;

  WNDCLASSW wc = {};
  wc.lpfnWndProc = guiProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"InfinityPackageManagerWindow";
  wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
  wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
  RegisterClassW(&wc);

  HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"InfinityPackageManager",
                              WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                              1000, 700, nullptr, nullptr, wc.hInstance, &state);
  if (!hwnd) { out("cannot create the window"); return 1; }
  setGuiStatus(&state, "loading the catalogue…");
  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);  // the first frame is drawn before the first request is sent

  catalog.refresh(token);  // an empty catalogue is still a usable window
  refreshGui(&state);
  setGuiStatus(&state, catalog.error);

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}

// ---------------------------------------------------------------- launcher

int launcherMain(const Mode& m) {
  const std::string prefix = m.admin ? "ipmx" : "ipm";
  out(APP + std::string(" [") + (m.admin ? "管理员" : "用户") + "]");
  out("");
  out("  1) CLI       命令行");
  out("  2) GUI       图形界面");
  out("");
  out("  q) 退出");
  out("");

  HANDLE hIn = GetStdHandle(STD_INPUT_HANDLE);
  if (!hIn || hIn == INVALID_HANDLE_VALUE) return 0;
  DWORD mode = 0;
  if (!GetConsoleMode(hIn, &mode)) {
    out("(no console; start " + prefix + "_cli / _tui / _gui directly)");
    return 0;
  }

  fputs("> ", stdout);
  fflush(stdout);
  std::string answer;
  char buf[64];
  if (fgets(buf, sizeof(buf), stdin)) answer = trim(buf);
  if (answer.empty() || answer == "q" || answer == "Q") return 0;

  std::string target;
  if (answer == "1" || answer == "cli") target = "cli";
  else if (answer == "2" || answer == "gui") target = "gui";
  else { out("unknown choice"); return 1; }

  const std::string exe = siblingExe(prefix, target);
  STARTUPINFOW si = {};
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi = {};
  std::wstring cmd = toWide("\"" + exe + "\"");
  if (!CreateProcessW(nullptr, &cmd[0], nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi)) {
    out("cannot start " + exe);
    return 1;
  }
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return 0;
}

}  // namespace

// ---------------------------------------------------------------- entry

int main(int argc, char** argv) {
  // The file unblocks itself before anything else runs: the browser marks a
  // download with a Zone.Identifier stream, and Windows then questions the
  // program it just let the user download. Only that stream is removed; the
  // file's contents are never touched.
  inc::unblockSelf();
  inc::unblockSelfDirectory(2);

  // The console has to be asked for UTF-8 before anything is printed, or the
  // Chinese in the interface arrives as mojibake on a code page 936 machine.
  SetConsoleOutputCP(CP_UTF8);
  SetConsoleCP(CP_UTF8);

  std::vector<std::string> args;
  for (int i = 1; i < argc; i++) args.push_back(argv[i]);

  if (!args.empty()) {
    if (args[0] == "--version" || args[0] == "-v") { out(std::string(APP) + " " + version()); return 0; }
    if (args[0] == "--help" || args[0] == "-h" || args[0] == "help") { help(); return 0; }
  }

  // --serve-ui is what the Electron shell starts this program with. See the
  // note in the ui section above for why it is a flag and not a face.
  bool serveUiRequested = false;
  int uiPort = 7632;
  {
    std::vector<std::string> rest;
    for (const std::string& a : args) {
      if (a == "--serve-ui") { serveUiRequested = true; continue; }
      if (a == "--profile") { gProfile = true; continue; }
      if (startsWith(a, "--port=")) {
        const int asked = atoi(a.substr(7).c_str());
        if (asked > 0 && asked < 65536) uiPort = asked;
        serveUiRequested = true;
        continue;
      }
      rest.push_back(a);
    }
    args.swap(rest);
  }
  if (serveUiRequested) return serveUi(uiPort);

  Mode m = detectMode();

  // `ipm gui` and friends still work when the program is started under a name
  // that carries no mode, which is what happens from a source build.
  if (m.mode.empty() && !args.empty()) {
    const std::string& a = args[0];
    std::vector<std::string> rest(args.begin() + 1, args.end());
    if (a == "cli") return cliMain(rest);
    if (a == "gui") return guiMain();
    if (a == "launcher") return launcherMain(m);
  }

  if (m.mode == "launcher") return launcherMain(m);
  if (m.mode == "gui") return guiMain();
  if (m.mode == "cli") return cliMain(args);

  if (args.empty()) return guiMain();
  return cliMain(args);
}
