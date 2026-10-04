// unblock.cpp - the one implementation of "delete the download mark".
//
// Every application links this: the six mains call inc::unblockSelf() and
// inc::unblockSelfDirectory() in their first statements, and the NSIS
// installers clear the same stream from the files they drop. One place, so a
// fix is made once.
#include "unblock.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <cwctype>

namespace inc {
namespace {

/* A stream is addressed as "<owner path>:<stream name>", and DeleteFileW
 * deletes it without opening the owner. An absent stream is the normal case,
 * not an error. */
bool deleteZoneStream(const std::wstring& path) {
  if (path.empty()) return false;
  const std::wstring stream = path + L":Zone.Identifier";
  if (DeleteFileW(stream.c_str())) return true;

  const DWORD error = GetLastError();
  if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return false;
  if (error != ERROR_ACCESS_DENIED) return false;

  /* A read-only owner refuses the delete. Clear the attribute, try once, and
   * put it back; the content is still never opened. */
  const DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_READONLY)) return false;
  if (!SetFileAttributesW(path.c_str(), attributes & ~static_cast<DWORD>(FILE_ATTRIBUTE_READONLY))) return false;
  const bool removed = DeleteFileW(stream.c_str()) != FALSE;
  SetFileAttributesW(path.c_str(), attributes);
  return removed;
}

bool wantedExtension(const std::wstring& name) {
  const size_t dot = name.find_last_of(L'.');
  if (dot == std::wstring::npos) return false;
  std::wstring extension = name.substr(dot);
  for (size_t i = 0; i < extension.size(); ++i) extension[i] = static_cast<wchar_t>(std::towlower(extension[i]));
  return extension == L".exe" || extension == L".dll" || extension == L".pak" ||
         extension == L".dat" || extension == L".json" || extension == L".txt";
}

int sweep(const std::wstring& directory, int depth, int removed) {
  if (depth < 0) return removed;
  WIN32_FIND_DATAW found = {};
  HANDLE handle = FindFirstFileW((directory + L"\\*").c_str(), &found);
  if (handle == INVALID_HANDLE_VALUE) return removed;
  do {
    const std::wstring name = found.cFileName;
    if (name == L"." || name == L"..") continue;
    const std::wstring full = directory + L"\\" + name;
    if (found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (depth > 0) removed = sweep(full, depth - 1, removed);
    } else if (wantedExtension(name)) {
      if (deleteZoneStream(full)) ++removed;
    }
  } while (FindNextFileW(handle, &found));
  FindClose(handle);
  return removed;
}

/* The running module's own path, from Windows rather than from an argument:
 * this function is only ever allowed to act on the program the user started
 * and what sits beside it. */
std::wstring modulePath() {
  DWORD size = MAX_PATH;
  for (;;) {
    std::wstring path(size, L'\0');
    const DWORD written = GetModuleFileNameW(nullptr, &path[0], size);
    if (written == 0) return std::wstring();
    if (written < size) { path.resize(written); return path; }
    if (size >= 32768) return std::wstring();
    size *= 2;
  }
}

}  // namespace

bool unblockFile(const std::wstring& path) { return deleteZoneStream(path); }

bool unblockSelf() { return deleteZoneStream(modulePath()); }

int unblockSelfDirectory(int maxDepth) {
  const std::wstring self = modulePath();
  if (self.empty()) return 0;
  const size_t slash = self.find_last_of(L"\\/");
  if (slash == std::wstring::npos || slash == 0) return 0;
  return sweep(self.substr(0, slash), maxDepth, 0);
}

}  // namespace inc
