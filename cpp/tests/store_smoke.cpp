// store_smoke.cpp - end-to-end proof that the cloud filesystem round-trips.
//
// This test makes a uniquely named inc_cpp_smoke_* repository, uploads one
// tiny file and one manifest, pulls it back into a fresh Store, downloads and
// compares the bytes, exercises the recycle bin, then deletes only the test
// repository it just created. It never looks at or removes any pre-existing
// repository, release or asset.
//
// Run only when the caller explicitly asks for it; this is a real write to
// GitHub, even though its footprint is temporary and self-cleaning.

#include "inc/env.hpp"
#include "inc/github.hpp"
#include "inc/store.hpp"

#include <cstdio>
#include <fstream>
#include <string>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

using namespace inc;

int main() {
  const std::string token = tokenFromEnv();
  if (token.empty()) { puts("SKIP: no token"); return 2; }

  GitHub gh(token);
  std::string error;
  if (!gh.me(&error)) { printf("FAIL: GitHub identity: %s\n", error.c_str()); return 1; }

  const std::string repo = "inc_cpp_smoke_" + std::to_string((long long)GetTickCount64());
  if (!gh.createRepo(repo, true, &error)) { printf("FAIL: create private test repo: %s\n", error.c_str()); return 1; }

  std::wstring temp;
  wchar_t buf[MAX_PATH] = {0};
  DWORD n = GetTempPathW(MAX_PATH, buf);
  if (!n || n >= MAX_PATH) { printf("FAIL: temp path\n"); gh.deleteRepo(gh.login(), repo, nullptr); return 1; }
  temp.assign(buf, n);
  temp += L"inc-store-smoke-" + std::to_wstring(GetTickCount64());
  CreateDirectoryW(temp.c_str(), nullptr);
  const std::wstring source = temp + L"\\source.txt";
  const std::wstring target = temp + L"\\roundtrip.txt";
  const std::string payload = "Infinity.Inc C++ cloud round-trip\nline two\n";
  FILE* f = _wfopen(source.c_str(), L"wb");
  if (!f) { printf("FAIL: create source file\n"); gh.deleteRepo(gh.login(), repo, nullptr); return 1; }
  fwrite(payload.data(), 1, payload.size(), f);
  fclose(f);

  StoreConfig cfg;
  cfg.repoPrefix = repo;
  Store writer(gh, gh.login(), cfg);
  if (!writer.pull(&error) || !writer.put(toUtf8(source), "/cpp-smoke.txt", &error) || !writer.flush(&error)) {
    printf("FAIL: upload: %s\n", error.c_str());
    DeleteFileW(source.c_str()); RemoveDirectoryW(temp.c_str());
    gh.deleteRepo(gh.login(), repo, nullptr);
    return 1;
  }

  Store reader(gh, gh.login(), cfg);
  if (!reader.pull(&error) || !reader.get("/cpp-smoke.txt", toUtf8(target), true, &error)) {
    printf("FAIL: download/manifest: %s\n", error.c_str());
    DeleteFileW(source.c_str()); DeleteFileW(target.c_str()); RemoveDirectoryW(temp.c_str());
    gh.deleteRepo(gh.login(), repo, nullptr);
    return 1;
  }
  FILE* rf = _wfopen(target.c_str(), L"rb");
  char got[128] = {0};
  size_t bytes = rf ? fread(got, 1, sizeof(got), rf) : 0;
  if (rf) fclose(rf);
  if (std::string(got, bytes) != payload) {
    printf("FAIL: byte comparison\n");
    DeleteFileW(source.c_str()); DeleteFileW(target.c_str()); RemoveDirectoryW(temp.c_str());
    gh.deleteRepo(gh.login(), repo, nullptr);
    return 1;
  }

  if (!reader.remove("/cpp-smoke.txt", false, &error) || !reader.flush(&error) ||
      reader.listTrash().empty() || !reader.purge("/cpp-smoke.txt", &error) || !reader.flush(&error)) {
    printf("FAIL: recycle-bin round-trip: %s\n", error.c_str());
    DeleteFileW(source.c_str()); DeleteFileW(target.c_str()); RemoveDirectoryW(temp.c_str());
    gh.deleteRepo(gh.login(), repo, nullptr);
    return 1;
  }

  DeleteFileW(source.c_str());
  DeleteFileW(target.c_str());
  RemoveDirectoryW(temp.c_str());
  if (!gh.deleteRepo(gh.login(), repo, &error)) {
    printf("FAIL: test repo cleanup: %s (repo %s)\n", error.c_str(), repo.c_str());
    return 1;
  }
  printf("PASS: manifest, upload, streaming download, SHA-256, recycle, purge; test repo removed\n");
  return 0;
}
