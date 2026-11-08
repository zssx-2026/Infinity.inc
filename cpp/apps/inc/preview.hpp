// preview.hpp - reading a remote file in pieces, so a preview can start before
// the file has finished arriving.
//
// A cloud file lives in GitHub release assets. The asset API hands out a signed
// URL when it is asked with "Accept: application/octet-stream", and that signed
// URL answers Range requests without the token. Everything here is built on
// that one fact.
//
// It is header-only on purpose: turning the streaming preview on for an
// application is then one include and a few routes, with no build change.
//
// The rules this file implements, from the task contract:
//   * 256 KiB per Range request;
//   * 8 s per chunk, two retries, then a clear error - never a silent hang;
//   * a chunk that cannot be read is never passed off as one that was: every
//     read either returns exactly the window asked for or fails;
//   * cancellation is a flag checked before every request and between retries;
//     an in-flight request finishes within its own 8 s timeout (a synchronous
//     WinHTTP call cannot be aborted from another thread without tearing down
//     the handle underneath it, which is not worth the crash).

#pragma once

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <string>
#include <utility>
#include <vector>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include "inc/github.hpp"
#include "inc/http.hpp"
#include "inc/json.hpp"
#include "inc/store.hpp"
#include "inc/str.hpp"

namespace inc {

// ------------------------------------------------------------------ the numbers

// The contract's numbers live in one place so a route, a test and the page all
// read the same window and the same timeout.
constexpr long long kPreviewChunkBytes = 256 * 1024;      // one Range request
constexpr int kPreviewChunkTimeoutMs = 8000;              // per window, 8 s
constexpr int kPreviewChunkRetries = 2;                   // two retries, then fail
constexpr long long kPreviewZipTailBytes = 64 * 1024;     // the zip tail read
constexpr long long kPreviewEntryMaxBytes = 64LL * 1024 * 1024;  // one entry fetch

// ------------------------------------------------------------------ the kinds

enum class PreviewKind {
  Text,       // read from the first byte, line by line
  Image,      // needs the first chunk to start decoding
  Audio,
  Video,
  Pdf,
  Zip,        // only the central directory at the end is needed to list it
  WholeFile   // nothing can be shown before the whole file is here
};

inline std::string previewExtension(const std::string& path) {
  const size_t slash = path.find_last_of("/\\");
  const std::string base = (slash == std::string::npos) ? path : path.substr(slash + 1);
  const size_t dot = base.find_last_of('.');
  if (dot == std::string::npos || dot + 1 >= base.size()) return std::string();
  return lower(base.substr(dot));
}

inline PreviewKind previewKind(const std::string& path) {
  const std::string ext = previewExtension(path);
  static const char* text[] = {
    ".txt", ".md", ".json", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml",
    ".ini", ".conf", ".cfg", ".toml", ".sql", ".c", ".h", ".hpp", ".cpp", ".cc",
    ".cs", ".java", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb",
    ".go", ".rs", ".php", ".sh", ".bash", ".ps1", ".bat", ".cmd", ".css",
    ".html", ".htm", ".srt", ".vtt", ".env", ".gitignore"
  };
  static const char* image[] = { ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp" };
  static const char* audio[] = { ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac" };
  static const char* video[] = { ".mp4", ".webm", ".mkv", ".mov" };
  for (const char* e : text) if (ext == e) return PreviewKind::Text;
  for (const char* e : image) if (ext == e) return PreviewKind::Image;
  for (const char* e : audio) if (ext == e) return PreviewKind::Audio;
  for (const char* e : video) if (ext == e) return PreviewKind::Video;
  if (ext == ".pdf") return PreviewKind::Pdf;
  if (ext == ".zip") return PreviewKind::Zip;
  return PreviewKind::WholeFile;
}

inline const char* previewKindName(PreviewKind kind) {
  switch (kind) {
    case PreviewKind::Text: return "text";
    case PreviewKind::Image: return "image";
    case PreviewKind::Audio: return "audio";
    case PreviewKind::Video: return "video";
    case PreviewKind::Pdf: return "pdf";
    case PreviewKind::Zip: return "zip";
    default: return "whole-file";
  }
}

// ------------------------------------------------------------------ the file

struct PreviewPart {
  std::string repo;
  long long assetId = 0;
  long long start = 0;      // where this part begins in the file
  long long length = 0;
};

struct PreviewSource {
  std::string path;
  std::string name;
  long long size = 0;
  PreviewKind kind = PreviewKind::WholeFile;
  std::vector<PreviewPart> parts;
};

inline std::string previewName(const std::string& path) {
  const size_t slash = path.find_last_of("/\\");
  return (slash == std::string::npos) ? path : path.substr(slash + 1);
}

// The manifest is the source of truth for what a file is made of, so a preview
// never asks the API where the bytes are until it is about to read them.
inline bool previewSource(Store& store, const std::string& cloudPath, PreviewSource* out,
                          std::string* error) {
  const std::string path = Store::normalizePath(cloudPath);
  const Json* entry = store.stat(path);
  if (!entry || entry->s("type") != "file") {
    if (error) *error = "no such file";
    return false;
  }
  PreviewSource source;
  source.path = path;
  source.name = entry->s("name");
  source.size = (long long)entry->i("size");
  source.kind = previewKind(path);
  for (const Json& part : entry->get("parts").items()) {
    PreviewPart p;
    p.repo = part.s("repo");
    p.assetId = (long long)part.i("assetId");
    p.start = (long long)part.i("start");
    p.length = (long long)part.i("length");
    if (p.repo.empty() || p.assetId <= 0 || p.length <= 0) {
      if (error) *error = "the manifest has an unreadable part";
      return false;
    }
    source.parts.push_back(p);
  }
  std::sort(source.parts.begin(), source.parts.end(),
            [](const PreviewPart& a, const PreviewPart& b) { return a.start < b.start; });
  if (source.parts.empty()) {
    if (error) *error = "the manifest names no parts for this file";
    return false;
  }
  *out = source;
  return true;
}

// ------------------------------------------------------------------ the options

struct PreviewReadOptions {
  int timeoutMs = kPreviewChunkTimeoutMs;
  int retries = kPreviewChunkRetries;
  long long chunkBytes = kPreviewChunkBytes;
  const std::atomic<bool>* cancel = nullptr;
  // A second cancellation source, for a caller whose cancellation is scoped to
  // one preview (an epoch) instead of one process-wide flag. Both are checked
  // before a window, between retries and while a request is in flight.
  std::function<bool()>* cancelCheck = nullptr;

  bool cancelled() const {
    if (cancel && cancel->load(std::memory_order_relaxed)) return true;
    return cancelCheck != nullptr && (*cancelCheck)();
  }
};

// ------------------------------------------------------------------ the transport

// WinHTTP's own receive timeout does not fire while a server holds its answer:
// measured on this machine, a 3 s delay with a 500 ms timeout still returned
// after 3 s (see tests/out; the probe is in build/timeout_probe.cpp). A chunk
// therefore gets its deadline here, around the synchronous call, on a worker
// thread. Giving up means detaching that worker; it cannot touch this function
// again because it owns a heap copy of the result, so the caller sees a clean
// timeout while the abandoned request finishes on its own.
struct PreviewHttpTask {
  std::mutex mutex;
  bool done = false;
  Response response;
};

inline bool previewHttpGet(const std::string& url, const RequestOptions& request, int timeoutMs,
                           Response* out, bool* timedOut = nullptr,
                           const PreviewReadOptions* options = nullptr) {
  if (timedOut) *timedOut = false;
  auto task = std::make_shared<PreviewHttpTask>();
  std::thread worker([task, url, request]() {
    Response response = httpRequest(url, request);
    std::lock_guard<std::mutex> lock(task->mutex);
    task->response = std::move(response);
    task->done = true;
  });
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs > 0 ? timeoutMs : 1);
  bool finished = false;
  bool cancelled = false;
  while (std::chrono::steady_clock::now() < deadline) {
    {
      std::lock_guard<std::mutex> lock(task->mutex);
      if (task->done) { finished = true; break; }
    }
    if (options && options->cancelled()) { cancelled = true; break; }
    Sleep(10);
  }
  if (finished) {
    worker.join();
    std::lock_guard<std::mutex> lock(task->mutex);
    *out = task->response;
    return true;
  }
  worker.detach();
  if (cancelled) {
    out->error = "cancelled";
    return false;
  }
  if (timedOut) *timedOut = true;
  out->error = "timeout after " + std::to_string(timeoutMs) + " ms";
  return false;
}

// ------------------------------------------------------------------ the URLs

// One signed URL per asset, kept for the life of the process: resolving it
// costs an API call, and a 50 MiB file at 256 KiB per request is 200 requests.
// Without this cache the first chunk would be the only cheap one.
struct PreviewUrlCache {
  std::map<std::string, std::string> urls;

  static std::string key(const std::string& repo, long long assetId) {
    return repo + "#" + std::to_string(assetId);
  }
  const std::string* find(const std::string& repo, long long assetId) const {
    auto it = urls.find(key(repo, assetId));
    return it == urls.end() ? nullptr : &it->second;
  }
  void put(const std::string& repo, long long assetId, const std::string& url) {
    urls[key(repo, assetId)] = url;
  }
  void drop(const std::string& repo, long long assetId) { urls.erase(key(repo, assetId)); }
};

inline std::string responseHeader(const Response& response, const char* name) {
  // Header names are case insensitive and the exact spelling that comes back is
  // not something to depend on.
  std::string v = response.header(name);
  if (!v.empty()) return v;
  std::string upper = name;
  for (char& c : upper) c = (char)::toupper((unsigned char)c);
  if (upper != name) { v = response.header(upper); if (!v.empty()) return v; }
  std::string capital = upper;
  if (!capital.empty()) capital[0] = (char)::toupper((unsigned char)capital[0]);
  return response.header(capital);
}

// The asset API answers with a redirect; following it while keeping the
// Authorization header would send the token to a CDN host, so the redirect is
// read by hand and the signed URL is used directly.
inline bool assetDownloadUrl(GitHub& gh, const std::string& repo, long long assetId,
                             std::string* out, std::string* error) {
  RequestOptions options;
  options.method = "GET";
  options.followRedirects = false;
  options.timeoutMs = 8000;
  options.token = gh.token();
  options.headers.push_back("Accept: application/octet-stream");
  const std::string url = std::string(GitHub::apiBase()) + "/repos/" + gh.login() + "/" +
                          repo + "/releases/assets/" + std::to_string(assetId);
  Response response;
  if (!previewHttpGet(url, options, options.timeoutMs, &response, nullptr, nullptr)) {
    if (error) *error = response.error;
    return false;
  }
  if (!response.error.empty()) {
    if (error) *error = response.error;
    return false;
  }
  if (response.status == 200) {
    // Already the bytes: no redirect to read, and the caller can use this URL.
    *out = url;
    return true;
  }
  const std::string location = responseHeader(response, "location");
  if (location.empty()) {
    if (error) *error = "the asset answer carried no redirect (HTTP " + std::to_string(response.status) + ")";
    return false;
  }
  *out = location;
  return true;
}

// ------------------------------------------------------------------ the reads

inline bool rangeRequest(const std::string& url, const std::string& token, long long from,
                         long long to, std::string* body, int* status, std::string* error,
                         const PreviewReadOptions& options) {
  for (int attempt = 0; attempt <= options.retries; attempt++) {
    if (options.cancelled()) {
      if (error) *error = "cancelled";
      return false;
    }
    RequestOptions request;
    request.method = "GET";
    request.followRedirects = true;
    request.timeoutMs = options.timeoutMs;
    char range[80];
    snprintf(range, sizeof(range), "Range: bytes=%lld-%lld", from, to);
    request.headers.push_back(range);
    request.headers.push_back("Accept: application/octet-stream");
    // Only the API host gets the credential; a signed CDN URL does not need it
    // and must not receive it.
    if (urlHost(url) == "api.github.com" && !token.empty()) request.token = token;
    Response response;
    bool timedOut = false;
    previewHttpGet(url, request, options.timeoutMs, &response, &timedOut, &options);
    if (response.error.empty() && (response.status == 206 || response.status == 200)) {
      *status = response.status;
      *body = response.body;
      return true;
    }
    if (error) {
      *error = response.error.empty() ? ("HTTP " + std::to_string(response.status)) : response.error;
    }
    if (attempt < options.retries) Sleep((DWORD)(150 * (attempt + 1)));
  }
  return false;
}

// The window [from, to] of one asset. A server that ignores Range answers 200
// with the whole asset; the window is cut out of it in that case, and it is
// reported through *serverIgnoredRange so the caller can say so instead of
// pretending the read was cheap.
inline bool assetWindow(GitHub& gh, PreviewUrlCache& cache, const std::string& repo,
                        long long assetId, long long from, long long to, std::string* out,
                        std::string* error, const PreviewReadOptions& options,
                        bool* serverIgnoredRange = nullptr) {
  const long long want = to - from + 1;
  for (int pass = 0; pass < 2; pass++) {
    const std::string* cached = cache.find(repo, assetId);
    std::string url;
    if (cached) {
      url = *cached;
    } else if (!assetDownloadUrl(gh, repo, assetId, &url, error)) {
      return false;
    }
    int status = 0;
    std::string body;
    std::string why;
    if (!rangeRequest(url, gh.token(), from, to, &body, &status, &why, options)) {
      // A signed URL that has expired answers 403 or 404; drop it and resolve a
      // fresh one once before giving up.
      cache.drop(repo, assetId);
      if (pass == 0 && (why == "HTTP 403" || why == "HTTP 404")) continue;
      if (error) *error = why;
      return false;
    }
    cache.put(repo, assetId, url);
    if (body.size() < (size_t)want) {
      if (error) *error = "short body: asked for " + std::to_string(want) + " bytes, got " +
                          std::to_string(body.size());
      return false;
    }
    if (status == 200 && body.size() > (size_t)want) {
      if (serverIgnoredRange) *serverIgnoredRange = true;
      *out = body.substr((size_t)from, (size_t)want);
    } else {
      *out = body.substr(0, (size_t)want);
    }
    return true;
  }
  return false;
}

// Bytes [offset, offset + length) of the file, assembled across the parts the
// manifest names. The array is a property of this process, so the cache is the
// caller's - the routes in main.cpp keep one per served process.
inline bool previewRead(Store& store, GitHub& gh, PreviewUrlCache& cache,
                        const PreviewSource& source, long long offset, long long length,
                        std::string* out, std::string* error,
                        const PreviewReadOptions& options = PreviewReadOptions()) {
  (void)store;
  if (offset < 0 || length <= 0 || offset + length > source.size) {
    if (error) *error = "the requested window is outside the file";
    return false;
  }
  std::string assembled;
  assembled.reserve((size_t)std::min<long long>(length, 4LL * 1024 * 1024));
  long long cursor = offset;
  long long remaining = length;
  for (const PreviewPart& part : source.parts) {
    const long long partEnd = part.start + part.length;
    if (cursor >= partEnd) continue;
    if (cursor < part.start) {
      if (error) *error = "the manifest has a hole before offset " + std::to_string(cursor);
      return false;
    }
    if (options.cancelled()) {
      if (error) *error = "cancelled";
      return false;
    }
    // One Range request is at most one 256 KiB window, however large the
    // requested range is: the contract's chunk size is a property of the wire,
    // not of the caller.
    const long long step = std::max<long long>(1, options.chunkBytes);
    while (remaining > 0 && cursor < partEnd) {
      if (options.cancelled()) {
        if (error) *error = "cancelled";
        return false;
      }
      const long long take = std::min<long long>(remaining, std::min<long long>(step, partEnd - cursor));
      std::string window;
      std::string why;
      if (!assetWindow(gh, cache, part.repo, part.assetId, cursor - part.start,
                       cursor - part.start + take - 1, &window, &why, options)) {
        if (error) *error = why;
        return false;
      }
      assembled += window;
      cursor += take;
      remaining -= take;
    }
    if (remaining == 0) break;
  }
  if (remaining != 0) {
    if (error) *error = "the parts do not cover the requested window";
    return false;
  }
  *out = std::move(assembled);
  return true;
}

// ------------------------------------------------------------------ the zip

struct ZipEntry {
  std::string name;
  uint64_t compressed = 0;
  uint64_t uncompressed = 0;
  uint64_t headerOffset = 0;
  uint32_t crc = 0;
  uint16_t method = 0;
  bool zip64 = false;
};

enum class ZipTailResult {
  Ok,          // the central directory was inside the tail
  NeedsMore,   // it starts before the tail: read a bigger tail and try again
  NotZip,
  Broken
};

namespace previewdetail {

inline uint16_t le16(const unsigned char* p) { return (uint16_t)(p[0] | (p[1] << 8)); }
inline uint32_t le32(const unsigned char* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
inline uint64_t le64(const unsigned char* p) {
  return (uint64_t)le32(p) | ((uint64_t)le32(p + 4) << 32);
}

}  // namespace previewdetail

// A zip64 archive keeps the real central-directory size and offset in a zip64
// end of central directory record, which sits just before its locator and the
// plain EOCD - all three inside the same tail. The record's offset in the
// locator is absolute in the file, so it is rebased on the tail before it is
// read. A missing or mispointed record is a broken archive, not an empty one.
inline ZipTailResult zip64TailDirectory(const unsigned char* data, size_t size, size_t eocd,
                                        uint64_t tailOffset, uint64_t* cdSize, uint64_t* cdOffset,
                                        std::string* error) {
  using namespace previewdetail;
  if (eocd < 20 || le32(data + eocd - 20) != 0x07064b50u) {
    if (error) *error = "the archive declares zip64 but carries no zip64 end of central directory locator";
    return ZipTailResult::Broken;
  }
  const uint64_t recordOffset = le64(data + eocd - 20 + 8);
  if (recordOffset < tailOffset || recordOffset - tailOffset + 56 > size) {
    if (error) *error = "the zip64 end of central directory is outside the tail";
    return ZipTailResult::NeedsMore;
  }
  const size_t at = (size_t)(recordOffset - tailOffset);
  if (le32(data + at) != 0x06064b50u) {
    if (error) *error = "the zip64 end of central directory is not where its locator says";
    return ZipTailResult::Broken;
  }
  *cdSize = le64(data + at + 40);
  *cdOffset = le64(data + at + 48);
  return ZipTailResult::Ok;
}

// Reads a zip's list of names out of the last bytes of the file: the end of
// central directory record points at the central directory, and a listing needs
// nothing else - the compressed data is never touched.
inline ZipTailResult zipEntriesFromTail(const std::string& tail, uint64_t tailOffset,
                                        std::vector<ZipEntry>* entries, std::string* error) {
  using namespace previewdetail;
  const unsigned char* data = (const unsigned char*)tail.data();
  const size_t size = tail.size();
  if (size < 22) {
    if (error) *error = "the tail is too small to be a zip";
    return ZipTailResult::NotZip;
  }
  // The EOCD is found from the end: a zip comment may contain the signature,
  // and taking the first match from the front would read garbage.
  // A comment may contain the signature, and a comment sits after the record,
  // so a plain backward search finds the fake one first. The record that is
  // real is the one whose comment length lands exactly on the end of the file,
  // which the tail always is.
  size_t eocd = std::string::npos;
  for (size_t i = size - 22 + 1; i-- > 0;) {
    if (le32(data + i) == 0x06054b50u) {
      const size_t commentLength = le16(data + i + 20);
      if (i + 22 + commentLength == size) { eocd = i; break; }
    }
    if (i == 0) break;
  }
  if (eocd == std::string::npos) {
    if (error) *error = "no end of central directory record in the tail";
    return ZipTailResult::NotZip;
  }
  const unsigned char* p = data + eocd;
  uint64_t cdSize = le32(p + 12);
  uint64_t cdOffset = le32(p + 16);
  if (cdOffset == 0xFFFFFFFFull || cdSize == 0xFFFFFFFFull) {
    // The 32-bit directory size and offset are placeholders in a zip64
    // archive; the real values come from the zip64 record right behind the
    // locator. A tail that does not reach them asks for a bigger one instead
    // of giving up, and a locator that is not there is a clear error.
    const ZipTailResult zip64 = zip64TailDirectory(data, size, eocd, tailOffset, &cdSize, &cdOffset, error);
    if (zip64 != ZipTailResult::Ok) return zip64;
  }
  if (cdOffset < tailOffset) {
    if (error) *error = "the central directory starts before the tail";
    return ZipTailResult::NeedsMore;
  }
  const uint64_t cdInTail = cdOffset - tailOffset;
  if (cdInTail + cdSize > size) {
    if (error) *error = "the central directory runs past the tail";
    return ZipTailResult::NeedsMore;
  }
  std::vector<ZipEntry> found;
  uint64_t at = cdInTail;
  while (at + 46 <= size) {
    const unsigned char* e = data + at;
    if (le32(e) != 0x02014b50u) break;
    ZipEntry entry;
    entry.method = le16(e + 10);
    entry.crc = le32(e + 16);
    entry.compressed = le32(e + 20);
    entry.uncompressed = le32(e + 24);
    const uint16_t nameLen = le16(e + 28);
    const uint16_t extraLen = le16(e + 30);
    const uint16_t commentLen = le16(e + 32);
    entry.headerOffset = le32(e + 42);
    if (at + 46 + nameLen > size) break;
    std::string name((const char*)e + 46, nameLen);
    // Zip64 sizes and offsets live in extra field 0x0001, in the order the
    // fields are present: uncompressed, compressed, local-header offset. A
    // field that is still 0xFFFFFFFF after this is a placeholder somebody
    // declared and never filled in - that is a broken archive, and passing the
    // 0xFFFFFFFF on as a size would be handing out a wrong number as if it
    // were the truth.
    uint64_t extraAt = at + 46 + nameLen;
    const uint64_t extraEnd = extraAt + extraLen;
    bool short64 = false;
    while (extraAt + 4 <= extraEnd && extraEnd <= size) {
      const uint16_t id = le16(data + extraAt);
      const uint16_t len = le16(data + extraAt + 2);
      if (id == 0x0001u) {
        entry.zip64 = true;
        const unsigned char* z = data + extraAt + 4;
        size_t used = 0;
        if (entry.uncompressed == 0xFFFFFFFFull) {
          if (used + 8 <= len) { entry.uncompressed = le64(z + used); used += 8; } else short64 = true;
        }
        if (!short64 && entry.compressed == 0xFFFFFFFFull) {
          if (used + 8 <= len) { entry.compressed = le64(z + used); used += 8; } else short64 = true;
        }
        if (!short64 && entry.headerOffset == 0xFFFFFFFFull) {
          if (used + 8 <= len) { entry.headerOffset = le64(z + used); used += 8; } else short64 = true;
        }
      }
      extraAt += 4 + len;
      if (short64) break;
    }
    if (short64) {
      if (error) *error = "the zip64 extra field is too short for entry \"" + name + "\"";
      return ZipTailResult::Broken;
    }
    if (entry.uncompressed == 0xFFFFFFFFull || entry.compressed == 0xFFFFFFFFull ||
        entry.headerOffset == 0xFFFFFFFFull) {
      if (error) *error = "entry \"" + name + "\" carries a 32-bit zip64 placeholder that no extra field fills";
      return ZipTailResult::Broken;
    }
    entry.name = name;
    found.push_back(entry);
    at += 46 + nameLen + extraLen + commentLen;
  }
  if (found.empty()) {
    if (error) *error = "the central directory held no entries";
    return ZipTailResult::Broken;
  }
  if (entries) *entries = found;
  return ZipTailResult::Ok;
}

// A local file header is read only when one entry is fetched. The central
// directory already has the sizes and the crc; the header is needed for the
// two lengths that place the compressed bytes, and for nothing else.
struct ZipLocalHeader {
  uint64_t dataOffset = 0;   // where this entry's compressed bytes begin
  uint32_t flags = 0;
  uint16_t method = 0;
  uint16_t nameLength = 0;
  uint16_t extraLength = 0;
  // Flag bit 3: the crc and the two sizes are written after the data, in a data
  // descriptor, and the local header's own values are zero. The central
  // directory carries the real ones, so the read is unaffected - but a caller
  // that needs to know where the entry ends must read the descriptor into
  // account, so the fact is reported rather than guessed.
  bool dataDescriptor = false;
};

inline bool zipLocalHeader(const std::string& header, uint64_t headerOffset,
                           ZipLocalHeader* out, std::string* error) {
  using namespace previewdetail;
  if (header.size() < 30) {
    if (error) *error = "the local file header is shorter than 30 bytes";
    return false;
  }
  const unsigned char* p = (const unsigned char*)header.data();
  if (le32(p) != 0x04034b50u) {
    if (error) *error = "the entry does not begin with a local file header";
    return false;
  }
  ZipLocalHeader local;
  local.flags = le16(p + 6);
  local.method = le16(p + 8);
  local.nameLength = le16(p + 26);
  local.extraLength = le16(p + 28);
  local.dataDescriptor = (local.flags & 0x0008u) != 0;
  local.dataOffset = headerOffset + 30 + local.nameLength + local.extraLength;
  if (out) *out = local;
  return true;
}

// The listing of a zip, read from its end: 64 KiB first, then four times that
// until the central directory falls inside the window. The compressed data is
// never touched, so listing a large archive costs one tail read.
inline bool previewZipTail(Store& store, GitHub& gh, PreviewUrlCache& cache,
                           const PreviewSource& source, std::vector<ZipEntry>* entries,
                           std::string* error,
                           const PreviewReadOptions& options = PreviewReadOptions(),
                           long long firstTail = kPreviewZipTailBytes) {
  if (source.size < 22) {
    if (error) *error = "the file is too small to be a zip";
    return false;
  }
  std::vector<ZipEntry> found;
  std::string why;
  long long window = std::min<long long>(std::max<long long>(firstTail, 22), source.size);
  ZipTailResult result = ZipTailResult::NotZip;
  for (int round = 0; round < 8; round++) {
    std::string bytes;
    if (!previewRead(store, gh, cache, source, source.size - window, window, &bytes, &why, options)) {
      if (error) *error = why;
      return false;
    }
    result = zipEntriesFromTail(bytes, (uint64_t)(source.size - window), &found, &why);
    if (result != ZipTailResult::NeedsMore || window >= source.size) break;
    window = std::min<long long>(window * 4, source.size);
  }
  if (result != ZipTailResult::Ok) {
    if (error) *error = why.empty() ? "the archive directory could not be read" : why;
    return false;
  }
  if (entries) *entries = std::move(found);
  return true;
}

// ------------------------------------------------------------------ the json

inline std::string previewSourceJson(const PreviewSource& source, long long epoch = 0) {
  Json j = Json::object();
  j.set("path", Json(source.path));
  j.set("name", Json(source.name));
  j.set("size", Json(source.size));
  j.set("kind", Json(std::string(previewKindName(source.kind))));
  Json parts = Json::array();
  for (const PreviewPart& part : source.parts) {
    Json p = Json::object();
    p.set("repo", Json(part.repo));
    p.set("assetId", Json(part.assetId));
    p.set("start", Json(part.start));
    p.set("length", Json(part.length));
    parts.push(p);
  }
  j.set("parts", parts);
  j.set("chunkBytes", Json(kPreviewChunkBytes));
  j.set("timeoutMs", Json((long long)kPreviewChunkTimeoutMs));
  j.set("retries", Json((long long)kPreviewChunkRetries));
  j.set("zipTailBytes", Json(kPreviewZipTailBytes));
  j.set("maxEntryBytes", Json(kPreviewEntryMaxBytes));
  j.set("maxLines", Json((long long)20000));
  if (epoch > 0) j.set("epoch", Json(epoch));
  return j.dump(2);
}

}  // namespace inc
