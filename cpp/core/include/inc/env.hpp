// env.hpp - the environment the suite reads and writes.
//
// Two jobs, and they are different in kind.
//
// Reading: the token has to be found wherever the machine happens to keep it.
// Several names are accepted, newest first, because the token on this machine
// has been renamed twice and an application that only knows one name stops
// working the moment somebody rotates it.
//
// Writing: the installer registers program locations so a shell can find
// them. Writing to HKCU\Environment is the same thing the installer does, and
// doing it from the program too means a portable copy can register itself.

#pragma once

#include <string>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "str.hpp"

namespace inc {

inline std::string getEnv(const std::string& name) {
  DWORD n = GetEnvironmentVariableA(name.c_str(), nullptr, 0);
  if (!n) return "";
  std::string buf(n, '\0');
  DWORD got = GetEnvironmentVariableA(name.c_str(), &buf[0], n);
  buf.resize(got);
  return buf;
}

// The token, in the order the suite has used these names. The bracket form
// is deliberate: the newest one contains a hyphen, which is legal in an
// environment variable name but not in a plain identifier.
inline std::string tokenFromEnv() {
  static const char* names[] = {
    "gittoken_zssx-2026_1",
    "EV_GH_TOKEN",
    "INC_TOKEN",
    "IFM_TOKEN",
    "IPM_TOKEN",
    "GITHUB_TOKEN",
    "GH_TOKEN"
  };
  for (const char* n : names) {
    std::string v = trim(getEnv(n));
    if (!v.empty()) return v;
  }
  return "";
}

// Which name supplied the token. Shown by `login` so a person can tell where
// the credential it is using actually came from.
inline std::string tokenSource() {
  static const char* names[] = {
    "gittoken_zssx-2026_1", "EV_GH_TOKEN", "INC_TOKEN",
    "IFM_TOKEN", "IPM_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"
  };
  for (const char* n : names) if (!trim(getEnv(n)).empty()) return n;
  return "";
}

// ------------------------------------------------------------ user env

inline bool setUserEnv(const std::string& name, const std::string& value) {
  HKEY key = nullptr;
  if (RegOpenKeyExA(HKEY_CURRENT_USER, "Environment", 0, KEY_SET_VALUE, &key) != ERROR_SUCCESS) return false;
  LSTATUS r = RegSetValueExA(key, name.c_str(), 0, REG_SZ,
                             (const BYTE*)value.c_str(), (DWORD)value.size() + 1);
  RegCloseKey(key);
  return r == ERROR_SUCCESS;
}

inline bool deleteUserEnv(const std::string& name) {
  HKEY key = nullptr;
  if (RegOpenKeyExA(HKEY_CURRENT_USER, "Environment", 0, KEY_SET_VALUE, &key) != ERROR_SUCCESS) return false;
  LSTATUS r = RegDeleteValueA(key, name.c_str());
  RegCloseKey(key);
  return r == ERROR_SUCCESS;
}

// Windows only re-reads the environment for processes started afterwards, so
// anything already open has to be told. Without this the variables look set
// and are invisible, which is the worst of both.
inline void broadcastEnvChange() {
  DWORD_PTR result = 0;
  SendMessageTimeoutA(HWND_BROADCAST, WM_SETTINGCHANGE, 0, (LPARAM)"Environment",
                      SMTO_ABORTIFHUNG, 5000, &result);
}

// The user name with spaces folded to underscores, because an environment
// variable name cannot contain a space.
inline std::string userTag() {
  std::string u = getEnv("USERNAME");
  if (u.empty()) u = "user";
  return replaceAll(u, " ", "_");
}

}  // namespace inc
