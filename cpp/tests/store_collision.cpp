// store_collision.cpp - proof that two files sharing a base name coexist.
//
// The bug this guards against is subtle and destructive: parts used to be
// named from the file's base name alone, so /a/report.pdf and /b/report.pdf
// produced the same asset name in the same release, and the second upload
// deleted the first while the manifest still pointed at it. This test makes a
// uniquely named private repository, uploads two same-named files with
// different bytes, and proves both come back intact - which only happens if
// their assets were kept apart.
//
// It also flushes twice, because the manifest write moved to a new volume so
// the replacement exists before the old one is removed; a pull after the
// second flush proves the tree survives that roll-over.
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

static bool writeFile(const std::wstring& path, const std::string& bytes) {
  FILE* f = _wfopen(path.c_str(), L"wb");
  if (!f) return false;
  bool ok = fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
  fclose(f);
  return ok;
}

static bool readFile(const std::wstring& path, std::string& out) {
  FILE* f = _wfopen(path.c_str(), L"rb");
  if (!f) return false;
  char buf[1 << 16];
  size_t n = 0;
  while ((n = fread(buf, 1, sizeof(buf), f)) != 0) out.append(buf, n);
  fclose(f);
  return true;
}

int main() {
  const std::string token = tokenFromEnv();
  if (token.empty()) { puts("SKIP: no token"); return 2; }

  GitHub gh(token);
  std::string error;
  if (!gh.me(&error)) { printf("FAIL: GitHub identity: %s\n", error.c_str()); return 1; }

  const std::string repo = "inc_cpp_collide_" + std::to_string((long long)GetTickCount64());
  if (!gh.createRepo(repo, true, &error)) { printf("FAIL: create private test repo: %s\n", error.c_str()); return 1; }

  std::wstring temp;
  wchar_t buf[MAX_PATH] = {0};
  DWORD n = GetTempPathW(MAX_PATH, buf);
  if (!n || n >= MAX_PATH) { printf("FAIL: temp path\n"); gh.deleteRepo(gh.login(), repo, nullptr); return 1; }
  temp.assign(buf, n);
  temp += L"inc-store-collision-" + std::to_wstring(GetTickCount64());
  CreateDirectoryW(temp.c_str(), nullptr);

  const std::wstring srcA = temp + L"\\srcA.pdf";
  const std::wstring srcB = temp + L"\\srcB.pdf";
  const std::wstring outA = temp + L"\\outA.pdf";
  const std::wstring outB = temp + L"\\outB.pdf";
  // Same base name, different folders and different bytes. If the two ever
  // shared an asset name, the second upload would have removed the first.
  const std::string payloadA = "first report: the quick brown fox\n";
  const std::string payloadB = "second report: jumps over the lazy dog\n";
  if (!writeFile(srcA, payloadA) || !writeFile(srcB, payloadB)) {
    printf("FAIL: create source files\n");
    gh.deleteRepo(gh.login(), repo, nullptr);
    return 1;
  }

  auto cleanup = [&]() {
    DeleteFileW(srcA.c_str()); DeleteFileW(srcB.c_str());
    DeleteFileW(outA.c_str()); DeleteFileW(outB.c_str());
    RemoveDirectoryW(temp.c_str());
    gh.deleteRepo(gh.login(), repo, nullptr);
  };

  StoreConfig cfg;
  cfg.repoPrefix = repo;
  Store writer(gh, gh.login(), cfg);
  if (!writer.pull(&error) ||
      !writer.put(toUtf8(srcA), "/a/report.pdf", &error) ||
      !writer.put(toUtf8(srcB), "/b/report.pdf", &error) ||
      !writer.flush(&error)) {
    printf("FAIL: upload: %s\n", error.c_str());
    cleanup();
    return 1;
  }

  // A second write rolls the manifest onto a new volume and deletes the one it
  // superseded; the tree must still be whole afterwards.
  if (!writer.put(toUtf8(srcA), "/a/report.pdf", &error) || !writer.flush(&error)) {
    printf("FAIL: re-flush: %s\n", error.c_str());
    cleanup();
    return 1;
  }

  Store reader(gh, gh.login(), cfg);
  if (!reader.pull(&error)) { printf("FAIL: pull: %s\n", error.c_str()); cleanup(); return 1; }
  const Json& files = reader.manifest().get("files");
  if (!files.has("/a/report.pdf") || !files.has("/b/report.pdf")) {
    printf("FAIL: manifest lost one of the colliding files\n");
    cleanup();
    return 1;
  }
  // hashCheck verifies each download against the SHA-256 recorded at upload.
  if (!reader.get("/a/report.pdf", toUtf8(outA), true, &error) ||
      !reader.get("/b/report.pdf", toUtf8(outB), true, &error)) {
    printf("FAIL: download: %s\n", error.c_str());
    cleanup();
    return 1;
  }

  std::string gotA, gotB;
  if (!readFile(outA, gotA) || !readFile(outB, gotB) || gotA != payloadA || gotB != payloadB) {
    printf("FAIL: bytes differ from what was uploaded\n");
    cleanup();
    return 1;
  }

  cleanup();
  printf("PASS: two files named report.pdf round-tripped with distinct SHA-256; test repo removed\n");
  return 0;
}
