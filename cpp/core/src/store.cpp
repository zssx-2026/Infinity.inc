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

// A stable, short fingerprint of a cloud path. Part asset names are built from
// it so that two files with the same base name - /a/report.pdf and
// /b/report.pdf - never land on the same asset name and delete each other.
// FNV-1a is chosen over the SHA-256 already in the file because this is only a
// naming tie-breaker, not a content check: it must be cheap and deterministic,
// and a collision would merely reintroduce the bug it fixes, not corrupt data.
std::string shortHash(const std::string& s) {
  uint64_t h = 1469598103934665603ULL;
  for (unsigned char c : s) { h ^= c; h *= 1099511628211ULL; }
  char buf[24];
  snprintf(buf, sizeof(buf), "%016llx", (unsigned long long)h);
  return buf;
}

// The N in a "manifest-vN" tag, or 0 for anything else. pull sorts releases
// with it so the newest snapshot is merged first regardless of the order the
// API happens to return.
int manifestVolume(const std::string& tag) {
  const std::string p = "manifest-v";
  if (!startsWith(tag, p)) return 0;
  return atoi(tag.c_str() + p.size());
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
  // A cloud we cannot list is not an empty cloud. listStorageRepos reports a
  // dead token or a network failure through error, and ignoring it here is
  // what let an expired token look like a freshly emptied drive.
  std::string e;
  repos_ = gh_.listStorageRepos(cfg_.repoPrefix, &e);
  if (!e.empty()) { if (error) *error = e; return false; }

  Json merged = emptyManifest();
  Json& mergedFiles = const_cast<Json&>(merged.get("files"));
  Json& mergedTrash = const_cast<Json&>(merged.get("trash"));
  std::vector<std::string> trashOrder;
  int maxVolume = 1;
  // Every manifest snapshot is kept rather than merged on sight. Telling a
  // deleted path from one that was never mentioned needs the order, and the
  // order is only known once every volume has been read.
  struct Snapshot { int vol; std::string repo; Json doc; };
  std::vector<Snapshot> snaps;

  for (const auto& repo : repos_) {
    std::string le;
    std::vector<Release> releases = gh_.listReleases(owner_, repo, 100, &le);
    if (!le.empty()) { if (error) *error = le; return false; }
    for (const auto& rel : releases) {
      long long assetId = 0;
      for (const Json& a : rel.assets.items()) if (a.s("name") == "file.json") { assetId = a.i("id"); break; }
      // A release without a manifest is ordinary - data-part releases and
      // volumes whose manifest has already been superseded look like this -
      // so this one skip is deliberate rather than a swallowed failure.
      if (!assetId) continue;
      std::string tmp = cacheDir() + "\\" + repo + "-" + std::to_string(rel.id) + ".json";
      std::string de;
      if (!gh_.downloadAsset(owner_, repo, assetId, tmp, &de)) {
        DeleteFileW(utf8ToPath(tmp).c_str());
        if (error) *error = de.empty() ? ("cannot download the manifest from " + repo) : de;
        return false;
      }
      FILE* in = _wfopen(utf8ToPath(tmp).c_str(), L"rb");
      if (!in) {
        DeleteFileW(utf8ToPath(tmp).c_str());
        if (error) *error = "cannot read the downloaded manifest from " + repo;
        return false;
      }
      std::ostringstream ss;
      char raw[1 << 16]; size_t read = 0;
      while ((read = fread(raw, 1, sizeof(raw), in)) != 0) ss.write(raw, (std::streamsize)read);
      fclose(in);
      bool ok = false;
      Json doc = Json::parse(ss.str(), &ok);
      DeleteFileW(utf8ToPath(tmp).c_str());
      if (!ok || !doc.isObject()) {
        if (error) *error = "the manifest in " + repo + " is not readable JSON";
        return false;
      }
      int vol = manifestVolume(rel.tag);
      if (vol <= 0) vol = (int)doc.i("volume", 1);
      snaps.push_back(Snapshot{vol, repo, doc});
    }
  }
  // Newest snapshot first, and the first snapshot that mentions a path decides
  // it. First-wins-if-absent cannot express a deletion: a file removed from the
  // newest manifest is still listed by the volume before it, so the next pull
  // put it back. Stopping at the first mention fixes that, and it also follows a
  // file that moved from one repository to another.
  std::stable_sort(snaps.begin(), snaps.end(),
                   [](const Snapshot& a, const Snapshot& b) { return a.vol > b.vol; });
  for (const auto& s : snaps) {
    for (const auto& kv : s.doc.get("files").entries()) {
      if (mergedFiles.has(kv.first) || mergedTrash.has(kv.first)) continue;
      mergedFiles.set(kv.first, kv.second);
    }
    for (const auto& kv : s.doc.get("trash").entries()) {
      if (mergedFiles.has(kv.first) || mergedTrash.has(kv.first)) continue;
      mergedTrash.set(kv.first, kv.second);
    }
    for (const Json& k : s.doc.get("trashOrder").items()) {
      std::string key = k.str();
      if (std::find(trashOrder.begin(), trashOrder.end(), key) == trashOrder.end()) trashOrder.push_back(key);
    }
  }
  // A tombstone has to outlive the snapshot that recorded it, or an older
  // volume brings the file back the moment the newest one stops mentioning it.
  for (const auto& kv : mergedTrash.entries()) {
    if (std::find(trashOrder.begin(), trashOrder.end(), kv.first) == trashOrder.end()) trashOrder.push_back(kv.first);
  }
  maxVolume = snaps.empty() ? 1 : snaps[0].vol;

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
  // A listing that failed must not be read as "no repositories yet": that
  // would send this write to a brand-new repo and make the existing cloud look
  // as though it had never existed.
  if (repos_.empty()) {
    std::string e;
    repos_ = gh_.listStorageRepos(cfg_.repoPrefix, &e);
    if (!e.empty()) { if (error) *error = e; return false; }
  }
  for (const auto& r : repos_) {
    std::vector<Release> rels = gh_.listReleases(owner_, r, cfg_.maxReleases + 1, nullptr);
    if ((int)rels.size() < cfg_.maxReleases) { repo = r; return true; }
  }
  repo = cfg_.repoPrefix + randomSuffix(16);
  /*
   * A storage repository is private, always.
   *
   * These repositories hold the user's files. Creating one as public publishes
   * everything put into it to anyone who finds the repository, which is not a
   * setting a person should have to remember to change - and the upload does
   * not fail loudly enough afterwards for them to notice. There is no option
   * for it and no reason to want it: the files are the user's.
   */
  if (!gh_.createRepo(repo, true, error)) return false;
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
    char ix[16]; snprintf(ix, sizeof(ix), "%05llu", (unsigned long long)i);
    std::string tag = "part-" + std::string(ix);
    std::string e;
    Release rel = gh_.releaseByTag(owner_, repo, tag, nullptr);
    if (!rel.id && !gh_.createRelease(owner_, repo, tag, tag, &e)) { if (error) *error = e; return false; }
    if (!rel.id) rel = gh_.releaseByTag(owner_, repo, tag, &e);
    if (!rel.id) { if (error) *error = e.empty() ? "cannot find created release" : e; return false; }

    // The full cloud path, not just its base name, goes into the asset name:
    // /a/report.pdf and /b/report.pdf must not share one, or the second upload
    // deletes the first while the manifest still points at it. The hash keeps
    // the name short and unique, the base name keeps it readable.
    std::string asset = baseName(cp) + "." + shortHash(cp) + "." + ix + ".part";
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
  // Copy the old parts before the manifest entry is replaced: files.set() can
  // move the entry out from under prev, and we still need the old asset ids.
  std::vector<Json> prevParts;
  if (prev && prev->s("type") == "file") prevParts = prev->get("parts").items();
  Json entry = fileEntry(cp, "file", size, hash, [&]() { Json a = Json::array(); for (const auto& p : parts) a.push(p); return a; }(), prev);
  Json& files = const_cast<Json&>(manifest_.get("files"));
  files.set(cp, entry);
  // A part the new version does not name again is now unreachable: the file
  // shrank, or its asset name changed with the collision fix. Deleting it
  // stops the release from accumulating orphans. Parts the loop above already
  // replaced are skipped by name; a delete that fails here leaves an orphan but
  // the stored file is already correct, so it must not fail the whole put.
  for (const Json& part : prevParts) {
    bool reused = false;
    for (const Json& p : parts) if (p.s("asset") == part.s("asset")) { reused = true; break; }
    if (!reused) gh_.deleteAsset(owner_, part.s("repo"), part.i("assetId"), nullptr);
  }
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
  // A record is dropped only once every one of its parts is really gone.
  // Removing it while a delete failed turned a failed purge into a silent
  // leak: the asset stayed in the cloud with nothing left pointing at it.
  Json newTrash = Json::object();
  bool failed = false;
  std::string firstError;
  for (const auto& e : trash.entries()) {
    if (std::find(keys.begin(), keys.end(), e.first) == keys.end()) { newTrash.set(e.first, e.second); continue; }
    bool gone = true;
    for (const Json& part : e.second.get("parts").items()) {
      std::string de;
      if (!gh_.deleteAsset(owner_, part.s("repo"), part.i("assetId"), &de)) {
        gone = false;
        if (firstError.empty()) firstError = de;
      }
    }
    if (gone) continue;
    newTrash.set(e.first, e.second);
    failed = true;
  }
  manifest_.set("trash", newTrash);
  Json order = Json::array();
  for (const Json& k : manifest_.get("trashOrder").items()) if (newTrash.has(k.str())) order.push(k);
  manifest_.set("trashOrder", order);
  if (failed) {
    if (error) *error = firstError.empty() ? "some assets could not be deleted" : firstError;
    return false;
  }
  return true;
}

bool Store::saveManifestToRepo(const std::string& repo, std::string* error) {
  /*
   * The replacement manifest is written to a fresh volume, and only then is
   * the previous volume's file.json removed.
   *
   * A release cannot hold two assets with the same name, so a replacement
   * cannot be staged inside the release it replaces - uploading the new
   * file.json would either be rejected or, as the old code did, require
   * deleting the live manifest first and leaving the cloud with none. Moving
   * to a new volume is what lets the new manifest exist before the old one
   * goes away, so a concurrent pull never meets a release that has lost its
   * manifest.
   *
   * The volume tag doubles as a coarse compare-and-swap: two writers that
   * start from the same volume aim at the same tag, so one createRelease or
   * upload fails instead of silently overwriting the other. What remains
   * unguarded: a writer that started from a volume another writer has already
   * superseded will delete that superseded manifest as its "old" one. There is
   * no If-Match here because the HTTP layer exposes no conditional requests.
   */
  long long next = manifest_.i("volume", 1) + 1;
  std::string tag = "manifest-v" + std::to_string(next);
  std::string e;
  Release rel = gh_.releaseByTag(owner_, repo, tag, nullptr);
  if (!rel.id && !gh_.createRelease(owner_, repo, tag, tag, &e)) { if (error) *error = e; return false; }
  if (!rel.id) rel = gh_.releaseByTag(owner_, repo, tag, &e);
  if (!rel.id) { if (error) *error = e.empty() ? "cannot find manifest release" : e; return false; }

  std::string tmp = cacheDir() + "\\file.json";
  manifest_.set("updated", Json((long long)unixMillis()));
  manifest_.set("volume", Json(next));
  FILE* f = _wfopen(utf8ToPath(tmp).c_str(), L"wb");
  if (!f) { if (error) *error = "cannot write manifest"; return false; }
  std::string bytes = manifest_.dump(2);
  bool wrote = fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
  fclose(f);
  if (!wrote) { DeleteFileW(utf8ToPath(tmp).c_str()); if (error) *error = "manifest write failed"; return false; }

  // Upload the replacement before touching the old one.
  long long id = gh_.uploadAsset(owner_, repo, rel.id, tmp, "file.json", error);
  DeleteFileW(utf8ToPath(tmp).c_str());
  if (!id) return false;

  // Now the superseded manifests can go. We remove every older manifest this
  // repo still holds rather than only volume next-1, because a repo can carry
  // a stale manifest at a non-adjacent volume once writers have moved between
  // repositories. A failure here leaves an older snapshot behind; pull orders
  // volumes newest-first, so it is shadowed and harmless, and is not worth
  // failing a write that has already succeeded.
  for (const Release& stale : gh_.listReleases(owner_, repo, 100, nullptr)) {
    if (manifestVolume(stale.tag) >= next) continue;
    for (const Json& a : stale.assets.items()) if (a.s("name") == "file.json") {
      gh_.deleteAsset(owner_, repo, a.i("id"), nullptr);
      break;
    }
  }
  return true;
}

bool Store::flush(std::string* error) {
  std::string repo;
  if (!ensureRepo(repo, error)) return false;
  return saveManifestToRepo(repo, error);
}

}  // namespace inc
