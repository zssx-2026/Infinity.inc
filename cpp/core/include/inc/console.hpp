// console.hpp - the terminal, driven directly.
//
// The TUI draws with ANSI escapes and reads keys as events, which on Windows
// means two things have to be turned on first: virtual terminal processing
// (so the escapes are interpreted rather than printed) and raw input (so a
// keypress arrives without waiting for Enter).
//
// Both are restored on the way out. A console left in raw mode is a console
// where the next program cannot be typed into, and that is a bug the user
// pays for, not the program.

#pragma once

#include <string>
#include <vector>

namespace inc {

struct Key {
  enum Kind { None, Char, Up, Down, Left, Right, Enter, Escape, Backspace, Tab, CtrlC, F1, F2, F3 } kind = None;
  char ch = 0;
};

class Console {
 public:
  Console();
  ~Console();

  bool ok() const { return ok_; }
  int width() const { return width_; }
  int height() const { return height_; }
  void refreshSize();

  void clear();
  void home();
  void moveTo(int row, int col);
  void hideCursor();
  void showCursor();

  // Colours are ANSI SGR codes: 30-37 foreground, 90-97 bright.
  void fg(int code);
  void bg(int code);
  void reset();

  void write(const std::string& s);
  void writeAt(int row, int col, const std::string& s);
  void line(int row, const std::string& s, int width);
  void flush();

  // Blocks until one key arrives. Returns Kind::None at end of input.
  Key readKey();

  void setRaw(bool on);
  bool raw() const { return raw_; }

 private:
  bool ok_ = false;
  bool raw_ = false;
  int width_ = 80;
  int height_ = 25;
  void* in_ = nullptr;
  void* out_ = nullptr;
  unsigned long savedIn_ = 0;
  unsigned long savedOut_ = 0;
};

// The colour set the suite uses. Named rather than numeric at the call site,
// because "bright cyan" survives a theme change and "96" does not.
enum Color {
  C_RESET = 0,
  C_DIM = 90,
  C_RED = 91,
  C_GREEN = 92,
  C_YELLOW = 93,
  C_BLUE = 94,
  C_MAGENTA = 95,
  C_CYAN = 96,
  C_WHITE = 97,
  C_GRAY = 37
};

}  // namespace inc
