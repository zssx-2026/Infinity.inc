// tokenstore.hpp - the token the program keeps for itself.
//
// The first window a person sees asks for a token, and what they paste has to
// survive the next start: asking again every time is the behaviour of a tool
// that does not expect to be used. The token is written under the user's own
// profile and sealed with DPAPI, so the file is readable only by that Windows
// account - a copy of the file on another machine or under another user is
// noise, not a credential.
//
// The environment is still read, but only as a fallback: a machine that
// already exports a token keeps working, and a person who never opens the
// window is not forced through it.

#pragma once

#include <string>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <wincrypt.h>

#include "env.hpp"

namespace inc {

// %LOCALAPPDATA%\Infinity\<app>. LOCALAPPDATA rather than APPDATA because
// this is machine state, not something a roaming profile should carry: the
// DPAPI blob is sealed to this account on this machine anyway.
inline std::string tokenStoreDir(const std::string& app) {
  std::string base = getEnv("LOCALAPPDATA");
  if (base.empty()) base = getEnv("APPDATA");
  if (base.empty()) return "";
  return base + "\\Infinity\\" + app;
}

inline std::string tokenStorePath(const std::string& app) {
  const std::string dir = tokenStoreDir(app);
  if (dir.empty()) return "";
  return dir + "\\token.bin";
}

inline bool writeBytes(const std::string& path, const void* data, size_t size, std::string* error) {
  HANDLE file = CreateFileA(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                            FILE_ATTRIBUTE_HIDDEN, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    if (error) *error = "cannot create the token file";
    return false;
  }
  DWORD written = 0;
  const bool ok = WriteFile(file, data, (DWORD)size, &written, nullptr) != 0 && written == size;
  CloseHandle(file);
  if (!ok) {
    DeleteFileA(path.c_str());
    if (error) *error = "cannot write the token file";
  }
  return ok;
}

inline bool readBytes(const std::string& path, std::string* out) {
  HANDLE file = CreateFileA(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
                            OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  char buffer[4096];
  DWORD got = 0;
  out->clear();
  while (ReadFile(file, buffer, sizeof(buffer), &got, nullptr) && got) out->append(buffer, got);
  CloseHandle(file);
  return !out->empty();
}

// Seals the token to the current Windows account and writes it. The plaintext
// exists only in this process's memory.
inline bool saveToken(const std::string& app, const std::string& token, std::string* error) {
  const std::string dir = tokenStoreDir(app);
  const std::string path = tokenStorePath(app);
  if (path.empty()) {
    if (error) *error = "no LOCALAPPDATA";
    return false;
  }
  const std::string root = dir.substr(0, dir.find_last_of('\\'));
  CreateDirectoryA(root.c_str(), nullptr);
  CreateDirectoryA(dir.c_str(), nullptr);

  DATA_BLOB in;
  in.pbData = (BYTE*)token.data();
  in.cbData = (DWORD)token.size();
  DATA_BLOB sealed;
  sealed.pbData = nullptr;
  sealed.cbData = 0;
  if (!CryptProtectData(&in, L"Infinity access token", nullptr, nullptr, nullptr,
                        CRYPTPROTECT_UI_FORBIDDEN, &sealed)) {
    if (error) *error = "CryptProtectData failed";
    return false;
  }
  const bool ok = writeBytes(path, sealed.pbData, sealed.cbData, error);
  LocalFree(sealed.pbData);
  return ok;
}

// The stored token, or empty when there is none (or it was sealed by another
// account). A missing file is not an error - it is a first run.
inline std::string loadToken(const std::string& app) {
  const std::string path = tokenStorePath(app);
  if (path.empty()) return "";
  std::string sealedBytes;
  if (!readBytes(path, &sealedBytes)) return "";

  DATA_BLOB in;
  in.pbData = (BYTE*)sealedBytes.data();
  in.cbData = (DWORD)sealedBytes.size();
  DATA_BLOB plain;
  plain.pbData = nullptr;
  plain.cbData = 0;
  if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr,
                          CRYPTPROTECT_UI_FORBIDDEN, &plain)) {
    return "";
  }
  std::string token((const char*)plain.pbData, plain.cbData);
  LocalFree(plain.pbData);
  return trim(token);
}

inline bool forgetToken(const std::string& app) {
  const std::string path = tokenStorePath(app);
  if (path.empty()) return false;
  return DeleteFileA(path.c_str()) != 0;
}

}  // namespace inc
