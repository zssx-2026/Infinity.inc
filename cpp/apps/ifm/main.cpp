#include "inc/json.hpp"
#include "inc/localfs.hpp"
#include "inc/mode.hpp"
#include "inc/str.hpp"
#include "inc/uiserver.hpp"
#include "unblock.hpp"

#include "ui.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace inc;

namespace {

const char* kVersion = "1.0.0-pre4";
const int kUp = 1001;
const int kNewFolder = 1002;
const int kRefresh = 1003;
const int kListing = 1004;
const int kPromptEdit = 1101;
const int kPromptOk = 1102;
const int kPromptCancel = 1103;

void out(const std::string& text) {
  fwrite(text.data(), 1, text.size(), stdout);
  fputc('\n', stdout);
}

bool isModeName(const std::string& value) {
  return value == "cli" || value == "gui" || value == "launcher";
}

std::string entryLine(const localfs::Entry& entry) {
  if (entry.directory) return "[DIR]  " + entry.name;
  return "        " + entry.name + "  " + humanSize(entry.size);
}

int cliMain(const std::vector<std::string>& args) {
  if (args.empty()) {
    std::vector<localfs::Entry> entries;
    std::string error;
    if (!localfs::list(localfs::currentDirectory(), &entries, &error)) {
      out("ifm: " + error);
      return 1;
    }
    for (const auto& entry : entries) out(entryLine(entry));
    return 0;
  }

  const std::string& command = args[0];
  std::string error;
  if (command == "list" && args.size() <= 2) {
    std::vector<localfs::Entry> entries;
    const std::string path = args.size() == 2 ? args[1] : localfs::currentDirectory();
    if (!localfs::list(path, &entries, &error)) { out("ifm: " + error); return 1; }
    for (const auto& entry : entries) out(entryLine(entry));
    return 0;
  }
  if (command == "mkdir" && args.size() == 2) {
    if (!localfs::createDirectory(args[1], &error)) { out("ifm: " + error); return 1; }
    out("created " + args[1]);
    return 0;
  }
  if (command == "rename" && args.size() == 3) {
    if (!localfs::renamePath(args[1], args[2], &error)) { out("ifm: " + error); return 1; }
    out("renamed " + args[1] + " -> " + args[2]);
    return 0;
  }
  if (command == "copy" && args.size() == 3) {
    if (!localfs::copyPath(args[1], args[2], &error)) { out("ifm: " + error); return 1; }
    out("copied " + args[1] + " -> " + args[2]);
    return 0;
  }
  if (command == "move" && args.size() == 3) {
    if (!localfs::movePath(args[1], args[2], &error)) { out("ifm: " + error); return 1; }
    out("moved " + args[1] + " -> " + args[2]);
    return 0;
  }
  if (command == "delete" && args.size() == 2) {
    if (!localfs::recycleDelete(args[1], &error)) { out("ifm: " + error); return 1; }
    out("moved to recycle bin  " + args[1]);
    return 0;
  }
  if (command == "--version" || command == "-v") {
    out(std::string("Infinity File Manager ") + kVersion);
    return 0;
  }
  if (command == "--help" || command == "-h" || command == "help") {
    out("ifm list [path] | mkdir <path> | rename <old> <new> | copy <source> <dest> | move <source> <dest> | delete <path>");
    return 0;
  }
  out("ifm: invalid command or arguments (use ifm --help)");
  return 2;
}

struct PromptState {
  HWND edit = nullptr;
  std::wstring value;
  bool accepted = false;
};

LRESULT CALLBACK promptProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  PromptState* state = reinterpret_cast<PromptState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
    state = static_cast<PromptState*>(create->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
  }
  switch (message) {
    case WM_CREATE:
      CreateWindowExW(0, L"STATIC", L"Folder name", WS_CHILD | WS_VISIBLE,
                      12, 12, 280, 20, hwnd, nullptr, GetModuleHandleW(nullptr), nullptr);
      state->edit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"New Folder",
                      WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL | WS_TABSTOP,
                      12, 36, 280, 25, hwnd, reinterpret_cast<HMENU>(kPromptEdit),
                      GetModuleHandleW(nullptr), nullptr);
      CreateWindowExW(0, L"BUTTON", L"Create", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
                      132, 72, 76, 27, hwnd, reinterpret_cast<HMENU>(kPromptOk),
                      GetModuleHandleW(nullptr), nullptr);
      CreateWindowExW(0, L"BUTTON", L"Cancel", WS_CHILD | WS_VISIBLE | WS_TABSTOP,
                      216, 72, 76, 27, hwnd, reinterpret_cast<HMENU>(kPromptCancel),
                      GetModuleHandleW(nullptr), nullptr);
      SetFocus(state->edit);
      SendMessageW(state->edit, EM_SETSEL, 0, -1);
      return 0;
    case WM_COMMAND:
      if (LOWORD(wParam) == kPromptOk) {
        int length = GetWindowTextLengthW(state->edit);
        std::vector<wchar_t> text(static_cast<size_t>(length) + 1);
        if (length) GetWindowTextW(state->edit, text.data(), length + 1);
        state->value.assign(text.data(), static_cast<size_t>(length));
        state->accepted = !state->value.empty();
        DestroyWindow(hwnd);
        return 0;
      }
      if (LOWORD(wParam) == kPromptCancel) { DestroyWindow(hwnd); return 0; }
      break;
    case WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

std::string promptFolder(HWND owner) {
  static const wchar_t* className = L"InfinityFileManagerFolderPrompt";
  WNDCLASSW wc = {};
  wc.lpfnWndProc = promptProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = className;
  wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
  if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return std::string();

  RECT rect = {};
  if (owner) GetWindowRect(owner, &rect);
  int x = owner ? rect.left + ((rect.right - rect.left) - 320) / 2 : CW_USEDEFAULT;
  int y = owner ? rect.top + ((rect.bottom - rect.top) - 140) / 2 : CW_USEDEFAULT;
  PromptState state;
  HWND dialog = CreateWindowExW(WS_EX_DLGMODALFRAME | WS_EX_CONTROLPARENT,
      className, L"New Folder", WS_POPUP | WS_CAPTION | WS_SYSMENU,
      x, y, 320, 140, owner, nullptr, wc.hInstance, &state);
  if (!dialog) return std::string();
  if (owner) EnableWindow(owner, FALSE);
  ShowWindow(dialog, SW_SHOW);
  UpdateWindow(dialog);
  MSG message;
  while (IsWindow(dialog) && GetMessageW(&message, nullptr, 0, 0) > 0) {
    if (!IsDialogMessageW(dialog, &message)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
  if (owner) { EnableWindow(owner, TRUE); SetActiveWindow(owner); }
  return state.accepted ? toUtf8(state.value) : std::string();
}

struct GuiState {
  std::string path;
  std::vector<localfs::Entry> entries;
  HWND pathLabel = nullptr;
  HWND listing = nullptr;
};

void guiError(HWND owner, const std::string& error) {
  std::wstring text = toWide(error);
  MessageBoxW(owner, text.c_str(), L"Infinity File Manager", MB_OK | MB_ICONERROR);
}

bool guiRefresh(HWND hwnd, GuiState* state, bool showError) {
  std::vector<localfs::Entry> entries;
  std::string error;
  if (!localfs::list(state->path, &entries, &error)) {
    if (showError) guiError(hwnd, error);
    return false;
  }
  state->entries.swap(entries);
  SetWindowTextW(state->pathLabel, toWide(state->path).c_str());
  SendMessageW(state->listing, LB_RESETCONTENT, 0, 0);
  for (const auto& entry : state->entries) {
    std::wstring line = entry.directory ? L"[DIR]  " : L"        ";
    line += toWide(entry.name);
    if (!entry.directory) line += L"  (" + toWide(humanSize(entry.size)) + L")";
    SendMessageW(state->listing, LB_ADDSTRING, 0, reinterpret_cast<LPARAM>(line.c_str()));
  }
  return true;
}

void guiOpenSelected(HWND hwnd, GuiState* state) {
  LRESULT index = SendMessageW(state->listing, LB_GETCURSEL, 0, 0);
  if (index == LB_ERR || static_cast<size_t>(index) >= state->entries.size()) return;
  const localfs::Entry& entry = state->entries[static_cast<size_t>(index)];
  if (entry.directory) {
    state->path = entry.path;
    guiRefresh(hwnd, state, true);
  } else {
    HINSTANCE result = ShellExecuteW(hwnd, L"open", toWide(entry.path).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    if (reinterpret_cast<INT_PTR>(result) <= 32) guiError(hwnd, "open failed");
  }
}

LRESULT CALLBACK guiProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  GuiState* state = reinterpret_cast<GuiState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
    state = static_cast<GuiState*>(create->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(state));
  }
  switch (message) {
    case WM_CREATE:
      CreateWindowExW(0, L"BUTTON", L"Up", WS_CHILD | WS_VISIBLE | WS_TABSTOP,
                      8, 8, 80, 30, hwnd, reinterpret_cast<HMENU>(kUp), GetModuleHandleW(nullptr), nullptr);
      CreateWindowExW(0, L"BUTTON", L"New Folder", WS_CHILD | WS_VISIBLE | WS_TABSTOP,
                      96, 8, 112, 30, hwnd, reinterpret_cast<HMENU>(kNewFolder), GetModuleHandleW(nullptr), nullptr);
      CreateWindowExW(0, L"BUTTON", L"Refresh", WS_CHILD | WS_VISIBLE | WS_TABSTOP,
                      216, 8, 88, 30, hwnd, reinterpret_cast<HMENU>(kRefresh), GetModuleHandleW(nullptr), nullptr);
      state->pathLabel = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_LEFT,
                      8, 44, 760, 22, hwnd, nullptr, GetModuleHandleW(nullptr), nullptr);
      state->listing = CreateWindowExW(WS_EX_CLIENTEDGE, L"LISTBOX", L"",
                      WS_CHILD | WS_VISIBLE | WS_VSCROLL | LBS_NOTIFY | LBS_NOINTEGRALHEIGHT | WS_TABSTOP,
                      8, 70, 760, 500, hwnd, reinterpret_cast<HMENU>(kListing), GetModuleHandleW(nullptr), nullptr);
      guiRefresh(hwnd, state, true);
      return 0;
    case WM_SIZE: {
      int width = LOWORD(lParam), height = HIWORD(lParam);
      if (state && state->pathLabel) {
        MoveWindow(state->pathLabel, 8, 44, std::max(0, width - 16), 22, TRUE);
        MoveWindow(state->listing, 8, 70, std::max(0, width - 16), std::max(0, height - 78), TRUE);
      }
      return 0;
    }
    case WM_COMMAND:
      if (LOWORD(wParam) == kUp && HIWORD(wParam) == BN_CLICKED) {
        std::string parent = localfs::parentPath(state->path);
        if (parent != state->path) { state->path = parent; guiRefresh(hwnd, state, true); }
        return 0;
      }
      if (LOWORD(wParam) == kRefresh && HIWORD(wParam) == BN_CLICKED) {
        guiRefresh(hwnd, state, true);
        return 0;
      }
      if (LOWORD(wParam) == kNewFolder && HIWORD(wParam) == BN_CLICKED) {
        std::string name = promptFolder(hwnd);
        if (!name.empty()) {
          if (name.find_first_of("\\/") != std::string::npos || name == "." || name == "..") {
            guiError(hwnd, "enter a folder name, not a path");
          } else {
            std::string error;
            if (!localfs::createDirectory(localfs::joinPath(state->path, name), &error)) guiError(hwnd, error);
            else guiRefresh(hwnd, state, true);
          }
        }
        return 0;
      }
      if (LOWORD(wParam) == kListing && HIWORD(wParam) == LBN_DBLCLK) {
        guiOpenSelected(hwnd, state);
        return 0;
      }
      break;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

// ---------------------------------------------------------------- ui

/*
 * The window is Electron; this process is what it talks to.
 *
 * The page fetches everything it shows from these routes, so the rules that
 * keep the program safe hold here too. A path arriving in a query string is
 * untrusted input from a browser, and every failure is answered with a JSON
 * object carrying a message and a non-zero status - an empty 200 would make
 * the page show a blank list where it should show a reason.
 */

// The layer has no modified time of its own; Windows does, and the column is
// worth having, so it is asked for here rather than dropped from the page.
long long modifiedTime(const std::string& path) {
  WIN32_FILE_ATTRIBUTE_DATA data;
  if (!GetFileAttributesExW(toWide(path).c_str(), GetFileExInfoStandard, &data)) return 0;
  ULARGE_INTEGER stamp;
  stamp.HighPart = data.ftLastWriteTime.dwHighDateTime;
  stamp.LowPart = data.ftLastWriteTime.dwLowDateTime;
  // 100-nanosecond ticks since 1601 -> milliseconds since 1970.
  return (long long)(stamp.QuadPart / 10000ULL) - 11644473600000LL;
}

Json entryJson(const localfs::Entry& entry) {
  Json j = Json::object();
  j.set("name", entry.name);
  j.set("path", entry.path);
  j.set("directory", entry.directory);
  j.set("size", (long long)entry.size);
  j.set("modified", modifiedTime(entry.path));
  return j;
}

// The drives that actually exist. GetLogicalDrives reports a bit per letter;
// offering a drive that is not there would be a button that fails.
std::vector<std::string> drives() {
  std::vector<std::string> found;
  const DWORD mask = GetLogicalDrives();
  for (int letter = 0; letter < 26; ++letter) {
    if (!(mask & (1u << letter))) continue;
    std::string root(1, (char)('A' + letter));
    root += ":\\";
    UINT type = GetDriveTypeW(toWide(root).c_str());
    if (type == DRIVE_UNKNOWN || type == DRIVE_NO_ROOT_DIR) continue;
    found.push_back(root);
  }
  return found;
}

Json listingJson(const std::string& path, std::string* error) {
  std::vector<localfs::Entry> entries;
  if (!localfs::list(path, &entries, error)) return Json();

  uint64_t total = 0;
  Json rows = Json::array();
  for (const localfs::Entry& entry : entries) {
    if (!entry.directory) total += entry.size;
    rows.push(entryJson(entry));
  }

  Json j = Json::object();
  j.set("path", path);
  j.set("entries", rows);
  j.set("totalBytes", (long long)total);
  return j;
}

std::string queryValue(const UiRequest& request, const std::string& key) {
  auto it = request.query.find(key);
  return it == request.query.end() ? std::string() : it->second;
}

UiResponse failure(const std::string& message, int status) {
  Json j = Json::object();
  j.set("error", message);
  return UiResponse::withStatus(UiResponse::json(j.dump(2)), status);
}

int serveUi(int port) {
  UiServer server;

  server.route("GET", "/", [](const UiRequest&) { return UiResponse::html(uiHtml()); });
  server.route("GET", "/app.css", [](const UiRequest&) { return UiResponse::css(uiCss()); });
  server.route("GET", "/app.js", [](const UiRequest&) { return UiResponse::js(uiJs()); });

  server.route("GET", "/api/state", [](const UiRequest& request) {
    std::string path = queryValue(request, "path");
    if (path.empty()) path = localfs::currentDirectory();
    std::string error;
    Json listing = listingJson(path, &error);
    if (listing.isNull()) return failure(error.empty() ? "cannot read " + path : error, 400);

    Json drivesJson = Json::array();
    for (const std::string& drive : drives()) {
      Json d = Json::object();
      d.set("name", drive);
      d.set("path", drive);
      drivesJson.push(d);
    }

    Json j = Json::object();
    j.set("app", "Infinity File Manager");
    j.set("version", kVersion);
    j.set("path", listing.s("path"));
    j.set("home", localfs::currentDirectory());
    j.set("entries", listing.get("entries"));
    j.set("totalBytes", listing.i("totalBytes"));
    j.set("drives", drivesJson);
    return UiResponse::json(j.dump(2));
  });

  server.route("GET", "/api/list", [](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    if (path.empty()) return failure("no path given", 400);
    std::string error;
    Json listing = listingJson(path, &error);
    if (listing.isNull()) return failure(error.empty() ? "cannot read " + path : error, 400);
    return UiResponse::json(listing.dump(2));
  });

  server.route("POST", "/api/mkdir", [](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    if (path.empty()) return failure("no path given", 400);
    std::string error;
    if (!localfs::createDirectory(path, &error)) return failure(error, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/rename", [](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    const std::string name = queryValue(request, "name");
    if (path.empty() || name.empty()) return failure("path and name are both required", 400);
    if (name.find_first_of("\\/") != std::string::npos || name == "." || name == "..") {
      return failure("a name cannot contain a path separator", 400);
    }
    std::string error;
    if (!localfs::renamePath(path, localfs::joinPath(localfs::parentPath(path), name), &error)) {
      return failure(error, 400);
    }
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/copy", [](const UiRequest& request) {
    const std::string from = queryValue(request, "from");
    const std::string to = queryValue(request, "to");
    if (from.empty() || to.empty()) return failure("from and to are both required", 400);
    std::string error;
    if (!localfs::copyPath(from, to, &error)) return failure(error, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/move", [](const UiRequest& request) {
    const std::string from = queryValue(request, "from");
    const std::string to = queryValue(request, "to");
    if (from.empty() || to.empty()) return failure("from and to are both required", 400);
    std::string error;
    if (!localfs::movePath(from, to, &error)) return failure(error, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/delete", [](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    if (path.empty()) return failure("no path given", 400);
    std::string error;
    if (!localfs::recycleDelete(path, &error)) return failure(error, 400);
    return UiResponse::json(Json::object().dump());
  });

  server.route("POST", "/api/upload", [](const UiRequest& request) {
    const std::string directory = queryValue(request, "path");
    const std::string name = queryValue(request, "name");
    if (directory.empty() || name.empty()) return failure("path and name are both required", 400);
    // The name comes from a browser file picker, which is still not a reason to
    // trust it: it becomes a path on disk.
    if (name.find_first_of("\\/") != std::string::npos || name == "." || name == "..") {
      return failure("a name cannot contain a path separator", 400);
    }
    const std::wstring target = toWide(localfs::joinPath(directory, name));
    HANDLE file = CreateFileW(target.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return failure("cannot create " + name, 400);
    DWORD written = 0;
    const bool ok = request.body.empty() ||
      WriteFile(file, request.body.data(), (DWORD)request.body.size(), &written, nullptr) != 0;
    CloseHandle(file);
    if (!ok) return failure("cannot write " + name, 500);
    Json j = Json::object();
    j.set("written", (long long)written);
    return UiResponse::json(j.dump());
  });

  server.route("GET", "/api/download", [](const UiRequest& request) {
    const std::string path = queryValue(request, "path");
    if (path.empty()) return failure("no path given", 400);
    if (localfs::isDirectory(path)) return failure("that is a folder", 400);
    HANDLE file = CreateFileW(toWide(path).c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                              OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return failure("cannot open " + path, 404);
    std::string body;
    char buffer[65536];
    DWORD read = 0;
    while (ReadFile(file, buffer, sizeof(buffer), &read, nullptr) && read) body.append(buffer, read);
    CloseHandle(file);

    const size_t slash = path.find_last_of("\\/");
    const std::string name = slash == std::string::npos ? path : path.substr(slash + 1);
    UiResponse response = UiResponse::text(body, 200);
    response.contentType = "application/octet-stream";
    response.headers.push_back({ "Content-Disposition", "attachment; filename=\"" + name + "\"" });
    return response;
  });

  std::string error;
  if (!server.start(port, &error)) {
    out("ifm: cannot start the interface server: " + error);
    return 1;
  }
  out("Infinity File Manager interface  " + server.url());
  out("open it in the window, or point a browser at it; close this to stop.");
  server.wait();
  return 0;
}

int guiMain() {
  GuiState state;
  state.path = localfs::currentDirectory();
  WNDCLASSW wc = {};
  wc.lpfnWndProc = guiProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"InfinityFileManagerWindow";
  wc.hCursor = LoadCursorW(nullptr, MAKEINTRESOURCEW(32512));
  if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    out("ifm: cannot register window class");
    return 1;
  }
  HWND hwnd = CreateWindowExW(0, wc.lpszClassName, L"Infinity File Manager",
      WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 900, 640,
      nullptr, nullptr, wc.hInstance, &state);
  if (!hwnd) { out("ifm: cannot create window"); return 1; }
  ShowWindow(hwnd, SW_SHOW);
  UpdateWindow(hwnd);
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  return 0;
}

int launcherMain(bool admin) {
  const std::string prefix = admin ? "ifmx" : "ifm";
  out(std::string("Infinity File Manager [") + (admin ? "管理员" : "用户") + "]");
  out("");
  out("  1) CLI       命令行");
  out("  2) GUI       图形界面");
  out("");
  out("  q) 退出");
  out("");

  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  DWORD inputMode = 0;
  if (input == INVALID_HANDLE_VALUE || !GetConsoleMode(input, &inputMode)) {
    out("(no console; start " + prefix + "_cli / _gui directly)");
    return 0;
  }

  fputs("> ", stdout);
  fflush(stdout);
  std::string answer;
  char buffer[64];
  if (fgets(buffer, sizeof(buffer), stdin)) answer = trim(buffer);
  if (answer.empty() || answer == "q" || answer == "Q") return 0;

  std::string selectedMode;
  if (answer == "1" || answer == "cli") selectedMode = "cli";
  else if (answer == "2" || answer == "gui") selectedMode = "gui";
  else { out("unknown choice"); return 1; }

  const std::wstring application = toWide(siblingExe(prefix, selectedMode));
  std::wstring commandLine = L"\"" + application + L"\"";
  STARTUPINFOW startup = {};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process = {};
  if (!CreateProcessW(application.c_str(), commandLine.data(), nullptr, nullptr, FALSE,
                      0, nullptr, nullptr, &startup, &process)) {
    out("ifm: cannot start selected program");
    return 1;
  }
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return 0;
}

}  // namespace

int main(int, char**) {
  // The file unblocks itself before anything else runs: the browser marks a
  // download with a Zone.Identifier stream, and Windows then questions the
  // program it just let the user download. Only that stream is removed; the
  // file's contents are never touched.
  inc::unblockSelf();
  inc::unblockSelfDirectory(2);

  SetConsoleOutputCP(CP_UTF8);
  SetConsoleCP(CP_UTF8);

  int argc = 0;
  LPWSTR* wideArgv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!wideArgv) { out("ifm: cannot read command line"); return 1; }
  std::vector<std::string> args;
  for (int i = 1; i < argc; ++i) args.push_back(toUtf8(wideArgv[i]));
  LocalFree(wideArgv);

  if (!args.empty() && (args[0] == "--version" || args[0] == "-v")) {
    out(std::string("Infinity File Manager ") + kVersion);
    return 0;
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
  int uiPort = 7623;
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

  Mode detected = detectMode();
  std::string mode = detected.mode;
  if (!args.empty() && isModeName(args[0])) {
    mode = args[0];
    args.erase(args.begin());
  }
  if (mode == "launcher") return launcherMain(detected.admin);
  if (mode == "gui") return guiMain();
  if (mode == "cli" || !args.empty()) return cliMain(args);
  return guiMain();
}
