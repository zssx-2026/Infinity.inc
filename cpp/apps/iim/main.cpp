// main.cpp - Infinity Installer Manager, in C++.
//
// One installer for the whole suite.
//
// The other three applications install themselves. This one installs
// everything else: the products, the plugins they drive, and the resource
// packs they load. It is deliberately the only program that knows where an
// install lands, so "where did that plugin go" has exactly one answer.
//
//   iim_cli  iim_tui  iim_gui  iim_launcher        the user's copies
//   iimx_cli iimx_tui iimx_gui iimx_launcher       the administrator's copies
//
// The catalogue is the one InfinityPackageManager already reads - release
// pages in a single repository, each carrying a name.txt - and the page tag
// decides the category:
//
//   plugin-*                 a plugin
//   resource-*  pack-*       a resource pack
//   anything else            a product
//
// Two rules hold for everything here. Nothing is installed without a SHA-256
// digest that matches, and every install leaves a record beside itself, so the
// list of installed things is read off the disk instead of remembered in a
// file that can quietly disagree with it.
//
// The window is direct manipulation: a category, a filter, a list, and buttons
// that act on the selected row. There is no command box.

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
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
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

static const char* APP = "Infinity Installer Manager";

namespace {

const char* kOwner = "zssx-2026";
const char* kRepo = "applications";

// How many page manifests are fetched at once. The requests are independent
// and each one costs a round trip, so the catalogue waits for two waves
// instead of for one round trip per page.
const size_t kManifestWorkers = 6;

// ---------------------------------------------------------------- output

void out(const std::string& text) {
  fwrite(text.data(), 1, text.size(), stdout);
  fputc('\n', stdout);
}

// ---------------------------------------------------------------- categories

enum class Category { Product, Plugin, Resource };

const Category kCategories[3] = { Category::Product, Category::Plugin, Category::Resource };

const char* categoryKey(Category c) {
  switch (c) {
    case Category::Plugin: return "plugin";
    case Category::Resource: return "resource";
    default: return "product";
  }
}

// The page tag is the only thing that says what a release holds, so it is
// read rather than a second index maintained alongside it.
Category categoryFromTag(const std::string& tag) {
  const std::string t = lower(tag);
  if (startsWith(t, "plugin")) return Category::Plugin;
  if (startsWith(t, "resource") || startsWith(t, "pack")) return Category::Resource;
  return Category::Product;
}

bool parseCategory(const std::string& text, Category* category) {
  const std::string t = lower(trim(text));
  if (t == "product" || t == "products") { *category = Category::Product; return true; }
  if (t == "plugin" || t == "plugins") { *category = Category::Plugin; return true; }
  if (t == "resource" || t == "resources" || t == "pack" || t == "packs") { *category = Category::Resource; return true; }
  return false;
}

// The catalogue page a published item is written to.
std::string pageForCategory(Category c) {
  switch (c) {
    case Category::Plugin: return "plugin-catalog";
    case Category::Resource: return "resource-catalog";
    default: return "product-catalog";
  }
}

// ---------------------------------------------------------------- model

struct Item {
  Category category = Category::Product;
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

struct Installed {
  Category category = Category::Product;
  std::string name;
  std::string version;
  std::string platform;
  std::string filename;
  std::string digest;
  std::string installedAt;
  std::string directory;
  long long size = 0;
};

void help() {
  out(std::string(APP) + " [v" + version() + "]  ·  Infinity.Inc");
  out("");
  out("  iim                       open the terminal interface");
  out("  iim cli                   open the command line");
  out("  iim gui                   open the window");
  out("  iim login                 show which token is in use");
  out("  iim catalog [type]        everything, or product|plugin|resource");
  out("  iim search <keyword>      names that match");
  out("  iim info <name>           the builds of one item");
  out("  iim installed [type]      what this machine already has");
  out("  iim install <name> [platform]   download, verify, place or run");
  out("  iim download <name> <platform> <destination>");
  out("  iim remove <name>         uninstall an item");
  out("  iim publish <type> <file> <name> <version>");
  out("  iim --serve-ui            serve the interface the window draws");
  out("  iim --version             print the version");
  out("  iim --paths               where this program keeps things");
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

// The platform this program is running on, so `iim install <name>` with no
// platform named picks the right build instead of asking.
std::string hostPlatform() {
  SYSTEM_INFO info;
  GetNativeSystemInfo(&info);
  switch (info.wProcessorArchitecture) {
    case PROCESSOR_ARCHITECTURE_ARM64: return "windows-arm64";
    case PROCESSOR_ARCHITECTURE_INTEL: return "windows-x86";
    default: return "windows-x64";
  }
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

Item fallbackItem(const Asset& asset, const std::string& releaseTag, Category category) {
  Item item;
  item.category = category;
  item.filename = asset.name;
  item.url = asset.url;
  item.digest = asset.digest;
  item.contentType = asset.contentType;
  item.assetId = asset.id;
  item.size = asset.size;
  item.releaseTag = releaseTag;
  item.version = releaseTag.empty() ? "unknown" : releaseTag;
  item.platform = inferPlatform(asset.name);

  const std::string stem = stripExtension(asset.name);
  const std::string lowerStem = lower(stem);
  size_t marker = lowerStem.find("_v");
  size_t markerLength = 2;
  if (marker == std::string::npos) {
    marker = lowerStem.find("-v");
    markerLength = 2;
  }
  if (marker != std::string::npos) {
    item.package = stem.substr(0, marker);
    size_t versionStart = marker + markerLength;
    size_t versionEnd = stem.find('_', versionStart);
    if (versionEnd == std::string::npos) versionEnd = stem.find('-', versionStart);
    item.version = stem.substr(versionStart, versionEnd == std::string::npos ? std::string::npos : versionEnd - versionStart);
  } else {
    item.package = stem;
  }
  while (!item.package.empty() && (item.package.back() == '_' || item.package.back() == '-')) item.package.pop_back();
  if (item.package.empty()) item.package = stem;
  if (!item.version.empty() && (item.version[0] == 'v' || item.version[0] == 'V')) item.version.erase(0, 1);
  return item;
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

std::vector<Asset> assetsOf(const Release& release) {
  std::vector<Asset> assets;
  if (!release.assets.isArray()) return assets;
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
  return assets;
}

// The manifest asset beside a page's builds, when the page has one.
const Asset* manifestOf(const std::vector<Asset>& assets) {
  for (const Asset& asset : assets) if (iequals(asset.name, "name.txt")) return &asset;
  return nullptr;
}

// Building the page is CPU and nothing else: the manifest it may need has
// already been fetched, so this never touches the network.
std::vector<Item> itemsForRelease(const Release& release, const std::string& manifestText) {
  const Category category = categoryFromTag(release.tag);
  const std::vector<Asset> assets = assetsOf(release);

  std::vector<Item> items;
  if (!manifestText.empty()) {
    const std::string& text = manifestText;
    for (const std::string& rawLine : split(text, '\n')) {
      const std::string line = trim(rawLine);
      if (line.empty() || line[0] == '#') continue;
      const std::vector<std::string> columns = words(line);
      if (columns.size() < 4) continue;
      auto asset = std::find_if(assets.begin(), assets.end(), [&](const Asset& candidate) {
        return candidate.name == columns[0];
      });
      if (asset == assets.end()) continue;
      Item item;
      item.category = category;
      item.filename = asset->name;
      item.url = asset->url;
      item.digest = asset->digest;
      item.contentType = asset->contentType;
      item.assetId = asset->id;
      item.size = asset->size;
      item.releaseTag = release.tag;
      item.version = columns[1];
      if (!item.version.empty() && (item.version[0] == 'v' || item.version[0] == 'V')) item.version.erase(0, 1);
      item.package = columns[2];
      item.installKind = columns.size() >= 6 ? lower(columns[3]) : std::string();
      item.platform = columns.size() >= 6 && !columns[5].empty() ? lower(columns[5]) : "any";
      items.push_back(item);
    }
  }

  if (items.empty()) {
    for (const Asset& asset : assets) {
      if (iequals(asset.name, "name.txt") || iequals(asset.name, "README.md") || !isBuildAsset(asset.name)) continue;
      items.push_back(fallbackItem(asset, release.tag, category));
    }
  }
  return items;
}

/*
 * The catalogue is a list of pages and every page keeps its contents in a
 * name.txt asset. Fetching those one after another put a whole round trip per
 * page between the user and the catalogue - on the published catalogue that is
 * eight round trips before the window can show anything. The fetches do not
 * depend on each other, so they are made together and the pages are built from
 * what came back. A manifest that cannot be read still falls back to the
 * assets on the page, exactly as before.
 */
bool loadItems(const std::string& token, std::vector<Item>* items, std::string* error) {
  GitHub github(token);
  std::vector<Release> releases = github.listReleases(kOwner, kRepo, 100, error);
  if (releases.empty()) return false;

  std::vector<size_t> live;
  live.reserve(releases.size());
  for (size_t i = 0; i < releases.size(); ++i) if (!releases[i].draft) live.push_back(i);

  std::vector<std::string> manifests(releases.size());
  std::atomic<size_t> next(0);
  const size_t workerCount = std::min(kManifestWorkers, live.size());
  std::vector<std::thread> workers;
  workers.reserve(workerCount);
  for (size_t w = 0; w < workerCount; ++w) {
    workers.emplace_back([&]() {
      for (;;) {
        const size_t slot = next.fetch_add(1);
        if (slot >= live.size()) break;
        const size_t index = live[slot];
        const std::vector<Asset> assets = assetsOf(releases[index]);
        if (const Asset* manifest = manifestOf(assets)) {
          manifests[index] = fetchNameTxt(github, *manifest);
        }
      }
    });
  }
  for (std::thread& worker : workers) worker.join();

  for (size_t index : live) {
    std::vector<Item> page = itemsForRelease(releases[index], manifests[index]);
    items->insert(items->end(), page.begin(), page.end());
  }
  return true;
}

void sortItems(std::vector<Item>* items) {
  std::sort(items->begin(), items->end(), [](const Item& a, const Item& b) {
    if (a.category != b.category) return (int)a.category < (int)b.category;
    if (!iequals(a.package, b.package)) return lower(a.package) < lower(b.package);
    if (a.platform != b.platform) return a.platform < b.platform;
    return a.version > b.version;
  });
}

std::string itemKind(const Item& item) {
  if (!item.installKind.empty()) return item.installKind;
  return item.category == Category::Product ? "port" : categoryKey(item.category);
}

void printItem(const Item& item, bool includeCategory) {
  std::string line;
  if (includeCategory) line += std::string(categoryKey(item.category)) + "\t";
  line += item.package + "\t" + item.version + "\t" + item.platform + "\t" +
          humanSize(static_cast<uint64_t>(std::max(0LL, item.size))) + "\t" + item.url;
  out(line);
}

// ---------------------------------------------------------------- paths

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

bool createDirectoryTree(const std::wstring& path) {
  if (path.empty()) return false;
  if (CreateDirectoryW(path.c_str(), nullptr)) return true;
  if (GetLastError() != ERROR_ALREADY_EXISTS) {
    const size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos || slash == 0) return false;
    if (!createDirectoryTree(path.substr(0, slash))) return false;
    return CreateDirectoryW(path.c_str(), nullptr) != 0;
  }
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

bool removeDirectoryTree(const std::wstring& path) {
  WIN32_FIND_DATAW found;
  HANDLE search = FindFirstFileW((path + L"\\*").c_str(), &found);
  if (search != INVALID_HANDLE_VALUE) {
    do {
      const std::wstring name(found.cFileName);
      if (name == L"." || name == L"..") continue;
      const std::wstring child = path + L"\\" + name;
      if (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) removeDirectoryTree(child);
      else {
        SetFileAttributesW(child.c_str(), FILE_ATTRIBUTE_NORMAL);
        DeleteFileW(child.c_str());
      }
    } while (FindNextFileW(search, &found));
    FindClose(search);
  }
  return RemoveDirectoryW(path.c_str()) != 0;
}

// The one root every install lands under. Keeping the three categories apart
// means removing a plugin can never take a product with it.
bool rootDirectory(Category category, std::wstring* root, std::string* error) {
  DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
  if (!length) { *error = "LOCALAPPDATA is not available"; return false; }
  std::vector<wchar_t> buffer(length);
  DWORD written = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), length);
  if (!written || written >= length) { *error = "cannot read LOCALAPPDATA"; return false; }
  std::wstring base(buffer.data(), written);
  if (!base.empty() && base.back() != L'\\' && base.back() != L'/') base.push_back(L'\\');
  *root = base + L"Infinity.Inc\\" + toWide(categoryKey(category));
  if (!createDirectoryTree(*root)) { *error = "cannot create the install directory"; return false; }
  return true;
}

bool downloadsDirectory(std::wstring* directory, std::string* error) {
  DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
  if (!length) { *error = "LOCALAPPDATA is not available"; return false; }
  std::vector<wchar_t> buffer(length);
  DWORD written = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), length);
  if (!written || written >= length) { *error = "cannot read LOCALAPPDATA"; return false; }
  std::wstring base(buffer.data(), written);
  if (!base.empty() && base.back() != L'\\' && base.back() != L'/') base.push_back(L'\\');
  *directory = base + L"Infinity.Inc\\downloads";
  if (!createDirectoryTree(*directory)) { *error = "cannot create the download directory"; return false; }
  return true;
}

// A package name becomes a directory name, so it is validated rather than
// trusted: the catalogue is remote data and "../.." is a legal package name
// only until somebody types it.
bool safeName(const std::string& name, std::wstring* wide) {
  *wide = toWide(trim(name));
  if (wide->empty() || *wide == L"." || *wide == L".." || wide->back() == L'.' || wide->back() == L' ') return false;
  for (wchar_t c : *wide) if (c < 32 || wcschr(L"<>:\"/\\|?*", c)) return false;
  std::wstring stem = wide->substr(0, wide->find(L'.'));
  std::transform(stem.begin(), stem.end(), stem.begin(), [](wchar_t c) {
    return c >= L'a' && c <= L'z' ? static_cast<wchar_t>(c - L'a' + L'A') : c;
  });
  if (stem == L"CON" || stem == L"PRN" || stem == L"AUX" || stem == L"NUL" ||
      (stem.size() == 4 && (stem.compare(0, 3, L"COM") == 0 || stem.compare(0, 3, L"LPT") == 0) &&
       stem[3] >= L'1' && stem[3] <= L'9')) return false;
  return true;
}

bool itemDirectory(Category category, const std::string& name, std::wstring* directory, std::string* error) {
  std::wstring leaf;
  if (!safeName(name, &leaf)) { *error = "unsafe package name: " + name; return false; }
  std::wstring root;
  if (!rootDirectory(category, &root, error)) return false;
  *directory = root + L"\\" + leaf;
  return true;
}

// ---------------------------------------------------------------- digests

bool hasSha256Digest(const Item& item) {
  const std::string digest = lower(trim(item.digest));
  if (digest.size() != 71 || digest.compare(0, 7, "sha256:") != 0) return false;
  return std::all_of(digest.begin() + 7, digest.end(), [](unsigned char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
  });
}

// A product that ships a setup program is run. A plugin or a resource pack is
// a file that belongs in a folder, and so is a portable product.
bool runsInstaller(const Item& item) {
  return item.category == Category::Product && iequals(item.installKind, "setup");
}

bool installable(const Item& item) {
  return hasSha256Digest(item);
}

std::string sha256File(const std::wstring& path, std::string* error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot open the downloaded file for SHA-256"; return std::string(); }

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

  DWORD objectLength = 0, hashLength = 0, resultLength = 0;
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
    if (!ReadFile(file, buffer, sizeof(buffer), &bytesRead, nullptr)) return fail("cannot read the downloaded file");
    if (bytesRead && !BCRYPT_SUCCESS(BCryptHashData(hash, buffer, bytesRead, 0))) return fail("cannot hash the download");
  } while (bytesRead);

  if (!BCRYPT_SUCCESS(BCryptFinishHash(hash, hashBytes.data(), hashLength, 0))) return fail("cannot hash the download");
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

// Download to an explicit path, then check the digest. The temporary file is
// the same volume as the destination, so the move at the end is atomic and a
// half-written download never appears under the real name.
bool downloadVerified(const Item& item, const std::string& token, const std::wstring& destination,
                      bool* verified, std::string* error) {
  if (verified) *verified = false;
  if (item.assetId <= 0) { *error = "the asset has no GitHub id"; return false; }

  std::vector<wchar_t> fullBuffer(32768);
  DWORD fullLength = GetFullPathNameW(destination.c_str(), static_cast<DWORD>(fullBuffer.size()), fullBuffer.data(), nullptr);
  if (!fullLength || fullLength >= fullBuffer.size()) { *error = "invalid destination path"; return false; }
  const std::wstring fullPath(fullBuffer.data(), fullLength);

  const size_t separator = fullPath.find_last_of(L"\\/");
  if (separator == std::wstring::npos) { *error = "invalid destination path"; return false; }
  const std::wstring directory = fullPath.substr(0, separator + 1);
  if (!createDirectoryTree(directory)) { *error = "cannot create the destination directory"; return false; }

  std::wstring tempPath;
  HANDLE file = INVALID_HANDLE_VALUE;
  for (unsigned int attempt = 0; attempt < 64; ++attempt) {
    tempPath = directory + L".iim-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(attempt) + L".part";
    file = CreateFileW(tempPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_TEMPORARY, nullptr);
    if (file != INVALID_HANDLE_VALUE) break;
    if (GetLastError() != ERROR_FILE_EXISTS && GetLastError() != ERROR_ALREADY_EXISTS) {
      *error = "cannot create a temporary download file";
      return false;
    }
  }
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot reserve a temporary download file"; return false; }
  CloseHandle(file);

  // The streaming downloader takes an ANSI path, so the temporary name is
  // shortened when the full one does not survive the code page.
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
    *error = "the destination path is not supported by the streaming downloader";
    return false;
  }

  const std::string url = std::string(GitHub::apiBase()) + "/repos/" + kOwner + "/" + kRepo +
                          "/releases/assets/" + std::to_string(item.assetId);
  std::vector<std::string> headers = {"Accept: application/octet-stream"};
  Response response = httpDownloadFile(url, narrowPath, token, headers);
  if (!response.ok()) {
    DeleteFileW(tempPath.c_str());
    *error = response.error.empty() ? "HTTP " + std::to_string(response.status) : response.error;
    return false;
  }

  const std::string digest = lower(trim(item.digest));
  if (digest.compare(0, 7, "sha256:") == 0) {
    if (!hasSha256Digest(item)) { DeleteFileW(tempPath.c_str()); *error = "the asset digest is malformed"; return false; }
    const std::string actual = sha256File(tempPath, error);
    if (actual.empty()) { DeleteFileW(tempPath.c_str()); return false; }
    if (actual != digest.substr(7)) { DeleteFileW(tempPath.c_str()); *error = "SHA-256 digest mismatch"; return false; }
    if (verified) *verified = true;
  }

  if (GetFileAttributesW(fullPath.c_str()) != INVALID_FILE_ATTRIBUTES) DeleteFileW(fullPath.c_str());
  if (!MoveFileExW(tempPath.c_str(), fullPath.c_str(), MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(tempPath.c_str());
    *error = "cannot move the download into place";
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- installed

std::string isoNow() {
  SYSTEMTIME t;
  GetLocalTime(&t);
  char buffer[32];
  snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02d",
           t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
  return buffer;
}

bool writeRecord(const std::wstring& directory, const Item& item, const std::string& filename, long long size,
                 std::string* error) {
  Json record = Json::object();
  record.set("name", item.package);
  record.set("version", item.version);
  record.set("platform", item.platform);
  record.set("category", categoryKey(item.category));
  record.set("filename", filename);
  record.set("digest", item.digest);
  record.set("kind", itemKind(item));
  record.set("size", size);
  record.set("source", item.url);
  record.set("page", item.releaseTag);
  record.set("installedAt", isoNow());

  const std::wstring path = directory + L"\\item.json";
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot write the install record"; return false; }
  const std::string text = record.dump(2) + "\n";
  DWORD written = 0;
  const bool ok = WriteFile(file, text.data(), static_cast<DWORD>(text.size()), &written, nullptr) != 0;
  CloseHandle(file);
  if (!ok) *error = "cannot write the install record";
  return ok;
}

// The list of what is installed is read off the disk, not remembered. A
// remembered list and a folder can disagree; a folder cannot disagree with
// itself.
std::vector<Installed> scanInstalled(Category category) {
  std::vector<Installed> found;
  std::wstring root;
  std::string error;
  if (!rootDirectory(category, &root, &error)) return found;

  WIN32_FIND_DATAW entry;
  HANDLE search = FindFirstFileW((root + L"\\*").c_str(), &entry);
  if (search == INVALID_HANDLE_VALUE) return found;
  do {
    if (!(entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
    const std::wstring name(entry.cFileName);
    if (name == L"." || name == L"..") continue;
    const std::wstring directory = root + L"\\" + name;

    const std::wstring recordPath = directory + L"\\item.json";
    HANDLE file = CreateFileW(recordPath.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) continue;
    std::string text;
    char buffer[4096];
    DWORD read = 0;
    while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read) text.append(buffer, read);
    CloseHandle(file);

    bool ok = false;
    const Json record = Json::parse(text, &ok);
    if (!ok) continue;

    Installed item;
    item.category = category;
    item.name = record.s("name", toUtf8(name));
    item.version = record.s("version");
    item.platform = record.s("platform");
    item.filename = record.s("filename");
    item.digest = record.s("digest");
    item.installedAt = record.s("installedAt");
    item.directory = toUtf8(directory);
    item.size = record.i("size");
    found.push_back(item);
  } while (FindNextFileW(search, &entry));
  FindClose(search);

  std::sort(found.begin(), found.end(), [](const Installed& a, const Installed& b) {
    return lower(a.name) < lower(b.name);
  });
  return found;
}

std::vector<Installed> scanAllInstalled() {
  std::vector<Installed> all;
  for (Category c : kCategories) {
    std::vector<Installed> part = scanInstalled(c);
    all.insert(all.end(), part.begin(), part.end());
  }
  return all;
}

// ---------------------------------------------------------------- session

struct Session {
  GitHub gh;
  std::string tokenSourceName;
  bool ready = false;

  explicit Session(const std::string& token) : gh(token) {}

  bool signIn(std::string* error) {
    if (!gh.me(error)) return false;
    if (!gh.verifyIdentity(error)) return false;
    ready = true;
    return true;
  }
};

struct Catalog {
  std::vector<Item> items;
  std::string error;
  bool loaded = false;

  bool refresh(const std::string& token) {
    std::vector<Item> fresh;
    std::string failure;
    if (!loadItems(token, &fresh, &failure)) {
      error = failure.empty() ? "cannot read the catalogue" : failure;
      return false;
    }
    sortItems(&fresh);
    items.swap(fresh);
    error.clear();
    loaded = true;
    return true;
  }

  std::vector<int> matching(Category category, const std::string& filter) const {
    std::vector<int> rows;
    const std::string needle = lower(trim(filter));
    for (size_t i = 0; i < items.size(); ++i) {
      if (items[i].category != category) continue;
      if (needle.empty()) { rows.push_back((int)i); continue; }
      const Item& it = items[i];
      const std::string haystack = lower(it.package + " " + it.version + " " + it.platform + " " + it.filename);
      if (haystack.find(needle) != std::string::npos) rows.push_back((int)i);
    }
    return rows;
  }

  // The newest build for a name on the running platform, preferring a real
  // match over an "any" build.
  const Item* best(const std::string& name, const std::string& platform) const {
    const Item* exact = nullptr;
    const Item* any = nullptr;
    for (const Item& it : items) {
      if (!iequals(it.package, name) || !installable(it)) continue;
      const std::string p = canonicalPlatform(it.platform);
      if (p == platform) { if (!exact) exact = &it; }
      else if (p == "any") { if (!any) any = &it; }
    }
    return exact ? exact : any;
  }

  std::string summary() const {
    if (!loaded) return error.empty() ? "not loaded" : error;
    size_t counts[3] = { 0, 0, 0 };
    for (const Item& it : items) counts[(int)it.category]++;
    return std::to_string(counts[0]) + " products  ·  " + std::to_string(counts[1]) + " plugins  ·  " +
           std::to_string(counts[2]) + " resources";
  }
};

// Put a local file into the catalogue: the asset goes up first, then the
// name.txt line that makes it visible. A page that lists a file it does not
// hold is worse than a file nothing lists, so the order matters.
bool publish(GitHub& github, Category category, const std::string& file, const std::string& name,
             const std::string& versionText, const std::string& platform, std::string* error) {
  const std::wstring wideFile = toWide(file);
  const DWORD attributes = GetFileAttributesW(wideFile.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
    *error = "not a file: " + file;
    return false;
  }
  size_t slash = file.find_last_of("\\/");
  const std::string assetName = slash == std::string::npos ? file : file.substr(slash + 1);

  const std::string tag = pageForCategory(category);
  Release release = github.releaseByTag(kOwner, kRepo, tag, error);
  if (release.id == 0) {
    if (!github.createRelease(kOwner, kRepo, tag, tag, error)) return false;
    release = github.releaseByTag(kOwner, kRepo, tag, error);
    if (release.id == 0) { *error = "cannot create the catalogue page " + tag; return false; }
  }

  // An asset cannot be replaced in place, so an older file of the same name
  // is removed first.
  std::string existingManifest;
  for (const Json& value : release.assets.items()) {
    const std::string asset = value.s("name");
    if (iequals(asset, assetName)) {
      github.deleteAsset(kOwner, kRepo, value.i("id"), nullptr);
    } else if (iequals(asset, "name.txt")) {
      RequestOptions options;
      options.token = github.token();
      options.headers.push_back("Accept: application/octet-stream");
      options.headers.push_back("User-Agent: Infinity.Inc");
      Response response = httpRequest(std::string(GitHub::apiBase()) + "/repos/" + kOwner + "/" + kRepo +
                                        "/releases/assets/" + std::to_string(value.i("id")), options);
      if (response.ok()) existingManifest = response.body;
    }
  }

  if (github.uploadAsset(kOwner, kRepo, release.id, file, assetName, error) == 0) return false;

  std::string line = assetName + " " + versionText + " " + name + " " + categoryKey(category) + " Infinity.Inc " + platform;
  std::vector<std::string> lines;
  bool replaced = false;
  for (const std::string& raw : split(existingManifest, '\n')) {
    const std::string current = trim(raw);
    if (current.empty()) continue;
    const std::vector<std::string> columns = words(current);
    if (!columns.empty() && columns[0] == assetName) {
      if (!replaced) { lines.push_back(line); replaced = true; }
      continue;
    }
    lines.push_back(current);
  }
  if (!replaced) lines.push_back(line);

  std::string manifest;
  for (const std::string& current : lines) manifest += current + "\n";

  std::wstring temporary;
  std::string why;
  if (!downloadsDirectory(&temporary, &why)) { *error = why; return false; }
  temporary += L"\\name.txt";
  HANDLE handle = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (handle == INVALID_HANDLE_VALUE) { *error = "cannot stage name.txt"; return false; }
  DWORD written = 0;
  WriteFile(handle, manifest.data(), static_cast<DWORD>(manifest.size()), &written, nullptr);
  CloseHandle(handle);

  for (const Json& value : release.assets.items()) {
    if (iequals(value.s("name"), "name.txt")) github.deleteAsset(kOwner, kRepo, value.i("id"), nullptr);
  }
  if (github.uploadAsset(kOwner, kRepo, release.id, toUtf8(temporary), "name.txt", error) == 0) return false;
  return true;
}

}  // namespace

// ---------------------------------------------------------------- cli

namespace {

int cliMain(const std::vector<std::string>& args) {
  if (!args.empty()) {
    const std::string& a = args[0];
    if (a == "--version" || a == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (a == "--paths") {
      out("exe        " + exeDir());
      out("version    " + std::string(version()));
      out("platform   " + hostPlatform());
      out("token      " + (tokenSource().empty() ? std::string("(none)") : tokenSource()));
      for (Category c : kCategories) {
        std::wstring root;
        std::string error;
        const bool ok = rootDirectory(c, &root, &error);
        out(std::string(categoryKey(c)).append(10 - std::string(categoryKey(c)).size(), ' ') +
            (ok ? toUtf8(root) : "(unavailable: " + error + ")"));
      }
      return 0;
    }
    if (a == "help" || a == "--help" || a == "-h") { help(); return 0; }
  }

  // Past the fast paths, so the rest of the folder is cleared only when the
  // command is actually going to do something.
  inc::unblockSelfDirectory(2);

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

  if (args[0] == "installed") {
    Category only;
    const bool filtered = args.size() >= 2 && parseCategory(args[1], &only);
    if (args.size() >= 2 && !filtered) { out(color(C_RED, "unknown type: " + args[1])); return 2; }
    std::vector<Installed> all;
    for (Category c : kCategories) {
      if (filtered && c != only) continue;
      std::vector<Installed> part = scanInstalled(c);
      all.insert(all.end(), part.begin(), part.end());
    }
    if (all.empty()) { out(color(C_DIM, "nothing installed")); return 0; }
    for (const Installed& it : all) {
      out(std::string(categoryKey(it.category)) + "\t" + it.name + "\t" + it.version + "\t" +
          it.platform + "\t" + it.directory);
    }
    return 0;
  }

  if (args[0] == "publish") {
    if (args.size() != 5) {
      out(color(C_RED, "usage: iim publish <type> <file> <name> <version>"));
      return 2;
    }
    Category category;
    if (!parseCategory(args[1], &category)) { out(color(C_RED, "unknown type: " + args[1])); return 2; }
    if (!publish(session.gh, category, args[2], args[3], args[4], hostPlatform(), &error)) {
      out(color(C_RED, "iim: " + error));
      return 1;
    }
    out("published " + args[3] + " " + args[4] + " to " + pageForCategory(category));
    return 0;
  }

  const bool known = args[0] == "catalog" || args[0] == "search" || args[0] == "info" ||
                     args[0] == "download" || args[0] == "install" || args[0] == "remove";
  if (!known) { out(color(C_RED, args[0] + ": command not found")); return 2; }
  if (args[0] == "search" && args.size() != 2) { out(color(C_RED, "usage: iim search <keyword>")); return 2; }
  if (args[0] == "info" && args.size() != 2) { out(color(C_RED, "usage: iim info <name>")); return 2; }
  if (args[0] == "download" && args.size() != 4) { out(color(C_RED, "usage: iim download <name> <platform> <destination>")); return 2; }
  if (args[0] == "install" && args.size() > 3) { out(color(C_RED, "usage: iim install <name> [platform]")); return 2; }
  if (args[0] == "remove" && args.size() != 2) { out(color(C_RED, "usage: iim remove <name>")); return 2; }

  if (args[0] == "remove") {
    bool removed = false;
    for (Category c : kCategories) {
      std::wstring directory;
      if (!itemDirectory(c, args[1], &directory, &error)) { out(color(C_RED, "iim: " + error)); return 1; }
      if (GetFileAttributesW(directory.c_str()) == INVALID_FILE_ATTRIBUTES) continue;
      if (!removeDirectoryTree(directory)) { out(color(C_RED, "iim: cannot remove " + toUtf8(directory))); return 1; }
      out("removed " + toUtf8(directory));
      removed = true;
    }
    if (!removed) { out(color(C_RED, "iim: not installed: " + args[1])); return 1; }
    return 0;
  }

  Catalog catalog;
  if (!catalog.refresh(token)) { out(color(C_RED, "iim: " + catalog.error)); return 1; }

  if (args[0] == "catalog") {
    Category only;
    const bool filtered = args.size() >= 2 && parseCategory(args[1], &only);
    if (args.size() >= 2 && !filtered) { out(color(C_RED, "unknown type: " + args[1])); return 2; }
    size_t printed = 0;
    for (const Item& item : catalog.items) {
      if (filtered && item.category != only) continue;
      printItem(item, true);
      printed++;
    }
    if (!printed) out(color(C_DIM, "no packages"));
    return 0;
  }

  if (args[0] == "search") {
    const std::string needle = lower(args[1]);
    size_t printed = 0;
    for (const Item& item : catalog.items) {
      const std::string haystack = lower(item.package + " " + item.version + " " + item.platform + " " + item.filename);
      if (haystack.find(needle) == std::string::npos) continue;
      printItem(item, true);
      printed++;
    }
    if (!printed) { out(color(C_DIM, "no match for " + args[1])); return 1; }
    return 0;
  }

  if (args[0] == "info") {
    bool found = false;
    for (const Item& item : catalog.items) {
      if (!iequals(item.package, args[1])) continue;
      printItem(item, true);
      found = true;
    }
    if (!found) { out(color(C_RED, "iim: package not found: " + args[1])); return 1; }
    return 0;
  }

  const bool installing = args[0] == "install";
  const std::string wanted = args[1];
  const std::string platform = args.size() >= 3 ? canonicalPlatform(args[2]) : hostPlatform();
  const Item* selected = catalog.best(wanted, platform);
  if (!selected) {
    out(color(C_RED, "iim: no build with a valid SHA-256 digest for " + wanted + " on " + platform));
    return 1;
  }

  if (!installing) {
    const std::wstring destination = toWide(args[3]);
    bool verified = false;
    if (!downloadVerified(*selected, token, destination, &verified, &error)) { out(color(C_RED, "iim: " + error)); return 1; }
    out("downloaded " + selected->filename + " -> " + args[3] + (verified ? "  (SHA-256 verified)" : "  (digest unavailable)"));
    return 0;
  }

  std::wstring directory;
  if (!itemDirectory(selected->category, selected->package, &directory, &error)) { out(color(C_RED, "iim: " + error)); return 1; }
  const std::wstring destination = directory + L"\\" + toWide(selected->filename);

  bool verified = false;
  if (!downloadVerified(*selected, token, destination, &verified, &error)) { out(color(C_RED, "iim: " + error)); return 1; }
  if (!verified) {
    DeleteFileW(destination.c_str());
    out(color(C_RED, "iim: refusing to install without a verified SHA-256 digest"));
    return 1;
  }
  writeRecord(directory, *selected, selected->filename, selected->size, &error);

  if (runsInstaller(*selected)) {
    HINSTANCE launched = ShellExecuteW(nullptr, L"open", destination.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(launched) <= 32) {
      out("installed " + selected->package + " (the setup program could not be opened)");
      return 1;
    }
    out("installed " + selected->package + " " + selected->version + "  ·  setup launched");
    return 0;
  }

  out("installed " + selected->package + " " + selected->version + "  ->  " + toUtf8(directory));
  return 0;
}

// ---------------------------------------------------------------- ui

/*
 * The window is Electron; this process is what it talks to.
 *
 * The page never decides whether a build may be installed - it reads the
 * digest and disables the button - but the gate that matters is the one in
 * the install handler below, because a page is a suggestion and the server is
 * the rule. Nothing is downloaded into an install directory, and nothing is
 * run, without a well-formed SHA-256 digest.
 *
 * A failure is a JSON object carrying a message and a non-zero status. An
 * empty 200 would make the page show an empty catalogue where it should show
 * a reason.
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

// The architecture this copy of the program is running on, so the page can say
// which build it is looking at without asking.
std::string hostPlatformName() {
  SYSTEM_INFO info;
  GetNativeSystemInfo(&info);
  switch (info.wProcessorArchitecture) {
    case PROCESSOR_ARCHITECTURE_ARM64: return "windows-arm64";
    case PROCESSOR_ARCHITECTURE_INTEL: return "windows-x86";
    default: return "windows-x64";
  }
}

// The shape the page reads for one catalogue row.
Json itemJson(const Item& item) {
  Json j = Json::object();
  j.set("name", item.package);
  j.set("category", categoryKey(item.category));
  j.set("version", item.version);
  j.set("platform", item.platform);
  j.set("size", item.size);
  j.set("kind", itemKind(item));
  j.set("page", item.releaseTag);
  j.set("digest", item.digest);
  j.set("url", item.url);
  // The page uses this to disable Install. It is a convenience, not the gate.
  j.set("installable", installable(item));
  return j;
}

// The shape the page reads for one installed row.
Json installedJson(const Installed& item) {
  Json j = Json::object();
  j.set("name", item.name);
  j.set("category", categoryKey(item.category));
  j.set("version", item.version);
  j.set("platform", item.platform);
  j.set("size", item.size);
  j.set("digest", item.digest);
  j.set("installedAt", item.installedAt);
  j.set("directory", item.directory);
  return j;
}

Json summaryJson(const Catalog& catalog) {
  size_t counts[3] = { 0, 0, 0 };
  for (const Item& item : catalog.items) counts[(int)item.category]++;
  Json summary = Json::object();
  summary.set("loaded", catalog.loaded);
  summary.set("products", (long long)counts[0]);
  summary.set("plugins", (long long)counts[1]);
  summary.set("resources", (long long)counts[2]);
  // An unread catalogue is reported rather than rendered as an empty one:
  // "you have nothing" and "I could not read what you have" are different.
  if (!catalog.error.empty()) summary.set("error", catalog.error);
  return summary;
}

int serveUi(int port) {
  inc::unblockSelfDirectory(2);
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

  Catalog catalog;
  catalog.refresh(token);

  UiServer server;
  server.route("GET", "/", [](const UiRequest&) { return UiResponse::html(uiHtml()); });
  server.route("GET", "/app.css", [](const UiRequest&) { return UiResponse::css(uiCss()); });
  server.route("GET", "/app.js", [](const UiRequest&) { return UiResponse::js(uiJs()); });

  server.route("GET", "/api/state", [&](const UiRequest&) {
    Json j = Json::object();
    j.set("app", APP);
    j.set("version", version());
    j.set("login", session.gh.login());
    j.set("tokenSource", session.tokenSourceName);
    j.set("platform", hostPlatformName());
    j.set("summary", summaryJson(catalog));
    return UiResponse::json(j.dump(2));
  });

  server.route("GET", "/api/catalog", [&](const UiRequest& request) {
    Category category = Category::Product;
    const std::string asked = queryValue(request, "category");
    if (!asked.empty() && !parseCategory(asked, &category)) return uiFailure("unknown category: " + asked, 400);
    Json packages = Json::array();
    for (int index : catalog.matching(category, "")) packages.push(itemJson(catalog.items[index]));
    Json j = Json::object();
    j.set("packages", packages);
    return UiResponse::json(j.dump(2));
  });

  // Search spans every category; the page narrows the result to the tab it is
  // showing, so the server does not have to be told which tab that is.
  server.route("GET", "/api/search", [&](const UiRequest& request) {
    const std::string needle = queryValue(request, "q");
    Json packages = Json::array();
    for (Category category : kCategories) {
      for (int index : catalog.matching(category, needle)) packages.push(itemJson(catalog.items[index]));
    }
    Json j = Json::object();
    j.set("packages", packages);
    return UiResponse::json(j.dump(2));
  });

  server.route("GET", "/api/installed", [&](const UiRequest&) {
    Json installed = Json::array();
    for (const Installed& item : scanAllInstalled()) installed.push(installedJson(item));
    Json j = Json::object();
    j.set("installed", installed);
    return UiResponse::json(j.dump(2));
  });

  server.route("POST", "/api/refresh", [&](const UiRequest&) {
    const bool ok = catalog.refresh(token);
    Json j = Json::object();
    if (ok) j.set("message", "Catalogue refreshed.");
    else j.set("error", catalog.error.empty() ? std::string("cannot read the catalogue") : catalog.error);
    return UiResponse::withStatus(UiResponse::json(j.dump(2)), ok ? 200 : 502);
  });

  /*
   * Find the build the page asked for. The page sends the exact name and
   * platform of the row it was shown, so this is an exact lookup - falling
   * back to "the best one for this platform" would act on something the user
   * did not point at.
   */
  auto locate = [&](const UiRequest& request, const Item** found, std::string* why) -> bool {
    const std::string name = queryValue(request, "name");
    const std::string platform = queryValue(request, "platform");
    if (name.empty()) { *why = "no name given"; return false; }
    for (const Item& item : catalog.items) {
      if (!iequals(item.package, name)) continue;
      if (!platform.empty() && !iequals(item.platform, platform)) continue;
      *found = &item;
      return true;
    }
    *why = "no build for " + name + (platform.empty() ? "" : " on " + platform);
    return false;
  };

  server.route("POST", "/api/download", [&](const UiRequest& request) {
    const Item* item = nullptr;
    std::string why;
    if (!locate(request, &item, &why)) return uiFailure(why, 404);

    std::wstring directory;
    if (!downloadsDirectory(&directory, &why)) return uiFailure(why, 500);
    const std::wstring destination = directory + L"\\" + toWide(item->filename);
    if (GetFileAttributesW(destination.c_str()) != INVALID_FILE_ATTRIBUTES) DeleteFileW(destination.c_str());

    bool verified = false;
    if (!downloadVerified(*item, token, destination, &verified, &why)) return uiFailure(why, 502);

    Json j = Json::object();
    j.set("message", "Downloaded " + item->filename +
                     (verified ? " and the SHA-256 matches." : " but no digest was reported."));
    j.set("verified", verified);
    j.set("path", toUtf8(destination));
    return UiResponse::json(j.dump(2));
  });

  server.route("POST", "/api/install", [&](const UiRequest& request) {
    const Item* item = nullptr;
    std::string why;
    if (!locate(request, &item, &why)) return uiFailure(why, 404);

    // The gate. The page disables the button when a build has no digest, but
    // the page is a suggestion and this is the rule: without a well-formed
    // SHA-256 digest nothing is downloaded into an install directory and
    // nothing is run.
    if (!hasSha256Digest(*item)) {
      return uiFailure(item->package + " has no valid SHA-256 digest on " + item->platform +
                       "; refusing to install", 400);
    }

    std::wstring directory;
    if (!itemDirectory(item->category, item->package, &directory, &why)) return uiFailure(why, 500);
    const std::wstring destination = directory + L"\\" + toWide(item->filename);
    if (GetFileAttributesW(destination.c_str()) != INVALID_FILE_ATTRIBUTES) DeleteFileW(destination.c_str());

    bool verified = false;
    if (!downloadVerified(*item, token, destination, &verified, &why)) return uiFailure(why, 502);
    if (!verified) {
      DeleteFileW(destination.c_str());
      return uiFailure("the SHA-256 could not be verified; nothing was installed", 400);
    }

    writeRecord(directory, *item, item->filename, item->size, &why);

    std::string message = "Installed " + item->package + " " + item->version;
    if (runsInstaller(*item)) {
      HINSTANCE launched = ShellExecuteW(nullptr, L"open", destination.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
      if (reinterpret_cast<INT_PTR>(launched) <= 32) {
        return uiFailure("the verified installer was downloaded but could not be opened", 500);
      }
      message = "Verified " + item->filename + " and started it.";
    }
    Json j = Json::object();
    j.set("message", message);
    return UiResponse::json(j.dump(2));
  });

  server.route("POST", "/api/remove", [&](const UiRequest& request) {
    const std::string name = queryValue(request, "name");
    if (name.empty()) return uiFailure("no name given", 400);
    bool removed = false;
    std::string why;
    for (Category category : kCategories) {
      std::wstring directory;
      if (!itemDirectory(category, name, &directory, &why)) return uiFailure(why, 500);
      if (GetFileAttributesW(directory.c_str()) == INVALID_FILE_ATTRIBUTES) continue;
      if (!removeDirectoryTree(directory)) return uiFailure("cannot remove " + toUtf8(directory), 500);
      removed = true;
    }
    if (!removed) return uiFailure("not installed: " + name, 404);
    Json j = Json::object();
    j.set("message", "Removed " + name + ".");
    return UiResponse::json(j.dump(2));
  });

  server.route("POST", "/api/open-folder", [&](const UiRequest& request) {
    const std::string name = queryValue(request, "name");
    std::wstring directory;
    std::string why;
    bool found = false;
    if (!name.empty()) {
      for (const Installed& item : scanAllInstalled()) {
        if (!iequals(item.name, name)) continue;
        directory = toWide(item.directory);
        found = true;
        break;
      }
    }
    if (!found && !rootDirectory(Category::Product, &directory, &why)) return uiFailure(why, 500);
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
  out("Infinity Installer Manager interface  " + server.url());
  out("open it in the window, or point a browser at it; close this to stop.");
  server.wait();
  return 0;
}

// ---------------------------------------------------------------- views

// The four things a person looks at: three kinds of catalogue and what is
// already on the machine. Keeping "Installed" beside the catalogues is the
// point of this program - one window answers both "what can I get" and "what
// have I got".
const int kViewCount = 4;

bool viewIsCatalog(int view) { return view >= 0 && view < 3; }
Category viewCategory(int view) { return kCategories[std::min(2, std::max(0, view))]; }

// ---------------------------------------------------------------- gui

const int ID_STATUS = 4001;
const int ID_VIEW = 4002;
const int ID_FILTER = 4003;
const int ID_REFRESH = 4004;
const int ID_INSTALL = 4005;
const int ID_DOWNLOAD = 4006;
const int ID_REMOVE = 4007;
const int ID_FOLDER = 4008;
const int ID_LIST = 4009;

#define IIM_CURSOR_ARROW MAKEINTRESOURCEW(32512)
#define IIM_CURSOR_WAIT  MAKEINTRESOURCEW(32514)

// One window, one background brush. Creating and deleting a brush on every
// WM_ERASEBKGND is a GDI object allocation on every repaint.
HBRUSH backgroundBrush = nullptr;

struct GuiState {
  Session* session = nullptr;
  Catalog* catalog = nullptr;
  int view = 0;
  std::string filter;
  std::string status;
  std::vector<int> rows;          // catalogue rows on screen
  std::vector<Installed> installed;
  HWND statusLabel = nullptr;
  HWND viewBox = nullptr;
  HWND filterEdit = nullptr;
  HWND list = nullptr;
  HWND installButton = nullptr;
  HWND removeButton = nullptr;
};

bool viewIsCatalogGui(GuiState* st) { return viewIsCatalog(st->view); }

int selectedCatalogItem(GuiState* st) {
  if (!st->list) return -1;
  const int item = (int)SendMessageW(st->list, LVM_GETNEXTITEM, (WPARAM)-1, LVNI_SELECTED);
  if (item < 0 || item >= (int)st->rows.size()) return -1;
  return st->rows[item];
}

void updateButtons(GuiState* st) {
  const bool catalogView = viewIsCatalogGui(st);
  const int item = selectedCatalogItem(st);
  const bool canInstall = catalogView && item >= 0 && installable(st->catalog->items[item]);
  EnableWindow(st->installButton, canInstall ? TRUE : FALSE);
  EnableWindow(st->removeButton, (!catalogView && item >= 0) ? TRUE : FALSE);
}

void setGuiStatus(GuiState* st, const std::string& status) {
  st->status = status;
  if (!st->statusLabel) return;
  std::string text = st->catalog->summary();
  if (!status.empty()) text += "    " + status;
  SetWindowTextW(st->statusLabel, toWide(text).c_str());
}

void refreshGui(GuiState* st) {
  if (!st->list) return;
  SendMessageW(st->list, WM_SETREDRAW, FALSE, 0);
  SendMessageW(st->list, LVM_DELETEALLITEMS, 0, 0);

  if (viewIsCatalogGui(st)) {
    st->rows = st->catalog->matching(viewCategory(st->view), st->filter);
    st->installed.clear();
    for (size_t i = 0; i < st->rows.size(); ++i) {
      const Item& item = st->catalog->items[st->rows[i]];
      LVITEMW row = {};
      row.mask = LVIF_TEXT | LVIF_PARAM;
      row.iItem = (int)i;
      row.lParam = (LPARAM)i;
      std::wstring package = toWide(item.package);
      row.pszText = &package[0];
      SendMessageW(st->list, LVM_INSERTITEMW, 0, (LPARAM)&row);

      const std::wstring cells[4] = {
        toWide(item.version),
        toWide(item.platform),
        toWide(humanSize((uint64_t)std::max(0LL, item.size))),
        toWide(itemKind(item))
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
  } else {
    st->installed = scanAllInstalled();
    st->rows.clear();
    const std::string needle = lower(trim(st->filter));
    for (size_t i = 0; i < st->installed.size(); ++i) {
      const Installed& it = st->installed[i];
      if (!needle.empty()) {
        const std::string haystack = lower(it.name + " " + it.version + " " + it.platform);
        if (haystack.find(needle) == std::string::npos) continue;
      }
      st->rows.push_back((int)i);
      LVITEMW row = {};
      row.mask = LVIF_TEXT | LVIF_PARAM;
      row.iItem = (int)(st->rows.size() - 1);
      row.lParam = (LPARAM)(st->rows.size() - 1);
      std::wstring name = toWide(it.name);
      row.pszText = &name[0];
      SendMessageW(st->list, LVM_INSERTITEMW, 0, (LPARAM)&row);

      const std::wstring cells[4] = {
        toWide(categoryKey(it.category)),
        toWide(it.version),
        toWide(it.platform),
        toWide(it.installedAt)
      };
      for (int column = 0; column < 4; ++column) {
        LVITEMW sub = {};
        sub.mask = LVIF_TEXT;
        sub.iItem = (int)(st->rows.size() - 1);
        sub.iSubItem = column + 1;
        sub.pszText = const_cast<LPWSTR>(cells[column].c_str());
        SendMessageW(st->list, LVM_SETITEMW, 0, (LPARAM)&sub);
      }
    }
  }

  SendMessageW(st->list, WM_SETREDRAW, TRUE, 0);
  InvalidateRect(st->list, nullptr, TRUE);
  updateButtons(st);
}

void reloadCatalog(HWND hwnd, GuiState* st) {
  SetCursor(LoadCursorW(nullptr, IIM_CURSOR_WAIT));
  const bool ok = st->catalog->refresh(st->session->gh.token());
  SetCursor(LoadCursorW(nullptr, IIM_CURSOR_ARROW));
  if (hwnd) refreshGui(st);
  setGuiStatus(st, ok ? "" : st->catalog->error);
}

bool saveDestination(HWND hwnd, const Item& item, std::wstring* destination) {
  std::vector<wchar_t> path(32768, L'\0');
  const std::wstring suggested = toWide(item.filename);
  if (suggested.size() < path.size()) std::copy(suggested.begin(), suggested.end(), path.begin());

  OPENFILENAMEW dialog = {};
  dialog.lStructSize = sizeof(dialog);
  dialog.hwndOwner = hwnd;
  dialog.lpstrFile = path.data();
  dialog.nMaxFile = static_cast<DWORD>(path.size());
  dialog.lpstrFilter = L"All files\0*.*\0\0";
  dialog.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
  if (!GetSaveFileNameW(&dialog)) return false;
  *destination = path.data();
  return true;
}

void installSelected(HWND hwnd, GuiState* st, bool install) {
  const int index = selectedCatalogItem(st);
  if (index < 0) return;
  const Item& item = st->catalog->items[index];
  if (install && !installable(item)) {
    setGuiStatus(st, item.package + " has no SHA-256 digest; refusing to install");
    return;
  }

  std::wstring destination;
  std::string error;
  if (install) {
    if (!itemDirectory(item.category, item.package, &destination, &error)) { setGuiStatus(st, error); return; }
    destination += L"\\" + toWide(item.filename);
  } else {
    if (!saveDestination(hwnd, item, &destination)) return;
  }

  setGuiStatus(st, (install ? "Downloading and verifying " : "Downloading ") + item.filename);
  UpdateWindow(hwnd);
  SetCursor(LoadCursorW(nullptr, IIM_CURSOR_WAIT));

  bool verified = false;
  const bool ok = downloadVerified(item, st->session->gh.token(), destination, &verified, &error);
  SetCursor(LoadCursorW(nullptr, IIM_CURSOR_ARROW));
  if (!ok) { setGuiStatus(st, error); return; }

  if (!install) {
    setGuiStatus(st, "Downloaded " + item.filename + (verified ? " (SHA-256 verified)" : " (unverified; not run)"));
    return;
  }
  if (!verified) {
    DeleteFileW(destination.c_str());
    setGuiStatus(st, "Refused: no verified SHA-256 digest for " + item.filename);
    return;
  }

  const size_t slash = destination.find_last_of(L"\\/");
  const std::wstring directory = slash == std::wstring::npos ? destination : destination.substr(0, slash);
  writeRecord(directory, item, item.filename, item.size, &error);

  if (runsInstaller(item)) {
    HINSTANCE launched = ShellExecuteW(nullptr, L"open", destination.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    setGuiStatus(st, reinterpret_cast<INT_PTR>(launched) > 32 ? "Installed " + item.package + "; setup launched"
                                                              : "Installed " + item.package + "; setup could not be opened");
  } else {
    setGuiStatus(st, "Installed " + item.package + " " + item.version);
  }
  if (st->view == 3) refreshGui(st);
}

void removeSelected(HWND hwnd, GuiState* st) {
  if (viewIsCatalogGui(st)) { setGuiStatus(st, "Switch to Installed to remove something."); return; }
  const int item = (int)SendMessageW(st->list, LVM_GETNEXTITEM, (WPARAM)-1, LVNI_SELECTED);
  if (item < 0 || item >= (int)st->rows.size()) return;
  const Installed& target = st->installed[st->rows[item]];

  const std::wstring prompt = L"Remove \"" + toWide(target.name) + L"\" from this machine?";
  if (MessageBoxW(hwnd, prompt.c_str(), L"Infinity Installer Manager",
                  MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES) return;

  std::wstring directory;
  std::string error;
  if (!itemDirectory(target.category, target.name, &directory, &error)) { setGuiStatus(st, error); return; }
  setGuiStatus(st, removeDirectoryTree(directory) ? "Removed " + target.name : "Could not remove " + target.name);
  refreshGui(st);
}

void openInstalledFolder(HWND hwnd, GuiState* st) {
  Category category = viewIsCatalogGui(st) ? viewCategory(st->view) : Category::Product;
  std::wstring root;
  std::string error;
  if (!rootDirectory(category, &root, &error)) { setGuiStatus(st, error); return; }
  ShellExecuteW(hwnd, L"open", root.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  setGuiStatus(st, "Opened the install folder");
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

      st->viewBox = CreateWindowExW(0, L"COMBOBOX", L"",
                                    WS_CHILD | WS_VISIBLE | CBS_DROPDOWNLIST | WS_VSCROLL,
                                    12, 40, 190, 200, hwnd, (HMENU)(INT_PTR)ID_VIEW, cs->hInstance, nullptr);
      SendMessageW(st->viewBox, CB_ADDSTRING, 0, (LPARAM)L"Products");
      SendMessageW(st->viewBox, CB_ADDSTRING, 0, (LPARAM)L"Plugins");
      SendMessageW(st->viewBox, CB_ADDSTRING, 0, (LPARAM)L"Resources");
      SendMessageW(st->viewBox, CB_ADDSTRING, 0, (LPARAM)L"Installed");
      SendMessageW(st->viewBox, CB_SETCURSEL, 0, 0);

      CreateWindowExW(0, L"BUTTON", L"Refresh", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      212, 40, 82, 28, hwnd, (HMENU)(INT_PTR)ID_REFRESH, cs->hInstance, nullptr);
      st->installButton = CreateWindowExW(0, L"BUTTON", L"Install", WS_CHILD | WS_VISIBLE | BS_DEFPUSHBUTTON,
                      302, 40, 82, 28, hwnd, (HMENU)(INT_PTR)ID_INSTALL, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"Download", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      392, 40, 96, 28, hwnd, (HMENU)(INT_PTR)ID_DOWNLOAD, cs->hInstance, nullptr);
      st->removeButton = CreateWindowExW(0, L"BUTTON", L"Remove", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      496, 40, 82, 28, hwnd, (HMENU)(INT_PTR)ID_REMOVE, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"Open folder", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      586, 40, 108, 28, hwnd, (HMENU)(INT_PTR)ID_FOLDER, cs->hInstance, nullptr);
      st->filterEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL,
                                       750, 42, 162, 24, hwnd, (HMENU)(INT_PTR)ID_FILTER, cs->hInstance, nullptr);
      SendMessageW(st->filterEdit, EM_SETCUEBANNER, TRUE, (LPARAM)L"Filter");

      st->list = CreateWindowExW(WS_EX_CLIENTEDGE, WC_LISTVIEWW, L"",
                                 WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS,
                                 12, 78, 900, 470, hwnd, (HMENU)(INT_PTR)ID_LIST, cs->hInstance, nullptr);
      ListView_SetExtendedListViewStyle(st->list, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_LABELTIP);

      LVCOLUMNW col = {};
      col.mask = LVCF_TEXT | LVCF_WIDTH;
      const wchar_t* titles[5] = { L"Name", L"Version", L"Platform", L"Size", L"Kind" };
      const int widths[5] = { 300, 140, 150, 120, 100 };
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
      MoveWindow(st->filterEdit, std::max(560, width - 174), 42, 162, 24, TRUE);
      MoveWindow(st->list, 12, 78, width - 24, height - 112, TRUE);
      return 0;
    }
    case WM_COMMAND:
      if (!st) break;
      switch (LOWORD(wp)) {
        case ID_REFRESH: reloadCatalog(hwnd, st); return 0;
        case ID_INSTALL: installSelected(hwnd, st, true); return 0;
        case ID_DOWNLOAD: installSelected(hwnd, st, false); return 0;
        case ID_REMOVE: removeSelected(hwnd, st); return 0;
        case ID_FOLDER: openInstalledFolder(hwnd, st); return 0;
        case ID_VIEW:
          if (HIWORD(wp) == CBN_SELCHANGE) {
            st->view = (int)SendMessageW(st->viewBox, CB_GETCURSEL, 0, 0);
            refreshGui(st);
            setGuiStatus(st, "");
          }
          return 0;
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
        if (viewIsCatalogGui(st)) installSelected(hwnd, st, true);
        return 0;
      }
      if (hdr->code == LVN_ITEMCHANGED) { updateButtons(st); return 0; }
      break;
    }
    case WM_GETMINMAXINFO: {
      MINMAXINFO* info = (MINMAXINFO*)lp;
      info->ptMinTrackSize.x = 940;
      info->ptMinTrackSize.y = 480;
      return 0;
    }
    case WM_ERASEBKGND: {
      HDC dc = (HDC)wp;
      RECT rc; GetClientRect(hwnd, &rc);
      if (!backgroundBrush) backgroundBrush = CreateSolidBrush(RGB(245, 247, 250));
      FillRect(dc, &rc, backgroundBrush); return 1;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

int guiMain() {
  inc::unblockSelfDirectory(2);
  const std::string token = tokenFromEnv();
  if (token.empty()) { out("not signed in - set gittoken_zssx-2026_1 first."); return 1; }

  Session session(token);
  session.tokenSourceName = tokenSource();
  std::string error;
  if (!session.signIn(&error)) { out("not signed in (" + error + ")"); return 1; }

  Catalog catalog;
  catalog.refresh(token);

  INITCOMMONCONTROLSEX controls = { sizeof(controls), ICC_LISTVIEW_CLASSES };
  InitCommonControlsEx(&controls);

  GuiState state;
  state.session = &session;
  state.catalog = &catalog;
  state.status = catalog.error;

  WNDCLASSW wc = {};
  wc.lpfnWndProc = guiProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"InfinityInstallerManagerWindow";
  wc.hCursor = LoadCursorW(nullptr, IIM_CURSOR_ARROW);
  wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
  RegisterClassW(&wc);

  HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"Infinity Installer Manager",
                              WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                              1100, 720, nullptr, nullptr, wc.hInstance, &state);
  if (!hwnd) { out("cannot create the window"); return 1; }
  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);
  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}

}  // namespace

// ---------------------------------------------------------------- entry

int main(int argc, char** argv) {
  // The file unblocks itself before anything else runs: the browser marks a
  // download with a Zone.Identifier stream, and Windows then questions the
  // program it just let the user download. Only that stream is removed; the
  // file's contents are never touched.
  // The running file clears its own mark here. The sweep of the folder it
  // sits in is done by the faces that are about to do real work, not here:
  // a script running --version must not pay for a directory walk.
  inc::unblockSelf();

  // The console has to be asked for UTF-8 before anything is printed, or the
  // Chinese in the interface arrives as mojibake on a code page 936 machine.
  SetConsoleOutputCP(CP_UTF8);
  SetConsoleCP(CP_UTF8);

  std::vector<std::string> args;
  for (int i = 1; i < argc; i++) args.push_back(argv[i]);

  if (!args.empty()) {
    if (args[0] == "--version" || args[0] == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (args[0] == "--help" || args[0] == "-h" || args[0] == "help") { help(); return 0; }
  }

  /*
   * --serve-ui is what the window starts this program with. It is a flag
   * rather than a face because the face belongs to the Electron shell: the
   * shell is iim_gui.exe, and it runs this executable with --serve-ui to get
   * something to draw. The port is fixed per application so the shell does not
   * have to be told it, and --port= is there for a test that wants two of
   * these at once.
   */
  bool serveUiRequested = false;
  int uiPort = 7643;
  {
    std::vector<std::string> rest;
    for (const std::string& a : args) {
      if (a == "--serve-ui") { serveUiRequested = true; continue; }
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

  // `iim gui` and friends still work when the program is started under a name
  // that carries no mode, which is what happens from a source build.
  if (m.mode.empty() && !args.empty()) {
    const std::string& a = args[0];
    std::vector<std::string> rest(args.begin() + 1, args.end());
    if (a == "cli") return cliMain(rest);
    if (a == "gui") return guiMain();
  }

  if (m.mode == "gui") return guiMain();
  if (m.mode == "cli") return cliMain(args);

  if (args.empty()) return guiMain();
  return cliMain(args);
}
