// perf_probe.cpp - a self-timing probe for the paths of ipm that are CPU- or
// disk-bound, so a change to them can be proved with a number.
//
// It is NOT part of the product: CMakeLists.txt builds apps/ipm/main.cpp only,
// and this file is never named there. It is compiled by hand:
//
//   see InfinityPackageManager/perf/run-probe.ps1
//
// It includes main.cpp so it can call the same functions the product calls -
// the anonymous namespace here is that translation unit's, which is the only
// way to time a function that is deliberately file-private.

#define main ipm_product_main
#include "main.cpp"
#undef main

#include <chrono>
#include <cstring>

namespace {

using Clock = std::chrono::steady_clock;

double elapsedMs(Clock::time_point start, Clock::time_point end) {
  return std::chrono::duration<double, std::milli>(end - start).count();
}

std::vector<Build> makeBuilds(size_t count) {
  static const char* platforms[] = { "windows-x64", "windows-x86", "windows-arm64",
                                     "macos-arm64", "linux-x64", "any" };
  std::vector<Build> builds;
  builds.reserve(count);
  for (size_t i = 0; i < count; ++i) {
    Build b;
    b.package = std::string("Vendor") + std::to_string(i % 400) + ".Product" + std::to_string(i);
    b.version = "1." + std::to_string(i % 50) + "." + std::to_string(i % 7) + ".0";
    b.platform = platforms[i % 6];
    b.filename = b.package + "_v" + b.version + "_" + b.platform + "_setup.exe";
    b.url = "https://example.invalid/" + b.filename;
    b.releaseTag = "application-" + std::to_string(i % 10);
    b.installKind = (i % 3 == 0) ? "port" : "setup";
    b.digest = (i % 3 == 0) ? std::string() : std::string("sha256:") + std::string(64, 'a');
    b.size = 1024LL * (long long)(i % 5000);
    builds.push_back(std::move(b));
  }
  return builds;
}

// The reference implementation matching() is measured against: the lowercase
// haystack is computed once, outside the loop.

// The reference hasher: identical to the product's except for the read size.
// It exists so the bisection between 64 KB and a larger buffer is measured in
// the same process, on the same file, with the same page cache.
std::string sha256FileWithBuffer(const std::wstring& path, DWORD bufferSize, std::string* error) {
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
  if (file == INVALID_HANDLE_VALUE) { *error = "cannot open"; return std::string(); }
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0))) {
    CloseHandle(file); *error = "algo"; return std::string();
  }
  DWORD objectLength = 0, hashLength = 0, resultLength = 0;
  BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength), sizeof(objectLength), &resultLength, 0);
  BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashLength), sizeof(hashLength), &resultLength, 0);
  std::vector<UCHAR> hashObject(objectLength);
  std::vector<UCHAR> hashBytes(hashLength);
  if (!BCRYPT_SUCCESS(BCryptCreateHash(algorithm, &hash, hashObject.data(), objectLength, nullptr, 0, 0))) {
    BCryptCloseAlgorithmProvider(algorithm, 0); CloseHandle(file); *error = "hash"; return std::string();
  }
  std::vector<UCHAR> buffer(bufferSize);
  DWORD bytesRead = 0;
  do {
    if (!ReadFile(file, buffer.data(), bufferSize, &bytesRead, nullptr)) {
      BCryptDestroyHash(hash); BCryptCloseAlgorithmProvider(algorithm, 0); CloseHandle(file);
      *error = "read"; return std::string();
    }
    if (bytesRead && !BCRYPT_SUCCESS(BCryptHashData(hash, buffer.data(), bytesRead, 0))) {
      BCryptDestroyHash(hash); BCryptCloseAlgorithmProvider(algorithm, 0); CloseHandle(file);
      *error = "digest"; return std::string();
    }
  } while (bytesRead);
  BCryptFinishHash(hash, hashBytes.data(), hashLength, 0);
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  CloseHandle(file);
  static const char hex[] = "0123456789abcdef";
  std::string result;
  result.reserve(hashBytes.size() * 2);
  for (UCHAR byte : hashBytes) { result.push_back(hex[byte >> 4]); result.push_back(hex[byte & 0x0f]); }
  return result;
}

double timeHash(const std::wstring& path, DWORD buffer, std::string* digest, std::string* error) {
  Clock::time_point t0 = Clock::now();
  *digest = sha256FileWithBuffer(path, buffer, error);
  return elapsedMs(t0, Clock::now());
}

std::vector<int> matchingWithKeys(const std::vector<Build>& builds,
                                  const std::vector<std::string>& keys,
                                  const std::string& filter) {
  std::vector<int> rows;
  const std::string needle = lower(trim(filter));
  for (size_t i = 0; i < builds.size(); ++i) {
    if (needle.empty()) { rows.push_back((int)i); continue; }
    if (keys[i].find(needle) != std::string::npos) rows.push_back((int)i);
  }
  return rows;
}

std::vector<std::string> makeKeys(const std::vector<Build>& builds) {
  std::vector<std::string> keys;
  keys.reserve(builds.size());
  for (const Build& b : builds) keys.push_back(lower(b.package + " " + b.version + " " + b.platform + " " + b.filename));
  return keys;
}

void reportCase(const char* name, double productMs, double referenceMs, size_t rows) {
  printf("%-28s product_ms=%9.3f  reference_ms=%9.3f  speedup=%5.2fx  rows=%zu\n",
         name, productMs, referenceMs, referenceMs > 0 ? productMs / referenceMs : 0.0, rows);
}

}  // namespace

int main(int argc, char** argv) {
  const size_t buildCount = argc > 1 ? (size_t)strtoull(argv[1], nullptr, 10) : 2000;
  const int filterRounds = argc > 2 ? atoi(argv[2]) : 200;
  const char* hashPath = argc > 3 ? argv[3] : nullptr;

  std::vector<Build> source = makeBuilds(buildCount);

  // ------------------------------------------------------------- sort
  {
    std::vector<Build> a = source;
    Clock::time_point t0 = Clock::now();
    sortBuilds(&a);
    Clock::time_point t1 = Clock::now();

    std::vector<Build> b = source;
    const std::vector<std::string> keys = makeKeys(source);
    std::vector<size_t> order(b.size());
    for (size_t i = 0; i < order.size(); ++i) order[i] = i;
    Clock::time_point t2 = Clock::now();
    std::sort(order.begin(), order.end(), [&](size_t x, size_t y) {
      if (!iequals(a[x].package, a[y].package)) return keys[x] < keys[y];
      if (a[x].platform != a[y].platform) return a[x].platform < a[y].platform;
      return a[x].version > a[y].version;
    });
    std::vector<Build> c;
    c.reserve(b.size());
    for (size_t i : order) c.push_back(source[i]);
    Clock::time_point t3 = Clock::now();
    reportCase("sortBuilds", elapsedMs(t0, t1), elapsedMs(t2, t3), a.size());
    printf("  (reference includes the index sort AND rebuilding %zu builds)\n", c.size());
  }

  // ---------------------------------------------------------- matching
  {
    Catalog product;
    product.builds = source;
    const std::vector<std::string> keys = makeKeys(source);
    const char* filters[] = { "", "vendor7", "windows-x64", "setup.exe", "1.4" };

    double productMs = 0;
    double referenceMs = 0;
    size_t rows = 0;
    for (int round = 0; round < filterRounds; ++round) {
      const char* f = filters[round % 5];
      Clock::time_point t0 = Clock::now();
      std::vector<int> got = product.matching(f);
      Clock::time_point t1 = Clock::now();
      std::vector<int> want = matchingWithKeys(source, keys, f);
      Clock::time_point t2 = Clock::now();
      productMs += elapsedMs(t0, t1);
      referenceMs += elapsedMs(t1, t2);
      (void)want;
      rows = got.size();
    }
    reportCase("Catalog::matching (warm x rounds)", productMs, referenceMs, rows);
    printf("  per call: product=%.4f ms  reference=%.4f ms  over %zu builds (%d rounds)\n",
           productMs / filterRounds, referenceMs / filterRounds, buildCount, filterRounds);
  }

  // ------------------------------------------------------------ sha256
  if (hashPath) {
    const std::wstring wide = toWide(hashPath);
    for (int round = 0; round < 3; ++round) {
      std::string error;
      Clock::time_point t0 = Clock::now();
      const std::string digest = sha256File(wide, &error);
      Clock::time_point t1 = Clock::now();
      printf("sha256File (product) r%d       ms=%9.3f  digest=%s  error=%s\n", round,
             elapsedMs(t0, t1), digest.substr(0, 16).c_str(), error.c_str());
    }
    for (DWORD buffer : { 65536u, 262144u, 1048576u }) {
      double best = 1e30;
      std::string digest;
      std::string error;
      for (int round = 0; round < 3; ++round) {
        double ms = timeHash(wide, buffer, &digest, &error);
        if (ms < best) best = ms;
      }
      printf("sha256File reference buf=%7u ms=%9.3f  digest=%s\n", buffer, best, digest.substr(0, 16).c_str());
    }
  }
  return 0;
}
