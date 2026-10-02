// console.cpp - the terminal behind console.hpp.

#include "inc/console.hpp"
#include "inc/str.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cstdio>

namespace inc {

Console::Console() {
  HANDLE hIn = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);
  in_ = hIn;
  out_ = hOut;

  if (hOut == INVALID_HANDLE_VALUE || hOut == nullptr) return;
  DWORD mode = 0;
  if (!GetConsoleMode(hOut, &mode)) return;
  savedOut_ = mode;
  // Without this the ANSI escapes the TUI emits are printed as literal
  // text, which turns a drawn screen into a wall of garbage.
  SetConsoleMode(hOut, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING | ENABLE_PROCESSED_OUTPUT);

  if (hIn != INVALID_HANDLE_VALUE && hIn != nullptr) {
    DWORD im = 0;
    if (GetConsoleMode(hIn, &im)) {
      savedIn_ = im;
      // Window and mouse input are off so the only thing that ever arrives is
      // a key; anything else would have to be filtered at every call site.
      SetConsoleMode(hIn, (im | ENABLE_VIRTUAL_TERMINAL_INPUT | ENABLE_WINDOW_INPUT) &
                          ~(ENABLE_MOUSE_INPUT | ENABLE_QUICK_EDIT_MODE));
    }
  }
  refreshSize();
  ok_ = true;
}

Console::~Console() {
  if (raw_) setRaw(false);
  if (out_ && savedOut_) SetConsoleMode((HANDLE)out_, (DWORD)savedOut_);
}

void Console::refreshSize() {
  CONSOLE_SCREEN_BUFFER_INFO info;
  if (GetConsoleScreenBufferInfo((HANDLE)out_, &info)) {
    width_ = info.srWindow.Right - info.srWindow.Left + 1;
    height_ = info.srWindow.Bottom - info.srWindow.Top + 1;
  }
}

void Console::setRaw(bool on) {
  HANDLE h = (HANDLE)in_;
  if (!h || h == INVALID_HANDLE_VALUE) return;
  DWORD m = 0;
  if (!GetConsoleMode(h, &m)) return;
  if (on) SetConsoleMode(h, m & ~(ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT));
  else SetConsoleMode(h, m | ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT);
  raw_ = on;
}

void Console::clear() { write("\x1b[2J\x1b[H"); }
void Console::home() { write("\x1b[H"); }
void Console::hideCursor() { write("\x1b[?25l"); }
void Console::showCursor() { write("\x1b[?25h"); }
void Console::reset() { write("\x1b[0m"); }
void Console::fg(int code) { write("\x1b[" + std::to_string(code) + "m"); }
void Console::bg(int code) { write("\x1b[" + std::to_string(code + 10) + "m"); }

void Console::moveTo(int row, int col) {
  write("\x1b[" + std::to_string(row + 1) + ";" + std::to_string(col + 1) + "H");
}

void Console::write(const std::string& s) {
  fwrite(s.data(), 1, s.size(), stdout);
}

void Console::writeAt(int row, int col, const std::string& s) {
  moveTo(row, col);
  write(s);
}

// Draw a full-width row: the text, then padding to the edge so whatever was
// there before is overwritten rather than left showing through.
void Console::line(int row, const std::string& s, int width) {
  moveTo(row, 0);
  std::string out = s;
  size_t visible = 0;
  for (size_t i = 0; i < s.size();) {
    if (s[i] == '\x1b') { while (i < s.size() && s[i] != 'm') i++; if (i < s.size()) i++; continue; }
    unsigned char c = (unsigned char)s[i];
    visible += (c < 0x80) ? 1 : (c < 0xE0) ? 0 : (c < 0xF0) ? 1 : 1;
    i++;
  }
  while ((int)visible < width) { out.push_back(' '); visible++; }
  write(out);
}

void Console::flush() { fflush(stdout); }

Key Console::readKey() {
  Key k;
  HANDLE h = (HANDLE)in_;
  if (!h || h == INVALID_HANDLE_VALUE) return k;

  for (;;) {
    INPUT_RECORD rec;
    DWORD got = 0;
    if (!ReadConsoleInputW(h, &rec, 1, &got)) return k;
    if (!got) return k;
    if (rec.EventType != KEY_EVENT) continue;
    if (!rec.Event.KeyEvent.bKeyDown) continue;

    const KEY_EVENT_RECORD& e = rec.Event.KeyEvent;
    if (e.wVirtualKeyCode == VK_UP) { k.kind = Key::Up; return k; }
    if (e.wVirtualKeyCode == VK_DOWN) { k.kind = Key::Down; return k; }
    if (e.wVirtualKeyCode == VK_LEFT) { k.kind = Key::Left; return k; }
    if (e.wVirtualKeyCode == VK_RIGHT) { k.kind = Key::Right; return k; }
    if (e.wVirtualKeyCode == VK_RETURN) { k.kind = Key::Enter; return k; }
    if (e.wVirtualKeyCode == VK_ESCAPE) { k.kind = Key::Escape; return k; }
    if (e.wVirtualKeyCode == VK_BACK) { k.kind = Key::Backspace; return k; }
    if (e.wVirtualKeyCode == VK_TAB) { k.kind = Key::Tab; return k; }
    if (e.wVirtualKeyCode == VK_F1) { k.kind = Key::F1; return k; }
    if (e.wVirtualKeyCode == VK_F2) { k.kind = Key::F2; return k; }
    if (e.wVirtualKeyCode == VK_F3) { k.kind = Key::F3; return k; }

    wchar_t wc = e.uChar.UnicodeChar;
    if (!wc) continue;
    if (wc == 3) { k.kind = Key::CtrlC; return k; }
    if (wc < 0x80) { k.kind = Key::Char; k.ch = (char)wc; return k; }
    // A non-ASCII keypress is dropped rather than mangled: the TUI only
    // needs ASCII for commands, and a half-converted character in a text
    // field is worse than a keystroke that does nothing.
  }
}

}  // namespace inc
