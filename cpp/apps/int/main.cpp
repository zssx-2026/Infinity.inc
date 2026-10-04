// main.cpp - Infinity Toolbox, in C++.
//
// A toolbox is a registry of small utilities. Each one can be listed, asked
// about and run, and a third party can add one by dropping a plugin into the
// place Infinity Installer Manager already installs to. The first tools are
// built into this binary rather than downloaded, so the program is useful the
// moment it exists.
//
//   int_cli   a command line
//   int_gui   the window
//
// The window is Electron, so the gui face is not a Win32 window: this program
// serves the page over loopback and Electron draws it, exactly as the other
// applications do. `int --serve-ui [--port=N]` is that server on its own.
//
// One rule holds the whole file together: the registry is one table and one
// function per tool. Adding a tool is adding a row to kTools and writing the
// function the row names - there is no second list to keep in step, and
// `list`, `info`, `run` and the window all read the same table. A tool that
// is a stub says so in its own summary, because a button that pretends is
// worse than a button that is missing.

#include <winsock2.h>
#include <windows.h>
#include <bcrypt.h>

#include "inc/ansi.hpp"
#include "inc/env.hpp"
#include "inc/github.hpp"
#include "inc/http.hpp"
#include "inc/json.hpp"
#include "inc/mode.hpp"
#include "inc/str.hpp"
#include "inc/uiserver.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace inc;

static const char* APP = "Infinity Toolbox";

namespace {

// The port the window's origin listens on when none is given. Fixed rather
// than random so the Electron shell has something to point at without asking.
const int kDefaultUiPort = 7653;

// ---------------------------------------------------------------- output

void out(const std::string& text) {
  fwrite(text.data(), 1, text.size(), stdout);
  fputc('\n', stdout);
}

// A tool appends to a log instead of printing, so the same function serves the
// command line (which prints the log) and the window (which returns it as
// text). Nothing a tool produces is ever inserted into the page as markup.
void emit(std::string* log, const std::string& text) {
  *log += text;
  *log += '\n';
}

// ---------------------------------------------------------------- arguments

// The value of `--name=value`, or empty when it is absent. Small enough that a
// parser object would be more machinery than the two callers need.
std::string flagValue(const std::vector<std::string>& args, const std::string& name) {
  const std::string prefix = name + "=";
  for (const std::string& a : args) if (startsWith(a, prefix)) return a.substr(prefix.size());
  return std::string();
}

int uiPortFromArgs(const std::vector<std::string>& args, int fallback) {
  const std::string value = trim(flagValue(args, "--port"));
  if (value.empty()) return fallback;
  const long long port = strtoll(value.c_str(), nullptr, 10);
  if (port < 1 || port > 65535) return fallback;
  return (int)port;
}

// ---------------------------------------------------------------- registry
//
// The table is the catalogue. A tool's row carries everything the rest of the
// program needs to describe and reach it: a name, a one-line summary, a usage
// line, whether it is built in, and the function that runs it.

enum class ToolKind { Builtin, Plugin };

const char* kindName(ToolKind kind) {
  return kind == ToolKind::Plugin ? "plugin" : "builtin";
}

struct Tool;

using ToolFn = int (*)(const std::vector<std::string>& args, std::string* log, std::string* error);

struct Tool {
  const char* name;
  const char* summary;
  const char* usage;
  ToolKind kind;
  ToolFn run;
};

int runSteamPP(const std::vector<std::string>& args, std::string* log, std::string* error);
int runFastGithub(const std::vector<std::string>& args, std::string* log, std::string* error);
int runFdm(const std::vector<std::string>& args, std::string* log, std::string* error);

const char* kFdmUsage = "int run fdm <url> <destination> [--sha256=<hex>] [--parts=N]";

const Tool kTools[] = {
  { "steampp",
    "Steam/network accelerator (stub - reports, does not act)",
    "int run steampp [status]",
    ToolKind::Builtin, runSteamPP },
  { "fastgithub",
    "GitHub accelerator relay: reports state; start/stop are stubs",
    "int run fastgithub [status|start|stop]",
    ToolKind::Builtin, runFastGithub },
  { "fdm",
    "Multi-part HTTP downloader with SHA-256 verification",
    kFdmUsage,
    ToolKind::Builtin, runFdm },
};

const size_t kToolCount = sizeof(kTools) / sizeof(kTools[0]);

const Tool* findTool(const std::string& name) {
  for (size_t i = 0; i < kToolCount; ++i) if (iequals(kTools[i].name, name)) return &kTools[i];
  return nullptr;
}

// ---------------------------------------------------------------- machine

std::string hostPlatform() {
  SYSTEM_INFO info;
  GetNativeSystemInfo(&info);
  switch (info.wProcessorArchitecture) {
    case PROCESSOR_ARCHITECTURE_ARM64: return "windows-arm64";
    case PROCESSOR_ARCHITECTURE_INTEL: return "windows-x86";
    default: return "windows-x64";
  }
}

std::wstring localAppDataDir() {
  DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", nullptr, 0);
  if (!length) return std::wstring();
  std::vector<wchar_t> buffer(length);
  DWORD written = GetEnvironmentVariableW(L"LOCALAPPDATA", buffer.data(), length);
  if (!written || written >= length) return std::wstring();
  std::wstring base(buffer.data(), written);
  if (!base.empty() && base.back() != L'\\' && base.back() != L'/') base.push_back(L'\\');
  return base;
}

// The plugin root is the one Infinity Installer Manager installs a plugin
// into - the same root, and the same one-directory-per-item layout it records
// with item.json - so a plugin the installer put there is a plugin this
// program can see. Inventing a second location would mean two places to keep
// in step, which is exactly what the installer exists to avoid.
std::wstring pluginRoot() {
  const std::wstring base = localAppDataDir();
  if (base.empty()) return std::wstring();
  return base + L"Infinity.Inc\\plugin";
}

std::string readTextFile(const std::wstring& path) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return std::string();
  std::string text;
  char buffer[4096];
  DWORD read = 0;
  while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read) text.append(buffer, read);
  CloseHandle(file);
  return text;
}

// ---------------------------------------------------------------- itbt
//
// .itbt is the single-file form of a plugin: the directory Infinity Installer
// Manager would have written, flattened into one file with a SHA-256 per entry
// so a container edited in transit is refused rather than unpacked and run.
// The layout is fixed and little endian; work/ITBT-FORMAT.md is the contract.
// Every field is read by hand rather than by casting a struct, because padding
// would silently disagree with the writer.
//
// A container is never trusted to stay inside its own directory. A path is
// accepted only if it is relative, slash separated and free of "..", and a
// container whose header, entry table or digests do not add up is rejected
// before a byte is written.

const uint16_t kItbtVersion = 1;
const uint16_t kItbtFlagDeflate = 1;
const uint8_t kItbtStore = 0;
const uint8_t kItbtDeflate = 1;

struct ItbtEntry {
  std::string path;
  uint64_t offset = 0;
  uint64_t storedSize = 0;
  uint64_t rawSize = 0;
  std::string sha256;      // hex, 64 characters
  uint8_t compression = kItbtStore;
};

struct ItbtArchive {
  std::string name;
  std::string version;
  std::string exe;
  uint16_t flags = 0;
  uint32_t headerSize = 0;
  uint32_t totalSize = 0;
  std::vector<ItbtEntry> entries;
};

std::string baseName(const std::string& path) {
  const size_t at = path.find_last_of("\/");
  return at == std::string::npos ? path : path.substr(at + 1);
}

bool readWholeFile(const std::wstring& path, std::string* bytes, std::string* error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot open " + toUtf8(path); return false; }
  bytes->clear();
  char buffer[65536];
  DWORD read = 0;
  while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read) bytes->append(buffer, read);
  CloseHandle(file);
  return true;
}

// SHA-256 over bytes already in memory, through the same Windows CNG the file
// hash uses. A container's digests are over the *raw* content, so an entry is
// hashed as it is read, before it is written anywhere.
std::string sha256Bytes(const std::string& bytes) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  std::string result;
  const auto close = [&]() {
    if (hash) BCryptDestroyHash(hash);
    if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  };

  if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0))) {
    close();
    return result;
  }
  DWORD objectLength = 0, hashLength = 0, resultLength = 0;
  if (!BCRYPT_SUCCESS(BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH,
                                        reinterpret_cast<PUCHAR>(&objectLength), sizeof(objectLength),
                                        &resultLength, 0)) ||
      !BCRYPT_SUCCESS(BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH,
                                        reinterpret_cast<PUCHAR>(&hashLength), sizeof(hashLength),
                                        &resultLength, 0))) {
    close();
    return result;
  }
  std::vector<UCHAR> object(objectLength);
  std::vector<UCHAR> digest(hashLength);
  const PUCHAR data = reinterpret_cast<PUCHAR>(const_cast<char*>(bytes.data()));
  if (!BCRYPT_SUCCESS(BCryptCreateHash(algorithm, &hash, object.data(), objectLength, nullptr, 0, 0)) ||
      !BCRYPT_SUCCESS(BCryptHashData(hash, data, static_cast<ULONG>(bytes.size()), 0)) ||
      !BCRYPT_SUCCESS(BCryptFinishHash(hash, digest.data(), hashLength, 0))) {
    close();
    return result;
  }
  close();

  static const char hex[] = "0123456789abcdef";
  result.reserve(digest.size() * 2);
  for (UCHAR byte : digest) {
    result.push_back(hex[byte >> 4]);
    result.push_back(hex[byte & 0x0f]);
  }
  return result;
}

// Little endian, explicitly: each read checks its own bounds before it touches
// the buffer, so a truncated or overlong container fails as an error rather
// than as a read past the end.
bool readU16(const std::string& bytes, uint64_t at, uint16_t* value) {
  if (at + 2 > bytes.size()) return false;
  *value = static_cast<uint16_t>(static_cast<unsigned char>(bytes[(size_t)at]) |
                                 (static_cast<unsigned char>(bytes[(size_t)at + 1]) << 8));
  return true;
}

bool readU32(const std::string& bytes, uint64_t at, uint32_t* value) {
  if (at + 4 > bytes.size()) return false;
  uint32_t v = 0;
  for (int i = 0; i < 4; i++)
    v |= static_cast<uint32_t>(static_cast<unsigned char>(bytes[(size_t)at + i])) << (8 * i);
  *value = v;
  return true;
}

bool readU64(const std::string& bytes, uint64_t at, uint64_t* value) {
  if (at + 8 > bytes.size()) return false;
  uint64_t v = 0;
  for (int i = 0; i < 8; i++)
    v |= static_cast<uint64_t>(static_cast<unsigned char>(bytes[(size_t)at + i])) << (8 * i);
  *value = v;
  return true;
}

bool readBytes(const std::string& bytes, uint64_t at, size_t count, std::string* out) {
  if (at + count > bytes.size()) return false;
  out->assign(bytes, static_cast<size_t>(at), count);
  return true;
}

std::string hexOf(const std::string& bytes) {
  static const char hex[] = "0123456789abcdef";
  std::string out;
  out.reserve(bytes.size() * 2);
  for (unsigned char byte : bytes) {
    out.push_back(hex[byte >> 4]);
    out.push_back(hex[byte & 0x0f]);
  }
  return out;
}

// Rule 1, applied to a path coming *out* of a container: relative, slash
// separated, no component that climbs. The writer checks the same thing.
bool safeEntryPath(const std::string& path, std::string* why) {
  if (path.empty()) { *why = "empty path"; return false; }
  if (path[0] == '/' || path[0] == '\') { *why = "absolute path: " + path; return false; }
  if (path.find(':') != std::string::npos) { *why = "drive-qualified path: " + path; return false; }
  size_t start = 0;
  for (;;) {
    const size_t slash = path.find('/', start);
    const std::string part =
        path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
    if (part.empty()) { *why = "empty component in: " + path; return false; }
    if (part == "." || part == "..") {
      *why = "unsafe component '" + part + "' in: " + path;
      return false;
    }
    if (slash == std::string::npos) break;
    start = slash + 1;
  }
  return true;
}

// The plugin name also becomes a directory name, so it must be one component.
bool safePluginName(const std::string& name, std::string* why) {
  if (name.empty()) { *why = "empty plugin name"; return false; }
  if (name.find_first_of("\/:") != std::string::npos) {
    *why = "plugin name has a path separator: " + name;
    return false;
  }
  if (name == "." || name == "..") { *why = "unsafe plugin name: " + name; return false; }
  return true;
}

const ItbtEntry* findItbtEntry(const ItbtArchive& archive, const std::string& path) {
  for (const ItbtEntry& entry : archive.entries) if (entry.path == path) return &entry;
  return nullptr;
}

// The whole format, read strictly. headerSize is read first and used as the
// boundary for the name and the entry table; anything that runs past it, or a
// table that does not end exactly where headerSize says, is an error.
bool parseItbt(const std::string& bytes, ItbtArchive* archive, std::string* error) {
  const auto bad = [&](const std::string& message) {
    *error = message;
    return false;
  };

  if (bytes.size() < 20) return bad("container is shorter than its header");
  if (bytes.compare(0, 4, "ITBT") != 0) return bad("magic is not ITBT");

  uint16_t version = 0, flags = 0;
  uint32_t headerSize = 0, entryCount = 0, totalSize = 0;
  if (!readU16(bytes, 4, &version) || !readU16(bytes, 6, &flags) ||
      !readU32(bytes, 8, &headerSize) || !readU32(bytes, 12, &entryCount) ||
      !readU32(bytes, 16, &totalSize)) {
    return bad("container header is truncated");
  }
  if (version != kItbtVersion) return bad("unsupported .itbt version " + std::to_string(version));
  if (flags & ~static_cast<uint16_t>(kItbtFlagDeflate)) {
    return bad("unknown container flags " + std::to_string(flags));
  }
  if (totalSize != bytes.size()) {
    return bad("totalSize " + std::to_string(totalSize) + " does not match the file size " +
               std::to_string(bytes.size()));
  }
  if (headerSize < 20 || headerSize > bytes.size()) return bad("headerSize is out of range");
  if (entryCount > headerSize) return bad("entryCount " + std::to_string(entryCount) + " is impossible");

  const auto string = [&](uint64_t* at, std::string* out) {
    uint16_t length = 0;
    if (!readU16(bytes, *at, &length)) return false;
    *at += 2;
    if (*at + length > headerSize) return false;
    out->assign(bytes, static_cast<size_t>(*at), length);
    *at += length;
    return true;
  };

  archive->flags = flags;
  archive->headerSize = headerSize;
  archive->totalSize = totalSize;
  archive->entries.clear();

  uint64_t at = 20;
  if (!string(&at, &archive->name) || !string(&at, &archive->version) || !string(&at, &archive->exe)) {
    return bad("container name/version/exe run past the header");
  }
  if (archive->name.empty()) return bad("container has no plugin name");

  for (uint32_t i = 0; i < entryCount; i++) {
    ItbtEntry entry;
    uint16_t pathLength = 0;
    if (!readU16(bytes, at, &pathLength)) return bad("entry table is truncated");
    at += 2;
    if (at + pathLength > headerSize) return bad("an entry path runs past the header");
    entry.path.assign(bytes, static_cast<size_t>(at), pathLength);
    at += pathLength;

    if (!readU64(bytes, at, &entry.offset) || !readU64(bytes, at + 8, &entry.storedSize) ||
        !readU64(bytes, at + 16, &entry.rawSize)) {
      return bad("entry table is truncated");
    }
    at += 24;

    std::string digest;
    if (!readBytes(bytes, at, 32, &digest)) return bad("entry table is truncated");
    at += 32;
    if (at + 1 > bytes.size()) return bad("entry table is truncated");
    entry.compression = static_cast<uint8_t>(bytes[(size_t)at]);
    at += 1;

    std::string why;
    if (!safeEntryPath(entry.path, &why)) return bad("unsafe entry path: " + why);
    if (entry.compression == kItbtDeflate) {
      return bad("entry '" + entry.path + "' is deflate-compressed (raw deflate) and this build " +
                 "has no zlib to inflate it");
    }
    if (entry.compression != kItbtStore) {
      return bad("entry '" + entry.path + "' has unknown compression " +
                 std::to_string(entry.compression));
    }
    if (entry.offset < headerSize || entry.offset + entry.storedSize > bytes.size()) {
      return bad("entry '" + entry.path + "' lies outside the file");
    }
    if (entry.storedSize != entry.rawSize) {
      return bad("stored entry '" + entry.path + "' disagrees about its size");
    }
    entry.sha256 = hexOf(digest);
    archive->entries.push_back(entry);
  }

  if (at != headerSize) {
    return bad("the entry table ends at " + std::to_string(at) + " but headerSize says " +
               std::to_string(headerSize));
  }
  for (size_t i = 0; i < archive->entries.size(); i++) {
    for (size_t j = i + 1; j < archive->entries.size(); j++) {
      if (archive->entries[i].path == archive->entries[j].path) {
        return bad("entry '" + archive->entries[i].path + "' appears twice");
      }
    }
  }
  if (archive->exe.empty()) return bad("container names no executable");
  if (!findItbtEntry(*archive, archive->exe)) {
    return bad("the entry table has no executable '" + archive->exe + "'");
  }
  std::string nameWhy;
  if (!safePluginName(archive->name, &nameWhy)) return bad(nameWhy);
  return true;
}

struct ItbtCheck {
  std::string path;
  uint64_t rawSize = 0;
  std::string expected;
  std::string actual;
  bool ok = false;
};

// Every entry's raw content, hashed and compared with what the writer recorded.
// The whole list is returned so the caller can name the first entry that failed
// rather than only saying the container is bad.
bool verifyItbt(const std::string& bytes, const ItbtArchive& archive, std::vector<ItbtCheck>* checks) {
  checks->clear();
  bool all = true;
  for (const ItbtEntry& entry : archive.entries) {
    ItbtCheck check;
    check.path = entry.path;
    check.rawSize = entry.rawSize;
    check.expected = entry.sha256;
    check.actual = sha256Bytes(bytes.substr(static_cast<size_t>(entry.offset),
                                            static_cast<size_t>(entry.storedSize)));
    check.ok = check.actual == check.expected;
    if (!check.ok) all = false;
    checks->push_back(check);
  }
  return all;
}

// ---------------------------------------------------------------- unpacking

bool createDirectories(const std::wstring& path) {
  if (path.empty()) return false;
  if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES) return true;
  const size_t slash = path.find_last_of(L"\/");
  if (slash != std::wstring::npos && slash > 0 && path.size() > 3) {
    if (!createDirectories(path.substr(0, slash))) return false;
  }
  if (CreateDirectoryW(path.c_str(), nullptr)) return true;
  return GetLastError() == ERROR_ALREADY_EXISTS;
}

bool removeTree(const std::wstring& path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES) return true;
  if (!(attributes & FILE_ATTRIBUTE_DIRECTORY)) return DeleteFileW(path.c_str()) != 0;

  WIN32_FIND_DATAW entry;
  HANDLE search = FindFirstFileW((path + L"\*").c_str(), &entry);
  if (search != INVALID_HANDLE_VALUE) {
    do {
      const std::wstring name(entry.cFileName);
      if (name == L"." || name == L"..") continue;
      removeTree(path + L"\" + name);
    } while (FindNextFileW(search, &entry));
    FindClose(search);
  }
  return RemoveDirectoryW(path.c_str()) != 0;
}

bool writeBytesFile(const std::wstring& path, const std::string& bytes, std::string* error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot create " + toUtf8(path); return false; }
  const char* data = bytes.data();
  size_t remaining = bytes.size();
  while (remaining) {
    DWORD written = 0;
    const DWORD want = static_cast<DWORD>(std::min<size_t>(remaining, 1u << 20));
    if (!WriteFile(file, data, want, &written, nullptr) || !written) {
      CloseHandle(file);
      *error = "cannot write " + toUtf8(path);
      return false;
    }
    data += written;
    remaining -= written;
  }
  CloseHandle(file);
  return true;
}

// Does the already unpacked directory hold exactly what this container says?
// Re-installing an unchanged plugin is then a no-op instead of a rewrite.
bool extractedMatches(const std::wstring& directory, const ItbtArchive& archive) {
  for (const ItbtEntry& entry : archive.entries) {
    const std::wstring file = directory + L"\" + toWide(replaceAll(entry.path, "/", "\"));
    std::string bytes, error;
    if (!readWholeFile(file, &bytes, &error)) return false;
    if (bytes.size() != entry.rawSize) return false;
    if (sha256Bytes(bytes) != entry.sha256) return false;
  }
  return true;
}

// Unpack into <root><name>.tmp, verify every entry, then rename the directory
// into place. Nothing half-written is ever visible under the plugin's own name:
// a crash leaves a .tmp that the next run removes.
bool extractItbt(const std::string& bytes, const ItbtArchive& archive, const std::wstring& root,
                 bool overwrite, std::string* log, std::string* error) {
  std::vector<ItbtCheck> checks;
  if (!verifyItbt(bytes, archive, &checks)) {
    for (const ItbtCheck& check : checks) {
      if (check.ok) continue;
      *error = "entry '" + check.path + "' failed SHA-256
  expected " + check.expected +
               "
  actual   " + check.actual;
      return false;
    }
  }

  const std::wstring target = root + L"\" + toWide(archive.name);
  const std::wstring temporary = target + L".tmp";
  removeTree(temporary);
  if (!createDirectories(temporary)) { *error = "cannot create " + toUtf8(temporary); return false; }

  for (const ItbtEntry& entry : archive.entries) {
    const std::wstring file = temporary + L"\" + toWide(replaceAll(entry.path, "/", "\"));
    const size_t slash = file.find_last_of(L"\/");
    if (slash != std::wstring::npos && !createDirectories(file.substr(0, slash))) {
      removeTree(temporary);
      *error = "cannot create the directory for " + entry.path;
      return false;
    }
    if (!writeBytesFile(file, bytes.substr(static_cast<size_t>(entry.offset),
                                           static_cast<size_t>(entry.storedSize)), error)) {
      removeTree(temporary);
      return false;
    }
  }

  if (GetFileAttributesW(target.c_str()) != INVALID_FILE_ATTRIBUTES) {
    if (!overwrite) {
      if (extractedMatches(target, archive)) {
        removeTree(temporary);
        if (log) *log = "already installed; the unpacked copy matches this container";
        return true;
      }
      removeTree(temporary);
      *error = "plugin '" + archive.name + "' is already installed with different contents; " +
               "re-run with --overwrite to replace it";
      return false;
    }
    const std::wstring previous = target + L".old";
    removeTree(previous);
    if (!MoveFileExW(target.c_str(), previous.c_str(), 0)) {
      removeTree(temporary);
      *error = "cannot set aside the existing " + toUtf8(target);
      return false;
    }
    if (!MoveFileExW(temporary.c_str(), target.c_str(), 0)) {
      MoveFileExW(previous.c_str(), target.c_str(), 0);   // put the old one back
      removeTree(temporary);
      *error = "cannot promote the unpacked plugin into place";
      return false;
    }
    removeTree(previous);
    if (log) *log = "replaced an existing install";
    return true;
  }

  if (!MoveFileExW(temporary.c_str(), target.c_str(), 0)) {
    removeTree(temporary);
    *error = "cannot rename the unpacked .tmp directory into place";
    return false;
  }
  return true;
}

void collectFiles(const std::wstring& directory, std::vector<std::wstring>* files) {
  WIN32_FIND_DATAW entry;
  HANDLE search = FindFirstFileW((directory + L"\*").c_str(), &entry);
  if (search == INVALID_HANDLE_VALUE) return;
  do {
    const std::wstring name(entry.cFileName);
    if (name == L"." || name == L"..") continue;
    const std::wstring path = directory + L"\" + name;
    if (entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) collectFiles(path, files);
    else files->push_back(path);
  } while (FindNextFileW(search, &entry));
  FindClose(search);
}

// A plugin is either a directory on disk, exactly as Infinity Installer Manager
// writes one, or a .itbt container that has (or has not) been unpacked. The two
// share one row so list, info and run see one registry.
struct Plugin {
  std::string name;
  std::string version;
  std::string filename;
  std::string directory;   // for display; the file itself is built from it
  bool present = false;
  bool fromContainer = false;
  std::string containerFile;   // full path of the .itbt, when there is one
  std::string containerSha;    // SHA-256 of the whole container file
  size_t containerEntries = 0;
  bool containerValid = false;
  std::string note;            // why a container was refused, when it was
};

// The list of plugins is read off the disk, not remembered: the installer
// writes a folder, and a folder cannot disagree with itself.
std::vector<Plugin> scanPlugins() {
  std::vector<Plugin> found;
  const std::wstring root = pluginRoot();
  if (root.empty()) return found;

  WIN32_FIND_DATAW entry;
  HANDLE search = FindFirstFileW((root + L"\\*").c_str(), &entry);
  if (search == INVALID_HANDLE_VALUE) return found;
  do {
    if (!(entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) continue;
    const std::wstring name(entry.cFileName);
    if (name == L"." || name == L"..") continue;
    const std::wstring directory = root + L"\\" + name;

    Plugin plugin;
    plugin.name = toUtf8(name);
    plugin.directory = toUtf8(directory);

    bool ok = false;
    const Json record = Json::parse(readTextFile(directory + L"\\item.json"), &ok);
    if (ok) {
      plugin.name = record.s("name", plugin.name);
      plugin.version = record.s("version");
      plugin.filename = record.s("filename");
    }
    // A directory with no record still counts if it holds an executable, so a
    // plugin dropped in by hand is not invisible.
    if (plugin.filename.empty()) {
      WIN32_FIND_DATAW inner;
      HANDLE files = FindFirstFileW((directory + L"\\*.exe").c_str(), &inner);
      if (files != INVALID_HANDLE_VALUE) {
        plugin.filename = toUtf8(inner.cFileName);
        FindClose(files);
      }
    }
    plugin.present = !plugin.filename.empty() &&
        GetFileAttributesW((directory + L"\\" + toWide(plugin.filename)).c_str()) != INVALID_FILE_ATTRIBUTES;
    found.push_back(plugin);
  } while (FindNextFileW(search, &entry));
  FindClose(search);

  // Containers. A .itbt in the plugin root is a plugin whether or not it has
  // been unpacked; when it has, the directory it produced is the plugin, and
  // the container stays as the signed original it came from.
  WIN32_FIND_DATAW packed;
  HANDLE containers = FindFirstFileW((root + L"\\*.itbt").c_str(), &packed);
  if (containers != INVALID_HANDLE_VALUE) {
    do {
      if (packed.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
      const std::wstring file = root + L"\\" + packed.cFileName;

      Plugin plugin;
      plugin.fromContainer = true;
      plugin.containerFile = toUtf8(file);

      std::string bytes, error;
      if (!readWholeFile(file, &bytes, &error)) {
        plugin.name = toUtf8(packed.cFileName);
        plugin.note = error;
        found.push_back(plugin);
        continue;
      }
      plugin.containerSha = sha256Bytes(bytes);

      ItbtArchive archive;
      if (!parseItbt(bytes, &archive, &error)) {
        plugin.name = toUtf8(packed.cFileName);
        plugin.note = error;
        found.push_back(plugin);
        continue;
      }

      plugin.name = archive.name;
      plugin.version = archive.version;
      plugin.filename = archive.exe;
      plugin.containerEntries = archive.entries.size();
      plugin.directory = toUtf8(root + L"\\" + toWide(archive.name));

      std::vector<ItbtCheck> checks;
      plugin.containerValid = verifyItbt(bytes, archive, &checks);
      if (!plugin.containerValid) {
        for (const ItbtCheck& check : checks) {
          if (check.ok) continue;
          plugin.note = "entry '" + check.path + "' failed SHA-256";
          break;
        }
      }
      plugin.present = !plugin.filename.empty() &&
          GetFileAttributesW((root + L"\\" + toWide(archive.name) + L"\\" +
                              toWide(replaceAll(plugin.filename, "/", "\\"))).c_str()) !=
              INVALID_FILE_ATTRIBUTES;
      found.push_back(plugin);
    } while (FindNextFileW(containers, &packed));
    FindClose(containers);
  }

  std::sort(found.begin(), found.end(), [](const Plugin& a, const Plugin& b) {
    return lower(a.name) < lower(b.name);
  });
  return found;
}

// Is something listening on a loopback port? A short non-blocking connect
// answers the question without sending a byte to whatever is there.
bool portListening(unsigned short port) {
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;

  bool up = false;
  SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s != INVALID_SOCKET) {
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_port = htons(port);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    u_long nonBlocking = 1;
    ioctlsocket(s, FIONBIO, &nonBlocking);
    connect(s, reinterpret_cast<sockaddr*>(&address), sizeof(address));
    fd_set writable;
    FD_ZERO(&writable);
    FD_SET(s, &writable);
    timeval timeout{0, 200000};   // 200 ms is generous on loopback
    up = select(0, nullptr, &writable, nullptr, &timeout) == 1;
    closesocket(s);
  }
  WSACleanup();
  return up;
}

// ---------------------------------------------------------------- digests

// SHA-256 over a file, through the same Windows CNG the installers use. Kept
// here rather than shared because the core deliberately exposes no hashing:
// the two installers each own their copy and so does this.
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

// ---------------------------------------------------------------- tools

// steampp is a stub, and says so. An accelerator rewrites the network stack;
// reimplementing one here would be a second product, not a tool, and a stub
// that reports what it would do is more honest than a button that pretends.
int runSteamPP(const std::vector<std::string>& args, std::string* log, std::string* error) {
  const std::string action = args.empty() ? std::string("status") : lower(args[0]);
  if (action == "status" || action == "info") {
    emit(log, "steampp  " + color(C_YELLOW, "stub") + "  - not implemented in this build");
    emit(log, "  what the real tool would do: route Steam CDN and store traffic through");
    emit(log, "  a local relay, pick the fastest edge, and report latency and throughput.");
    emit(log, "  nothing here touches the network stack, by design.");
    return 0;
  }
  *error = "steampp is a stub: only `status` is available";
  return 2;
}

// fastgithub reports the relay's state, which is a real answer: it asks the
// loopback ports FastGithub has used across its versions. start and stop are
// stubs, because the accelerator is an external program and this build starts
// nothing that is not part of Windows.
int runFastGithub(const std::vector<std::string>& args, std::string* log, std::string* error) {
  const std::string action = args.empty() ? std::string("status") : lower(args[0]);

  if (action == "status" || action == "info") {
    static const unsigned short kPorts[] = { 38457, 38458, 7890, 10809, 443 };
    std::vector<unsigned short> up;
    for (unsigned short port : kPorts) if (portListening(port)) up.push_back(port);
    if (up.empty()) {
      emit(log, "fastgithub  relay not running  (nothing listening on 127.0.0.1)");
      return 0;
    }
    emit(log, "fastgithub  " + color(C_GREEN, "relay running"));
    for (unsigned short port : up) emit(log, "  http://127.0.0.1:" + std::to_string(port));
    return 0;
  }

  if (action == "start" || action == "stop") {
    const bool already = portListening(38457) || portListening(38458) || portListening(7890) ||
                         portListening(10809) || portListening(443);
    if (action == "start" && already) { emit(log, "fastgithub  relay already running"); return 0; }
    if (action == "stop" && !already) { emit(log, "fastgithub  relay is not running"); return 0; }
    emit(log, "fastgithub  " + color(C_YELLOW, "stub") + "  - `" + action + "` is not implemented");
    emit(log, "  The accelerator is an external program; this build starts nothing that");
    emit(log, "  is not part of Windows. " + std::string(action == "start" ? "Start" : "Stop") +
             " it with its own installer.");
    return 0;
  }

  *error = "fastgithub: unknown action `" + action + "` (try status)";
  return 2;
}

// ---------------------------------------------------------------- fdm
//
// The download manager is the one tool that is not a stub, so it is the one
// that has to actually work. It asks the server for byte ranges and fetches
// them in parallel, which is the whole point of a download manager, and it
// checks the SHA-256 when one is given. A downloader that only pretends is
// worse than no downloader at all.

const long long kChunkBytes = 4LL * 1024 * 1024;
const int kMaxParts = 16;

// "bytes 0-0/12345" -> 12345; -1 when the header is absent or says "*".
long long totalFromContentRange(const std::string& header) {
  const size_t slash = header.find('/');
  if (slash == std::string::npos) return -1;
  const std::string tail = trim(header.substr(slash + 1));
  if (tail.empty() || tail == "*") return -1;
  return strtoll(tail.c_str(), nullptr, 10);
}

bool writeWholeFile(const std::wstring& path, const std::string& bytes, std::string* error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot create the destination file"; return false; }
  const char* data = bytes.data();
  size_t remaining = bytes.size();
  while (remaining) {
    DWORD written = 0;
    const DWORD want = static_cast<DWORD>(std::min<size_t>(remaining, 1u << 20));
    if (!WriteFile(file, data, want, &written, nullptr) || !written) {
      CloseHandle(file);
      *error = "cannot write the destination file";
      return false;
    }
    data += written;
    remaining -= written;
  }
  CloseHandle(file);
  return true;
}

// Write one range at its offset. Each worker opens its own handle: the ranges
// are disjoint, so the file needs no lock, and Windows extends the file as
// writes land beyond the current end.
bool writeAt(const std::wstring& path, long long offset, const std::string& bytes, std::string* error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                            nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot open the destination for writing"; return false; }

  LARGE_INTEGER position;
  position.QuadPart = offset;
  if (!SetFilePointerEx(file, position, nullptr, FILE_BEGIN)) {
    CloseHandle(file);
    *error = "cannot seek in the destination";
    return false;
  }
  const char* data = bytes.data();
  size_t remaining = bytes.size();
  while (remaining) {
    DWORD written = 0;
    const DWORD want = static_cast<DWORD>(std::min<size_t>(remaining, 1u << 20));
    if (!WriteFile(file, data, want, &written, nullptr) || !written) {
      CloseHandle(file);
      *error = "cannot write to the destination";
      return false;
    }
    data += written;
    remaining -= written;
  }
  CloseHandle(file);
  return true;
}

void printProgress(long long done, long long total, std::chrono::steady_clock::time_point began) {
  const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
  const double percent = total > 0 ? 100.0 * static_cast<double>(done) / static_cast<double>(total) : 0.0;
  const double speed = seconds > 0 ? static_cast<double>(done) / seconds : 0.0;
  std::fprintf(stderr, "\r  %s / %s  %5.1f%%  %s/s   ",
               humanSize(static_cast<uint64_t>(done)).c_str(),
               humanSize(static_cast<uint64_t>(total)).c_str(),
               percent,
               humanSize(static_cast<uint64_t>(speed)).c_str());
  std::fflush(stderr);
}

bool verifyDigest(const std::wstring& path, const std::string& want, std::string* error) {
  if (want.empty()) return true;
  std::string why;
  const std::string actual = sha256File(path, &why);
  if (actual.empty()) { *error = why; return false; }
  if (actual != want) { *error = "SHA-256 mismatch: expected " + want + ", got " + actual; return false; }
  return true;
}

int runFdm(const std::vector<std::string>& args, std::string* log, std::string* error) {
  std::vector<std::string> positional;
  for (const std::string& a : args) if (!startsWith(a, "--")) positional.push_back(a);
  if (positional.size() < 2) {
    emit(log, "usage: " + std::string(kFdmUsage));
    emit(log, "  --sha256=<hex>  verify the download against this digest");
    emit(log, "  --parts=<n>     parallel connections (default 4, max " + std::to_string(kMaxParts) + ")");
    return 2;
  }
  const std::string url = positional[0];
  const std::string destination = positional[1];

  int parts = 4;
  const std::string partsFlag = trim(flagValue(args, "--parts"));
  if (!partsFlag.empty()) {
    const long long n = strtoll(partsFlag.c_str(), nullptr, 10);
    if (n < 1 || n > kMaxParts) { *error = "--parts must be between 1 and " + std::to_string(kMaxParts); return 2; }
    parts = (int)n;
  }

  const std::string want = lower(trim(flagValue(args, "--sha256")));
  if (!want.empty() && (want.size() != 64 || want.find_first_not_of("0123456789abcdef") != std::string::npos)) {
    *error = "--sha256 must be 64 hexadecimal digits";
    return 2;
  }

  const std::wstring wideDestination = toWide(destination);
  if (wideDestination.empty()) { *error = "the destination is empty"; return 2; }

  // One byte first, to learn the size and whether the server honours ranges.
  RequestOptions probe;
  probe.headers.push_back("Range: bytes=0-0");
  const Response head = httpRequest(url, probe);
  if (!head.error.empty()) { *error = head.error; return 1; }

  long long total = -1;
  if (head.status == 200) {
    // The server ignored the range and handed back the whole resource, so
    // there is nothing to split and nothing more to fetch.
    total = static_cast<long long>(head.body.size());
    if (!writeWholeFile(wideDestination, head.body, error)) return 1;
    emit(log, "downloaded " + destination + "  " + humanSize(static_cast<uint64_t>(total)) +
              "  (server does not support ranges; single connection)");
  } else if (head.status == 206) {
    total = totalFromContentRange(head.header("content-range"));
    if (total <= 0) { *error = "the server did not report a usable size"; return 1; }
    if (total <= kChunkBytes) {
      parts = 1;
    } else {
      const long long byChunk = (total + kChunkBytes - 1) / kChunkBytes;
      if (parts > byChunk) parts = static_cast<int>(byChunk);
    }

    // Create the file empty; the workers extend it as they write.
    HANDLE file = CreateFileW(wideDestination.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) { *error = "cannot create " + destination; return 1; }
    CloseHandle(file);

    std::atomic<long long> done{0};
    std::atomic<int> remaining{parts};
    std::atomic<bool> failed{false};
    std::mutex errorMutex;
    std::string failure;

    auto downloadRange = [&](long long begin, long long end) {
      long long offset = begin;
      while (offset <= end && !failed.load()) {
        const long long chunkEnd = std::min(offset + kChunkBytes - 1, end);
        RequestOptions options;
        options.headers.push_back("Range: bytes=" + std::to_string(offset) + "-" + std::to_string(chunkEnd));
        const Response part = httpRequest(url, options);
        if (part.status != 206 || part.body.empty()) {
          std::lock_guard<std::mutex> lock(errorMutex);
          if (failure.empty()) failure = part.error.empty() ? "HTTP " + std::to_string(part.status) : part.error;
          failed.store(true);
          return;
        }
        if (static_cast<long long>(part.body.size()) != chunkEnd - offset + 1) {
          std::lock_guard<std::mutex> lock(errorMutex);
          if (failure.empty()) failure = "a range came back short";
          failed.store(true);
          return;
        }
        std::string writeError;
        if (!writeAt(wideDestination, offset, part.body, &writeError)) {
          std::lock_guard<std::mutex> lock(errorMutex);
          if (failure.empty()) failure = writeError;
          failed.store(true);
          return;
        }
        done.fetch_add(static_cast<long long>(part.body.size()));
        offset = chunkEnd + 1;
      }
    };

    const auto began = std::chrono::steady_clock::now();
    std::vector<std::thread> workers;
    const long long per = total / parts;
    long long start = 0;
    for (int i = 0; i < parts; ++i) {
      const long long end = (i == parts - 1) ? total - 1 : start + per - 1;
      workers.emplace_back([&, start, end]() {
        downloadRange(start, end);
        remaining.fetch_sub(1);
      });
      start = end + 1;
    }

    while (remaining.load() > 0) {
      printProgress(done.load(), total, began);
      std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    for (std::thread& worker : workers) worker.join();
    std::fprintf(stderr, "\n");

    if (failed.load()) {
      DeleteFileW(wideDestination.c_str());
      *error = failure.empty() ? "the download failed" : failure;
      return 1;
    }
    if (done.load() != total) {
      DeleteFileW(wideDestination.c_str());
      *error = "the download is incomplete";
      return 1;
    }

    const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - began).count();
    const double speed = seconds > 0 ? static_cast<double>(total) / seconds : 0.0;
    char summary[256];
    std::snprintf(summary, sizeof(summary), "  in %.1fs  %s/s  %d connection%s",
                  seconds, humanSize(static_cast<uint64_t>(speed)).c_str(), parts, parts == 1 ? "" : "s");
    emit(log, "downloaded " + destination + "  " + humanSize(static_cast<uint64_t>(total)) + summary);
  } else {
    *error = "HTTP " + std::to_string(head.status) + " from " + url;
    return 1;
  }

  if (!verifyDigest(wideDestination, want, error)) {
    DeleteFileW(wideDestination.c_str());
    return 1;
  }
  if (want.empty()) emit(log, "sha256 not checked (no --sha256 given)");
  else emit(log, "sha256 verified: " + want);
  return 0;
}

// ---------------------------------------------------------------- cli

void help() {
  out(std::string(APP) + " [v" + version() + "]  ·  Infinity.Inc");
  out("");
  out("  int                       open the window (serves the interface)");
  out("  int cli                   open the command line");
  out("  int gui                   open the window");
  out("  int --serve-ui [--port=N] serve the interface on 127.0.0.1 (default " +
      std::to_string(kDefaultUiPort) + ")");
  out("  int list                  every tool, builtin and plugin");
  out("  int info <tool>           everything known about one tool");
  out("  int run <tool> [args...]  run a tool");
  out("  int plugin list           plugins installed on this machine, directory or .itbt");
  out("  int plugin install <f.itbt>  verify, unpack and register a .itbt container");
  out("  int plugin verify <name|f>   every entry's SHA-256, or an installed plugin");
  out("  int --version             print the version");
  out("  int --paths               where this program keeps things");
}

void listTools() {
  out(padRight("NAME", 14) + padRight("KIND", 9) + padRight("READY", 7) + "DESCRIPTION");
  for (size_t i = 0; i < kToolCount; ++i) {
    const Tool& tool = kTools[i];
    out(padRight(tool.name, 14) + padRight(kindName(tool.kind), 9) + padRight("yes", 7) + tool.summary);
  }
  for (const Plugin& plugin : scanPlugins()) {
    out(padRight(plugin.name, 14) + padRight("plugin", 9) + padRight(plugin.present ? "yes" : "no", 7) +
        (plugin.present ? "plugin: " + plugin.filename : std::string("plugin: file missing")));
  }
}

int infoTool(const std::string& name) {
  if (const Tool* tool = findTool(name)) {
    out("name     " + std::string(tool->name));
    out("kind     " + std::string(kindName(tool->kind)));
    out("ready    yes");
    out("usage    " + std::string(tool->usage));
    out("summary  " + std::string(tool->summary));
    return 0;
  }
  for (const Plugin& plugin : scanPlugins()) {
    if (!iequals(plugin.name, name)) continue;
    out("name     " + plugin.name);
    out("kind     plugin");
    out("ready    " + std::string(plugin.present ? "yes" : "no"));
    if (!plugin.version.empty()) out("version  " + plugin.version);
    if (!plugin.filename.empty()) out("file     " + plugin.filename);
    out("path     " + plugin.directory);
    if (plugin.fromContainer) {
      out("source   " + plugin.containerFile);
      out("sha256   " + plugin.containerSha);
      out("entries  " + std::to_string(plugin.containerEntries));
      if (!plugin.containerValid) out("problem  " + plugin.note);
    }
    return 0;
  }
  out(color(C_RED, "int: no such tool: " + name));
  return 1;
}

void listPlugins() {
  const std::vector<Plugin> plugins = scanPlugins();
  if (plugins.empty()) {
    out(color(C_DIM, "no plugins installed"));
    const std::wstring root = pluginRoot();
    if (!root.empty()) out(color(C_DIM, "  looked in " + toUtf8(root)));
    return;
  }
  // STATUS is the last column so a colour escape cannot push the columns after
  // it around; the container's source and digest come before it.
  out(padRight("NAME", 18) + padRight("VERSION", 12) + padRight("FILE", 26) +
      padRight("SOURCE", 46) + "STATUS");
  for (const Plugin& plugin : plugins) {
    std::string status = plugin.present ? color(C_GREEN, "installed") : color(C_YELLOW, "missing");
    std::string source = "-";
    if (plugin.fromContainer) {
      source = baseName(plugin.containerFile) + "  sha256 " + plugin.containerSha.substr(0, 8);
      if (!plugin.containerValid) {
        status = color(C_RED, "invalid");
        source += "  " + plugin.note;
      } else if (!plugin.present) {
        source += "  (not unpacked)";
      }
    }
    out(padRight(plugin.name, 18) +
        padRight(plugin.version.empty() ? "-" : plugin.version, 12) +
        padRight(plugin.filename.empty() ? "-" : plugin.filename, 26) +
        padRight(source, 46) + status);
  }
}

// One container, every entry, digests printed. A failure names the entry and
// both digests, because 'the container is bad' is not an actionable answer.
int verifyContainerFile(const std::wstring& path, const std::string& label) {
  std::string bytes, error;
  if (!readWholeFile(path, &bytes, &error)) { out(color(C_RED, "int: " + error)); return 1; }

  ItbtArchive archive;
  if (!parseItbt(bytes, &archive, &error)) {
    out(color(C_RED, "int: " + label + ": " + error));
    return 1;
  }
  std::vector<ItbtCheck> checks;
  const bool ok = verifyItbt(bytes, archive, &checks);

  out("container " + label);
  out("  name    " + archive.name + (archive.version.empty() ? "" : "  " + archive.version));
  out("  exe     " + archive.exe);
  out("  entries " + std::to_string(archive.entries.size()) + "  " + humanSize(bytes.size()));
  for (const ItbtCheck& check : checks) {
    out("  " + (check.ok ? color(C_GREEN, "ok  ") : color(C_RED, "FAIL")) + "  " +
        padRight(check.path, 36) + padRight(humanSize(check.rawSize), 12) + check.actual);
    if (!check.ok) out("        expected " + check.expected);
  }
  out(ok ? color(C_GREEN, "verified " + std::to_string(checks.size()) + " entries, sha256 " +
                          sha256Bytes(bytes))
         : color(C_RED, "verification failed"));
  return ok ? 0 : 1;
}

// The argument is either a file (or a .itbt path) or the name of an installed
// plugin. A directory plugin has no manifest of hashes to compare against, so
// its digests are printed as facts rather than as a verdict.
int verifyPlugin(const std::string& target) {
  const std::wstring path = toWide(target);
  const bool asFile = endsWith(lower(target), ".itbt") ||
      GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
  if (asFile) return verifyContainerFile(path, target);

  for (const Plugin& plugin : scanPlugins()) {
    if (!iequals(plugin.name, target)) continue;
    if (plugin.fromContainer) {
      return verifyContainerFile(toWide(plugin.containerFile), plugin.containerFile);
    }
    out("directory plugin " + plugin.name + "  " + plugin.directory);
    std::vector<std::wstring> files;
    collectFiles(toWide(plugin.directory), &files);
    std::sort(files.begin(), files.end());
    for (const std::wstring& file : files) {
      std::string error;
      const std::string digest = sha256File(file, &error);
      const std::string full = toUtf8(file);
      const std::string relative = full.size() > plugin.directory.size()
          ? full.substr(plugin.directory.size() + 1) : full;
      out("  --    " + padRight(relative, 36) + (digest.empty() ? error : digest));
    }
    out("no stored digests: a directory plugin carries no manifest of hashes");
    return 0;
  }
  out(color(C_RED, "int: no plugin named " + target));
  return 1;
}

// install = verify, unpack atomically, register. Re-installing the same
// container is a no-op when the unpacked copy matches; a different one is
// refused unless --overwrite is given, so an install never silently replaces
// a working plugin with an older build.
int installPlugin(const std::string& file, bool overwrite) {
  const std::wstring path = toWide(file);
  if (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES) {
    out(color(C_RED, "int: no such file: " + file));
    return 1;
  }
  std::string bytes, error;
  if (!readWholeFile(path, &bytes, &error)) { out(color(C_RED, "int: " + error)); return 1; }

  ItbtArchive archive;
  if (!parseItbt(bytes, &archive, &error)) {
    out(color(C_RED, "int: " + file + ": " + error));
    return 1;
  }
  std::vector<ItbtCheck> checks;
  if (!verifyItbt(bytes, archive, &checks)) {
    for (const ItbtCheck& check : checks) {
      if (check.ok) continue;
      out(color(C_RED, "int: " + file + ": entry '" + check.path + "' failed SHA-256"));
      out("  expected " + check.expected);
      out("  actual   " + check.actual);
      break;
    }
    return 1;
  }

  const std::wstring root = pluginRoot();
  if (root.empty()) { out(color(C_RED, "int: LOCALAPPDATA is not available")); return 1; }

  std::string log;
  if (!extractItbt(bytes, archive, root, overwrite, &log, &error)) {
    out(color(C_RED, "int: " + error));
    return 1;
  }

  uint64_t raw = 0;
  for (const ItbtEntry& entry : archive.entries) raw += entry.rawSize;
  out("installed " + archive.name + (archive.version.empty() ? "" : "  " + archive.version));
  out("  entries " + std::to_string(archive.entries.size()) + "  raw " + humanSize(raw) +
      "  container " + humanSize(bytes.size()));
  out("  exe     " + archive.exe);
  out("  path    " + toUtf8(root + L"\\" + toWide(archive.name)));
  out("  sha256  " + sha256Bytes(bytes));
  if (!log.empty()) out("  " + log);
  return 0;
}

int runTool(const std::vector<std::string>& args) {
  if (args.empty()) { out(color(C_RED, "usage: int run <tool> [args...]")); return 2; }
  const std::string name = args[0];
  const std::vector<std::string> rest(args.begin() + 1, args.end());

  if (const Tool* tool = findTool(name)) {
    std::string log, error;
    const int code = tool->run(rest, &log, &error);
    if (!log.empty()) {
      std::string text = log;
      while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
      if (!text.empty()) out(text);
    }
    if (!error.empty()) out(color(C_RED, "int: " + error));
    return code;
  }

  for (const Plugin& plugin : scanPlugins()) {
    if (!iequals(plugin.name, name)) continue;

    // First use of a container unpacks it, atomically, exactly as install
    // would. An already unpacked copy is left alone.
    if (plugin.fromContainer && !plugin.present) {
      std::string bytes, error, log;
      if (!readWholeFile(toWide(plugin.containerFile), &bytes, &error)) {
        out(color(C_RED, "int: " + error));
        return 1;
      }
      ItbtArchive archive;
      if (!parseItbt(bytes, &archive, &error)) {
        out(color(C_RED, "int: " + plugin.name + ": " + error));
        return 1;
      }
      const std::wstring root = pluginRoot();
      if (root.empty() || !extractItbt(bytes, archive, root, false, &log, &error)) {
        out(color(C_RED, "int: " + (error.empty()
                                       ? std::string("LOCALAPPDATA is not available") : error)));
        return 1;
      }
      out("unpacked " + plugin.name + " from " + baseName(plugin.containerFile));
    }
    if (!plugin.present) {
      out(color(C_RED, "int: plugin `" + plugin.name + "` is not installed"));
      if (!plugin.filename.empty()) out(color(C_DIM, "  expected " + plugin.filename + " in " + plugin.directory));
      return 1;
    }
    const std::wstring workDirectory = toWide(plugin.directory);
    const std::wstring file = workDirectory + L"\\" + toWide(plugin.filename);
    std::wstring command = L"\"" + file + L"\"";
    for (const std::string& a : rest) command += L" \"" + toWide(a) + L"\"";
    std::vector<wchar_t> mutableCommand(command.begin(), command.end());
    mutableCommand.push_back(L'\0');

    STARTUPINFOW startup = {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process = {};
    if (!CreateProcessW(file.c_str(), mutableCommand.data(), nullptr, nullptr, FALSE, 0, nullptr,
                        workDirectory.c_str(), &startup, &process)) {
      out(color(C_RED, "int: cannot start plugin `" + plugin.name + "`"));
      return 1;
    }
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    out("started plugin " + plugin.name + "  (" + plugin.filename + ")");
    return 0;
  }

  out(color(C_RED, "int: no such tool: " + name));
  return 1;
}

int cliMain(const std::vector<std::string>& args) {
  if (!args.empty()) {
    const std::string& a = args[0];
    if (a == "--version" || a == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (a == "--paths") {
      out("exe        " + exeDir());
      out("version    " + std::string(version()));
      out("platform   " + hostPlatform());
      const std::wstring root = pluginRoot();
      out("plugins    " + (root.empty() ? std::string("(LOCALAPPDATA is not available)") : toUtf8(root)));
      return 0;
    }
    if (a == "help" || a == "--help" || a == "-h") { help(); return 0; }
    if (a == "list") { listTools(); return 0; }
    if (a == "info") {
      if (args.size() != 2) { out(color(C_RED, "usage: int info <tool>")); return 2; }
      return infoTool(args[1]);
    }
    if (a == "run") return runTool(std::vector<std::string>(args.begin() + 1, args.end()));
    if (a == "plugin") {
      const std::string action = args.size() >= 2 ? lower(args[1]) : std::string();
      if (action == "list") { listPlugins(); return 0; }
      if (action == "install") {
        if (args.size() < 3) { out(color(C_RED, "usage: int plugin install <file.itbt> [--overwrite]")); return 2; }
        const bool overwrite = args.size() > 3 &&
            (lower(args[3]) == "--overwrite" || lower(args[3]) == "--force" || lower(args[3]) == "-f");
        return installPlugin(args[2], overwrite);
      }
      if (action == "verify") {
        if (args.size() < 3) { out(color(C_RED, "usage: int plugin verify <name|file.itbt>")); return 2; }
        return verifyPlugin(args[2]);
      }
      out(color(C_RED, "usage: int plugin list|install <file.itbt>|verify <name|file.itbt>"));
      return 2;
    }
  }
  help();
  return 0;
}

// ---------------------------------------------------------------- window
//
// The window is Electron, so this program serves the page rather than drawing
// it: the three documents the other applications ship, the two JSON routes the
// script reads, and the one route that runs a tool.

std::string stateJson() {
  size_t plugins = 0, ready = kToolCount;
  for (const Plugin& plugin : scanPlugins()) {
    plugins++;
    if (plugin.present) ready++;
  }
  const std::wstring root = pluginRoot();

  Json state = Json::object();
  state.set("app", APP);
  state.set("version", version());
  state.set("platform", hostPlatform());
  state.set("pluginDir", root.empty() ? std::string() : toUtf8(root));
  state.set("builtin", static_cast<long long>(kToolCount));
  state.set("plugins", static_cast<long long>(plugins));
  state.set("ready", static_cast<long long>(ready));
  return state.dump();
}

std::string toolsJson() {
  Json tools = Json::array();
  for (size_t i = 0; i < kToolCount; ++i) {
    Json tool = Json::object();
    tool.set("name", kTools[i].name);
    tool.set("summary", kTools[i].summary);
    tool.set("usage", kTools[i].usage);
    tool.set("kind", kindName(kTools[i].kind));
    tool.set("ready", true);
    tools.push(tool);
  }
  for (const Plugin& plugin : scanPlugins()) {
    Json tool = Json::object();
    tool.set("name", plugin.name);
    tool.set("summary", plugin.present ? "plugin: " + plugin.filename : std::string("plugin: file missing"));
    tool.set("usage", "int run " + plugin.name);
    tool.set("kind", "plugin");
    tool.set("ready", plugin.present);
    tool.set("version", plugin.version);
    tool.set("path", plugin.directory);
    if (plugin.fromContainer) {
      tool.set("source", plugin.containerFile);
      tool.set("sha256", plugin.containerSha);
    }
    tools.push(tool);
  }
  Json root = Json::object();
  root.set("tools", tools);
  return root.dump();
}

UiResponse handleRun(const UiRequest& request) {
  // Only a builtin can be run from the page, and only without arguments. The
  // server is loopback-only and unauthenticated, so anything it exposes is
  // something a page already open on this machine could reach; a builtin with
  // no arguments can only report, and a plugin is left to the command line
  // where starting it is a deliberate act.
  const auto it = request.query.find("tool");
  const std::string name = it == request.query.end() ? std::string() : it->second;
  const Tool* tool = findTool(name);
  if (!tool) return UiResponse::error(404, "no builtin tool named " + name);

  std::string log, error;
  tool->run(std::vector<std::string>(), &log, &error);
  Json result = Json::object();
  result.set("ok", error.empty());
  result.set("output", log);
  result.set("error", error);
  return UiResponse::json(result.dump());
}

inline const char* uiHtml() {
  return R"HTML(<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infinity Toolbox</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="bar">
  <div class="brand"><span class="logo"></span><b>Infinity Toolbox</b><span class="ver" id="version"></span></div>
  <div class="summary" id="summary">loading&hellip;</div>
  <div class="who" id="who"></div>
</header>

<main>
  <section class="list">
    <table id="tools">
      <thead><tr><th>Tool</th><th>Kind</th><th>Ready</th><th class="c-act"></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>No tools.</div>
  </section>

  <aside class="detail">
    <h2 id="dTitle">No tool selected</h2>
    <p class="muted" id="dSummary">Pick a tool to see what it does.</p>
    <dl>
      <dt>Kind</dt><dd id="dKind">&mdash;</dd>
      <dt>Ready</dt><dd id="dReady">&mdash;</dd>
      <dt>Usage</dt><dd class="mono" id="dUsage">&mdash;</dd>
      <dt>Path</dt><dd class="mono" id="dPath">&mdash;</dd>
    </dl>
    <button id="run" class="btn primary" type="button" disabled>Run</button>
  </aside>
</main>

<footer class="status"><span class="dot" id="dot"></span><span id="status">Ready.</span></footer>

<script src="/app.js"></script>
</body>
</html>
)HTML";
}

inline const char* uiCss() {
  return R"CSS(:root{
  --bg:#eef1f7;--panel:#fff;--ink:#1b2330;--dim:#6b7688;--line:#dfe5ef;--line-soft:#eef1f7;
  --accent:#2f6fed;--sel:#e6efff;--ok:#1f9d61;--bad:#cf4034;
  --mono:ui-monospace,"Cascadia Mono",Consolas,monospace;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;height:100vh;color:var(--ink);background:var(--bg);
  font:14px/1.45 -apple-system,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif}

.bar{display:flex;align-items:center;gap:14px;padding:12px 18px;background:var(--panel);
  border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,var(--accent),#7c3aed)}
.brand b{font-size:15px}
.ver{color:var(--dim);font-size:12px}
.summary{color:var(--dim);font-size:12.5px}
.who{margin-left:auto;color:var(--dim);font-size:12px;font-family:var(--mono)}

main{flex:1;display:flex;min-height:0}
.list{flex:1;overflow:auto;padding:14px 18px}
table{width:100%;border-collapse:collapse}
th{text-align:left;color:var(--dim);font-weight:500;font-size:12px;padding:8px 10px;
  border-bottom:1px solid var(--line)}
td{padding:8px 10px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
tr.row{cursor:pointer}
tr.row:hover{background:#f6f8fc}
tr.sel{background:var(--sel)}
.c-act{width:96px;text-align:right;white-space:nowrap}
.badge{font-size:11.5px;padding:1px 8px;border-radius:10px;border:1px solid var(--line)}
.badge.ok{color:var(--ok);border-color:#bfe3cf;background:#eefaf3}
.badge.no{color:var(--bad);border-color:#f0c9c4;background:#fdeeed}
.empty{padding:60px 10px;text-align:center;color:var(--dim)}

.detail{width:330px;border-left:1px solid var(--line);background:var(--panel);padding:16px 18px;overflow:auto}
.detail h2{margin:0 0 6px;font-size:16px}
.muted{color:var(--dim);margin:0}
dl{display:grid;grid-template-columns:70px 1fr;gap:6px 10px;margin:14px 0}
dt{color:var(--dim);font-size:12px}
dd{margin:0;word-break:break-all}
.mono{font-family:var(--mono);font-size:12px}

.btn{background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:7px;
  padding:6px 12px;cursor:pointer;font-size:13px}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
.btn.small{padding:3px 10px;font-size:12px}
.btn:disabled{opacity:.5;cursor:default}

.status{display:flex;align-items:center;gap:8px;padding:8px 18px;border-top:1px solid var(--line);
  background:var(--panel);color:var(--dim);font-size:12.5px;min-height:34px;white-space:pre-line}
#status.ok{color:var(--ok)}
#status.err{color:var(--bad)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim);flex:none}
)CSS";
}

inline const char* uiJs() {
  return R"JS('use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var state = { tools: [], selected: null };

  function status(msg, kind) {
    var el = $('status');
    el.textContent = msg;
    el.className = kind || '';
  }
  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status));
        return j;
      });
    });
  }

  // Rows are built from nodes and filled with textContent, never with markup:
  // a tool name comes from disk and is data, not a fragment of this page.
  function rowFor(tool) {
    var tr = document.createElement('tr');
    tr.className = 'row';
    tr.dataset.name = tool.name;

    var name = document.createElement('td');
    name.textContent = tool.name;
    tr.appendChild(name);

    var kind = document.createElement('td');
    kind.textContent = tool.kind;
    tr.appendChild(kind);

    var ready = document.createElement('td');
    var badge = document.createElement('span');
    badge.className = 'badge ' + (tool.ready ? 'ok' : 'no');
    badge.textContent = tool.ready ? 'ready' : 'missing';
    ready.appendChild(badge);
    tr.appendChild(ready);

    var act = document.createElement('td');
    act.className = 'c-act';
    var run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn small';
    run.textContent = 'Run';
    run.disabled = !tool.ready;
    run.onclick = function (ev) { ev.stopPropagation(); runTool(tool); };
    act.appendChild(run);
    tr.appendChild(act);

    tr.onclick = function () { select(tool); };
    return tr;
  }

  function paint() {
    var rows = $('rows');
    rows.innerHTML = '';
    state.tools.forEach(function (tool) { rows.appendChild(rowFor(tool)); });
    $('empty').hidden = state.tools.length > 0;
    $('summary').textContent = state.tools.length + ' tools';
  }

  function select(tool) {
    state.selected = tool;
    Array.prototype.forEach.call($('rows').children, function (tr) {
      tr.classList.toggle('sel', tr.dataset.name === tool.name);
    });
    $('dTitle').textContent = tool.name;
    $('dSummary').textContent = tool.summary || '';
    $('dKind').textContent = tool.kind || '';
    $('dReady').textContent = tool.ready ? 'ready' : 'not ready';
    $('dUsage').textContent = tool.usage || '\u2014';
    $('dPath').textContent = tool.path || '\u2014';
    $('run').disabled = !tool.ready;
  }

  function runTool(tool) {
    status('Running ' + tool.name + '\u2026');
    api('/api/run?tool=' + encodeURIComponent(tool.name), { method: 'POST' })
      .then(function (j) {
        if (j.ok) status(j.output || (tool.name + ' finished.'), 'ok');
        else status(j.error || (tool.name + ' failed.'), 'err');
      })
      .catch(function (e) { status(e.message, 'err'); });
  }

  function load() {
    api('/api/state').then(function (j) {
      $('version').textContent = j.version || '';
      $('who').textContent = (j.platform || '') + (j.pluginDir ? '  \u00B7  ' + j.pluginDir : '');
    }).catch(function () { /* the tools list is the part that matters */ });

    api('/api/tools').then(function (j) {
      state.tools = j.tools || [];
      paint();
      status(state.tools.length + ' tools');
    }).catch(function (e) { status(e.message, 'err'); });
  }

  $('run').onclick = function () { if (state.selected) runTool(state.selected); };
  load();
})();
)JS";
}

int serveUi(int port) {
  UiServer server;
  server.route("GET", "/", [](const UiRequest&) { return UiResponse::html(uiHtml()); });
  server.route("GET", "/app.css", [](const UiRequest&) { return UiResponse::css(uiCss()); });
  server.route("GET", "/app.js", [](const UiRequest&) { return UiResponse::js(uiJs()); });
  server.route("GET", "/api/state", [](const UiRequest&) { return UiResponse::json(stateJson()); });
  server.route("GET", "/api/tools", [](const UiRequest&) { return UiResponse::json(toolsJson()); });
  server.route("POST", "/api/run", [](const UiRequest& request) { return handleRun(request); });

  std::string error;
  if (!server.start(port, &error)) {
    out(std::string(APP) + ": " + error);
    return 1;
  }
  out(std::string(APP) + " is serving the interface at " + server.url() + "  ·  Ctrl+C to stop");
  server.wait();
  return 0;
}

}  // namespace

// ---------------------------------------------------------------- entry

int main(int argc, char** argv) {
  // The console has to be asked for UTF-8 before anything is printed, or the
  // Chinese in the interface arrives as mojibake on a code page 936 machine.
  SetConsoleOutputCP(CP_UTF8);
  SetConsoleCP(CP_UTF8);

  std::vector<std::string> args;
  for (int i = 1; i < argc; i++) args.push_back(argv[i]);

  if (!args.empty()) {
    if (args[0] == "--version" || args[0] == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (args[0] == "--help" || args[0] == "-h" || args[0] == "help") { help(); return 0; }
    if (args[0] == "--serve-ui") return serveUi(uiPortFromArgs(args, kDefaultUiPort));
  }

  Mode m = detectMode();

  // `int gui` and friends still work when the program is started under a name
  // that carries no mode, which is what happens from a source build.
  if (m.mode.empty() && !args.empty()) {
    const std::string& a = args[0];
    std::vector<std::string> rest(args.begin() + 1, args.end());
    if (a == "cli") return cliMain(rest);
    if (a == "gui") return serveUi(uiPortFromArgs(args, kDefaultUiPort));
  }

  if (m.mode == "gui") return serveUi(kDefaultUiPort);
  if (m.mode == "cli") return cliMain(args);

  // No mode in the name and nothing on the command line: a bare double click
  // opens the window, which for this application is the interface served over
  // loopback for Electron to draw.
  if (args.empty()) return serveUi(kDefaultUiPort);
  return cliMain(args);
}
