// str_test.cpp - checks for core/include/inc/str.hpp.
//
// Self-contained: prints one line per check and returns non-zero if any check
// failed. Every check asserts an exact expected value.
//
// The UTF-8 / UTF-16 bridge is the part worth guarding: Windows talks UTF-16,
// the wire and files talk UTF-8, and a silent mix-up produces mojibake rather
// than an error, so both directions are tested with real multi-byte text.

#include "inc/str.hpp"

#include <cstdio>
#include <string>
#include <vector>

using namespace inc;
using std::string;
using std::vector;

static int g_fail = 0;
static int g_total = 0;

static void check(bool cond, const string& what) {
  g_total++;
  if (cond) {
    printf("ok   %s\n", what.c_str());
  } else {
    g_fail++;
    printf("FAIL %s\n", what.c_str());
  }
}

static void checkEq(const string& got, const string& want, const string& what) {
  g_total++;
  if (got == want) {
    printf("ok   %s\n", what.c_str());
  } else {
    g_fail++;
    printf("FAIL %s\n       got  [%s] (len %zu)\n       want [%s] (len %zu)\n",
           what.c_str(), got.c_str(), got.size(), want.c_str(), want.size());
  }
}

// The UTF-8 byte sequences used below, spelled out so the source file's own
// encoding cannot change what is being tested.
static const string CN = "\xE4\xB8\xAD\xE6\x96\x87";       // 中文
static const string EMOJI = "\xF0\x9F\x98\x80";            // U+1F600
static const string E_ACUTE = "\xC3\xA9";                  // é, 2-byte

int main() {
  // ---- toWide / toUtf8 round trips --------------------------------------
  {
    const string ascii = "Hello, World!";
    checkEq(toUtf8(toWide(ascii)), ascii, "utf: ascii round-trips");
    check(toWide(ascii).size() == ascii.size(), "utf: ascii is one wchar per byte");
  }
  {
    checkEq(toUtf8(toWide(CN)), CN, "utf: chinese round-trips");
    check(toWide(CN).size() == 2, "utf: chinese is two UTF-16 units");
  }
  {
    checkEq(toUtf8(toWide(E_ACUTE)), E_ACUTE, "utf: 2-byte char round-trips");
    check(toWide(E_ACUTE).size() == 1, "utf: 2-byte char is one UTF-16 unit");
  }
  {
    checkEq(toUtf8(toWide(EMOJI)), EMOJI, "utf: emoji round-trips");
    check(toWide(EMOJI).size() == 2, "utf: emoji becomes a surrogate pair");
    check((uint16_t)toWide(EMOJI)[0] == 0xD83D, "utf: emoji high surrogate is D83D");
    check((uint16_t)toWide(EMOJI)[1] == 0xDE00, "utf: emoji low surrogate is DE00");
  }
  {
    const string mixed = "a" + CN + EMOJI + "b";
    checkEq(toUtf8(toWide(mixed)), mixed, "utf: mixed ascii/cjk/emoji round-trips");
  }

  // ---- a lone embedded NUL ----------------------------------------------
  {
    const string withNul("a\0b", 3);
    std::wstring w = toWide(withNul);
    check(w.size() == 3, "utf: embedded NUL is one UTF-16 unit");
    check(w.size() == 3 && w[0] == L'a' && w[1] == L'\0' && w[2] == L'b',
          "utf: embedded NUL keeps its position and neighbours");
    checkEq(toUtf8(w), withNul, "utf: embedded NUL survives the round trip");
  }

  // ---- invalid UTF-8 becomes U+FFFD, not a dropped byte ------------------
  {
    const string bad("\xFF", 1);
    std::wstring w = toWide(bad);
    check(w.size() == 1 && w[0] == 0xFFFD, "utf: invalid byte becomes U+FFFD");
    const string truncated = "\xE4\xB8";  // first two bytes of 中
    std::wstring tw = toWide(truncated);
    check(tw.size() == 1 && tw[0] == 0xFFFD, "utf: truncated sequence becomes U+FFFD");
  }

  // ---- basics ------------------------------------------------------------
  {
    check(startsWith("hello.txt", "hello"), "basics: startsWith positive");
    check(!startsWith("hello.txt", "ello"), "basics: startsWith negative");
    check(startsWith("abc", "abc"), "basics: startsWith equal strings");
    check(!startsWith("ab", "abc"), "basics: startsWith longer prefix is false");
    check(endsWith("hello.txt", ".txt"), "basics: endsWith positive");
    check(!endsWith("hello.txt", ".md"), "basics: endsWith negative");
    check(endsWith("abc", "abc"), "basics: endsWith equal strings");
  }
  {
    checkEq(lower("HeLLo-123"), "hello-123", "basics: lower");
    checkEq(upper("HeLLo-123"), "HELLO-123", "basics: upper");
    check(iequals("File.TXT", "file.txt"), "basics: iequals positive");
    check(!iequals("File.TXT", "file.md"), "basics: iequals negative");
    check(!iequals("a", "ab"), "basics: iequals length mismatch");
  }
  {
    checkEq(trim("  \t x \n"), "x", "basics: trim strips both ends");
    checkEq(trim("x"), "x", "basics: trim leaves clean text alone");
    checkEq(trim("   "), "", "basics: trim of all whitespace is empty");
  }
  {
    checkEq(padRight("ab", 5), "ab   ", "basics: padRight pads with spaces");
    checkEq(padRight("abcdef", 3), "abcdef", "basics: padRight never truncates");
    checkEq(padRight("abc", 3), "abc", "basics: padRight exact length unchanged");
  }
  {
    checkEq(replaceAll("a.b.c", ".", "/"), "a/b/c", "basics: replaceAll all occurrences");
    checkEq(replaceAll("aaa", "aa", "b"), "ba", "basics: replaceAll does not re-scan output");
    checkEq(replaceAll("abc", "", "x"), "abc", "basics: replaceAll empty needle is a no-op");
    checkEq(replaceAll("abc", "z", "x"), "abc", "basics: replaceAll absent needle is a no-op");
  }

  // ---- split / words -----------------------------------------------------
  {
    vector<string> v = split("a,b,c", ',');
    check(v.size() == 3, "split: three pieces");
    check(v.size() == 3 && v[0] == "a" && v[1] == "b" && v[2] == "c", "split: pieces exact");
    vector<string> e = split("a,,c", ',');
    check(e.size() == 3 && e[1].empty(), "split: empty field preserved");
    vector<string> one = split("abc", ',');
    check(one.size() == 1 && one[0] == "abc", "split: no separator yields one piece");
    vector<string> empty = split("", ',');
    check(empty.size() == 1 && empty[0].empty(), "split: empty string yields one empty piece");
  }
  {
    vector<string> w = words("  a   b\tc\n");
    check(w.size() == 3, "words: collapses runs of whitespace");
    check(w.size() == 3 && w[0] == "a" && w[1] == "b" && w[2] == "c", "words: pieces exact");
    check(words("").empty(), "words: empty input yields no pieces");
    check(words("   ").empty(), "words: whitespace only yields no pieces");
  }
  {
    vector<string> v;
    v.push_back("a");
    v.push_back("b");
    v.push_back("c");
    checkEq(join(v, ", "), "a, b, c", "join: joins with separator");
    checkEq(join(vector<string>(), ","), "", "join: empty vector yields empty string");
  }

  // ---- humanSize boundaries ---------------------------------------------
  {
    checkEq(humanSize(0ULL), "0 B", "humanSize: 0");
    checkEq(humanSize(1023ULL), "1023 B", "humanSize: 1023 stays bytes");
    checkEq(humanSize(1024ULL), "1.0 KB", "humanSize: 1024 becomes 1.0 KB");
    checkEq(humanSize(1024ULL * 1024ULL), "1.0 MB", "humanSize: 1 MiB becomes 1.0 MB");
    checkEq(humanSize(1024ULL * 1024ULL * 1024ULL), "1.0 GB", "humanSize: 1 GiB becomes 1.0 GB");
    checkEq(humanSize(5ULL * 1024ULL * 1024ULL * 1024ULL), "5.0 GB",
            "humanSize: 5 GiB becomes 5.0 GB");
    checkEq(humanSize(1536ULL * 1024ULL * 1024ULL), "1.5 GB", "humanSize: 1.5 GiB");
  }

  printf("\n%d checks, %d failed\n", g_total, g_fail);
  return g_fail == 0 ? 0 : 1;
}
