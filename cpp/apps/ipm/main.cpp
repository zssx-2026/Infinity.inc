#include "inc/env.hpp"
#include "inc/github.hpp"
#include "inc/http.hpp"
#include "inc/str.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>
#include <bcrypt.h>

#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

using namespace inc;

namespace {

const char* kOwner = "zssx-2026";
const char* kRepo = "applications";
const char* kApp = "Infinity Package Manager";

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

void out(const std::string& text) {
  fwrite(text.data(), 1, text.size(), stdout);
  fputc('\n', stdout);
}

void help() {
  out(std::string(kApp) + " [v" + version() + "]");
  out("  ipm --version");
  out("  ipm help");
  out("  ipm repos");
  out("  ipm catalog");
  out("  ipm info <name>");
  out("  ipm download <name> <platform> <destination>");
  out("  ipm install <name> <platform>");
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

std::vector<Build> buildsForRelease(GitHub& github, const Release& release) {
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

  std::vector<Build> builds;
  auto manifest = std::find_if(assets.begin(), assets.end(), [](const Asset& asset) {
    return iequals(asset.name, "name.txt");
  });
  if (manifest != assets.end()) {
    const std::string text = fetchNameTxt(github, *manifest);
    for (const std::string& rawLine : split(text, '\n')) {
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
  GitHub github(token);
  std::vector<Release> releases = github.listReleases(kOwner, kRepo, 100, error);
  if (releases.empty()) return false;
  for (const Release& release : releases) {
    if (release.draft) continue;
    std::vector<Build> releaseBuilds = buildsForRelease(github, release);
    builds->insert(builds->end(), releaseBuilds.begin(), releaseBuilds.end());
  }
  return true;
}

void printBuild(const Build& build, bool includePackage) {
  std::string line;
  if (includePackage) line = build.package + "\t";
  line += build.version + "\t" + build.platform + "\t" + humanSize(static_cast<uint64_t>(std::max(0LL, build.size))) + "\t" + build.url;
  out(line);
}

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

bool installDestination(const std::string& filename, std::wstring* destination, std::string* error) {
  std::wstring wideFilename;
  if (!safeInstallerFilename(filename, &wideFilename)) {
    *error = "unsafe installer filename";
    return false;
  }

  DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
  if (!length) { *error = "LOCALAPPDATA is not available"; return false; }
  std::vector<wchar_t> buffer(length);
  DWORD written = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), length);
  if (!written || written >= length) { *error = "cannot read LOCALAPPDATA"; return false; }
  std::wstring root(buffer.data(), written);
  if (!root.empty() && root.back() != L'\\' && root.back() != L'/') root.push_back(L'\\');

  const std::wstring managerDirectory = root + L"InfinityPackageManager";
  const std::wstring downloadsDirectory = managerDirectory + L"\\downloads";
  if (!createDirectoryIfNeeded(managerDirectory) || !createDirectoryIfNeeded(downloadsDirectory)) {
    *error = "cannot create installer download directory";
    return false;
  }
  *destination = downloadsDirectory + L"\\" + wideFilename;
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

int run(const std::vector<std::string>& args) {
  if (args.empty() || args[0] == "help" || args[0] == "--help" || args[0] == "-h") {
    help();
    return 0;
  }
  if (args[0] == "--version" || args[0] == "-v") {
    out(std::string(kApp) + " " + version());
    return 0;
  }

  if (args[0] != "repos" && args[0] != "catalog" && args[0] != "info" &&
      args[0] != "download" && args[0] != "install") {
    out("ipm: unknown command (use ipm help)");
    return 2;
  }
  if (args[0] == "info" && args.size() != 2) {
    out("usage: ipm info <name>");
    return 2;
  }
  if (args[0] == "download" && args.size() != 4) {
    out("usage: ipm download <name> <platform> <destination>");
    return 2;
  }
  if (args[0] == "install" && args.size() != 3) {
    out("usage: ipm install <name> <platform>");
    return 2;
  }

  const std::string token = tokenFromEnv();
  if (token.empty()) {
    out("ipm: GitHub token not found");
    return 1;
  }
  GitHub github(token);
  std::string error;

  if (args[0] == "repos") {
    const std::vector<std::string> repos = github.listRepos(&error);
    if (!error.empty()) { out("ipm: " + error); return 1; }
    for (const std::string& repo : repos) out(repo);
    if (repos.empty()) out("no repositories");
    return 0;
  }

  std::vector<Build> builds;
  if (!loadBuilds(token, &builds, &error)) {
    out("ipm: " + (error.empty() ? std::string("no releases") : error));
    return 1;
  }
  if (args[0] == "catalog") {
    if (builds.empty()) { out("no packages"); return 0; }
    for (const Build& build : builds) printBuild(build, true);
    return 0;
  }

  if (args[0] == "info") {
    std::vector<Build> found;
    for (const Build& build : builds) if (iequals(build.package, args[1])) found.push_back(build);
    if (found.empty()) { out("ipm: package not found: " + args[1]); return 1; }
    for (const Build& build : found) printBuild(build, false);
    return 0;
  }

  const bool installing = args[0] == "install";
  const std::string wantedName = args[1];
  const std::string wantedPlatform = canonicalPlatform(args[2]);
  auto selected = std::find_if(builds.begin(), builds.end(), [&](const Build& build) {
    return iequals(build.package, wantedName) &&
           (canonicalPlatform(build.platform) == wantedPlatform || canonicalPlatform(build.platform) == "any") &&
           (!installing || (iequals(build.installKind, "setup") && hasSha256Digest(build)));
  });
  if (selected == builds.end()) {
    out(installing ? "ipm: no setup build with a valid SHA-256 digest for " + wantedName + " on " + args[2]
                   : "ipm: no build for " + wantedName + " on " + args[2]);
    return 1;
  }

  std::wstring destination;
  std::string destinationLabel;
  if (installing) {
    if (!installDestination(selected->filename, &destination, &error)) {
      out("ipm: " + error);
      return 1;
    }
    destinationLabel = toUtf8(destination);
  } else {
    destination = toWide(args[3]);
    destinationLabel = args[3];
  }

  bool verified = false;
  if (!downloadBuild(*selected, token, destination, &verified, &error)) {
    out("ipm: " + error);
    return 1;
  }
  if (!verified) {
    if (installing) {
      DeleteFileW(destination.c_str());
      out("ipm: refusing to run an installer without a verified SHA-256 digest");
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
    out("ipm: verified installer downloaded but could not be opened");
    return 1;
  }
  out("launched verified installer " + selected->filename);
  return 0;
}

}  // namespace

int main(int, char**) {
  SetConsoleOutputCP(CP_UTF8);
  SetConsoleCP(CP_UTF8);
  int argc = 0;
  LPWSTR* wideArgv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!wideArgv) { out("ipm: cannot read command line"); return 1; }
  std::vector<std::string> args;
  for (int i = 1; i < argc; ++i) args.push_back(toUtf8(wideArgv[i]));
  LocalFree(wideArgv);
  return run(args);
}
