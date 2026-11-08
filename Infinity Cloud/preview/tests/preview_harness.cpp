// preview_harness.cpp - the streaming preview's rules, checked against a real
// local HTTP server that answers Range requests.
//
// The server (tests/range-server.mjs) is a stand-in for the signed CDN URL the
// asset API hands out: it answers 206 with the window asked for, it can fail
// the first requests of a path, and it can delay a path. That is enough to
// exercise the contract end to end without a GitHub account:
//
//   * one 256 KiB window per Range request, whatever the caller asks for;
//   * 8 s per window and two retries, then a clear failure;
//   * a 64 KiB tail read lists a zip and touches nothing else;
//   * one entry is pulled on demand through its local header;
//   * cancellation is honoured before a window and between retries.
//
// Every check prints one JSON line: {"test":..,"pass":..,"detail":..}. The
// runner reads the server's request log next to it, because "how many requests
// and how wide" is a property of the wire, not of this program.

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <string>
#include <thread>
#include <vector>

#include "preview.hpp"

using namespace inc;

namespace {

int g_fail = 0;
long long g_nextAsset = 100;

std::string jsonEscape(const std::string& s) {
  std::string out;
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if ((unsigned char)c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

std::string num(long long v) { return std::to_string(v); }

void report(const char* name, bool pass, const std::string& detail) {
  printf("{\"test\":\"%s\",\"pass\":%s,\"detail\":\"%s\"}\n", name, pass ? "true" : "false",
         jsonEscape(detail).c_str());
  fflush(stdout);
  if (!pass) g_fail++;
}

long long nowMs() {
  return (long long)std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}

long long fileSize(const std::string& path) {
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return -1;
  fseek(f, 0, SEEK_END);
  const long long n = ftell(f);
  fclose(f);
  return n;
}

std::string readAll(const std::string& path) {
  std::string out;
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) return out;
  char buffer[65536];
  size_t n = 0;
  while ((n = fread(buffer, 1, sizeof(buffer), f)) > 0) out.append(buffer, n);
  fclose(f);
  return out;
}

bool writeAll(const std::string& path, const std::string& bytes) {
  FILE* f = fopen(path.c_str(), "wb");
  if (!f) return false;
  const bool ok = bytes.empty() || fwrite(bytes.data(), 1, bytes.size(), f) == bytes.size();
  fclose(f);
  return ok;
}

// The manifest would name a repo, an asset id and a part, and the store would
// hand out one signed URL per asset. Here the manifest is one part covering the
// whole fixture and the URL is the local server's, which is the same shape
// previewRead works on.
PreviewSource sourceFor(const std::string& name, const std::string& dir, const std::string& base,
                        PreviewUrlCache& cache) {
  PreviewSource source;
  source.path = "/" + name;
  source.name = name;
  source.size = fileSize(dir + "/" + name);
  source.kind = previewKind(name);
  PreviewPart part;
  part.repo = "fixture";
  part.assetId = ++g_nextAsset;
  part.start = 0;
  part.length = source.size > 0 ? source.size : 0;
  source.parts.push_back(part);
  cache.put(part.repo, part.assetId, base + "/" + name);
  return source;
}

const Json* findExpected(const Json& expected, const std::string& name) {
  for (const Json& entry : expected.get("entries").items()) {
    if (entry.s("name") == name) return &entry;
  }
  return nullptr;
}

// Every entry the tail listing produced must match the fixture's recorded
// sizes, method and local-header offset. A reader that quietly returned
// 0xFFFFFFFF or a zero for one of them fails here instead of downstream.
bool zipMatches(const std::vector<ZipEntry>& entries, const Json& expected, std::string* detail) {
  std::string out;
  bool ok = entries.size() == expected.get("entries").size();
  if (!ok) {
    out += "count=" + num((long long)entries.size()) + "/" +
           num((long long)expected.get("entries").size());
  }
  for (const ZipEntry& entry : entries) {
    const Json* want = findExpected(expected, entry.name);
    if (!want) { ok = false; out += " unexpected:" + entry.name; continue; }
    const bool one = (long long)entry.method == want->i("method") &&
                     (long long)entry.compressed == want->i("compressed") &&
                     (long long)entry.uncompressed == want->i("uncompressed") &&
                     (long long)entry.headerOffset == want->i("headerOffset");
    if (!one) {
      ok = false;
      out += " mismatch:" + entry.name + "=" + num((long long)entry.compressed) + "/" +
             num(want->i("compressed"));
    }
  }
  if (detail) *detail = out;
  return ok;
}

void put16(std::string* s, size_t at, uint16_t v) {
  (*s)[at] = (char)(v & 0xFF);
  (*s)[at + 1] = (char)((v >> 8) & 0xFF);
}

void put32(std::string* s, size_t at, uint32_t v) {
  for (int i = 0; i < 4; i++) (*s)[at + i] = (char)((v >> (8 * i)) & 0xFF);
}

}  // namespace

int main(int argc, char** argv) {
  std::string base, dir, out;
  bool with8s = false;
  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    if (a == "--base" && i + 1 < argc) base = argv[++i];
    else if (a == "--dir" && i + 1 < argc) dir = argv[++i];
    else if (a == "--out" && i + 1 < argc) out = argv[++i];
    else if (a == "--with-8s") with8s = true;
  }
  if (base.empty() || dir.empty() || out.empty()) {
    fprintf(stderr, "usage: preview_harness --base <url> --dir <fixtures> --out <dir> [--with-8s]\n");
    return 2;
  }
  if (!base.empty() && base.back() == '/') base.pop_back();

  GitHub gh("");
  PreviewUrlCache cache;
  Store store(gh, "fixture");

  // ---------------------------------------------------------------- numbers
  {
    PreviewReadOptions defaults;
    const bool ok = defaults.chunkBytes == 262144 && defaults.timeoutMs == 8000 &&
                    defaults.retries == 2 && kPreviewZipTailBytes == 65536;
    report("defaults", ok,
           "chunkBytes=" + num(defaults.chunkBytes) + " timeoutMs=" + num(defaults.timeoutMs) +
               " retries=" + num(defaults.retries) + " zipTailBytes=" + num(kPreviewZipTailBytes));
  }

  // ---------------------------------------------------------------- one window
  {
    PreviewSource source = sourceFor("small.txt", dir, base, cache);
    PreviewReadOptions options;
    std::string bytes, why;
    const long long t0 = nowMs();
    const bool ok = previewRead(store, gh, cache, source, 0, kPreviewChunkBytes, &bytes, &why, options);
    const long long ms = nowMs() - t0;
    report("chunk1", ok && bytes.size() == (size_t)kPreviewChunkBytes,
           "bytes=" + num((long long)bytes.size()) + " want=" + num(kPreviewChunkBytes) +
               " ms=" + num(ms) + " first_screen<=800ms=" + (ms <= 800 ? "yes" : "no") +
               (ok ? "" : (" error=" + why)));
  }

  // ------------------------------------------------- a big request is still windows
  {
    PreviewSource source = sourceFor("small.txt", dir, base, cache);
    PreviewReadOptions options;
    std::string bytes, why;
    const long long want = 3 * kPreviewChunkBytes;
    const bool ok = previewRead(store, gh, cache, source, 0, want, &bytes, &why, options);
    report("oversize-request-split", ok && bytes.size() == (size_t)want,
           "requested=" + num(want) + " bytes=" + num((long long)bytes.size()) +
               " (server log must show 3 windows of 262144)" + (ok ? "" : (" error=" + why)));
  }

  // ---------------------------------------------------------------- whole file
  {
    PreviewSource source = sourceFor("big.bin", dir, base, cache);
    PreviewReadOptions options;
    std::string bytes, why;
    const long long t0 = nowMs();
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    const long long ms = nowMs() - t0;
    report("full-big", ok && bytes.size() == (size_t)source.size,
           "bytes=" + num((long long)bytes.size()) + " size=" + num(source.size) + " ms=" + num(ms) +
               " windows=" + num((source.size + kPreviewChunkBytes - 1) / kPreviewChunkBytes) +
               (ok ? "" : (" error=" + why)));
  }

  // ---------------------------------------------------------------- retries
  {
    PreviewSource source = sourceFor("retry.bin", dir, base, cache);
    PreviewReadOptions options;
    std::string bytes, why;
    const long long t0 = nowMs();
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    report("retry-after-two-failures", ok && bytes.size() == (size_t)source.size,
           "bytes=" + num((long long)bytes.size()) + " ms=" + num(nowMs() - t0) +
               " (server log must show 3 requests for retry.bin)" + (ok ? "" : (" error=" + why)));
  }

  // ---------------------------------------------------------------- timeout
  // The contract's 8 s is per attempt and two retries follow it, so a read that
  // times out fails at (retries + 1) * timeout plus the two backoffs. The bound
  // is asserted rather than merely observed: the failure this guards against is
  // an unbounded hang, and the ~24 s a real 8 s default costs is that bound.
  {
    PreviewSource source = sourceFor("slow.bin", dir, base, cache);
    PreviewReadOptions options;
    options.timeoutMs = 800;   // the mechanism, at a test-sized timeout
    std::string bytes, why;
    const long long t0 = nowMs();
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    const long long ms = nowMs() - t0;
    const long long bound = (long long)(options.retries + 1) * options.timeoutMs + 1500;
    const bool failed = !ok && !why.empty() && ms <= bound;
    report("timeout-with-two-retries", failed,
           "ok=" + std::string(ok ? "true" : "false") + " ms=" + num(ms) + " bound=" + num(bound) +
               " error=" + why + " (3 attempts: 1 + 2 retries)");
  }

  if (with8s) {
    PreviewSource source = sourceFor("slow8.bin", dir, base, cache);
    PreviewReadOptions options;   // the real 8 s, two retries
    std::string bytes, why;
    const long long t0 = nowMs();
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    const long long ms = nowMs() - t0;
    const long long bound = (long long)(options.retries + 1) * options.timeoutMs + 1500;
    const bool pass = !ok && why.find("timeout after 8000 ms") != std::string::npos && ms <= bound;
    report("timeout-8s-default", pass,
           "ok=" + std::string(ok ? "true" : "false") + " ms=" + num(ms) + " bound=" + num(bound) +
               " error=" + why + " (3 attempts of 8 s; the bound is the contract's cost)");
  }

  // ---------------------------------------------------------------- cancellation
  {
    PreviewSource source = sourceFor("cancel.bin", dir, base, cache);
    std::atomic<bool> flag(true);
    PreviewReadOptions options;
    options.cancel = &flag;
    std::string bytes, why;
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    report("cancel-flag", !ok && why == "cancelled", "error=" + why +
           " (server log must show 0 requests for cancel.bin)");
  }
  {
    PreviewSource source = sourceFor("cancel.bin", dir, base, cache);
    std::string bytes, why;
    PreviewReadOptions options;
    std::function<bool()> closed = []() { return true; };
    options.cancelCheck = &closed;
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    report("cancel-epoch", !ok && why == "cancelled", "error=" + why);
  }

  // Cancelling while a window is in flight: the request was sent, so the
  // server sees it, but the reader returns as soon as it is told to stop
  // instead of waiting out the delayed answer.
  {
    PreviewSource source = sourceFor("cancel2.bin", dir, base, cache);
    std::atomic<bool> flag(false);
    PreviewReadOptions options;
    options.timeoutMs = 8000;
    options.cancel = &flag;
    std::thread canceller([&flag]() { Sleep(300); flag.store(true); });
    std::string bytes, why;
    const long long t0 = nowMs();
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    const long long ms = nowMs() - t0;
    canceller.join();
    report("cancel-in-flight", !ok && why == "cancelled" && ms < 1500,
           "ms=" + num(ms) + " error=" + why + " (server log must show 1 request for cancel2.bin)");
  }

  // The transport cannot abort the synchronous WinHTTP call underneath a worker
  // thread, so what the cancellation contract really promises is this: after a
  // cancel the reader returns "cancelled", never success, and never hands back
  // the bytes it had already assembled. Here the first part is read, the second
  // request is in flight when the cancel lands, and the caller's buffer must
  // still hold exactly what it held before the call.
  {
    PreviewSource source;
    source.path = "/cancelpart.txt";
    source.name = "cancelpart.txt";
    source.kind = PreviewKind::WholeFile;
    const long long firstLength = fileSize(dir + "/cancelpart.bin");
    const long long secondLength = fileSize(dir + "/cancelpart2.bin");
    source.size = firstLength + secondLength;
    PreviewPart first;
    first.repo = "fixture";
    first.assetId = ++g_nextAsset;
    first.start = 0;
    first.length = firstLength;
    PreviewPart second;
    second.repo = "fixture";
    second.assetId = ++g_nextAsset;
    second.start = firstLength;
    second.length = secondLength;
    source.parts.push_back(first);
    source.parts.push_back(second);
    cache.put(first.repo, first.assetId, base + "/cancelpart.bin");
    cache.put(second.repo, second.assetId, base + "/cancelpart2.bin");
    std::atomic<bool> flag(false);
    PreviewReadOptions options;
    options.timeoutMs = 8000;
    options.cancel = &flag;
    std::thread canceller([&flag]() { Sleep(300); flag.store(true); });
    std::string bytes = "SENTINEL";
    std::string why;
    const long long t0 = nowMs();
    const bool ok = previewRead(store, gh, cache, source, 0, source.size, &bytes, &why, options);
    const long long ms = nowMs() - t0;
    canceller.join();
    const bool pass = !ok && why == "cancelled" && bytes == "SENTINEL" && ms < 1500;
    report("cancel-no-partial-output", pass,
           "ok=" + std::string(ok ? "true" : "false") + " ms=" + num(ms) + " out=" +
               num((long long)bytes.size()) + " error=" + why +
               " (first part read, second cancelled in flight, caller buffer untouched)");
  }

  // ---------------------------------------------------------------- the zip tail
  bool expectedOk = false;
  Json expected = Json::parse(readAll(dir + "/sample.zip.json"), &expectedOk);
  bool descOk = false;
  Json descExpected = Json::parse(readAll(dir + "/descriptor.zip.json"), &descOk);
  bool z64Ok = false;
  Json z64Expected = Json::parse(readAll(dir + "/zip64.zip.json"), &z64Ok);
  const long long zipSize = fileSize(dir + "/sample.zip");

  // Pull one entry the way the page does: read the central directory from the
  // tail, read the entry's 30-byte local header, then exactly its compressed
  // bytes. wantDescriptor/wantZip64 are what the fixture says the entry should
  // report, so a reader that drops either fact fails here.
  auto pullEntry = [&](const std::string& zipName, const Json& expectedJson, const char* name,
                       bool wantDescriptor, bool wantZip64) {
    PreviewSource source = sourceFor(zipName, dir, base, cache);
    const Json* want = findExpected(expectedJson, name);
    PreviewReadOptions options;
    std::vector<ZipEntry> entries;
    std::string why;
    bool ok = previewZipTail(store, gh, cache, source, &entries, &why, options);
    const ZipEntry* entry = nullptr;
    if (ok) for (const ZipEntry& candidate : entries) if (candidate.name == name) { entry = &candidate; break; }
    if (!entry) { report((std::string("zip-entry-") + name).c_str(), false, "entry not in the tail listing"); return; }
    std::string header;
    ok = ok && previewRead(store, gh, cache, source, (long long)entry->headerOffset, 30, &header, &why, options);
    ZipLocalHeader local;
    ok = ok && zipLocalHeader(header, entry->headerOffset, &local, &why);
    const long long t0 = nowMs();
    std::string bytes;
    ok = ok && previewRead(store, gh, cache, source, (long long)local.dataOffset,
                           (long long)entry->compressed, &bytes, &why, options);
    const bool wrote = ok && writeAll(out + "/entry-" + name + ".bin", bytes);
    const long long expectedDataOffset = want ? want->i("dataOffset") : -1;
    const bool pass = ok && wrote && want && (long long)bytes.size() == (long long)entry->compressed &&
                      (long long)local.dataOffset == expectedDataOffset &&
                      local.dataDescriptor == wantDescriptor && entry->zip64 == wantZip64;
    report((std::string("zip-entry-") + name).c_str(), pass,
           "compressed=" + num((long long)bytes.size()) + " method=" + num(entry->method) +
               " headerOffset=" + num((long long)entry->headerOffset) +
               " dataOffset=" + num((long long)local.dataOffset) + " expectedDataOffset=" +
               num(expectedDataOffset) + " descriptor=" + (local.dataDescriptor ? "true" : "false") +
               " zip64=" + (entry->zip64 ? "true" : "false") + " ms=" + num(nowMs() - t0) +
               (ok ? "" : (" error=" + why)));
  };

  {
    PreviewSource source = sourceFor("sample.zip", dir, base, cache);
    PreviewReadOptions options;
    std::vector<ZipEntry> entries;
    std::string why;
    const long long t0 = nowMs();
    const bool ok = previewZipTail(store, gh, cache, source, &entries, &why, options);
    std::string diff;
    const bool countOk = expectedOk && ok && zipMatches(entries, expected, &diff);
    report("zip-tail-64k", countOk,
           "entries=" + num((long long)entries.size()) + " expected=" +
               num(expectedOk ? (long long)expected.get("entries").size() : -1) + " ms=" +
               num(nowMs() - t0) + " (first Range must be start=" + num(zipSize - 65536) +
               " span=65536)" + (diff.empty() ? "" : (" " + diff)) + (ok ? "" : (" error=" + why)));
    Json list = Json::array();
    for (const ZipEntry& entry : entries) {
      Json item = Json::object();
      item.set("name", Json(entry.name));
      item.set("method", Json((long long)entry.method));
      item.set("compressed", Json((long long)entry.compressed));
      item.set("uncompressed", Json((long long)entry.uncompressed));
      item.set("headerOffset", Json((long long)entry.headerOffset));
      list.push(item);
    }
    printf("{\"test\":\"zip-entries\",\"pass\":%s,\"detail\":%s}\n", countOk ? "true" : "false",
           list.dump().c_str());
    fflush(stdout);
  }

  // ------------------------------------------------- data descriptors and zip64
  {
    PreviewSource source = sourceFor("descriptor.zip", dir, base, cache);
    PreviewReadOptions options;
    std::vector<ZipEntry> entries;
    std::string why;
    const bool ok = previewZipTail(store, gh, cache, source, &entries, &why, options);
    std::string diff;
    report("descriptor-zip-tail", descOk && ok && zipMatches(entries, descExpected, &diff),
           "entries=" + num((long long)entries.size()) + " expected=" +
               num(descOk ? (long long)descExpected.get("entries").size() : -1) +
               (diff.empty() ? "" : (" " + diff)) + (ok ? "" : (" error=" + why)));
  }
  pullEntry("descriptor.zip", descExpected, "desc-stored.bin", true, false);

  {
    PreviewSource source = sourceFor("zip64.zip", dir, base, cache);
    PreviewReadOptions options;
    std::vector<ZipEntry> entries;
    std::string why;
    const bool ok = previewZipTail(store, gh, cache, source, &entries, &why, options);
    std::string diff;
    bool flagOk = false;
    if (ok) for (const ZipEntry& e : entries) if (e.name == "z64-big.bin") flagOk = e.zip64;
    report("zip64-zip-tail", z64Ok && ok && zipMatches(entries, z64Expected, &diff) && flagOk,
           "entries=" + num((long long)entries.size()) + " expected=" +
               num(z64Ok ? (long long)z64Expected.get("entries").size() : -1) +
               " zip64Entry=" + (flagOk ? "true" : "false") +
               (diff.empty() ? "" : (" " + diff)) + (ok ? "" : (" error=" + why)));
  }
  pullEntry("zip64.zip", z64Expected, "z64-hello.txt", false, false);
  pullEntry("zip64.zip", z64Expected, "z64-big.bin", false, true);

  // A zip64 placeholder nobody filled in must be a clear, distinguishable
  // error - never a listing that reports 0xFFFFFFFF as a size.
  {
    PreviewSource source = sourceFor("zip64bad.zip", dir, base, cache);
    PreviewReadOptions options;
    std::vector<ZipEntry> entries;
    std::string why;
    const bool ok = previewZipTail(store, gh, cache, source, &entries, &why, options);
    const bool pass = !ok && why.find("zip64") != std::string::npos;
    report("zip64-placeholder-rejected", pass,
           "ok=" + std::string(ok ? "true" : "false") + " error=" + why);
  }
  // And the archive-level form of the same rule: an EOCD whose directory size
  // and offset are 0xFFFFFFFF with no zip64 record behind it.
  {
    std::string tail(22, '\0');
    put32(&tail, 0, 0x06054b50u);
    put16(&tail, 8, 0xFFFFu);
    put16(&tail, 10, 0xFFFFu);
    put32(&tail, 12, 0xFFFFFFFFu);
    put32(&tail, 16, 0xFFFFFFFFu);
    std::vector<ZipEntry> entries;
    std::string why;
    const ZipTailResult result = zipEntriesFromTail(tail, 0, &entries, &why);
    const bool pass = result == ZipTailResult::Broken && why.find("zip64") != std::string::npos;
    report("zip64-locator-missing", pass,
           "result=" + num((long long)result) + " error=" + why);
  }

  // ---------------------------------------------------------------- one entry
  pullEntry("sample.zip", expected, "hello.txt", false, false);
  pullEntry("sample.zip", expected, "stored.txt", false, false);
  pullEntry("sample.zip", expected, "data.bin", false, false);

  printf("{\"test\":\"summary\",\"fail\":%d}\n", g_fail);
  fflush(stdout);
  return g_fail == 0 ? 0 : 1;
}
