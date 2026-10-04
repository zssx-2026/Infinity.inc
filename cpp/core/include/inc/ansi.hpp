// ansi.hpp - the colour set the suite prints with.
//
// These constants lived in console.hpp until the terminal interface was
// dropped from every application. The command line still prints colour, and a
// name survives a theme change where a bare "96" does not, so the enum
// outlived the screen it was written for.
//
// The escape sequences are emitted as-is. On Windows that means virtual
// terminal processing has to be on, which is the console's default in Windows
// 10 and later; the callers do not ask for it any more because the only
// program that needed to is gone.

#pragma once

#include <string>

namespace inc {

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

inline std::string color(int code, const std::string& text) {
  return "\x1b[" + std::to_string(code) + "m" + text + "\x1b[0m";
}

}  // namespace inc
