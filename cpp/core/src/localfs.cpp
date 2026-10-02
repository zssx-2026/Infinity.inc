#include "inc/localfs.hpp"
#include "inc/str.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shellapi.h>

#include <algorithm>
#include <string>
#include <vector>

namespace inc {
namespace localfs {
namespace {

bool isSlash(wchar_t c) { return c == L'\\' || c == L'/'; }

std::wstring withSeparator(std::wstring path) {
  if (!path.empty() && !isSlash(path.back())) path.push_back(L'\\');
  return path;
}

size_t rootLength(const std::wstring& path) {
  if (path.size() >= 3 && path[1] == L':' && isSlash(path[2])) return 3;
  if (path.size() >= 2 && isSlash(path[0]) && isSlash(path[1])) {
    size_t serverEnd = path.find_first_of(L"\\/", 2);
    if (serverEnd == std::wstring::npos) return path.size();
    size_t shareEnd = path.find_first_of(L"\\/", serverEnd + 1);
    return shareEnd == std::wstring::npos ? path.size() : shareEnd;
  }
  return !path.empty() && isSlash(path[0]) ? 1 : 0;
}

void setError(std::string* error, const char* action) {
  if (error) *error = std::string(action) + " failed (Windows error " +
                             std::to_string(GetLastError()) + ")";
}

std::wstring baseName(std::wstring path) {
  const size_t root = rootLength(path);
  while (path.size() > root && isSlash(path.back())) path.pop_back();
  size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(slash + 1);
}

bool fullPath(const std::wstring& path, std::wstring* result) {
  DWORD size = GetFullPathNameW(path.c_str(), 0, nullptr, nullptr);
  if (!size) return false;
  std::vector<wchar_t> buffer(size);
  DWORD written = GetFullPathNameW(path.c_str(), size, buffer.data(), nullptr);
  if (!written || written >= size) return false;
  result->assign(buffer.data(), written);
  return true;
}

bool isWithin(const std::wstring& parent, const std::wstring& child) {
  std::wstring p, c;
  if (!fullPath(parent, &p) || !fullPath(child, &c)) return false;
  while (p.size() > rootLength(p) && isSlash(p.back())) p.pop_back();
  while (c.size() > rootLength(c) && isSlash(c.back())) c.pop_back();
  if (c.size() <= p.size() ||
      CompareStringOrdinal(p.data(), static_cast<int>(p.size()), c.data(),
                           static_cast<int>(p.size()), TRUE) != CSTR_EQUAL) return false;
  return isSlash(p.back()) || isSlash(c[p.size()]);
}

bool resolveDestination(const std::wstring& source, const std::wstring& destination,
                        std::wstring* resolved, std::string* error) {
  DWORD attrs = GetFileAttributesW(destination.c_str());
  if (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY)) {
    std::wstring leaf = baseName(source);
    if (leaf.empty()) {
      if (error) *error = "source has no name";
      return false;
    }
    *resolved = withSeparator(destination) + leaf;
  } else {
    *resolved = destination;
  }
  return true;
}

bool copyDirectory(const std::wstring& source, const std::wstring& destination,
                   std::string* error) {
  DWORD attrs = GetFileAttributesW(source.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES) {
    setError(error, "copy");
    return false;
  }
  if (attrs & FILE_ATTRIBUTE_REPARSE_POINT) {
    if (error) *error = "copy does not follow reparse points";
    return false;
  }
  if (!CreateDirectoryW(destination.c_str(), nullptr)) {
    setError(error, "copy");
    return false;
  }

  WIN32_FIND_DATAW data;
  std::wstring pattern = withSeparator(source) + L"*";
  HANDLE find = FindFirstFileW(pattern.c_str(), &data);
  if (find == INVALID_HANDLE_VALUE) {
    setError(error, "copy");
    return false;
  }

  bool ok = true;
  do {
    if (wcscmp(data.cFileName, L".") == 0 || wcscmp(data.cFileName, L"..") == 0) continue;
    std::wstring from = withSeparator(source) + data.cFileName;
    std::wstring to = withSeparator(destination) + data.cFileName;
    if (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) {
      if (error) *error = "copy does not follow reparse points";
      ok = false;
      break;
    }
    if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
      if (!copyDirectory(from, to, error)) { ok = false; break; }
    } else if (!CopyFileW(from.c_str(), to.c_str(), TRUE)) {
      setError(error, "copy");
      ok = false;
      break;
    }
  } while (FindNextFileW(find, &data));

  DWORD endError = GetLastError();
  FindClose(find);
  if (ok && endError != ERROR_NO_MORE_FILES) {
    SetLastError(endError);
    setError(error, "copy");
    ok = false;
  }
  return ok;
}

}  // namespace

std::string currentDirectory() {
  DWORD size = GetCurrentDirectoryW(0, nullptr);
  if (!size) return std::string();
  std::vector<wchar_t> buffer(size);
  DWORD written = GetCurrentDirectoryW(size, buffer.data());
  if (!written || written >= size) return std::string();
  return toUtf8(std::wstring(buffer.data(), written));
}

std::string joinPath(const std::string& directory, const std::string& name) {
  if (directory.empty()) return name;
  return toUtf8(withSeparator(toWide(directory)) + toWide(name));
}

std::string parentPath(const std::string& path) {
  std::wstring value = toWide(path);
  const size_t root = rootLength(value);
  while (value.size() > root && isSlash(value.back())) value.pop_back();
  if (value.size() <= root) return toUtf8(value);
  size_t slash = value.find_last_of(L"\\/");
  if (slash == std::wstring::npos) return ".";
  if (slash < root) return toUtf8(value.substr(0, root));
  if (slash == 0) return toUtf8(value.substr(0, 1));
  return toUtf8(value.substr(0, slash));
}

bool isDirectory(const std::string& path) {
  DWORD attrs = GetFileAttributesW(toWide(path).c_str());
  return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

bool list(const std::string& path, std::vector<Entry>* entries, std::string* error) {
  if (!entries) {
    if (error) *error = "invalid output";
    return false;
  }
  entries->clear();
  std::wstring directory = toWide(path.empty() ? currentDirectory() : path);
  std::wstring pattern = withSeparator(directory) + L"*";
  WIN32_FIND_DATAW data;
  HANDLE find = FindFirstFileW(pattern.c_str(), &data);
  if (find == INVALID_HANDLE_VALUE) {
    setError(error, "list");
    return false;
  }
  bool ok = true;
  do {
    if (wcscmp(data.cFileName, L".") == 0 || wcscmp(data.cFileName, L"..") == 0) continue;
    Entry entry;
    entry.name = toUtf8(data.cFileName);
    entry.path = toUtf8(withSeparator(directory) + data.cFileName);
    entry.directory = (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
    entry.size = (static_cast<uint64_t>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
    entries->push_back(entry);
  } while (FindNextFileW(find, &data));
  DWORD endError = GetLastError();
  FindClose(find);
  if (endError != ERROR_NO_MORE_FILES) {
    SetLastError(endError);
    setError(error, "list");
    entries->clear();
    ok = false;
  }
  if (ok) {
    std::sort(entries->begin(), entries->end(), [](const Entry& a, const Entry& b) {
      if (a.directory != b.directory) return a.directory;
      int cmp = CompareStringOrdinal(toWide(a.name).c_str(), -1,
                                     toWide(b.name).c_str(), -1, TRUE);
      return cmp == CSTR_EQUAL ? a.name < b.name : cmp == CSTR_LESS_THAN;
    });
  }
  return ok;
}

bool createDirectory(const std::string& path, std::string* error) {
  if (CreateDirectoryW(toWide(path).c_str(), nullptr)) return true;
  setError(error, "mkdir");
  return false;
}

bool renamePath(const std::string& from, const std::string& to, std::string* error) {
  if (MoveFileW(toWide(from).c_str(), toWide(to).c_str())) return true;
  setError(error, "rename");
  return false;
}

bool copyPath(const std::string& from, const std::string& to, std::string* error) {
  std::wstring source = toWide(from), destination;
  DWORD attrs = GetFileAttributesW(source.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES) {
    setError(error, "copy");
    return false;
  }
  if (!resolveDestination(source, toWide(to), &destination, error)) return false;
  if (attrs & FILE_ATTRIBUTE_DIRECTORY) {
    if (isWithin(source, destination) ||
        CompareStringOrdinal(source.c_str(), -1, destination.c_str(), -1, TRUE) == CSTR_EQUAL) {
      if (error) *error = "cannot copy a directory into itself";
      return false;
    }
    return copyDirectory(source, destination, error);
  }
  if (!CopyFileW(source.c_str(), destination.c_str(), TRUE)) {
    setError(error, "copy");
    return false;
  }
  return true;
}

bool movePath(const std::string& from, const std::string& to, std::string* error) {
  std::wstring source = toWide(from), destination;
  if (GetFileAttributesW(source.c_str()) == INVALID_FILE_ATTRIBUTES) {
    setError(error, "move");
    return false;
  }
  if (!resolveDestination(source, toWide(to), &destination, error)) return false;
  DWORD attrs = GetFileAttributesW(source.c_str());
  if ((attrs & FILE_ATTRIBUTE_DIRECTORY) &&
      (isWithin(source, destination) ||
       CompareStringOrdinal(source.c_str(), -1, destination.c_str(), -1, TRUE) == CSTR_EQUAL)) {
    if (error) *error = "cannot move a directory into itself";
    return false;
  }
  if (MoveFileExW(source.c_str(), destination.c_str(), MOVEFILE_COPY_ALLOWED)) return true;
  setError(error, "move");
  return false;
}

bool recycleDelete(const std::string& path, std::string* error) {
  std::wstring source = toWide(path);
  if (source.find_first_of(L"*?") != std::wstring::npos) {
    if (error) *error = "delete expects one path, not a wildcard";
    return false;
  }
  DWORD attrs = GetFileAttributesW(source.c_str());
  if (attrs == INVALID_FILE_ATTRIBUTES) {
    setError(error, "delete");
    return false;
  }
  if ((attrs & FILE_ATTRIBUTE_DIRECTORY) && source.size() <= rootLength(source)) {
    if (error) *error = "refusing to delete a filesystem root";
    return false;
  }

  std::wstring doubleNull = source;
  doubleNull.push_back(L'\0');
  doubleNull.push_back(L'\0');
  SHFILEOPSTRUCTW operation = {};
  operation.wFunc = FO_DELETE;
  operation.pFrom = doubleNull.c_str();
  operation.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT;
  int result = SHFileOperationW(&operation);
  if (result != 0 || operation.fAnyOperationsAborted) {
    if (result) SetLastError(static_cast<DWORD>(result));
    setError(error, "delete");
    return false;
  }
  return true;
}

}  // namespace localfs
}  // namespace inc
