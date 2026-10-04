// main.cpp - Infinity Games, in C++.
//
// A games library. Two kinds of entry, and they are genuinely different:
//
//   local    an executable already on this machine. The library remembers
//            where it is and starts it when asked.
//   online   a web game. The library stores an address and nothing else.
//
// The online entry is the part worth reading carefully. An online game is a
// page that belongs to somebody else, so this program stores its address and
// hands it to the window - it does not fetch it, mirror it, or put it inside
// a frame of its own. Two reasons, and either alone would settle it: a frame
// would present another site's content as this program's, and it would break
// the first time that site adds a frame guard. The window says whose page it
// is, and the address is used as an outbound link rather than as content.
//
// Because the address is the only untrusted text this program keeps, it is
// the only text it checks. Only `https:` with a host is accepted; everything
// else is refused with the reason, at the moment it is stored and again at
// the moment it is used.
//
//   ing_cli   a command line
//   ing_gui   the window
//
// The window is Electron, so the gui face is not a Win32 window: this program
// serves the page over loopback and Electron draws it, exactly as the other
// applications do. `ing --serve-ui [--port=N]` is that server on its own.
//
// The library is a JSON file, not code: adding a game is adding one entry.

#include <cstdio>
#include <cstdlib>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>

#include "inc/ansi.hpp"
#include "inc/github.hpp"   // version()
#include "inc/json.hpp"
#include "inc/mode.hpp"
#include "inc/str.hpp"
#include "inc/uiserver.hpp"
#include "unblock.hpp"

#include <algorithm>
#include <string>
#include <vector>

using namespace inc;

static const char* APP = "Infinity Games";

namespace {

// The port the window's origin listens on when none is given. Fixed rather
// than random so the Electron shell has something to point at without asking.
const int kDefaultUiPort = 7664;

// ---------------------------------------------------------------- output

void out(const std::string& text) {
  fwrite(text.data(), 1, text.size(), stdout);
  fputc('\n', stdout);
}

// ---------------------------------------------------------------- arguments

// The value of `--name=value`, or empty when it is absent.
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

// The library lives where the rest of the suite keeps its state, under the
// same company directory, so "where does Infinity.Inc keep things" still has
// one answer.
std::wstring libraryDir() {
  const std::wstring base = localAppDataDir();
  if (base.empty()) return std::wstring();
  return base + L"Infinity.Inc\\games";
}

std::wstring libraryPath() {
  const std::wstring dir = libraryDir();
  if (dir.empty()) return std::wstring();
  return dir + L"\\library.json";
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

bool writeTextFile(const std::wstring& path, const std::string& text) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  const char* data = text.data();
  size_t remaining = text.size();
  while (remaining) {
    DWORD written = 0;
    const DWORD want = remaining > (1u << 20) ? (1u << 20) : static_cast<DWORD>(remaining);
    if (!WriteFile(file, data, want, &written, nullptr) || !written) {
      CloseHandle(file);
      return false;
    }
    data += written;
    remaining -= written;
  }
  CloseHandle(file);
  return true;
}

// A clock stamp for the two moments the library records: when a game was
// added and when it was last played. Local time, to the minute - this is a
// line a person reads, not a key anything sorts on.
std::string nowStamp() {
  SYSTEMTIME t;
  GetLocalTime(&t);
  char buffer[32];
  std::snprintf(buffer, sizeof(buffer), "%04d-%02d-%02d %02d:%02d",
                (int)t.wYear, (int)t.wMonth, (int)t.wDay, (int)t.wHour, (int)t.wMinute);
  return std::string(buffer);
}

std::wstring parentOf(const std::wstring& path) {
  const size_t slash = path.find_last_of(L"\\/");
  if (slash == std::wstring::npos || slash == 0) return std::wstring();
  return path.substr(0, slash);
}

// A relative path typed at a prompt is relative to wherever the shell was;
// the library stores the absolute one so it still means the same thing later.
std::wstring absolutePath(const std::wstring& path) {
  const DWORD need = GetFullPathNameW(path.c_str(), 0, nullptr, nullptr);
  if (!need) return path;
  std::vector<wchar_t> buffer(need + 1);
  const DWORD wrote = GetFullPathNameW(path.c_str(), need + 1, buffer.data(), nullptr);
  if (!wrote || wrote > need) return path;
  return std::wstring(buffer.data(), wrote);
}

bool fileExists(const std::wstring& path) {
  if (path.empty()) return false;
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
}

// ---------------------------------------------------------------- addresses
//
// The one place this program handles text it did not write. A stored address
// is used as the target of a real navigation, so it is checked on the way in
// and again on the way out: a file can be edited by hand between those two
// moments, and a check that only happened once is not a check.

struct Address {
  bool ok = false;
  std::string url;
  std::string host;
  std::string reason;
};

Address checkAddress(const std::string& raw) {
  Address result;
  const std::string text = trim(raw);

  if (text.empty()) { result.reason = "the address is empty"; return result; }
  if (text.size() > 2048) { result.reason = "the address is too long to be a web address"; return result; }
  for (char c : text) {
    if ((unsigned char)c <= 0x20 || (unsigned char)c == 0x7f) {
      result.reason = "the address contains a space or a control character";
      return result;
    }
  }

  if (!startsWith(lower(text), "https://")) {
    const size_t colon = text.find(':');
    const std::string scheme = colon == std::string::npos ? std::string("no scheme at all")
                                                          : text.substr(0, colon);
    result.reason = "only https:// addresses are accepted; this one has " + scheme;
    return result;
  }

  // The authority is everything up to the first / ? or #. It is the part that
  // says which machine the page comes from, so it is the part that matters.
  size_t end = text.size();
  for (size_t i = 8; i < text.size(); i++) {
    const char c = text[i];
    if (c == '/' || c == '?' || c == '#') { end = i; break; }
  }
  const std::string authority = text.substr(8, end - 8);
  if (authority.empty()) { result.reason = "the address has no host"; return result; }

  // "https://good.example.com@evil.example/" is the classic look-alike: the
  // host is the part after the @, not the part a person reads. Refusing it
  // outright is shorter than explaining it.
  if (authority.find('@') != std::string::npos) {
    result.reason = "the address carries credentials before the host, which is how a look-alike is written";
    return result;
  }

  // Split off the port. An IPv6 literal is bracketed, so its colons are part
  // of the address and the port is the one after the bracket.
  std::string host = authority;
  if (host[0] == '[') {
    const size_t close = host.find(']');
    if (close == std::string::npos) { result.reason = "the host is an IPv6 address with no closing bracket"; return result; }
    if (close + 1 < host.size()) {
      if (host[close + 1] != ':') { result.reason = "the host is not a valid address"; return result; }
      const std::string port = host.substr(close + 2);
      if (port.empty() || port.find_first_not_of("0123456789") != std::string::npos) {
        result.reason = "the port is not a number";
        return result;
      }
    }
    host = host.substr(1, close - 1);
  } else {
    const size_t colon = host.find(':');
    if (colon != std::string::npos) {
      const std::string port = host.substr(colon + 1);
      if (port.empty() || port.find_first_not_of("0123456789") != std::string::npos) {
        result.reason = "the port is not a number";
        return result;
      }
      host = host.substr(0, colon);
    }
  }

  if (host.empty()) { result.reason = "the address has no host"; return result; }
  for (char c : host) {
    const bool allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                         (c >= '0' && c <= '9') || c == '-' || c == '.' || c == ':';
    if (!allowed) { result.reason = "the host contains a character a host name cannot contain"; return result; }
  }
  if (host.front() == '.' || host.back() == '.' || host.find("..") != std::string::npos) {
    result.reason = "the host is not a domain name";
    return result;
  }

  result.ok = true;
  result.url = text;
  result.host = host;
  return result;
}

// ---------------------------------------------------------------- registry

enum class Kind { Local, Online };

const char* kindName(Kind kind) {
  return kind == Kind::Online ? "online" : "local";
}

struct Game {
  std::string name;
  Kind kind = Kind::Local;
  std::string path;         // local: the executable
  std::string url;          // online: the address
  std::string addedAt;
  std::string lastPlayed;

  const std::string& source() const { return kind == Kind::Online ? url : path; }
  bool present() const {
    return kind == Kind::Online ? !url.empty() : fileExists(toWide(path));
  }
};

Json gameJson(const Game& game) {
  Json j = Json::object();
  j.set("name", game.name);
  j.set("kind", kindName(game.kind));
  if (game.kind == Kind::Online) j.set("url", game.url);
  else j.set("path", game.path);
  j.set("addedAt", game.addedAt);
  j.set("lastPlayed", game.lastPlayed);
  return j;
}

Game gameFromJson(const Json& j) {
  Game game;
  game.name = trim(j.s("name"));
  game.kind = iequals(j.s("kind"), "online") ? Kind::Online : Kind::Local;
  game.path = j.s("path");
  game.url = j.s("url");
  game.addedAt = j.s("addedAt");
  game.lastPlayed = j.s("lastPlayed");
  return game;
}

// Read the library off the disk every time it is needed. A file the program
// can re-read cannot disagree with itself, and `add` from the command line
// shows up in the window without the two having to tell each other anything.
std::vector<Game> loadLibrary(std::string* error) {
  std::vector<Game> games;
  const std::wstring path = libraryPath();
  if (path.empty()) { *error = "LOCALAPPDATA is not available, so the library cannot be read"; return games; }

  const std::string text = readTextFile(path);
  if (text.empty()) return games;   // no file yet is an empty library, not a failure

  bool ok = false;
  const Json root = Json::parse(text, &ok);
  if (!ok || !root.isObject()) {
    *error = "the library file is not readable JSON: " + toUtf8(path);
    return games;
  }
  const Json& list = root.get("games");
  if (!list.isArray()) return games;
  for (const Json& entry : list.items()) {
    if (!entry.isObject()) continue;
    const Game game = gameFromJson(entry);
    if (game.name.empty()) continue;
    games.push_back(game);
  }
  std::sort(games.begin(), games.end(), [](const Game& a, const Game& b) {
    return lower(a.name) < lower(b.name);
  });
  return games;
}

bool saveLibrary(const std::vector<Game>& games, std::string* error) {
  const std::wstring dir = libraryDir();
  const std::wstring path = libraryPath();
  if (path.empty()) { *error = "LOCALAPPDATA is not available, so the library cannot be written"; return false; }
  if (!createDirectoryTree(dir)) { *error = "cannot create " + toUtf8(dir); return false; }

  Json list = Json::array();
  for (const Game& game : games) list.push(gameJson(game));
  Json root = Json::object();
  root.set("version", 1);
  root.set("games", list);
  if (!writeTextFile(path, root.dump(2))) { *error = "cannot write " + toUtf8(path); return false; }
  return true;
}

size_t indexOfGame(const std::vector<Game>& games, const std::string& name) {
  for (size_t i = 0; i < games.size(); i++) if (iequals(games[i].name, name)) return i;
  return games.size();
}

// A name is shown and typed, so it has to be something that survives both.
bool validName(const std::string& raw, std::string* why) {
  const std::string name = trim(raw);
  if (name.empty()) { *why = "the name is empty"; return false; }
  if (name.size() > 80) { *why = "the name is longer than 80 characters"; return false; }
  for (char c : name) {
    if ((unsigned char)c < 0x20 || (unsigned char)c == 0x7f) { *why = "the name contains a control character"; return false; }
  }
  return true;
}

// ---------------------------------------------------------------- launch

// A local game is started by handing the file to the shell, which is what
// already knows how to run it. The file is checked first: a game that was
// moved or uninstalled since it was added has to be reported, not attempted.
bool launchLocal(const Game& game, std::string* error) {
  const std::wstring file = toWide(game.path);
  if (!fileExists(file)) {
    *error = "the file is no longer where the library says it is: " + game.path;
    return false;
  }
  const std::wstring directory = parentOf(file);
  const INT_PTR code = reinterpret_cast<INT_PTR>(ShellExecuteW(
      nullptr, L"open", file.c_str(), nullptr,
      directory.empty() ? nullptr : directory.c_str(), SW_SHOWNORMAL));
  if (code <= 32) {
    *error = "Windows would not start " + game.path + " (ShellExecute reported " +
             std::to_string((long long)code) + ")";
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- cli

void help() {
  out(std::string(APP) + " [v" + version() + "]  ·  Infinity.Inc");
  out("");
  out("  ing                       open the window (serves the interface)");
  out("  ing cli                   open the command line");
  out("  ing gui                   open the window");
  out("  ing --serve-ui [--port=N] serve the interface on 127.0.0.1 (default " +
      std::to_string(kDefaultUiPort) + ")");
  out("  ing list                  every game in the library");
  out("  ing info <name>           everything known about one game");
  out("  ing run <name>            start a local game; print an online game's address");
  out("  ing add local <name> <path>    remember an executable on this machine");
  out("  ing add online <name> <url>    remember a web game by its address");
  out("  ing remove <name>         forget a game");
  out("  ing --version             print the version");
  out("  ing --paths               where this program keeps things");
  out("");
  out("  An online game is stored as an address and handed to the window. It is");
  out("  not fetched, copied or embedded here - the page belongs to whoever");
  out("  published it, and only https:// addresses with a host are accepted.");
}

void listGames() {
  std::string error;
  const std::vector<Game> games = loadLibrary(&error);
  if (!error.empty()) { out(color(C_RED, "ing: " + error)); return; }
  if (games.empty()) {
    out(color(C_DIM, "the library is empty"));
    out(color(C_DIM, "  ing add local <name> <path>     or     ing add online <name> <url>"));
    return;
  }
  out(padRight("NAME", 20) + padRight("KIND", 8) + padRight("SOURCE", 46) + "LAST PLAYED");
  for (const Game& game : games) {
    out(padRight(game.name, 20) + padRight(kindName(game.kind), 8) +
        padRight(game.source().empty() ? "-" : game.source(), 46) +
        (game.lastPlayed.empty() ? color(C_DIM, "never") : game.lastPlayed));
  }
}

int infoGame(const std::string& name) {
  std::string error;
  std::vector<Game> games = loadLibrary(&error);
  if (!error.empty()) { out(color(C_RED, "ing: " + error)); return 1; }
  const size_t at = indexOfGame(games, name);
  if (at == games.size()) { out(color(C_RED, "ing: no such game: " + name)); return 1; }

  const Game& game = games[at];
  out("name         " + game.name);
  out("kind         " + std::string(kindName(game.kind)));
  out("source       " + (game.source().empty() ? "-" : game.source()));
  out("added        " + (game.addedAt.empty() ? "-" : game.addedAt));
  out("last played  " + (game.lastPlayed.empty() ? "never" : game.lastPlayed));
  if (game.kind == Kind::Local) {
    out("present      " + std::string(game.present() ? "yes" : color(C_YELLOW, "no - the file is gone")));
  } else {
    const Address address = checkAddress(game.url);
    if (address.ok) {
      out("host         " + address.host);
      out("note         this page belongs to " + address.host + ", not to " + APP + ".");
    } else {
      out("address      " + color(C_RED, "rejected: " + address.reason));
    }
  }
  return 0;
}

int runGame(const std::string& name) {
  std::string error;
  std::vector<Game> games = loadLibrary(&error);
  if (!error.empty()) { out(color(C_RED, "ing: " + error)); return 1; }
  const size_t at = indexOfGame(games, name);
  if (at == games.size()) { out(color(C_RED, "ing: no such game: " + name)); return 1; }

  Game& game = games[at];
  if (game.kind == Kind::Local) {
    std::string why;
    if (!launchLocal(game, &why)) { out(color(C_RED, "ing: " + why)); return 1; }
    game.lastPlayed = nowStamp();
    saveLibrary(games, &error);
    out("started " + game.name + "  (" + game.path + ")");
    return 0;
  }

  // An online game is not launched. Its address is checked again here - the
  // file may have been edited since it was stored - and then reported, which
  // is the only thing this program can honestly do with somebody else's page.
  const Address address = checkAddress(game.url);
  if (!address.ok) { out(color(C_RED, "ing: " + game.name + ": " + address.reason)); return 1; }
  game.lastPlayed = nowStamp();
  saveLibrary(games, &error);
  out(game.name + "  " + color(C_CYAN, address.url));
  out(color(C_DIM, "  hosted by " + address.host + " - this program stores the address and"));
  out(color(C_DIM, "  hands it to the window; it does not open or copy the page itself."));
  return 0;
}

int addGame(const std::vector<std::string>& args) {
  if (args.size() < 2) {
    out(color(C_RED, "usage: ing add local <name> <path>"));
    out(color(C_RED, "       ing add online <name> <url>"));
    return 2;
  }
  const std::string kind = lower(args[0]);
  if (kind != "local" && kind != "online") { out(color(C_RED, "ing: unknown kind: " + args[0])); return 2; }
  if (args.size() != 3) {
    out(color(C_RED, kind == "local"
        ? "usage: ing add local <name> <path>"
        : "usage: ing add online <name> <url>"));
    return 2;
  }

  const std::string name = trim(args[1]);
  std::string why;
  if (!validName(name, &why)) { out(color(C_RED, "ing: " + why)); return 2; }

  std::string error;
  std::vector<Game> games = loadLibrary(&error);
  if (!error.empty()) { out(color(C_RED, "ing: " + error)); return 1; }
  if (indexOfGame(games, name) != games.size()) {
    out(color(C_RED, "ing: a game named " + name + " is already in the library"));
    return 1;
  }

  Game game;
  game.name = name;
  game.addedAt = nowStamp();
  if (kind == "local") {
    game.kind = Kind::Local;
    const std::wstring full = absolutePath(toWide(trim(args[2])));
    game.path = toUtf8(full);
    if (game.path.empty()) { out(color(C_RED, "ing: the path is empty")); return 2; }
    games.push_back(game);
    if (!saveLibrary(games, &error)) { out(color(C_RED, "ing: " + error)); return 1; }
    if (fileExists(full)) {
      out("added " + game.name + "  (local)  " + game.path);
    } else {
      out("added " + game.name + "  (local)  " + game.path);
      out(color(C_YELLOW, "  the file is not there now; running it will say so"));
    }
    return 0;
  }

  game.kind = Kind::Online;
  const Address address = checkAddress(args[2]);
  if (!address.ok) { out(color(C_RED, "ing: " + address.reason)); return 2; }
  game.url = address.url;
  games.push_back(game);
  if (!saveLibrary(games, &error)) { out(color(C_RED, "ing: " + error)); return 1; }
  out("added " + game.name + "  (online)  " + game.url);
  out(color(C_DIM, "  hosted by " + address.host + "; nothing was fetched or copied"));
  return 0;
}

int removeGame(const std::string& name) {
  std::string error;
  std::vector<Game> games = loadLibrary(&error);
  if (!error.empty()) { out(color(C_RED, "ing: " + error)); return 1; }
  const size_t at = indexOfGame(games, name);
  if (at == games.size()) { out(color(C_RED, "ing: no such game: " + name)); return 1; }
  games.erase(games.begin() + (std::ptrdiff_t)at);
  if (!saveLibrary(games, &error)) { out(color(C_RED, "ing: " + error)); return 1; }
  out("removed " + name);
  return 0;
}

int cliMain(const std::vector<std::string>& args) {
  if (!args.empty()) {
    const std::string& a = args[0];
    if (a == "--version" || a == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (a == "--paths") {
      out("exe        " + exeDir());
      out("version    " + std::string(version()));
      out("platform   " + hostPlatform());
      const std::wstring dir = libraryDir();
      out("library    " + (dir.empty() ? std::string("(LOCALAPPDATA is not available)")
                                       : toUtf8(dir) + "\\library.json"));
      return 0;
    }
    if (a == "help" || a == "--help" || a == "-h") { help(); return 0; }
    if (a == "list") { listGames(); return 0; }
    if (a == "info") {
      if (args.size() != 2) { out(color(C_RED, "usage: ing info <name>")); return 2; }
      return infoGame(args[1]);
    }
    if (a == "run") {
      if (args.size() != 2) { out(color(C_RED, "usage: ing run <name>")); return 2; }
      return runGame(args[1]);
    }
    if (a == "add") return addGame(std::vector<std::string>(args.begin() + 1, args.end()));
    if (a == "remove") {
      if (args.size() != 2) { out(color(C_RED, "usage: ing remove <name>")); return 2; }
      return removeGame(args[1]);
    }
  }
  help();
  return 0;
}

// ---------------------------------------------------------------- window
//
// The window is Electron, so this program serves the page rather than drawing
// it: the three documents the other applications ship, and the two JSON
// routes the script reads.

std::string stateJson() {
  std::string error;
  const std::vector<Game> games = loadLibrary(&error);
  long long local = 0, online = 0, ready = 0;
  for (const Game& game : games) {
    if (game.kind == Kind::Online) {
      online++;
      if (checkAddress(game.url).ok) ready++;
    } else {
      local++;
      if (game.present()) ready++;
    }
  }
  const std::wstring dir = libraryDir();

  Json state = Json::object();
  state.set("app", APP);
  state.set("version", version());
  state.set("platform", hostPlatform());
  state.set("libraryDir", dir.empty() ? std::string() : toUtf8(dir));
  state.set("games", (long long)games.size());
  state.set("local", local);
  state.set("online", online);
  state.set("ready", ready);
  // An unreadable library is reported rather than shown as an empty one:
  // "you have nothing" and "I could not read what you have" are different.
  if (!error.empty()) state.set("error", error);
  return state.dump(2);
}

// An online address is re-checked on the way out, and only a good one is
// given to the page. The script never receives a URL this program has not
// accepted, so the link it builds is the link that was checked.
Json gameRowJson(const Game& game) {
  Json j = Json::object();
  j.set("name", game.name);
  j.set("kind", kindName(game.kind));
  j.set("addedAt", game.addedAt);
  j.set("lastPlayed", game.lastPlayed);
  if (game.kind == Kind::Online) {
    const Address address = checkAddress(game.url);
    j.set("host", address.ok ? address.host : std::string());
    j.set("ready", address.ok);
    if (address.ok) j.set("url", address.url);
    else j.set("reason", address.reason);
  } else {
    j.set("path", game.path);
    j.set("ready", game.present());
  }
  return j;
}

std::string gamesJson() {
  std::string error;
  const std::vector<Game> games = loadLibrary(&error);
  Json rows = Json::array();
  for (const Game& game : games) rows.push(gameRowJson(game));
  Json root = Json::object();
  root.set("games", rows);
  if (!error.empty()) root.set("error", error);
  return root.dump(2);
}

// The one route that acts. A local game is started; an online game's address
// is returned, and the page says whose it is. Nothing here fetches anything.
UiResponse handleRun(const UiRequest& request) {
  const auto it = request.query.find("name");
  const std::string name = it == request.query.end() ? std::string() : it->second;
  if (name.empty()) return UiResponse::error(400, "no game named in the request");

  std::string error;
  std::vector<Game> games = loadLibrary(&error);
  if (!error.empty()) return UiResponse::error(500, error);
  const size_t at = indexOfGame(games, name);
  if (at == games.size()) return UiResponse::error(404, "no game named " + name);

  Game& game = games[at];
  Json result = Json::object();
  result.set("name", game.name);
  result.set("kind", kindName(game.kind));

  if (game.kind == Kind::Local) {
    std::string why;
    if (!launchLocal(game, &why)) {
      result.set("ok", false);
      result.set("error", why);
      return UiResponse::json(result.dump(2));
    }
    game.lastPlayed = nowStamp();
    saveLibrary(games, &error);
    result.set("ok", true);
    result.set("message", "Started " + game.name + ".");
    return UiResponse::json(result.dump(2));
  }

  const Address address = checkAddress(game.url);
  if (!address.ok) {
    result.set("ok", false);
    result.set("error", address.reason);
    return UiResponse::json(result.dump(2));
  }
  game.lastPlayed = nowStamp();
  saveLibrary(games, &error);
  result.set("ok", true);
  result.set("url", address.url);
  result.set("host", address.host);
  result.set("message", game.name + " is hosted by " + address.host +
                        ". Infinity Games stores the address and nothing else.");
  return UiResponse::json(result.dump(2));
}

inline const char* uiHtml() {
  return R"HTML(<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infinity Games</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="bar">
  <div class="brand"><span class="logo"></span><b>Infinity Games</b><span class="ver" id="version"></span></div>
  <div class="summary" id="summary">loading&hellip;</div>
  <div class="who" id="who"></div>
</header>

<main>
  <section class="list">
    <table id="games">
      <thead><tr><th>Game</th><th>Kind</th><th>Source</th><th>Last played</th><th class="c-act"></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>No games yet &mdash; add one with
      <span class="mono">ing add local</span> or <span class="mono">ing add online</span>.</div>
  </section>

  <aside class="detail">
    <h2 id="dTitle">No game selected</h2>
    <p class="muted" id="dSummary">Pick a game to see where it comes from.</p>
    <dl>
      <dt>Kind</dt><dd id="dKind">&mdash;</dd>
      <dt>Source</dt><dd class="mono" id="dSource">&mdash;</dd>
      <dt>Host</dt><dd class="mono" id="dHost">&mdash;</dd>
      <dt>Added</dt><dd id="dAdded">&mdash;</dd>
      <dt>Played</dt><dd id="dPlayed">&mdash;</dd>
    </dl>
    <p class="note" id="dNote" hidden></p>
    <div class="linkbox" id="dLinkBox" hidden><a id="dLink" target="_blank" rel="noopener noreferrer"></a></div>
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
.c-act{width:110px;text-align:right;white-space:nowrap}
.badge{font-size:11.5px;padding:1px 8px;border-radius:10px;border:1px solid var(--line)}
.badge.ok{color:var(--ok);border-color:#bfe3cf;background:#eefaf3}
.badge.no{color:var(--bad);border-color:#f0c9c4;background:#fdeeed}
.empty{padding:60px 10px;text-align:center;color:var(--dim)}
.mono{font-family:var(--mono);font-size:12px}

.detail{width:360px;border-left:1px solid var(--line);background:var(--panel);padding:16px 18px;overflow:auto}
.detail h2{margin:0 0 6px;font-size:16px}
.muted{color:var(--dim);margin:0}
dl{display:grid;grid-template-columns:76px 1fr;gap:6px 10px;margin:14px 0}
dt{color:var(--dim);font-size:12px}
dd{margin:0;word-break:break-all}
.note{margin:10px 0 0;padding:9px 11px;border-radius:7px;background:#fff8e8;color:#7a5a10;font-size:12.5px}
.linkbox{margin:10px 0 0;word-break:break-all}
.linkbox a{color:var(--accent)}

.btn{background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:7px;
  padding:6px 12px;cursor:pointer;font-size:13px}
.btn:hover{border-color:var(--accent)}
.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600;margin-top:14px}
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
  var state = { games: [], selected: null };

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
  // a game's name, path and address are data, not fragments of this page.
  function rowFor(game) {
    var tr = document.createElement('tr');
    tr.className = 'row';
    tr.dataset.name = game.name;

    var name = document.createElement('td');
    name.textContent = game.name;
    tr.appendChild(name);

    var kind = document.createElement('td');
    kind.textContent = game.kind;
    tr.appendChild(kind);

    var source = document.createElement('td');
    source.className = 'mono';
    source.textContent = game.kind === 'online' ? (game.url || '(address rejected)') : (game.path || '');
    tr.appendChild(source);

    var played = document.createElement('td');
    played.textContent = game.lastPlayed || 'never';
    tr.appendChild(played);

    var act = document.createElement('td');
    act.className = 'c-act';
    var run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn small';
    run.textContent = game.kind === 'online' ? 'Open' : 'Run';
    run.disabled = !game.ready;
    run.onclick = function (ev) { ev.stopPropagation(); play(game); };
    act.appendChild(run);
    tr.appendChild(act);

    tr.onclick = function () { select(game); };
    return tr;
  }

  function paint() {
    var rows = $('rows');
    rows.innerHTML = '';
    state.games.forEach(function (g) { rows.appendChild(rowFor(g)); });
    $('empty').hidden = state.games.length > 0;
  }

  function select(game) {
    state.selected = game;
    Array.prototype.forEach.call($('rows').children, function (tr) {
      tr.classList.toggle('sel', tr.dataset.name === game.name);
    });
    var online = game.kind === 'online';
    $('dTitle').textContent = game.name;
    $('dSummary').textContent = online
      ? 'A web game. Its address is stored here; the page itself is not.'
      : 'A program on this machine.';
    $('dKind').textContent = game.kind;
    $('dSource').textContent = online ? (game.url || '\u2014') : (game.path || '\u2014');
    $('dHost').textContent = online ? (game.host || '\u2014') : 'this machine';
    $('dAdded').textContent = game.addedAt || '\u2014';
    $('dPlayed').textContent = game.lastPlayed || 'never';

    var note = $('dNote');
    if (online && game.host) {
      note.hidden = false;
      note.textContent = 'This game is published by ' + game.host +
        '. Infinity Games stores the address and does not host, copy or embed the page.';
    } else if (online && game.reason) {
      note.hidden = false;
      note.textContent = 'The stored address was rejected: ' + game.reason;
    } else {
      note.hidden = true;
      note.textContent = '';
    }

    var box = $('dLinkBox'), link = $('dLink');
    if (online && game.url) {
      box.hidden = false;
      link.textContent = game.url;
      link.href = game.url;
    } else {
      box.hidden = true;
      link.removeAttribute('href');
      link.textContent = '';
    }

    var run = $('run');
    run.disabled = !game.ready;
    run.textContent = online ? 'Open address' : 'Run';
  }

  // An online game is not started by this program. The address goes out as a
  // normal outbound link, so what opens is the publisher's own page in its own
  // tab - not somebody else's game inside a frame of ours.
  function openAddress(game) {
    if (!game.url) { status('That address was rejected: ' + (game.reason || 'unknown reason'), 'err'); return; }
    var a = document.createElement('a');
    a.href = game.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    status('Opened ' + game.url + ' in a new tab. That page belongs to ' + (game.host || 'its publisher') + '.');
  }

  function play(game) {
    if (game.kind === 'online') { openAddress(game); return; }
    status('Starting ' + game.name + '\u2026');
    api('/api/run?name=' + encodeURIComponent(game.name), { method: 'POST' })
      .then(function (j) {
        if (j.ok) { status(j.message || (game.name + ' started.'), 'ok'); load(); }
        else status(j.error || (game.name + ' could not be started.'), 'err');
      })
      .catch(function (e) { status(e.message, 'err'); });
  }

  function load() {
    api('/api/state').then(function (j) {
      $('version').textContent = j.version || '';
      $('who').textContent = (j.platform || '') + (j.libraryDir ? '  \u00B7  ' + j.libraryDir : '');
      var n = j.games || 0;
      $('summary').textContent = n + (n === 1 ? ' game' : ' games') +
        (j.local ? '  \u00B7  ' + j.local + ' local' : '') +
        (j.online ? '  \u00B7  ' + j.online + ' online' : '');
      if (j.error) status(j.error, 'err');
    }).catch(function () { /* the list is the part that matters */ });

    api('/api/games').then(function (j) {
      state.games = j.games || [];
      paint();
      if (j.error) status(j.error, 'err');
      else if (!state.games.length) status('No games yet.');
    }).catch(function (e) { status(e.message, 'err'); });
  }

  $('run').onclick = function () { if (state.selected) play(state.selected); };
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
  server.route("GET", "/api/games", [](const UiRequest&) { return UiResponse::json(gamesJson()); });
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
    if (args[0] == "--version" || args[0] == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (args[0] == "--help" || args[0] == "-h" || args[0] == "help") { help(); return 0; }
    if (args[0] == "--serve-ui") return serveUi(uiPortFromArgs(args, kDefaultUiPort));
  }

  Mode m = detectMode();

  // `ing gui` and friends still work when the program is started under a name
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
