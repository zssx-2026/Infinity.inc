// main.cpp - Infinity Cloud, in C++.
//
// One program, several faces, and the file name decides which one runs - the
// same contract the Node build had, kept so the executables can be swapped
// without anything else changing:
//
//   inc_cli        a command line
//   inc_tui        a full screen terminal interface
//   inc_gui        a native window
//   inc_launcher   a menu that starts one of the other three
//
// What is here is the part that has to be right before anything else can be
// built on it: the credential, the API, and the three ways of showing the
// answer. The cloud itself - manifest volumes, uploads, the task queue - is
// the next slice, and its shape is visible in the commands that are already
// wired up.

#include "inc/env.hpp"
#include "inc/github.hpp"
#include "inc/json.hpp"
#include "inc/mode.hpp"
#include "inc/store.hpp"
#include "inc/ansi.hpp"
#include "inc/str.hpp"
#include "inc/uiserver.hpp"
#include "unblock.hpp"

#include "ui.hpp"
#include "perflog.hpp"

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <commctrl.h>
#include <commdlg.h>
#include <shellapi.h>

using namespace inc;

static const char* APP = "Infinity Cloud";

// ---------------------------------------------------------------- output

static void out(const std::string& s) { fputs((s + "\n").c_str(), stdout); }

static void help() {
  out(std::string(APP) + " [v" + version() + "]  ·  Infinity.Inc");
  out("");
  out("  inc                       open the terminal interface");
  out("  inc cli                   open the command line");
  out("  inc gui                   open the window");
  out("  inc login                 show which token is in use");
  out("  inc get                   refresh the cloud manifest");
  out("  inc listf [-a]            list the cloud files");
  out("  inc mkdir <cloud-path>    create a cloud folder");
  out("  inc pull upload -path=<> -cpath=<>    upload a file");
  out("  inc pull download -path=<> -lpath=<>  download a file");
  out("  inc rm -path=<>           move to the recycle bin");
  out("  inc trash list|restore|purge           manage deleted files");
  out("  inc repos                 repositories you own");
  out("  inc releases <owner/repo> list releases");
  out("  inc --version             print the version");
  out("  inc --paths               where this program keeps things");
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

// ---------------------------------------------------------------- cli

static std::string optionValue(const std::vector<std::string>& args, const std::string& name) {
  const std::string prefix = name + "=";
  for (const auto& a : args) if (startsWith(a, prefix)) return a.substr(prefix.size());
  return "";
}

static void printEntries(const std::vector<Json>& rows) {
  for (const Json& e : rows) {
    const bool folder = e.s("type") == "folder";
    out(std::string(folder ? "[DIR]  " : "       ") + e.s("name") +
        (folder ? "" : "  " + humanSize((uint64_t)e.i("size"))));
  }
  if (rows.empty()) out(color(C_DIM, "empty"));
}

static int cliMain(const std::vector<std::string>& args) {
  if (!args.empty()) {
    const std::string& a = args[0];
    if (a == "--version" || a == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (a == "--paths") {
      out("exe      " + exeDir());
      out("version  " + std::string(version()));
      out("token    " + (tokenSource().empty() ? std::string("(none)") : tokenSource()));
      return 0;
    }
    if (a == "help" || a == "--help" || a == "-h") { help(); return 0; }
  }

  std::string token = tokenFromEnv();
  if (token.empty()) {
    out(color(C_RED, "not signed in") + " - set gittoken_zssx-2026_1 (or EV_GH_TOKEN) first.");
    return 1;
  }

  Session s(token);
  s.tokenSourceName = tokenSource();
  std::string err;
  if (!s.signIn(&err)) {
    out(color(C_RED, "not signed in") + " (" + err + ")");
    return 1;
  }

  if (args.empty() || args[0] == "whoami" || args[0] == "login") {
    out(color(C_GREEN, s.gh.login()) + "  " + color(C_DIM, "via " + s.tokenSourceName));
    return 0;
  }

  if (args[0] == "repos") {
    std::vector<std::string> repos = s.gh.listRepos(&err);
    if (repos.empty()) { out(color(C_DIM, "no repositories")); return 0; }
    for (const std::string& r : repos) out("  " + r);
    return 0;
  }

  if (args[0] == "releases" && args.size() >= 2) {
    std::string spec = args[1];
    size_t slash = spec.find('/');
    if (slash == std::string::npos) { out(color(C_RED, "usage: inc releases <owner/repo>")); return 1; }
    std::vector<Release> rels = s.gh.listReleases(spec.substr(0, slash), spec.substr(slash + 1), 100, &err);
    if (rels.empty()) { out(color(C_DIM, "no releases" + (err.empty() ? std::string() : " (" + err + ")"))); return 0; }
    for (const Release& r : rels) {
      std::string mark = r.prerelease ? color(C_YELLOW, " pre") : "";
      out("  " + padRight(r.tag, 22) + padRight(std::to_string(r.assets.size()) + " assets", 12) + mark);
    }
    return 0;
  }

  Store store(s.gh, s.gh.login());
  if (args[0] == "get") {
    if (!store.pull(&err)) { out(color(C_RED, err)); return 1; }
    out("manifest refreshed  " + std::to_string(store.list("/", true).size()) + " entries  " + humanSize(store.totalBytes()));
    return 0;
  }

  if (args[0] == "listf") {
    if (!store.pull(&err)) { out(color(C_RED, err)); return 1; }
    bool recursive = std::find(args.begin(), args.end(), "-a") != args.end() ||
                     std::find(args.begin(), args.end(), "--all") != args.end();
    printEntries(store.list("/", recursive));
    return 0;
  }

  if (args[0] == "mkdir" && args.size() >= 2) {
    if (!store.pull(&err) || !store.mkdir(args[1], &err) || !store.flush(&err)) { out(color(C_RED, err)); return 1; }
    out("created " + Store::normalizePath(args[1]));
    return 0;
  }

  if (args[0] == "pull" && args.size() >= 2 && args[1] == "upload") {
    const std::string local = optionValue(args, "-path");
    const std::string cloud = optionValue(args, "-cpath");
    if (local.empty() || cloud.empty()) { out(color(C_RED, "usage: inc pull upload -path=<local> -cpath=<cloud>")); return 2; }
    if (!store.pull(&err) || !store.put(local, cloud, &err) || !store.flush(&err)) { out(color(C_RED, err)); return 1; }
    out("uploaded " + Store::normalizePath(cloud));
    return 0;
  }

  if (args[0] == "pull" && args.size() >= 2 && args[1] == "download") {
    const std::string cloud = optionValue(args, "-path");
    const std::string local = optionValue(args, "-lpath");
    if (cloud.empty() || local.empty()) { out(color(C_RED, "usage: inc pull download -path=<cloud> -lpath=<local>")); return 2; }
    if (!store.pull(&err) || !store.get(cloud, local, true, &err)) { out(color(C_RED, err)); return 1; }
    out("downloaded " + Store::normalizePath(cloud) + " -> " + local);
    return 0;
  }

  if (args[0] == "rm") {
    std::string p = optionValue(args, "-path");
    if (p.empty() && args.size() > 1) p = args[1];
    if (p.empty()) { out(color(C_RED, "usage: inc rm -path=<cloud-path>")); return 2; }
    if (!store.pull(&err) || !store.remove(p, false, &err) || !store.flush(&err)) { out(color(C_RED, err)); return 1; }
    out("moved to recycle bin  " + Store::normalizePath(p));
    return 0;
  }

  if (args[0] == "trash" && args.size() >= 2) {
    if (!store.pull(&err)) { out(color(C_RED, err)); return 1; }
    if (args[1] == "list") { printEntries(store.listTrash()); return 0; }
    if (args[1] == "restore") {
      std::string p = optionValue(args, "-path");
      if (p.empty() && args.size() > 2) p = args[2];
      if (p.empty() || !store.restore(p, &err) || !store.flush(&err)) { out(color(C_RED, err.empty() ? "usage: inc trash restore -path=<cloud-path>" : err)); return 1; }
      out("restored " + Store::normalizePath(p)); return 0;
    }
    if (args[1] == "purge") {
      std::string p = optionValue(args, "-path");
      if (!store.purge(p, &err) || !store.flush(&err)) { out(color(C_RED, err)); return 1; }
      out("recycle bin purged"); return 0;
    }
  }

  out(color(C_RED, args[0] + ": command not found"));
  return 1;
}

// ---------------------------------------------------------------- ui

/*
 * The window is Electron; this process is what it talks to.
 *
 * The handlers run one at a time on the server's thread, so the Store below
 * needs no locking - there is only ever one request in flight, and the main
 * thread is parked in wait().
 *
 * Two rules from the command line carry over unchanged. A path in a query
 * string is untrusted input, and it goes to the Store, which normalises it and
 * refuses to walk out of the tree. And a failure is answered with a JSON object
 * carrying a message and a non-zero status: an empty 200 would make the page
 * show an empty drive where it should show a reason.
 */

std::string queryValue(const UiRequest& request, const std::string& key) {
  auto it = request.query.find(key);
  return it == request.query.end() ? std::string() : it->second;
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

UiResponse uiFailure(const std::string& message, int status) {
  Json j = Json::object();
  j.set("error", message);
  return UiResponse::withStatus(UiResponse::json(j.dump(2)), status);
}

// A path in the system temp directory, for the two places where the Store
// insists on a file: an upload arrives as a request body, and a download has
// to be written somewhere before it can be read back.
std::wstring tempPath(const std::string& tag) {
  wchar_t directory[32768] = { 0 };
  DWORD length = GetTempPathW(32768, directory);
  std::wstring path(directory, length);
  if (path.empty() || path.back() != L'\\') path.push_back(L'\\');
  path += L"inc-ui-" + toWide(tag) + L"-" + std::to_wstring(GetCurrentProcessId()) + L".tmp";
  return path;
}

std::string readFileBytes(const std::wstring& path, bool* ok) {
  *ok = false;
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return std::string();
  std::string body;
  char buffer[65536];
  DWORD read = 0;
  while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read) body.append(buffer, read);
  CloseHandle(file);
  *ok = true;
  return body;
}

int serveUi(int port) {
  std::string token = tokenFromEnv();
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

  Store store(session.gh, session.gh.login());
  std::string manifestError;
  const bool manifestLoaded = store.pull(&manifestError);

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
    Json trash = Json::array();
    for (const Json& entry : store.listTrash()) trash.push(entry);
    j.set("trash", trash);
    j.set("totalBytes", (long long)store.totalBytes());
    // An unread manifest is reported rather than rendered as an empty drive:
    // "you have nothing" and "I could not read what you have" are different.
    if (!manifestLoaded) j.set("error", manifestError);
    return UiResponse::json(j.dump(2));
  });

  server.route("GET", "/api/list", [&](const UiRequest& request) {
    std::string path = queryValue(request, "path");
    if (path.empty()) path = "/";
    std::vector<Json> entries = store.list(Store::normalizePath(path));
    Json rows = Json::array();
    for (const Json& entry : entries) rows.push(entry);
    Json j = Json::object();
    j.set("path", Store::normalizePath(path));
    j.set("entries", rows);
    j.set("totalBytes", (long long)store.totalBytes());
    return UiResponse::json(j.dump(2));
  });

  server.route("POST", "/api/mkdir", [&](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    if (path.empty()) return uiFailure("no path given", 400);
    std::string why;
    if (!store.mkdir(path, &why) || !store.flush(&why)) return uiFailure(why, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/remove", [&](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    if (path.empty()) return uiFailure("no path given", 400);
    std::string why;
    if (!store.remove(path, false, &why) || !store.flush(&why)) return uiFailure(why, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/trash/restore", [&](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    if (path.empty()) return uiFailure("no path given", 400);
    std::string why;
    if (!store.restore(path, &why) || !store.flush(&why)) return uiFailure(why, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/trash/purge", [&](const UiRequest& request) {
    std::string why;
    const std::string path = queryValue(request, "path");
    if (!store.purge(path, &why) || !store.flush(&why)) return uiFailure(why, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/refresh", [&](const UiRequest&) {
    std::string why;
    const bool ok = store.pull(&why);
    Json j = Json::object();
    if (!ok) j.set("error", why);
    j.set("entries", (long long)store.list("/", true).size());
    return UiResponse::withStatus(UiResponse::json(j.dump(2)), ok ? 200 : 502);
  });

  server.route("POST", "/api/upload", [&](const UiRequest& request) {
    const std::string directory = queryValue(request, "path");
    const std::string name = queryValue(request, "name");
    if (name.empty()) return uiFailure("no name given", 400);
    if (name.find_first_of("/\\") != std::string::npos || name == "." || name == "..") {
      return uiFailure("a name cannot contain a path separator", 400);
    }
    const std::string cloud = Store::normalizePath(
        (directory.empty() || directory == "/") ? "/" + name : directory + "/" + name);

    const std::wstring staged = tempPath("upload");
    HANDLE file = CreateFileW(staged.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_TEMPORARY, nullptr);
    if (file == INVALID_HANDLE_VALUE) return uiFailure("cannot stage the upload", 500);
    DWORD written = 0;
    const bool wrote = request.body.empty() ||
      WriteFile(file, request.body.data(), (DWORD)request.body.size(), &written, nullptr) != 0;
    CloseHandle(file);
    if (!wrote) { DeleteFileW(staged.c_str()); return uiFailure("cannot stage the upload", 500); }

    std::string why;
    const bool ok = store.put(toUtf8(staged), cloud, &why) && store.flush(&why);
    DeleteFileW(staged.c_str());
    if (!ok) return uiFailure(why, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("GET", "/api/download", [&](const UiRequest& request) {
    const std::string cloud = queryValue(request, "path");
    if (cloud.empty()) return uiFailure("no path given", 400);
    const std::wstring staged = tempPath("download");
    std::string why;
    if (!store.get(cloud, toUtf8(staged), true, &why)) {
      DeleteFileW(staged.c_str());
      return uiFailure(why, 404);
    }
    bool ok = false;
    const std::string body = readFileBytes(staged, &ok);
    DeleteFileW(staged.c_str());
    if (!ok) return uiFailure("the file could not be read back", 500);

    const std::string normalized = Store::normalizePath(cloud);
    const size_t slash = normalized.find_last_of('/');
    UiResponse response = UiResponse::text(body, 200);
    response.contentType = "application/octet-stream";
    response.headers.push_back({ "Content-Disposition",
      "attachment; filename=\"" + (slash == std::string::npos ? normalized : normalized.substr(slash + 1)) + "\"" });
    return response;
  });

  if (!server.start(port, &error)) {
    out(color(C_RED, "cannot start the interface server: " + error));
    return 1;
  }
  out(color(C_GREEN, session.gh.login()) + "  " + color(C_DIM, "via " + session.tokenSourceName));
  out("Infinity Cloud interface  " + server.url());
  out("open it in the window, or point a browser at it; close this to stop.");
  server.wait();
  return 0;
}

// ---------------------------------------------------------------- gui

namespace {

const int ID_UP = 2001;
const int ID_NEW = 2002;
const int ID_REFRESH = 2003;
const int ID_DELETE = 2004;
const int ID_UPLOAD = 2010;
const int ID_CREATE = 2005;
const int ID_CANCEL = 2006;
const int ID_LIST = 2007;
const int ID_PATH = 2008;
const int ID_NAME = 2009;

struct GuiState {
  Session* session = nullptr;
  Store* store = nullptr;
  std::string token;
  std::string cloudPath = "/";
  std::string status;
  std::vector<Json> entries;
  bool loading = false;   // a background load owns the store right now
  bool ready = false;     // a load has finished at least once
  bool signedIn = false;
  HWND pathLabel = nullptr;
  HWND list = nullptr;
  HWND nameEdit = nullptr;
  HWND createButton = nullptr;
  HWND cancelButton = nullptr;
  std::vector<HWND> gated;                    // controls that touch the store
  HIMAGELIST images = nullptr;
  std::vector<std::pair<std::string, int>> iconByExtension;
  int folderIcon = 0;
  int genericIcon = 0;
};

void setGuiStatus(HWND hwnd, GuiState* st, const std::string& status) {
  st->status = status;
  SetWindowTextW(GetDlgItem(hwnd, ID_PATH), toWide(st->cloudPath + "    " + status).c_str());
}

// The shell decides a file's icon from its extension, so it is asked once per
// extension rather than once per row. The loop below used to call
// SHGetFileInfoW for every entry, which is the most expensive thing in drawing
// a directory.
int iconIndexFor(GuiState* st, const std::string& name, bool folder) {
  if (folder) return st->folderIcon;
  const size_t dot = name.find_last_of('.');
  const std::string ext = (dot == std::string::npos) ? std::string() : lower(name.substr(dot));
  for (const auto& cached : st->iconByExtension) if (cached.first == ext) return cached.second;
  const std::wstring probe = toWide(ext.empty() ? std::string("file") : ("file" + ext));
  SHFILEINFOW info = {};
  if (!SHGetFileInfoW(probe.c_str(), FILE_ATTRIBUTE_NORMAL, &info, sizeof(info),
                      SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES)) {
    st->iconByExtension.push_back({ ext, st->genericIcon });
    return st->genericIcon;
  }
  const int index = info.iIcon ? (int)info.iIcon : st->genericIcon;
  st->iconByExtension.push_back({ ext, index });
  return index;
}

void refreshGui(HWND hwnd, GuiState* st) {
  st->pathLabel = GetDlgItem(hwnd, ID_PATH);
  st->list = GetDlgItem(hwnd, ID_LIST);
  const std::string location = st->cloudPath + (st->status.empty() ? "" : "    " + st->status);
  SetWindowTextW(st->pathLabel, toWide(location).c_str());
  SendMessageW(st->list, LVM_DELETEALLITEMS, 0, 0);
  st->entries = st->store->list(st->cloudPath);

  for (size_t i = 0; i < st->entries.size(); ++i) {
    const Json& entry = st->entries[i];
    const bool folder = entry.s("type") == "folder";
    const std::string name = entry.s("name");
    std::wstring wname = toWide(name);

    LVITEMW item = {};
    item.mask = LVIF_TEXT | LVIF_PARAM | LVIF_IMAGE;
    item.iItem = (int)i;
    item.iImage = iconIndexFor(st, name, folder);
    item.lParam = (LPARAM)i;
    item.pszText = &wname[0];
    SendMessageW(st->list, LVM_INSERTITEMW, 0, (LPARAM)&item);

    std::wstring size = folder ? L"Folder" : toWide(humanSize((uint64_t)std::max<long long>(0, entry.i("size"))));
    LVITEMW sub = {};
    sub.mask = LVIF_TEXT;
    sub.iItem = (int)i;
    sub.iSubItem = 1;
    sub.pszText = &size[0];
    SendMessageW(st->list, LVM_SETITEMW, 0, (LPARAM)&sub);
  }
  // The list view already repaints the rows it inserts. The full-window
  // InvalidateRect that used to sit here only added a second erase and paint of
  // everything, including the rows that had just been drawn.
}

// Browsing a folder re-reads the manifest already in memory. Going to the
// network is what the Refresh button is for; walking the tree is not.
void listCurrent(HWND hwnd, GuiState* st) {
  refreshGui(hwnd, st);
  st->status = std::to_string(st->entries.size()) + " items  ·  " + humanSize(st->store->totalBytes());
  SetWindowTextW(GetDlgItem(hwnd, ID_PATH), toWide(st->cloudPath + "    " + st->status).c_str());
}

// --------------------------------------------------------- background loading

const UINT WM_APP_CLOUD_LOADED = WM_APP + 1;

// The load result crosses from the loader thread to the window procedure as a
// heap block owned by the receiver. The message queue is the handover point, so
// there is no lock here and none is needed.
struct LoadResult {
  Store* store = nullptr;        // adopted by the window when it arrives
  bool signedIn = false;
  bool manifestLoaded = false;
  std::string login;
  std::string authError;
  std::string manifestError;
};

struct LoadJob {
  GuiState* state = nullptr;
  HWND hwnd = nullptr;
  Store* existing = nullptr;     // refresh in place instead of signing in again
};

DWORD WINAPI loadThreadProc(LPVOID raw) {
  LoadJob* job = (LoadJob*)raw;
  GuiState* st = job->state;
  LoadResult* result = new LoadResult();
  incperf::mark("cloud-load-start");

  if (job->existing) {
    result->signedIn = true;
    result->store = job->existing;
    result->manifestLoaded = job->existing->pull(&result->manifestError);
  } else {
    if (st->token.empty()) {
      // No credential is not a reason to refuse to open the window: the window
      // is where the reason belongs, and browsing what is left still works.
      result->authError = "not signed in - set gittoken_zssx-2026_1 (or EV_GH_TOKEN)";
    } else if (st->session->signIn(&result->authError)) {
      result->signedIn = true;
      result->login = st->session->gh.login();
    }
    result->store = new Store(st->session->gh, result->login);
    if (result->signedIn) result->manifestLoaded = result->store->pull(&result->manifestError);
  }

  incperf::mark("cloud-load-end");
  HWND hwnd = job->hwnd;
  delete job;
  std::atomic_thread_fence(std::memory_order_release);
  PostMessageW(hwnd, WM_APP_CLOUD_LOADED, 0, (LPARAM)result);
  return 0;
}

void setGated(GuiState* st, bool enabled) {
  for (HWND control : st->gated) EnableWindow(control, enabled ? TRUE : FALSE);
}

// One load at a time. Every control that reads or writes the store is disabled
// while the loader has it, which is what keeps the two threads apart without a
// lock around the manifest.
void startLoad(HWND hwnd, GuiState* st, bool refreshInPlace) {
  if (st->loading) return;
  st->loading = true;
  setGated(st, false);
  setGuiStatus(hwnd, st, refreshInPlace ? "Refreshing..." : "Signing in...");
  incperf::mark(refreshInPlace ? "refresh-start" : "signin-start");
  LoadJob* job = new LoadJob();
  job->state = st;
  job->hwnd = hwnd;
  job->existing = refreshInPlace ? st->store : nullptr;
  HANDLE thread = CreateThread(nullptr, 0, loadThreadProc, job, 0, nullptr);
  if (!thread) {
    delete job;
    st->loading = false;
    setGated(st, true);
    setGuiStatus(hwnd, st, "cannot start the loader");
    return;
  }
  CloseHandle(thread);
}

void setCreateMode(HWND hwnd, GuiState* st, bool on) {
  ShowWindow(st->nameEdit, on ? SW_SHOW : SW_HIDE);
  ShowWindow(st->createButton, on ? SW_SHOW : SW_HIDE);
  ShowWindow(st->cancelButton, on ? SW_SHOW : SW_HIDE);
  if (on) { SetWindowTextW(st->nameEdit, L""); SetFocus(st->nameEdit); }
  else SetFocus(hwnd);
}

void createFolder(HWND hwnd, GuiState* st) {
  wchar_t name[260] = {};
  GetWindowTextW(st->nameEdit, name, 260);
  std::string leaf = trim(toUtf8(name));
  if (leaf.empty() || leaf.find_first_of("/\\") != std::string::npos || leaf == "." || leaf == "..") {
    setGuiStatus(hwnd, st, "Choose a folder name.");
    return;
  }
  const std::string target = Store::normalizePath(st->cloudPath == "/" ? "/" + leaf : st->cloudPath + "/" + leaf);
  std::string error;
  if (!st->store->mkdir(target, &error) || !st->store->flush(&error)) {
    setGuiStatus(hwnd, st, error);
    return;
  }
  setCreateMode(hwnd, st, false);
  listCurrent(hwnd, st);
  setGuiStatus(hwnd, st, "Folder created");
}

void deleteSelected(HWND hwnd, GuiState* st) {
  int index = (int)SendMessageW(st->list, LVM_GETNEXTITEM, (WPARAM)-1, LVNI_SELECTED);
  if (index < 0 || index >= (int)st->entries.size()) return;
  const Json& entry = st->entries[index];
  std::wstring prompt = L"Move \"" + toWide(entry.s("name")) + L"\" to the recycle bin?";
  if (MessageBoxW(hwnd, prompt.c_str(), L"Infinity Cloud", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) != IDYES) return;
  std::string error;
  if (!st->store->remove(entry.s("path"), false, &error) || !st->store->flush(&error)) {
    setGuiStatus(hwnd, st, error);
    return;
  }
  listCurrent(hwnd, st);
  setGuiStatus(hwnd, st, "Moved to recycle bin");
}

void activateSelected(HWND hwnd, GuiState* st, int index) {
  if (index < 0 || index >= (int)st->entries.size()) return;
  const Json& entry = st->entries[index];
  if (entry.s("type") == "folder") {
    st->cloudPath = Store::normalizePath(st->cloudPath == "/" ? "/" + entry.s("name") : st->cloudPath + "/" + entry.s("name"));
    listCurrent(hwnd, st);
    return;
  }

  std::string home = getEnv("USERPROFILE");
  if (home.empty()) { setGuiStatus(hwnd, st, "Downloads folder unavailable"); return; }
  std::string dir = home + "\\Downloads";
  std::string dest = dir + "\\" + entry.s("name");
  DWORD attrs = GetFileAttributesW(toWide(dest).c_str());
  for (int i = 1; attrs != INVALID_FILE_ATTRIBUTES && i < 100; ++i) {
    dest = dir + "\\" + entry.s("name") + " (" + std::to_string(i) + ")";
    attrs = GetFileAttributesW(toWide(dest).c_str());
  }
  std::string error;
  setGuiStatus(hwnd, st, "Downloading " + entry.s("name"));
  if (!st->store->get(entry.s("path"), dest, true, &error)) setGuiStatus(hwnd, st, error);
  else setGuiStatus(hwnd, st, "Downloaded to " + dest);
}

LRESULT CALLBACK guiProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  GuiState* st = (GuiState*)GetWindowLongPtrW(hwnd, GWLP_USERDATA);
  switch (msg) {
    case WM_CREATE: {
      CREATESTRUCTW* cs = (CREATESTRUCTW*)lp;
      st = (GuiState*)cs->lpCreateParams;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, (LONG_PTR)st);
      CreateWindowExW(0, L"STATIC", L"/", WS_CHILD | WS_VISIBLE | SS_LEFT,
                      12, 10, 850, 24, hwnd, (HMENU)(INT_PTR)ID_PATH, cs->hInstance, nullptr);
      const HWND up = CreateWindowExW(0, L"BUTTON", L"Up", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      12, 40, 64, 28, hwnd, (HMENU)(INT_PTR)ID_UP, cs->hInstance, nullptr);
      const HWND newFolder = CreateWindowExW(0, L"BUTTON", L"New folder", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      84, 40, 104, 28, hwnd, (HMENU)(INT_PTR)ID_NEW, cs->hInstance, nullptr);
      const HWND refresh = CreateWindowExW(0, L"BUTTON", L"Refresh", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      196, 40, 82, 28, hwnd, (HMENU)(INT_PTR)ID_REFRESH, cs->hInstance, nullptr);
      const HWND removeButton = CreateWindowExW(0, L"BUTTON", L"Delete", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      286, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_DELETE, cs->hInstance, nullptr);
      const HWND upload = CreateWindowExW(0, L"BUTTON", L"Upload", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      366, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_UPLOAD, cs->hInstance, nullptr);
      st->nameEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | ES_AUTOHSCROLL,
                      368, 42, 190, 24, hwnd, (HMENU)(INT_PTR)ID_NAME, cs->hInstance, nullptr);
      st->createButton = CreateWindowExW(0, L"BUTTON", L"Create", WS_CHILD | BS_PUSHBUTTON,
                      566, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_CREATE, cs->hInstance, nullptr);
      st->cancelButton = CreateWindowExW(0, L"BUTTON", L"Cancel", WS_CHILD | BS_PUSHBUTTON,
                      646, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_CANCEL, cs->hInstance, nullptr);
      ShowWindow(st->nameEdit, SW_HIDE); ShowWindow(st->createButton, SW_HIDE); ShowWindow(st->cancelButton, SW_HIDE);
      st->gated = { up, newFolder, refresh, removeButton, upload, st->nameEdit, st->createButton, st->cancelButton };

      st->list = CreateWindowExW(WS_EX_CLIENTEDGE, WC_LISTVIEWW, L"",
                      WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS,
                      12, 78, 850, 450, hwnd, (HMENU)(INT_PTR)ID_LIST, cs->hInstance, nullptr);
      ListView_SetExtendedListViewStyle(st->list, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_LABELTIP);
      SHFILEINFOW folderInfo = {};
      st->images = (HIMAGELIST)SHGetFileInfoW(L"folder", FILE_ATTRIBUTE_DIRECTORY, &folderInfo,
                            sizeof(folderInfo), SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES);
      if (st->images) ListView_SetImageList(st->list, st->images, LVSIL_SMALL);
      st->folderIcon = (int)folderInfo.iIcon;
      SHFILEINFOW fileInfo = {};
      SHGetFileInfoW(L"file", FILE_ATTRIBUTE_NORMAL, &fileInfo, sizeof(fileInfo),
                     SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES);
      st->genericIcon = (int)fileInfo.iIcon;
      LVCOLUMNW col = {};
      col.mask = LVCF_TEXT | LVCF_WIDTH;
      col.pszText = const_cast<LPWSTR>(L"Name"); col.cx = 620; ListView_InsertColumn(st->list, 0, &col);
      col.pszText = const_cast<LPWSTR>(L"Size"); col.cx = 150; ListView_InsertColumn(st->list, 1, &col);
      st->pathLabel = GetDlgItem(hwnd, ID_PATH);
      // Nothing is read from the cloud here. The window goes up first and the
      // loader fills this list when it has an answer.
      setGated(st, false);
      setGuiStatus(hwnd, st, "Opening the cloud...");
      incperf::mark("gui-first-paint");
      return 0;
    }
    case WM_SIZE: {
      if (!st) break;
      int width = LOWORD(lp), height = HIWORD(lp);
      MoveWindow(GetDlgItem(hwnd, ID_PATH), 12, 10, width - 24, 24, TRUE);
      MoveWindow(st->list, 12, 78, width - 24, height - 112, TRUE);
      return 0;
    }
    case WM_COMMAND:
      if (!st) break;
      // While the loader owns the store nothing else may touch it. The disabled
      // controls say so to a person; this says so to the keyboard.
      if (st->loading && LOWORD(wp) != ID_CANCEL) break;
      switch (LOWORD(wp)) {
        case ID_UP:
          if (st->cloudPath != "/") st->cloudPath = Store::parentPath(st->cloudPath);
          listCurrent(hwnd, st); return 0;
        case ID_NEW: setCreateMode(hwnd, st, true); return 0;
        case ID_CREATE: createFolder(hwnd, st); return 0;
        case ID_CANCEL: setCreateMode(hwnd, st, false); return 0;
        case ID_REFRESH:
          if (!st->ready) break;
          if (!st->signedIn) { setGuiStatus(hwnd, st, "not signed in"); break; }
          startLoad(hwnd, st, true); return 0;
        case ID_DELETE: deleteSelected(hwnd, st); return 0;
        case ID_UPLOAD: {
          std::vector<wchar_t> path(32768, L'\0');
          OPENFILENAMEW dialog = {};
          dialog.lStructSize = sizeof(dialog);
          dialog.hwndOwner = hwnd;
          dialog.lpstrFile = path.data();
          dialog.nMaxFile = static_cast<DWORD>(path.size());
          dialog.lpstrFilter = L"All files\\0*.*\\0\\0";
          dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
          if (!GetOpenFileNameW(&dialog)) return 0;
          std::wstring selected(path.data());
          size_t slash = selected.find_last_of(L"\\\\/");
          std::string base = toUtf8(slash == std::wstring::npos ? selected : selected.substr(slash + 1));
          std::string target = Store::normalizePath(st->cloudPath == "/" ? "/" + base : st->cloudPath + "/" + base);
          std::string error;
          setGuiStatus(hwnd, st, "Uploading " + base);
          if (!st->store->put(toUtf8(selected), target, &error) || !st->store->flush(&error)) {
            setGuiStatus(hwnd, st, error);
            return 0;
          }
          listCurrent(hwnd, st);
          setGuiStatus(hwnd, st, "Uploaded " + base);
          return 0;
        }
      }
      break;
    case WM_NOTIFY: {
      if (!st) break;
      NMHDR* hdr = (NMHDR*)lp;
      if (hdr && hdr->idFrom == ID_LIST && hdr->code == NM_DBLCLK) {
        NMLISTVIEW* info = (NMLISTVIEW*)lp;
        activateSelected(hwnd, st, info->iItem);
        return 0;
      }
      break;
    }
    case WM_ERASEBKGND: {
      // One brush for the life of the window. The old code created and deleted
      // a solid brush on every erase, which is a GDI allocation per repaint.
      static HBRUSH background = CreateSolidBrush(RGB(245, 247, 250));
      HDC dc = (HDC)wp;
      RECT rc; GetClientRect(hwnd, &rc);
      FillRect(dc, &rc, background);
      return 1;
    }
    case WM_APP_CLOUD_LOADED: {
      if (!st) break;
      LoadResult* result = (LoadResult*)lp;
      st->loading = false;
      st->ready = true;
      st->signedIn = result->signedIn;
      if (result->store) st->store = result->store;
      if (!result->signedIn) st->status = result->authError;
      else if (!result->manifestLoaded) st->status = result->manifestError.empty() ? "the manifest could not be read" : result->manifestError;
      else st->status = "signed in as " + result->login;
      refreshGui(hwnd, st);
      if (result->signedIn && result->manifestLoaded) {
        st->status = std::to_string(st->entries.size()) + " items  ·  " + humanSize(st->store->totalBytes());
      }
      SetWindowTextW(GetDlgItem(hwnd, ID_PATH), toWide(st->cloudPath + "    " + st->status).c_str());
      setGated(st, true);
      delete result;
      incperf::markCount("gui-list-ready", (long long)st->entries.size());
      return 0;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

static int guiMain() {
  incperf::mark("gui-enter");
  // Everything before the window is local: read the token, register the class,
  // create the window. Signing in and reading the manifest are network calls
  // and they happen after it is on screen, in loadThreadProc, because the first
  // frame must not wait for one.
  const std::string token = tokenFromEnv();
  Session* session = new Session(token);   // lives until the process does
  session->tokenSourceName = tokenSource();
  incperf::mark("gui-token");

  INITCOMMONCONTROLSEX controls = { sizeof(controls), ICC_LISTVIEW_CLASSES };
  InitCommonControlsEx(&controls);
  GuiState state;
  state.session = session;
  state.token = token;

  WNDCLASSW wc = {};
  wc.lpfnWndProc = guiProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"InfinityCloudWindow";
  wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
  wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
  RegisterClassW(&wc);

  HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"Infinity Cloud",
                              WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT,
                              1000, 700, nullptr, nullptr, wc.hInstance, &state);
  if (!hwnd) { out("cannot create the window"); return 1; }
  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);
  incperf::mark("gui-window-shown");

  startLoad(hwnd, &state, false);

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  incperf::mark("gui-exit");
  return 0;
}


// ---------------------------------------------------------------- launcher

static int launcherMain(const Mode& m) {
  const std::string prefix = m.app.empty() ? "inc" : (m.admin ? "inx" : "inc");
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

  std::string exe = siblingExe(prefix, target);
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
  incperf::mark("process-start");
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

  // Flags that belong to the program rather than to a face.
  if (!args.empty()) {
    if (args[0] == "--version" || args[0] == "-v") { out(std::string(APP) + " [v" + version() + "]"); return 0; }
    if (args[0] == "--help" || args[0] == "-h" || args[0] == "help") { help(); return 0; }
  }

  /*
   * --serve-ui is what the window starts this program with. It is a flag
   * rather than a face because the face belongs to the Electron shell: the
   * shell is inc_gui.exe, and it runs this executable with --serve-ui to get
   * something to draw. The port is fixed per application so the shell does not
   * have to be told it, and --port= is there for a test that wants two of
   * these at once.
   */
  bool serveUiRequested = false;
  int uiPort = 7621;
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

  // `inc gui` and friends still work when the program is started under a
  // name that carries no mode, which is what happens from a source build.
  // The words after the face name are the command, so they are passed on
  // rather than dropped.
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

  // No mode in the name and nothing on the command line: a bare double click.
  if (args.empty()) return guiMain();
  return cliMain(args);
}
