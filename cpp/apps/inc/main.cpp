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

#include "inc/console.hpp"
#include "inc/env.hpp"
#include "inc/github.hpp"
#include "inc/json.hpp"
#include "inc/mode.hpp"
#include "inc/store.hpp"
#include "inc/str.hpp"

#include <algorithm>
#include <cstdio>
#include <string>
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

static std::string color(int c, const std::string& s) {
  return "\x1b[" + std::to_string(c) + "m" + s + "\x1b[0m";
}

static void help() {
  out(std::string(APP) + " [v" + version() + "]  ·  Infinity.Inc");
  out("");
  out("  inc                       open the terminal interface");
  out("  inc cli                   open the command line");
  out("  inc tui                   open the terminal interface");
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

// ---------------------------------------------------------------- tui

static void tuiDraw(Console& c, Session& s, Store& store, const std::string& cloudPath,
                    const std::vector<std::string>& repos, int page, int cursor,
                    bool manifestLoaded, const std::string& status) {
  c.clear();
  c.hideCursor();
  const int w = c.width();
  c.line(0, color(C_CYAN, " Infinity Cloud [v" + std::string(version()) + "] ") + color(C_DIM, "Infinity.Inc"), w);
  c.line(1, color(C_DIM, " " + s.gh.login() + "  ·  " + s.tokenSourceName), w);

  const char* pages[3] = { " My files ", " Account ", " Repositories " };
  std::string tabs;
  for (int i = 0; i < 3; i++) {
    tabs += (i == page) ? color(C_CYAN, "[" + std::string(pages[i]) + "]") : color(C_DIM, " " + std::string(pages[i]) + " ");
    tabs += " ";
  }
  c.line(3, " " + tabs, w);
  c.line(4, color(C_DIM, " " + std::string(w > 2 ? w - 2 : 0, '-')), w);

  int row = 6;
  if (page == 0) {
    c.line(row++, color(C_DIM, "  " + cloudPath + (manifestLoaded ? "" : "  (manifest unavailable)")), w);
    std::vector<Json> entries = store.list(cloudPath);
    if (entries.empty()) c.line(row++, color(C_DIM, "  empty"), w);
    for (size_t i = 0; i < entries.size() && row < c.height() - 2; i++, row++) {
      const Json& e = entries[i];
      const bool folder = e.s("type") == "folder";
      const std::string label = (folder ? "[DIR]  " : "       ") + e.s("name") +
                                (folder ? "" : "  " + humanSize((uint64_t)std::max<long long>(0, e.i("size"))));
      c.line(row, (static_cast<int>(i) == cursor ? color(C_CYAN, " > ") : "   ") + label, w);
    }
  } else if (page == 1) {
    c.line(row++, "  account   " + color(C_GREEN, s.gh.login()), w);
    c.line(row++, "  token     " + color(C_DIM, s.tokenSourceName), w);
    c.line(row++, "  version   v" + std::string(version()), w);
    c.line(row++, "  cloud     " + humanSize(store.totalBytes()), w);
  } else {
    if (repos.empty()) c.line(row++, color(C_DIM, "  no repositories"), w);
    for (size_t i = 0; i < repos.size() && row < c.height() - 2; i++, row++) {
      c.line(row, (static_cast<int>(i) == cursor ? color(C_CYAN, " > ") : "   ") + repos[i], w);
    }
  }

  c.line(c.height() - 1, color(C_DIM, " up/down  select/page  Enter  open  Backspace  up  r  refresh  q  quit"), w);
  if (!status.empty() && c.height() > 2) c.line(c.height() - 2, color(C_DIM, " " + status), w);
  c.flush();
}

static int tuiMain() {
  Console c;
  if (!c.ok()) { out("Infinity Cloud needs a console for TUI mode."); return 1; }

  std::string token = tokenFromEnv();
  if (token.empty()) { out(color(C_RED, "not signed in") + " - set gittoken_zssx-2026_1 first."); return 1; }

  Session s(token);
  s.tokenSourceName = tokenSource();
  std::string err;
  if (!s.signIn(&err)) { out(color(C_RED, "not signed in") + " (" + err + ")"); return 1; }

  Store store(s.gh, s.gh.login());
  bool manifestLoaded = store.pull(&err);
  std::string status = manifestLoaded ? "" : err;
  std::vector<std::string> repos = s.gh.listStorageRepos("inc_");
  std::string cloudPath = "/";
  int page = 0, cursor = 0;
  c.setRaw(true);
  tuiDraw(c, s, store, cloudPath, repos, page, cursor, manifestLoaded, status);

  for (;;) {
    Key k = c.readKey();
    if (k.kind == Key::None || k.kind == Key::CtrlC) break;
    if (k.kind == Key::Char && (k.ch == 'q' || k.ch == 'Q')) break;
    if (k.kind == Key::Char && (k.ch == 'r' || k.ch == 'R')) {
      status = store.pull(&err) ? "refreshed" : err;
      manifestLoaded = err.empty();
      cursor = 0;
    } else if (k.kind == Key::Up) {
      if (page == 0) { if (cursor > 0) cursor--; }
      else { page = (page + 2) % 3; cursor = 0; }
    } else if (k.kind == Key::Down) {
      if (page == 0) { auto rows = store.list(cloudPath); if (cursor + 1 < (int)rows.size()) cursor++; }
      else { page = (page + 1) % 3; cursor = 0; }
    } else if (k.kind == Key::Backspace && page == 0) {
      if (cloudPath != "/") cloudPath = Store::parentPath(cloudPath);
      cursor = 0;
    } else if (k.kind == Key::Enter && page == 0) {
      std::vector<Json> rows = store.list(cloudPath);
      if (cursor >= 0 && cursor < (int)rows.size() && rows[cursor].s("type") == "folder") {
        cloudPath = Store::normalizePath(cloudPath == "/" ? "/" + rows[cursor].s("name") : cloudPath + "/" + rows[cursor].s("name"));
        cursor = 0;
      }
    }
    c.refreshSize();
    tuiDraw(c, s, store, cloudPath, repos, page, cursor, manifestLoaded, status);
  }

  c.setRaw(false);
  c.showCursor();
  c.clear();
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
  std::string cloudPath = "/";
  std::string status;
  std::vector<Json> entries;
  HWND pathLabel = nullptr;
  HWND list = nullptr;
  HWND nameEdit = nullptr;
  HWND createButton = nullptr;
  HWND cancelButton = nullptr;
};

void refreshGui(HWND hwnd, GuiState* st) {
  st->pathLabel = GetDlgItem(hwnd, ID_PATH);
  st->list = GetDlgItem(hwnd, ID_LIST);
  const std::string location = st->cloudPath + (st->status.empty() ? "" : "    " + st->status);
  SetWindowTextW(st->pathLabel, toWide(location).c_str());
  SendMessageW(st->list, LVM_DELETEALLITEMS, 0, 0);
  st->entries = st->store->list(st->cloudPath);

  for (size_t i = 0; i < st->entries.size(); ++i) {
    const Json& entry = st->entries[i];
    std::string name = entry.s("name");
    std::wstring path = toWide(entry.s("path"));
    DWORD attrs = entry.s("type") == "folder" ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
    SHFILEINFOW info = {};
    SHGetFileInfoW(path.c_str(), attrs, &info, sizeof(info), SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES);

    LVITEMW item = {};
    item.mask = LVIF_TEXT | LVIF_PARAM | LVIF_IMAGE;
    item.iItem = (int)i;
    item.iImage = info.iIcon;
    item.lParam = (LPARAM)i;
    std::wstring wname = toWide(name);
    item.pszText = &wname[0];
    SendMessageW(st->list, LVM_INSERTITEMW, 0, (LPARAM)&item);

    std::wstring size = entry.s("type") == "folder" ? L"Folder" : toWide(humanSize((uint64_t)std::max<long long>(0, entry.i("size"))));
    LVITEMW sub = {};
    sub.mask = LVIF_TEXT;
    sub.iItem = (int)i;
    sub.iSubItem = 1;
    sub.pszText = &size[0];
    SendMessageW(st->list, LVM_SETITEMW, 0, (LPARAM)&sub);
  }

  InvalidateRect(hwnd, nullptr, TRUE);
}

void loadCloud(HWND hwnd, GuiState* st) {
  std::string error;
  const bool loaded = st->store->pull(&error);
  st->status = loaded ? "" : error;
  refreshGui(hwnd, st);
  if (loaded) st->status = std::to_string(st->entries.size()) + " items  ·  " + humanSize(st->store->totalBytes());
  const std::string location = st->cloudPath + (st->status.empty() ? "" : "    " + st->status);
  SetWindowTextW(st->pathLabel, toWide(location).c_str());
}

void setGuiStatus(HWND hwnd, GuiState* st, const std::string& status) {
  st->status = status;
  SetWindowTextW(GetDlgItem(hwnd, ID_PATH), toWide(st->cloudPath + "    " + status).c_str());
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
  loadCloud(hwnd, st);
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
  loadCloud(hwnd, st);
  setGuiStatus(hwnd, st, "Moved to recycle bin");
}

void activateSelected(HWND hwnd, GuiState* st, int index) {
  if (index < 0 || index >= (int)st->entries.size()) return;
  const Json& entry = st->entries[index];
  if (entry.s("type") == "folder") {
    st->cloudPath = Store::normalizePath(st->cloudPath == "/" ? "/" + entry.s("name") : st->cloudPath + "/" + entry.s("name"));
    loadCloud(hwnd, st);
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
      CreateWindowExW(0, L"BUTTON", L"Up", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      12, 40, 64, 28, hwnd, (HMENU)(INT_PTR)ID_UP, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"New folder", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      84, 40, 104, 28, hwnd, (HMENU)(INT_PTR)ID_NEW, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"Refresh", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      196, 40, 82, 28, hwnd, (HMENU)(INT_PTR)ID_REFRESH, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"Delete", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      286, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_DELETE, cs->hInstance, nullptr);
      CreateWindowExW(0, L"BUTTON", L"Upload", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
                      366, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_UPLOAD, cs->hInstance, nullptr);
      st->nameEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | ES_AUTOHSCROLL,
                      368, 42, 190, 24, hwnd, (HMENU)(INT_PTR)ID_NAME, cs->hInstance, nullptr);
      st->createButton = CreateWindowExW(0, L"BUTTON", L"Create", WS_CHILD | BS_PUSHBUTTON,
                      566, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_CREATE, cs->hInstance, nullptr);
      st->cancelButton = CreateWindowExW(0, L"BUTTON", L"Cancel", WS_CHILD | BS_PUSHBUTTON,
                      646, 40, 72, 28, hwnd, (HMENU)(INT_PTR)ID_CANCEL, cs->hInstance, nullptr);
      ShowWindow(st->nameEdit, SW_HIDE); ShowWindow(st->createButton, SW_HIDE); ShowWindow(st->cancelButton, SW_HIDE);

      st->list = CreateWindowExW(WS_EX_CLIENTEDGE, WC_LISTVIEWW, L"",
                      WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS,
                      12, 78, 850, 450, hwnd, (HMENU)(INT_PTR)ID_LIST, cs->hInstance, nullptr);
      ListView_SetExtendedListViewStyle(st->list, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER | LVS_EX_LABELTIP);
      SHFILEINFOW folderInfo = {};
      HIMAGELIST images = (HIMAGELIST)SHGetFileInfoW(L"folder", FILE_ATTRIBUTE_DIRECTORY, &folderInfo,
                            sizeof(folderInfo), SHGFI_SYSICONINDEX | SHGFI_SMALLICON | SHGFI_USEFILEATTRIBUTES);
      if (images) ListView_SetImageList(st->list, images, LVSIL_SMALL);
      LVCOLUMNW col = {};
      col.mask = LVCF_TEXT | LVCF_WIDTH;
      col.pszText = const_cast<LPWSTR>(L"Name"); col.cx = 620; ListView_InsertColumn(st->list, 0, &col);
      col.pszText = const_cast<LPWSTR>(L"Size"); col.cx = 150; ListView_InsertColumn(st->list, 1, &col);
      st->pathLabel = GetDlgItem(hwnd, ID_PATH);
      refreshGui(hwnd, st);
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
      switch (LOWORD(wp)) {
        case ID_UP:
          if (st->cloudPath != "/") st->cloudPath = Store::parentPath(st->cloudPath);
          loadCloud(hwnd, st); return 0;
        case ID_NEW: setCreateMode(hwnd, st, true); return 0;
        case ID_CREATE: createFolder(hwnd, st); return 0;
        case ID_CANCEL: setCreateMode(hwnd, st, false); return 0;
        case ID_REFRESH: loadCloud(hwnd, st); return 0;
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
          loadCloud(hwnd, st);
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
      HDC dc = (HDC)wp;
      RECT rc; GetClientRect(hwnd, &rc);
      HBRUSH b = CreateSolidBrush(RGB(245, 247, 250));
      FillRect(dc, &rc, b); DeleteObject(b); return 1;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

static int guiMain() {
  std::string token = tokenFromEnv();
  if (token.empty()) { out("not signed in - set gittoken_zssx-2026_1 first."); return 1; }
  Session session(token);
  session.tokenSourceName = tokenSource();
  std::string error;
  if (!session.signIn(&error)) { out("not signed in (" + error + ")"); return 1; }
  Store store(session.gh, session.gh.login());
  store.pull(&error);  // empty cloud is still a valid browseable view

  INITCOMMONCONTROLSEX controls = { sizeof(controls), ICC_LISTVIEW_CLASSES };
  InitCommonControlsEx(&controls);
  GuiState state;
  state.session = &session;
  state.store = &store;
  state.status = error;

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
  ShowWindow(hwnd, SW_SHOW); UpdateWindow(hwnd);
  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) { TranslateMessage(&msg); DispatchMessageW(&msg); }
  return 0;
}


// ---------------------------------------------------------------- launcher

static int launcherMain(const Mode& m) {
  const std::string prefix = m.app.empty() ? "inc" : (m.admin ? "inx" : "inc");
  out(APP + std::string(" [") + (m.admin ? "管理员" : "用户") + "]");
  out("");
  out("  1) CLI       命令行");
  out("  2) TUI       终端界面");
  out("  3) GUI       图形界面");
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
  else if (answer == "2" || answer == "tui") target = "tui";
  else if (answer == "3" || answer == "gui") target = "gui";
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

  Mode m = detectMode();

  // `inc gui` and friends still work when the program is started under a
  // name that carries no mode, which is what happens from a source build.
  // The words after the face name are the command, so they are passed on
  // rather than dropped.
  if (m.mode.empty() && !args.empty()) {
    const std::string& a = args[0];
    std::vector<std::string> rest(args.begin() + 1, args.end());
    if (a == "cli") return cliMain(rest);
    if (a == "tui") return tuiMain();
    if (a == "gui") return guiMain();
    if (a == "launcher") return launcherMain(m);
  }

  if (m.mode == "launcher") return launcherMain(m);
  if (m.mode == "gui") return guiMain();
  if (m.mode == "tui") return tuiMain();
  if (m.mode == "cli") return cliMain(args);

  // No mode in the name and nothing on the command line: a bare double click.
  if (args.empty()) return tuiMain();
  return cliMain(args);
}
