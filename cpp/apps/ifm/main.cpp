#include "inc/console.hpp"
#include "inc/localfs.hpp"
#include "inc/mode.hpp"
#include "inc/str.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>

#include <algorithm>
#include <cstdio>
#include <string>
#include <vector>

using namespace inc;

namespace {

const char* kVersion = "1.0.0-pre3";
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
  return value == "cli" || value == "tui" || value == "gui" || value == "launcher";
}

std::string fitLine(const std::string& text, int width) {
  if (width <= 0) return std::string();
  size_t bytes = 0;
  int cells = 0;
  while (bytes < text.size()) {
    unsigned char c = static_cast<unsigned char>(text[bytes]);
    size_t length = c < 0x80 ? 1 : (c < 0xE0 ? 2 : (c < 0xF0 ? 3 : 4));
    if (bytes + length > text.size()) length = 1;
    int cellsForChar = (length == 3 || length == 4) ? 2 : 1;
    if (cells + cellsForChar > width) break;
    cells += cellsForChar;
    bytes += length;
  }
  std::string result = text.substr(0, bytes);
  if (bytes < text.size() && width >= 3) {
    while (cells > width - 3 && !result.empty()) {
      size_t start = result.size() - 1;
      while (start > 0 && (static_cast<unsigned char>(result[start]) & 0xC0) == 0x80) --start;
      unsigned char c = static_cast<unsigned char>(result[start]);
      size_t length = c < 0x80 ? 1 : (c < 0xE0 ? 2 : (c < 0xF0 ? 3 : 4));
      result.resize(start);
      cells -= (length == 3 || length == 4) ? 2 : 1;
    }
    result += "...";
  }
  return result;
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

void tuiDraw(Console& console, const std::string& path,
             const std::vector<localfs::Entry>& entries, int cursor,
             const std::string& status) {
  console.clear();
  console.hideCursor();
  int width = console.width();
  int height = console.height();
  console.line(0, fitLine(" " + path, width), width);
  console.line(1, fitLine(status.empty() ? "" : " " + status, width), width);

  int visible = std::max(0, height - 4);
  int start = 0;
  if (cursor >= visible && visible > 0) start = cursor - visible + 1;
  for (int row = 0; row < visible; ++row) {
    int index = start + row;
    if (index >= static_cast<int>(entries.size())) break;
    std::string line = (index == cursor ? "> " : "  ") + entryLine(entries[index]);
    console.line(row + 2, fitLine(line, width), width);
  }
  if (height > 2) console.line(height - 1, fitLine(" Up/Down select  Enter open  Backspace up  Q quit", width), width);
  console.flush();
}

int tuiMain() {
  Console console;
  if (!console.ok()) { out("ifm: no console available for TUI"); return 1; }

  std::string path = localfs::currentDirectory();
  std::vector<localfs::Entry> entries;
  std::string status;
  if (!localfs::list(path, &entries, &status)) { out("ifm: " + status); return 1; }
  int cursor = 0;
  console.setRaw(true);
  tuiDraw(console, path, entries, cursor, status);

  for (;;) {
    Key key = console.readKey();
    if (key.kind == Key::None || key.kind == Key::CtrlC || key.kind == Key::Escape ||
        (key.kind == Key::Char && (key.ch == 'q' || key.ch == 'Q'))) break;
    status.clear();
    if (key.kind == Key::Up && cursor > 0) --cursor;
    else if (key.kind == Key::Down && cursor + 1 < static_cast<int>(entries.size())) ++cursor;
    else if (key.kind == Key::Backspace) {
      std::string parent = localfs::parentPath(path);
      if (parent != path) {
        std::vector<localfs::Entry> next;
        if (localfs::list(parent, &next, &status)) { path = parent; entries.swap(next); cursor = 0; }
      }
    } else if (key.kind == Key::Enter && cursor >= 0 && cursor < static_cast<int>(entries.size())) {
      const localfs::Entry& entry = entries[cursor];
      if (entry.directory) {
        std::vector<localfs::Entry> next;
        if (localfs::list(entry.path, &next, &status)) { path = entry.path; entries.swap(next); cursor = 0; }
      } else {
        HINSTANCE result = ShellExecuteW(nullptr, L"open", toWide(entry.path).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        if (reinterpret_cast<INT_PTR>(result) <= 32) status = "open failed";
      }
    }
    console.refreshSize();
    tuiDraw(console, path, entries, cursor, status);
  }
  console.setRaw(false);
  console.showCursor();
  console.clear();
  return 0;
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
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  DWORD inputMode = 0;
  if (input == INVALID_HANDLE_VALUE || !GetConsoleMode(input, &inputMode)) {
    out(admin ? "Run ifmx_cli/ifmx_tui/ifmx_gui directly."
              : "Run ifm_cli/ifm_tui/ifm_gui directly.");
    return 0;
  }

  Console console;
  if (!console.ok()) return 0;
  out("1 CLI  2 TUI  3 GUI  (q/Esc quit)");
  fputs("> ", stdout);
  fflush(stdout);
  console.setRaw(true);

  int selection = 0;
  while (!selection) {
    Key key = console.readKey();
    if (key.kind == Key::Escape || key.kind == Key::CtrlC || key.kind == Key::None ||
        (key.kind == Key::Char && (key.ch == 'q' || key.ch == 'Q'))) {
      console.setRaw(false);
      return 0;
    }
    if (key.kind == Key::Char && key.ch >= '1' && key.ch <= '3') selection = key.ch - '0';
  }
  console.setRaw(false);

  const char* selectedMode = selection == 1 ? "cli" : (selection == 2 ? "tui" : "gui");
  const std::string prefix = admin ? "ifmx" : "ifm";
  std::wstring application = toWide(siblingExe(prefix, selectedMode));
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
  Mode detected = detectMode();
  std::string mode = detected.mode;
  if (!args.empty() && isModeName(args[0])) {
    mode = args[0];
    args.erase(args.begin());
  }
  if (mode == "launcher") return launcherMain(detected.admin);
  if (mode == "gui") return guiMain();
  if (mode == "tui") return tuiMain();
  if (mode == "cli" || !args.empty()) return cliMain(args);
  return tuiMain();
}
