// mode.hpp - which face of the program am I?
//
// Infinity.Inc ships one program under several names, and the name is the
// whole configuration:
//
//   inc_cli  inc_tui  inc_gui  inc_launcher        the user's copies
//   inx_cli  inx_tui  inx_gui  inx_launcher        the administrator's copies
//
// The eight files are identical; only the file name carries meaning. Reading
// it here means the build stays a single artifact per application and the
// behaviour lives in one place instead of eight.

#pragma once

#include <string>
#include <cstdio>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "str.hpp"

namespace inc {

struct Mode {
  std::string app;      // inc / ifm / ipm, or empty when the name matched nothing
  std::string mode;     // cli / tui / gui / launcher, or empty
  bool admin = false;
  std::string exe;      // the base name it was started as
};

inline const char* modeNames() { return "cli tui gui launcher"; }

inline Mode detectMode() {
  Mode m;
  wchar_t buf[MAX_PATH] = { 0 };
  DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
  std::wstring full(buf, n);
  size_t slash = full.find_last_of(L"\\/");
  std::wstring base = slash == std::wstring::npos ? full : full.substr(slash + 1);
  std::string name = lower(toUtf8(base));
  if (endsWith(name, ".exe")) name = name.substr(0, name.size() - 4);
  m.exe = name;

  size_t cut = name.find('_');
  if (cut == std::string::npos) return m;
  const std::string prefix = name.substr(0, cut);
  const std::string mode = name.substr(cut + 1);

  if (mode != "cli" && mode != "tui" && mode != "gui" && mode != "launcher") return m;
  if (prefix == "inc") { m.app = "inc"; m.admin = false; }
  else if (prefix == "inx") { m.app = "inc"; m.admin = true; }
  else if (prefix == "ifm") { m.app = "ifm"; m.admin = false; }
  else if (prefix == "ifmx") { m.app = "ifm"; m.admin = true; }
  else if (prefix == "ipm") { m.app = "ipm"; m.admin = false; }
  else if (prefix == "ipmx") { m.app = "ipm"; m.admin = true; }
  else return m;

  m.mode = mode;
  return m;
}

// Where a sibling executable lives. The launcher starts one of these, and
// every face looks for its payload beside itself, so one helper is enough.
inline std::string exeDir() {
  wchar_t buf[MAX_PATH] = { 0 };
  DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
  std::wstring full(buf, n);
  size_t slash = full.find_last_of(L"\\/");
  return toUtf8(slash == std::wstring::npos ? full : full.substr(0, slash));
}

inline std::string siblingExe(const std::string& prefix, const std::string& mode) {
  return exeDir() + "\\" + prefix + "_" + mode + ".exe";
}

// Elevation is not something the program can grant itself, so the elevated
// faces simply record that they are running and let the caller decide what
// that means. Reporting it is more honest than pretending to be root.
inline bool isElevated() {
  BOOL admin = FALSE;
  PSID group = nullptr;
  SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
  if (AllocateAndInitializeSid(&nt, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS,
                               0, 0, 0, 0, 0, 0, &group)) {
    CheckTokenMembership(nullptr, group, &admin);
    FreeSid(group);
  }
  return admin != FALSE;
}

}  // namespace inc
