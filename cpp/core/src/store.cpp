// store.cpp - the GitHub-backed cloud filesystem.

#include "inc/store.hpp"
#include "inc/env.hpp"
#include "inc/str.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <cstdio>
#include <random>
#include <sstream>

namespace inc {

namespace {

long long unixMillis();

Json emptyManifest() {
  Json j = Json::object();
  j.set("version", Json(1));
  j.set("volume", Json(1));
  j.set("updated", Json((long long)unixMillis()));
  j.set("files", Json::object());
  j.set("parts", Json::object());
  j.set("nextPart", Json(1));
  j.set("repos", Json::array());
  j.set("trash", Json::object());
  j.set("trashOrder", Json::array());
  return j;
}

long long unixMillis() {
  FILETIME ft;
  GetSystemTimeAsFileTime(&ft);
  ULARGE_INTEGER u;
  u.LowPart = ft.dwLowDateTime;
  u.HighPart = ft.dwHighDateTime;
  return (long long)(u.QuadPart / 10000ULL - 11644473600000ULL);
}

std::string pathToUtf8(const std::wstring& w) { return toUtf8(w); }
std::wstring utf8ToPath(const std::string& s) { return toWide(s); }

bool fileSize(const std::string& p, uint64_t& n) {
  WIN32_FILE_ATTRIBUTE_DATA d;
  if (!GetFileAttributesExW(utf8ToPath(p).c_str(), GetFileExInfoStandard, &d)) return false;
  ULARGE_INTEGER x;
  x.HighPart = d.nFileSizeHigh;
  x.LowPart = d.nFileSizeLow;
  n = x.QuadPart;
  return !(d.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY);
}

bool ensureDir(const std::string& p) {
  std::wstring w = utf8ToPath(p);
  if (CreateDirectoryW(w.c_str(), nullptr)) return true;
  DWORD e = GetLastError();
  if (e == ERROR_ALREADY_EXISTS) return true;
  size_t slash = w.find_last_of(L"\\/");
  if (slash != std::wstring::npos && slash > 2) {
    if (!ensureDir(pathToUtf8(w.substr(0, slash)))) return false;
    if (CreateDirectoryW(w.c_str(), nullptr)) return true;
    return GetLastError() == ERROR_ALREADY_EXISTS;
  }
  return false;
}

std::string randomSuffix(size_t len) {
  static const char alphabet[] = "abcdefghijklmnopqrstuvwxyz0123456789";
  std::random_device rd;
  std::mt19937 gen(rd());
  std::uniform_int_distribution<size_t> dist(0, sizeof(alphabet) - 2);
  std::string out;
  for (size_t i = 0; i < len; i++) out.push_back(alphabet[dist(gen)]);
  return out;
}

std::string sha256File(const std::string& p, std::string* error) {
  BCRYPT_ALG_HANDLE alg = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD objLen = 0, got = 0, hashLen = 0;
  if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) {
    if (error) *error = "cannot open SHA-256 provider";
    return "";
  }
  BCryptGetProperty(alg, BCRYPT_OBJECT_LENGTH, (PUCHAR)&objLen, sizeof(objLen), &got, 0);
  BCryptGetProperty(alg, BCRYPT_HASH_LENGTH, (PUCHAR)&hashLen, sizeof(hashLen), &got, 0);
  std::vector<UCHAR> obj(objLen), digest(hashLen);
  if (BCryptCreateHash(alg, &hash, obj.data(), objLen, nullptr, 0, 0) < 0) {
    BCryptCloseAlgorithmProvider(alg, 0);
    if (error) *error = "cannot create SHA-256 hash";
    return "";
  }
  FILE* f = _wfopen(utf8ToPath(p).c_str(), L"rb");
  if (!f) {
    BCryptDestroyHash(hash); BCryptCloseAlgorithmProvider(alg, 0);
    if (error) *error = "cannot open file for hashing: " + p;
    return "";
  }
  char buf[1 << 16];
  size_t n = 0;
  while ((n = fread(buf, 1, sizeof(buf), f)) != 0) BCryptHashData(hash, (PUCHAR)buf, (ULONG)n, 0);
  fclose(f);
  NTSTATUS st = BCryptFinishHash(hash, digest.data(), hashLen, 0);
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(alg, 0);
  if (st < 0) { if (error) *error = "cannot finish SHA-256"; return ""; }
  static const char* hex = "0123456789abcdef";
  std::string out;
  for (UCHAR c : digest) { out.push_back(hex[c >> 4]); out.push_back(hex[c & 15]); }
  return out;
}

bool copyRange(const std::string& src, const std::string& dst, uint64_t start, uint64_t length) {
  FILE* in = _wfopen(utf8ToPath(src).c_str(), L"rb");
  FILE* out = _wfopen(utf8ToPath(dst).c_str(), L"wb");
  if (!in || !out) { if (in) fclose(in); if (out) fclose(out); return false; }
  if (_fseeki64(in, (long long)start, SEEK_SET) != 0) { fclose(in); fclose(out); return false; }
  char buf[1 << 16];
  uint64_t left = length;
  while (left) {
    size_t want = (size_t)std::min<uint64_t>(sizeof(buf), left);
    size_t n = fread(buf, 1, want, in);
    if (!n || fwrite(buf, 1, n, out) != n) { fclose(in); fclose(out); return false; }
    left -= n;
  }
  fclose(in); fclose(out);
  return true;
}

Json fileEntry(const std::string& p, const std::string& type, uint64_t size,
               const std::string& hash, const Json& parts, const Json* previous = nullptr) {
  Json e = Json::object();
  e.set("name", Json(Store::baseName(p)));
  e.set("path", Json(p));
  e.set("size", Json((long long)size));
  e.set("hash", Json(hash));
  e.set("type", Json(type));
  e.set("created", Json(previous && !previous->get("created").isNull() ? previous->i("created") : (long long)unixMillis()));
  e.set("modified", Json((long long)unixMillis()));
  e.set("parts", parts);
  return e;
}

void mergeObject(Json& dst, const Json& src) {
  if (!src.isObject()) return;
  for (const auto& e : src.entries()) if (!dst.has(e.first)) dst.set(e.first, e.second);
}

}  // namespace

Store::Store(GitHub& gh, const std::string& owner, StoreConfig config)
  : gh_(gh), owner_(owner), cfg_(config), manifest_(emptyManifest()) {}

std::string Store::normalizePath(const std::string& p) {
  std::vector<std::string> parts;
  for (const auto& raw : split(replaceAll(p, "\\", "/"), '/')) {
    if (raw.empty() || raw == ".") continue;
    if (raw == "..") { if (!parts.empty()) parts.pop_back(); continue; }
    parts.push_back(raw);
  }
  return "/" + join(parts, "/");
}

std::string Store::parentPath(const std::string& p) {
  std::string n = normalizePath(p);
  if (n == "/") return "";
  size_t i = n.find_last_of('/');
  return i <= 0 ? "/" : n.substr(0, i);
}

std::string Store::baseName(const std::string& p) {
  std::string n = normalizePath(p);
  size_t i = n.find_last_of('/');
  return i == std::string::npos ? n : n.substr(i + 1);
}

std::string Store::cacheDir() const {
  std::string root = getEnv("LOCALAPPDATA");
  if (root.empty()) root = getEnv("USERPROFILE") + "\\AppData\\Local";
  std::string d = root + "\\Infinity.Inc\\cache\\" + (owner_.empty() ? "anonymous" : owner_);
  ensureDir(d);
  return d;
}

const Json* Store::stat(const std::string& cloudPath) const {
  const Json& files = manifest_.get("files");
  std::string p = normalizePath(cloudPath);
  if (!files.has(p)) return nullptr;
  // Json::get returns a reference, but exposing a pointer to it is safe while
  // the manifest does not mutate. Caller only reads this entry.
  return &files.get(p);
}

uint64_t Store::totalBytes() const {
  uint64_t total = 0;
  const Json& files = manifest_.get("files");
  for (const auto& e : files.entries()) total += (uint64_t)std::max<long long>(0, e.second.i("size"));
  return total;
}

std::vector<Json> Store::list(const std::string& cloudPath, bool recursive) const {
  std::vector<Json> out;
  const std::string cp = normalizePath(cloudPath);
  const std::string prefix = cp == "/" ? "/" : cp + "/";
  const Json& files = manifest_.get("files");
  for (const auto& e : files.entries()) {
    if (e.first == cp) continue;
    if (recursive) {
      if (!startsWith(e.first, prefix)) continue;
    } else if (parentPath(e.first) != cp) continue;
    out.push_back(e.second);
  }
  std::sort(out.begin(), out.end(), [](const Json& a, const Json& b) { return lower(a.s("name")) < lower(b.s("name")); });
  return out;
}

bool Store::pull(std::string* error) {
  repos_ = gh_.listStorageRepos(cfg_.repoPrefix, error);
  Json merged = emptyManifest();
  Json& mergedFiles = const_cast<Json&>(merged.get("files"));
  Json& mergedTrash = const_cast<Json&>(merged.get("trash"));
  std::vector<std::string> trashOrder;
  int maxVolume = 1;

  for (const auto& repo : repos_) {
    std::vector<Release> releases = gh_.listReleases(owner_, repo, 100, error);
    for (const auto& rel : releases) {
      long long assetId = 0;
      for (const Json& a : rel.assets.items()) if (a.s("name") == "file.json") { assetId = a.i("id"); break; }
      if (!assetId) continue;
      std::string tmp = cacheDir() + "\\" + repo + "-" + std::to_string(rel.id) + ".json";
      std::string e;
      if (!gh_.downloadAsset(owner_, repo, assetId, tmp, &e)) continue;
      FILE* in = _wfopen(utf8ToPath(tmp).c_str(), L"rb");
      if (!in) { DeleteFileW(utf8ToPath(tmp).c_str()); continue; }
      std::ostringstream ss;
      char raw[1 << 16]; size_t read = 0;
      while ((read = fread(raw, 1, sizeof(raw), in)) != 0) ss.write(raw, (std::streamsize)read);
      fclose(in);
      bool ok = false;
      Json doc = Json::parse(ss.str(), &ok);
      DeleteFileW(utf8ToPath(tmp).c_str());
      if (!ok || !doc.isObject()) continue;
      mergeObject(mergedFiles, doc.get("files"));
      mergeObject(mergedTrash, doc.get("trash"));
      int vol = (int)doc.i("volume", 1);
      if (vol > maxVolume) maxVolume = vol;
      for (const Json& k : doc.get("trashOrder").items()) {
        std::string s = k.str();
        if (std::find(trashOrder.begin(), trashOrder.end(), s) == trashOrder.end()) trashOrder.push_back(s);
      }
    }
  }
  Json repos = Json::array();
  for (const auto& r : repos_) repos.push(Json(r));
  merged.set("repos", repos);
  merged.set("volume", Json(maxVolume));
  Json order = Json::array();
  for (const auto& k : trashOrder) order.push(Json(k));
  merged.set("trashOrder", order);
  merged.set("updated", Json((long long)unixMillis()));
  manifest_ = merged;
  return true;
}

bool Store::ensureRepo(std::string& repo, std::string* error) {
  if (repos_.empty()) repos_ = gh_.listStorageRepos(cfg_.repoPrefix, error);
  for (const auto& r : repos_) {
    std::vector<Release> rels = gh_.listReleases(owner_, r, cfg_.maxReleases + 1, nullptr);
    if ((int)rels.size() < cfg_.maxReleases) { repo = r; return true; }
  }
  repo = cfg_.repoPrefix + randomSuffix(16);
  if (!gh_.createRepo(repo, false, error)) return false;
  repos_.push_back(repo);
  return true;
}

bool Store::ensureParents(const std::string& p, std::string* error) {
  std::vector<std::string> chain;
  std::string cur = parentPath(p);
  while (!cur.empty() && cur != "/") {
    chain.push_back(cur);
    cur = parentPath(cur);
  }
  for (auto it = chain.rbegin(); it != chain.rend(); ++it) if (!mkdir(*it, error)) return false;
  return true;
}

bool Store::mkdir(const std::string& cloudPath, std::string* error) {
  std::string p = normalizePath(cloudPath);
  if (p == "/") return true;
  Json& files = const_cast<Json&>(manifest_.get("files"));
  if (files.has(p)) return true;
  if (!ensureParents(p, error)) return false;
  Json emptyParts = Json::array();
  files.set(p, fileEntry(p, "folder", 0, "", emptyParts));
  return true;
}

bool Store::put(const std::string& localPath, const std::string& cloudPath, std::string* error) {
  std::string cp = normalizePath(cloudPath);
  uint64_t size = 0;
  if (!fileSize(localPath, size)) { if (error) *error = "not a file: " + localPath; return false; }
  std::string hash = sha256File(localPath, error);
  if (hash.empty()) return false;
  std::string repo;
  if (!ensureRepo(repo, error)) return false;

  std::vector<Json> parts;
  uint64_t count = std::max<uint64_t>(1, (size + cfg_.chunkBytes - 1) / cfg_.chunkBytes);
  for (uint64_t i = 0; i < count; i++) {
    uint64_t start = i * cfg_.chunkBytes;
    uint64_t length = size == 0 ? 0 : std::min(cfg_.chunkBytes, size - start);
    std::string tag = "part-" + padRight("", 5); // replaced below with zero padding
    char ix[16]; snprintf(ix, sizeof(ix), "%05llu", (unsigned long long)i);
    tag = "part-" + std::string(ix);
    std::string e;
    Release rel = gh_.releaseByTag(owner_, repo, tag, nullptr);
    if (!rel.id && !gh_.createRelease(owner_, repo, tag, tag, &e)) { if (error) *error = e; return false; }
    if (!rel.id) rel = gh_.releaseByTag(owner_, repo, tag, &e);
    if (!rel.id) { if (error) *error = e.empty() ? "cannot find created release" : e; return false; }

    std::string asset = baseName(cp) + "." + ix + ".part";
    for (const Json& a : rel.assets.items()) if (a.s("name") == asset) {
      if (!gh_.deleteAsset(owner_, repo, a.i("id"), &e)) { if (error) *error = e; return false; }
      break;
    }
    std::string slice = cacheDir() + "\\slice-" + std::to_string(unixMillis()) + "-" + ix;
    if (!copyRange(localPath, slice, start, length)) { if (error) *error = "cannot create upload part"; return false; }
    long long assetId = gh_.uploadAsset(owner_, repo, rel.id, slice, asset, &e);
    DeleteFileW(utf8ToPath(slice).c_str());
    if (!assetId) { if (error) *error = e; return false; }

    Json part = Json::object();
    part.set("repo", Json(repo)); part.set("release", Json(tag)); part.set("asset", Json(asset));
    part.set("assetId", Json(assetId)); part.set("start", Json((long long)start)); part.set("length", Json((long long)length));
    parts.push_back(part);
  }

  const Json* prev = stat(cp);
  Json entry = fileEntry(cp, "file", size, hash, [&]() { Json a = Json::array(); for (const auto& p : parts) a.push(p); return a; }(), prev);
  Json& files = const_cast<Json&>(manifest_.get("files"));
  files.set(cp, entry);
  return ensureParents(cp, error);
}

bool Store::get(const std::string& cloudPath, const std::string& localPath, bool hashCheck, std::string* error) {
  std::string cp = normalizePath(cloudPath);
  const Json* e = stat(cp);
  if (!e) { if (error) *error = "file not found: " + cp; return false; }
  if (e->s("type") == "folder") { if (error) *error = "that is a folder"; return false; }
  std::string parent = localPath;
  size_t slash = parent.find_last_of("\\/");
  if (slash != std::string::npos) ensureDir(parent.substr(0, slash));
  FILE* out = _wfopen(utf8ToPath(localPath).c_str(), L"wb+");
  if (!out) { if (error) *error = "cannot open destination: " + localPath; return false; }
  bool good = true;
  const Json& parts = e->get("parts");
  for (size_t i = 0; i < parts.size(); i++) {
    const Json& part = parts[i];
    std::string tmp = cacheDir() + "\\part-" + std::to_string(unixMillis()) + "-" + std::to_string(i);
    std::string err;
    if (!gh_.downloadAsset(owner_, part.s("repo"), part.i("assetId"), tmp, &err)) {
      if (error) *error = err;
      good = false;
      break;
    }
    FILE* in = _wfopen(utf8ToPath(tmp).c_str(), L"rb");
    if (!in) { DeleteFileW(utf8ToPath(tmp).c_str()); if (error) *error = "cannot read downloaded part"; good = false; break; }
    _fseeki64(out, part.i("start"), SEEK_SET);
    char buf[1 << 16]; size_t n = 0;
    while ((n = fread(buf, 1, sizeof(buf), in)) != 0) if (fwrite(buf, 1, n, out) != n) { good = false; break; }
    fclose(in); DeleteFileW(utf8ToPath(tmp).c_str());
    if (!good) { if (error) *error = "cannot write destination"; break; }
  }
  fclose(out);
  if (!good) return false;
  if (hashCheck) {
    std::string got = sha256File(localPath, error);
    if (got.empty()) return false;
    if (got != e->s("hash")) { if (error) *error = "hash mismatch"; return false; }
  }
  return true;
}

bool Store::remove(const std::string& cloudPath, bool permanent, std::string* error) {
  std::string cp = normalizePath(cloudPath);
  Json& files = const_cast<Json&>(manifest_.get("files"));
  if (!files.has(cp)) { if (error) *error = "file not found: " + cp; return false; }
  const Json root = files.get(cp);
  std::vector<std::string> victims{cp};
  if (root.s("type") == "folder") {
    std::string prefix = cp == "/" ? "/" : cp + "/";
    for (const auto& e : files.entries()) if (e.first != cp && startsWith(e.first, prefix)) victims.push_back(e.first);
  }
  Json& trash = const_cast<Json&>(manifest_.get("trash"));
  Json& order = const_cast<Json&>(manifest_.get("trashOrder"));
  for (const auto& v : victims) {
    if (!files.has(v)) continue;
    Json entry = files.get(v);
    if (permanent) {
      for (const Json& part : entry.get("parts").items()) {
        std::string e;
        if (!gh_.deleteAsset(owner_, part.s("repo"), part.i("assetId"), &e) && !e.empty()) {
          if (error) *error = e;
          return false;
        }
      }
    } else {
      entry.set("deletedAt", Json((long long)unixMillis()));
      entry.set("originalPath", Json(v));
      trash.set(v, entry);
      order.push(Json(v));
    }
    // JSON has no erase yet; rebuild the object below.
  }
  Json newFiles = Json::object();
  for (const auto& e : files.entries()) if (std::find(victims.begin(), victims.end(), e.first) == victims.end()) newFiles.set(e.first, e.second);
  manifest_.set("files", newFiles);
  return true;
}

std::vector<Json> Store::listTrash() const {
  std::vector<Json> out;
  const Json& trash = manifest_.get("trash");
  for (const Json& key : manifest_.get("trashOrder").items()) if (trash.has(key.str())) out.push_back(trash.get(key.str()));
  std::sort(out.begin(), out.end(), [](const Json& a, const Json& b) { return a.i("deletedAt") > b.i("deletedAt"); });
  return out;
}

bool Store::restore(const std::string& cloudPath, std::string* error) {
  std::string cp = normalizePath(cloudPath);
  Json& trash = const_cast<Json&>(manifest_.get("trash"));
  Json& files = const_cast<Json&>(manifest_.get("files"));
  if (!trash.has(cp)) { if (error) *error = "not in the recycle bin: " + cp; return false; }
  if (files.has(cp)) { if (error) *error = "something already lives at " + cp; return false; }
  Json entry = trash.get(cp);
  Json clean = Json::object();
  for (const auto& x : entry.entries()) if (x.first != "deletedAt" && x.first != "originalPath") clean.set(x.first, x.second);
  clean.set("modified", Json((long long)unixMillis()));
  files.set(cp, clean);
  Json newTrash = Json::object();
  for (const auto& x : trash.entries()) if (x.first != cp) newTrash.set(x.first, x.second);
  manifest_.set("trash", newTrash);
  Json order = Json::array();
  for (const Json& k : manifest_.get("trashOrder").items()) if (k.str() != cp) order.push(k);
  manifest_.set("trashOrder", order);
  return ensureParents(cp, error);
}

bool Store::purge(const std::string& cloudPath, std::string* error) {
  Json& trash = const_cast<Json&>(manifest_.get("trash"));
  std::vector<std::string> keys;
  std::string cp = cloudPath.empty() ? "" : normalizePath(cloudPath);
  std::string prefix = cp.empty() ? "" : (cp == "/" ? "/" : cp + "/");
  for (const auto& e : trash.entries()) if (cp.empty() || e.first == cp || startsWith(e.first, prefix)) keys.push_back(e.first);
  for (const auto& k : keys) {
    const Json entry = trash.get(k);
    for (const Json& part : entry.get("parts").items()) {
      std::string e;
      if (!gh_.deleteAsset(owner_, part.s("repo"), part.i("assetId"), &e) && !e.empty() && error) *error = e;
    }
  }
  Json newTrash = Json::object();
  for (const auto& e : trash.entries()) if (std::find(keys.begin(), keys.end(), e.first) == keys.end()) newTrash.set(e.first, e.second);
  manifest_.set("trash", newTrash);
  Json order = Json::array();
  for (const Json& k : manifest_.get("trashOrder").items()) if (std::find(keys.begin(), keys.end(), k.str()) == keys.end()) order.push(k);
  manifest_.set("trashOrder", order);
  return true;
}

bool Store::saveManifestToRepo(const std::string& repo, std::string* error) {
  std::string tag = "manifest-v" + std::to_string(manifest_.i("volume", 1));
  Release rel = gh_.releaseByTag(owner_, repo, tag, nullptr);
  if (!rel.id && !gh_.createRelease(owner_, repo, tag, tag, error)) return false;
  if (!rel.id) rel = gh_.releaseByTag(owner_, repo, tag, error);
  if (!rel.id) { if (error && error->empty()) *error = "cannot find manifest release"; return false; }
  for (const Json& a : rel.assets.items()) if (a.s("name") == "file.json") {
    if (!gh_.deleteAsset(owner_, repo, a.i("id"), error)) return false;
    break;
  }
  std::string tmp = cacheDir() + "\\file.json";
  manifest_.set("updated", Json((long long)unixMillis()));
  FILE* f = _wfopen(utf8ToPath(tmp).c_str(), L"wb");
  if (!f) { if (error) *error = "cannot write manifest"; return false; }
  std::string bytes = manifest_.dump(2);
  bool wrote = fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
  fclose(f);
  if (!wrote) { DeleteFileW(utf8ToPath(tmp).c_str()); if (error) *error = "manifest write failed"; return false; }
  long long id = gh_.uploadAsset(owner_, repo, rel.id, tmp, "file.json", error);
  DeleteFileW(utf8ToPath(tmp).c_str());
  return id != 0;
}

bool Store::flush(std::string* error) {
  std::string repo;
  if (!ensureRepo(repo, error)) return false;
  return saveManifestToRepo(repo, error);
}

}  // namespace inc
