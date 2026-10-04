// itbt-pack.cpp - build an .itbt tool container.
//
// .itbt is the single-file form of an Infinity Toolbox plugin: the directory
// the installer would have written, flattened into one file with a SHA-256 per
// entry so a container that was edited in transit is refused rather than run.
// work/ITBT-FORMAT.md is the contract and this program is the only writer of
// it; everything below is that format, written out literally.
//
//   itbt-pack --dir <plugin dir> --out <name.itbt>
//             [--name N] [--version V] [--exe relative/path] [--deflate]
//
// No third party library is used. Little-endian integers and lengths are
// written by hand, because the loader reads them the same way and a struct
// would silently disagree about padding.
//
// deflate is optional in the format. This build has no zlib - the MinGW
// toolchain here does not ship zlib.h - so --deflate is accepted and then
// stored uncompressed, with a notice, rather than pretending to compress.

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace {

// ---------------------------------------------------------------- SHA-256
//
// Written here rather than linked, so the packer depends on nothing but the
// compiler. A round trip against the loader - which hashes through Windows
// CNG - is the test that the two agree.

inline uint32_t rotr(uint32_t x, uint32_t n) { return (x >> n) | (x << (32 - n)); }

const uint32_t kSha256K[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

class Sha256 {
 public:
  void update(const void* data, size_t n) {
    const uint8_t* p = static_cast<const uint8_t*>(data);
    total_ += n;
    while (n) {
      const size_t take = std::min(n, sizeof(block_) - fill_);
      std::memcpy(block_ + fill_, p, take);
      fill_ += take;
      p += take;
      n -= take;
      if (fill_ == sizeof(block_)) { transform(block_); fill_ = 0; }
    }
  }

  std::string hex() {
    const uint64_t bits = total_ * 8;
    const uint8_t one = 0x80;
    update(&one, 1);
    const uint8_t zero = 0;
    while (fill_ != 56) update(&zero, 1);
    uint8_t length[8];
    for (int i = 0; i < 8; i++) length[i] = static_cast<uint8_t>(bits >> (56 - 8 * i));
    update(length, 8);

    static const char* digits = "0123456789abcdef";
    std::string out;
    out.reserve(64);
    for (int i = 0; i < 8; i++) {
      for (int b = 3; b >= 0; b--) {
        const uint8_t byte = static_cast<uint8_t>(h_[i] >> (8 * b));
        out.push_back(digits[byte >> 4]);
        out.push_back(digits[byte & 0x0f]);
      }
    }
    return out;
  }

 private:
  void transform(const uint8_t* p) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++) {
      w[i] = (static_cast<uint32_t>(p[4 * i]) << 24) | (static_cast<uint32_t>(p[4 * i + 1]) << 16) |
             (static_cast<uint32_t>(p[4 * i + 2]) << 8) | static_cast<uint32_t>(p[4 * i + 3]);
    }
    for (int i = 16; i < 64; i++) {
      const uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      const uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h_[0], b = h_[1], c = h_[2], d = h_[3];
    uint32_t e = h_[4], f = h_[5], g = h_[6], h = h_[7];
    for (int i = 0; i < 64; i++) {
      const uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const uint32_t ch = (e & f) ^ (~e & g);
      const uint32_t t1 = h + s1 + ch + kSha256K[i] + w[i];
      const uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
      const uint32_t t2 = s0 + maj;
      h = g; g = f; f = e; e = d + t1;
      d = c; c = b; b = a; a = t1 + t2;
    }
    h_[0] += a; h_[1] += b; h_[2] += c; h_[3] += d;
    h_[4] += e; h_[5] += f; h_[6] += g; h_[7] += h;
  }

  uint32_t h_[8] = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                     0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };
  uint8_t block_[64] = {};
  size_t fill_ = 0;
  uint64_t total_ = 0;
};

std::string sha256Hex(const void* data, size_t n) {
  Sha256 hash;
  hash.update(data, n);
  return hash.hex();
}

// ---------------------------------------------------------------- little endian

void putU16(std::string& out, uint16_t v) {
  out.push_back(static_cast<char>(v & 0xff));
  out.push_back(static_cast<char>((v >> 8) & 0xff));
}

void putU32(std::string& out, uint32_t v) {
  for (int i = 0; i < 4; i++) out.push_back(static_cast<char>((v >> (8 * i)) & 0xff));
}

void putU64(std::string& out, uint64_t v) {
  for (int i = 0; i < 8; i++) out.push_back(static_cast<char>((v >> (8 * i)) & 0xff));
}

// ---------------------------------------------------------------- paths

// A path is usable only if it is relative, uses /, and has no component that
// climbs out of the extraction directory. This is rule 1 of the format, and
// the writer checks it too - a container that escapes the plugin root must not
// be possible to produce from here either.
bool safeRelativePath(const std::string& path, std::string* why) {
  if (path.empty()) { *why = "empty path"; return false; }
  if (path[0] == '/' || path[0] == '\\') { *why = "absolute path: " + path; return false; }
  if (path.find(':') != std::string::npos) { *why = "drive-qualified path: " + path; return false; }
  size_t start = 0;
  for (;;) {
    const size_t slash = path.find('/', start);
    const std::string part =
        path.substr(start, slash == std::string::npos ? std::string::npos : slash - start);
    if (part.empty()) { *why = "empty component in: " + path; return false; }
    if (part == "." || part == "..") {
      *why = "unsafe component '" + part + "' in: " + path;
      return false;
    }
    if (slash == std::string::npos) break;
    start = slash + 1;
  }
  return true;
}

std::string jsonEscape(const std::string& s) {
  std::string out;
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else out.push_back(static_cast<char>(c));
    }
  }
  return out;
}

// ---------------------------------------------------------------- io

bool readFile(const fs::path& path, std::string* out, std::string* error) {
  std::ifstream in(path, std::ios::binary);
  if (!in) { *error = "cannot open " + path.string(); return false; }
  in.seekg(0, std::ios::end);
  const std::streamoff size = in.tellg();
  if (size < 0) { *error = "cannot measure " + path.string(); return false; }
  in.seekg(0, std::ios::beg);
  out->resize(static_cast<size_t>(size));
  if (size && !in.read(&(*out)[0], size)) { *error = "cannot read " + path.string(); return false; }
  return true;
}

bool writeFile(const fs::path& path, const std::string& bytes, std::string* error) {
  std::ofstream file(path, std::ios::binary | std::ios::trunc);
  if (!file) { *error = "cannot create " + path.string(); return false; }
  file.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  if (!file) { *error = "cannot write " + path.string(); return false; }
  return true;
}

void usage() {
  std::fprintf(stderr,
    "itbt-pack - build an Infinity Toolbox .itbt container\n"
    "\n"
    "usage: itbt-pack --dir <plugin dir> --out <name.itbt>\n"
    "                 [--name N] [--version V] [--exe relative/path] [--deflate]\n"
    "\n"
    "  --dir       directory holding item.json and the plugin's files\n"
    "  --out       path of the .itbt to write\n"
    "  --name      plugin display name (default: item.json, else the directory name)\n"
    "  --version   plugin version      (default: item.json, else 1.0.0)\n"
    "  --exe       entry executable relative path (default: item.json, else the first .exe)\n"
    "  --deflate   request deflate; this build has no zlib and stores instead\n"
    "\n"
    "If the source directory has no item.json, one is generated from the\n"
    "arguments above and written into the container.\n");
}

}  // namespace

int main(int argc, char** argv) {
  std::map<std::string, std::string> options;
  bool wantDeflate = false;

  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    if (arg == "--help" || arg == "-h") { usage(); return 0; }
    if (arg == "--deflate") { wantDeflate = true; continue; }
    if (arg.size() > 2 && arg[0] == '-' && arg[1] == '-') {
      const size_t eq = arg.find('=');
      if (eq != std::string::npos) { options[arg.substr(2, eq - 2)] = arg.substr(eq + 1); continue; }
      if (i + 1 >= argc) {
        std::fprintf(stderr, "itbt-pack: %s needs a value\n", arg.c_str());
        return 2;
      }
      options[arg.substr(2)] = argv[++i];
      continue;
    }
    std::fprintf(stderr, "itbt-pack: unexpected argument '%s'\n", arg.c_str());
    usage();
    return 2;
  }

  if (argc == 1) { usage(); return 0; }

  const auto opt = [&](const char* key) -> std::string {
    const auto it = options.find(key);
    return it == options.end() ? std::string() : it->second;
  };

  const std::string dirArg = opt("dir");
  const std::string outArg = opt("out");
  if (dirArg.empty() || outArg.empty()) {
    std::fprintf(stderr, "itbt-pack: --dir and --out are both required\n");
    usage();
    return 2;
  }

  std::error_code ec;
  const fs::path sourceDir = fs::weakly_canonical(fs::path(dirArg), ec);
  if (ec || !fs::is_directory(sourceDir, ec)) {
    std::fprintf(stderr, "itbt-pack: not a directory: %s\n", dirArg.c_str());
    return 1;
  }

  // Every regular file below the directory, relative to it, with / separators.
  struct Source { std::string path; std::string bytes; std::string sha256; };
  std::vector<Source> sources;
  for (const fs::directory_entry& entry :
       fs::recursive_directory_iterator(sourceDir, fs::directory_options::skip_permission_denied, ec)) {
    if (ec) break;
    std::error_code fileError;
    if (entry.is_symlink(fileError) || !entry.is_regular_file(fileError)) continue;
    const std::string relative = entry.path().lexically_relative(sourceDir).generic_string();
    std::string why;
    if (!safeRelativePath(relative, &why)) {
      std::fprintf(stderr, "itbt-pack: refusing %s\n", why.c_str());
      return 1;
    }
    Source source;
    source.path = relative;
    if (!readFile(entry.path(), &source.bytes, &why)) {
      std::fprintf(stderr, "itbt-pack: %s\n", why.c_str());
      return 1;
    }
    source.sha256 = sha256Hex(source.bytes.data(), source.bytes.size());
    sources.push_back(source);
  }
  if (sources.empty()) {
    std::fprintf(stderr, "itbt-pack: %s holds no files\n", dirArg.c_str());
    return 1;
  }

  // item.json first: the loader reads it to learn the plugin's name, and a
  // person opening the container expects the manifest at the front.
  std::sort(sources.begin(), sources.end(), [](const Source& a, const Source& b) {
    if (a.path == "item.json") return true;
    if (b.path == "item.json") return false;
    return a.path < b.path;
  });

  const auto findSource = [&](const std::string& path) -> Source* {
    for (Source& s : sources) if (s.path == path) return &s;
    return nullptr;
  };

  // Name / version / exe: the command line wins, then item.json, then a
  // sensible default. item.json is only parsed loosely - this tool should not
  // grow a JSON parser to read three strings.
  const auto jsonField = [](const std::string& text, const std::string& field) -> std::string {
    const std::string key = "\"" + field + "\"";
    size_t at = text.find(key);
    if (at == std::string::npos) return std::string();
    at = text.find(':', at + key.size());
    if (at == std::string::npos) return std::string();
    at++;
    while (at < text.size() && (text[at] == ' ' || text[at] == '\t' || text[at] == '\n' ||
                                text[at] == '\r')) at++;
    if (at >= text.size() || text[at] != '"') return std::string();
    at++;
    std::string value;
    while (at < text.size() && text[at] != '"') {
      if (text[at] == '\\' && at + 1 < text.size()) at++;
      value.push_back(text[at++]);
    }
    return value;
  };

  Source* manifest = findSource("item.json");
  const std::string manifestText = manifest ? manifest->bytes : std::string();

  std::string name = opt("name");
  if (name.empty()) name = jsonField(manifestText, "name");
  if (name.empty()) name = sourceDir.filename().string();

  std::string version = opt("version");
  if (version.empty()) version = jsonField(manifestText, "version");
  if (version.empty()) version = "1.0.0";

  std::string exe = opt("exe");
  if (exe.empty()) exe = jsonField(manifestText, "filename");
  if (exe.empty()) {
    for (const Source& s : sources) {
      if (s.path.size() > 4) {
        std::string tail = s.path.substr(s.path.size() - 4);
        for (char& c : tail) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (tail == ".exe") { exe = s.path; break; }
      }
    }
  }

  std::string why;
  if (!safeRelativePath(exe, &why)) {
    std::fprintf(stderr, "itbt-pack: bad --exe: %s\n", why.c_str());
    return 1;
  }
  if (!findSource(exe)) {
    std::fprintf(stderr, "itbt-pack: the executable '%s' is not one of the packed files\n",
                 exe.c_str());
    return 1;
  }

  // No item.json in the source: build the one the loader reads, from the same
  // values that go into the archive header, so the extracted directory and the
  // container agree.
  if (!manifest) {
    std::string generated = "{\n";
    generated += "  \"name\": \"" + jsonEscape(name) + "\",\n";
    generated += "  \"version\": \"" + jsonEscape(version) + "\",\n";
    generated += "  \"filename\": \"" + jsonEscape(exe) + "\"\n";
    generated += "}\n";
    Source source;
    source.path = "item.json";
    source.bytes = generated;
    source.sha256 = sha256Hex(source.bytes.data(), source.bytes.size());
    sources.insert(sources.begin(), source);
  }

  if (wantDeflate) {
    std::fprintf(stderr,
      "itbt-pack: --deflate requested, but this build has no zlib (zlib.h is not in\n"
      "           the MinGW toolchain), so entries are stored uncompressed.\n");
  }

  // ---------------------------------------------------------- serialise

  // The header and the entry table are built here before a byte is written.
  // item.json stays first in the table, and the payload follows the table in
  // that same order, so entry offsets are computed, not back-patched.
  std::string prefix;
  prefix += "ITBT";
  putU16(prefix, 1);                     // version
  putU16(prefix, 0);                     // flags, patched below
  putU32(prefix, 0);                     // headerSize, patched below
  putU32(prefix, static_cast<uint32_t>(sources.size()));
  putU32(prefix, 0);                     // totalSize, patched below
  putU16(prefix, static_cast<uint16_t>(name.size()));    prefix += name;
  putU16(prefix, static_cast<uint16_t>(version.size())); prefix += version;
  putU16(prefix, static_cast<uint16_t>(exe.size()));     prefix += exe;

  size_t tableSize = 0;
  for (const Source& s : sources) tableSize += 2 + s.path.size() + 8 + 8 + 8 + 32 + 1;
  const uint32_t headerSize = static_cast<uint32_t>(prefix.size() + tableSize);

  std::string table;
  uint64_t cursor = headerSize;
  const bool anyDeflate = false;  // store only in this build (no zlib)
  for (const Source& s : sources) {
    putU16(table, static_cast<uint16_t>(s.path.size()));
    table += s.path;
    putU64(table, cursor);
    putU64(table, static_cast<uint64_t>(s.bytes.size()));
    putU64(table, static_cast<uint64_t>(s.bytes.size()));   // rawSize == storedSize for store
    for (int i = 0; i < 32; i++) {
      const std::string pair = s.sha256.substr(static_cast<size_t>(i) * 2, 2);
      table.push_back(static_cast<char>(std::stoi(pair, nullptr, 16)));
    }
    table.push_back(0);                                     // compression = store
    cursor += static_cast<uint64_t>(s.bytes.size());
  }

  // Patch the three little-endian fields now that they are known. The offsets
  // are fixed: 4 version, 6 flags, 8 headerSize, 16 totalSize.
  const auto patchU16 = [](std::string& s, size_t at, uint16_t v) {
    s[at] = static_cast<char>(v & 0xff);
    s[at + 1] = static_cast<char>((v >> 8) & 0xff);
  };
  const auto patchU32 = [](std::string& s, size_t at, uint32_t v) {
    for (int i = 0; i < 4; i++) s[at + i] = static_cast<char>((v >> (8 * i)) & 0xff);
  };
  patchU16(prefix, 6, anyDeflate ? 1 : 0);
  patchU32(prefix, 8, headerSize);
  patchU32(prefix, 16, static_cast<uint32_t>(cursor));

  std::string container = prefix + table;
  for (const Source& s : sources) container += s.bytes;

  if (!writeFile(fs::path(outArg), container, &why)) {
    std::fprintf(stderr, "itbt-pack: %s\n", why.c_str());
    return 1;
  }

  std::fprintf(stdout, "itbt-pack  %s  v%s\n", name.c_str(), version.c_str());
  for (const Source& s : sources) {
    std::fprintf(stdout, "  %-40s %10llu B  store  %s\n", s.path.c_str(),
                 static_cast<unsigned long long>(s.bytes.size()), s.sha256.c_str());
  }
  std::fprintf(stdout, "wrote %s  %llu B  %llu entries  exe=%s\n", outArg.c_str(),
               static_cast<unsigned long long>(container.size()),
               static_cast<unsigned long long>(sources.size()), exe.c_str());
  std::fprintf(stdout, "itbt sha256 %s\n", sha256Hex(container.data(), container.size()).c_str());
  return 0;
}
