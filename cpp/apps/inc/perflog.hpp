// perflog.hpp - opt-in startup phase timestamps.
//
// A start that takes seconds cannot be fixed by guessing which part of it is
// slow, and a debugger changes the thing it is measuring. So the program writes
// its own phase times to a file when INC_PERF_LOG names one:
//
//   set INC_PERF_LOG=%TEMP%\inc-perf.log
//   inc_gui.exe
//
// Each line is "milliseconds<TAB>phase", counted from the first mark in the
// process. With the variable unset every call is one environment lookup and a
// branch, and nothing is written.

#pragma once

#include <cstdio>
#include <string>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace incperf {

inline long long clockMs() { return (long long)GetTickCount64(); }

// The first mark in the process fixes the origin, so every number below is
// "milliseconds since the program started" rather than since the machine booted.
inline long long originMs() {
  static const long long origin = clockMs();
  return origin;
}

inline const std::string& logPath() {
  static const std::string path = []() {
    char buf[1024] = { 0 };
    DWORD n = GetEnvironmentVariableA("INC_PERF_LOG", buf, sizeof(buf));
    return (n > 0 && n < sizeof(buf)) ? std::string(buf, n) : std::string();
  }();
  return path;
}

inline void mark(const char* phase) {
  if (logPath().empty()) return;
  FILE* f = fopen(logPath().c_str(), "a");
  if (!f) return;
  fprintf(f, "%lld\t%s\n", clockMs() - originMs(), phase);
  fclose(f);
}

inline void markCount(const char* phase, long long value) {
  if (logPath().empty()) return;
  FILE* f = fopen(logPath().c_str(), "a");
  if (!f) return;
  fprintf(f, "%lld\t%s=%lld\n", clockMs() - originMs(), phase, value);
  fclose(f);
}

}  // namespace incperf
