// json_test.cpp - checks for core/include/inc/json.hpp.
//
// Self-contained: prints one line per check and returns non-zero if any check
// failed. Every check asserts an exact expected value, not merely "non-empty",
// so a regression that changed the output would turn the line red.
//
// The number checks are the reason this file matters: a manifest carries
// GitHub ids and sizes that are meaningful as digits, and the header promises
// the original text survives a parse -> dump round trip.

#include "inc/json.hpp"

#include <cstdio>
#include <string>
#include <vector>

using namespace inc;
using std::string;

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

// Like check(), but prints both sides when it fails so the report is useful.
static void checkEq(const string& got, const string& want, const string& what) {
  g_total++;
  if (got == want) {
    printf("ok   %s\n", what.c_str());
  } else {
    g_fail++;
    printf("FAIL %s\n       got  [%s]\n       want [%s]\n", what.c_str(), got.c_str(),
           want.c_str());
  }
}

static void checkEqI(long long got, long long want, const string& what) {
  g_total++;
  if (got == want) {
    printf("ok   %s\n", what.c_str());
  } else {
    g_fail++;
    printf("FAIL %s\n       got  %lld\n       want %lld\n", what.c_str(), got, want);
  }
}

int main() {
  // ---- round trip: parse -> dump -> parse gives the same structure --------
  {
    const string src = "{\"a\":1,\"b\":[true,false,null],\"c\":\"hi\"}";
    bool ok = false;
    Json first = Json::parse(src, &ok);
    check(ok, "round-trip: first parse succeeds");
    const string d1 = first.dump();
    bool ok2 = false;
    Json second = Json::parse(d1, &ok2);
    check(ok2, "round-trip: reparse succeeds");
    checkEq(second.dump(), d1, "round-trip: dump is stable across parse");
    checkEq(d1, "{\"a\":1,\"b\":[true,false,null],\"c\":\"hi\"}",
            "round-trip: exact serialisation");
  }

  // ---- escapes -----------------------------------------------------------
  {
    // JSON text:  "a\"b\\c\nd\te"
    bool ok = false;
    Json j = Json::parse("\"a\\\"b\\\\c\\nd\\te\"", &ok);
    check(ok, "escapes: parse succeeds");
    checkEq(j.str(), string("a\"b\\c\nd\te"), "escapes: decoded bytes are exact");
    checkEq(j.dump(), "\"a\\\"b\\\\c\\nd\\te\"", "escapes: re-encoded bytes are exact");
  }
  {
    // \u0041 -> 'A', \u4e2d -> U+4E2D (E4 B8 AD)
    bool ok = false;
    Json j = Json::parse("\"\\u0041\\u4e2d\"", &ok);
    check(ok, "\\uXXXX: parse succeeds");
    checkEq(j.str(), string("A\xE4\xB8\xAD"), "\\uXXXX: decodes to A + U+4E2D");
  }
  {
    // A surrogate pair for U+1F600, which is 4 UTF-8 bytes.
    bool ok = false;
    Json j = Json::parse("\"\\uD83D\\uDE00\"", &ok);
    check(ok, "surrogate pair: parse succeeds");
    checkEq(j.str(), string("\xF0\x9F\x98\x80"), "surrogate pair: joins to U+1F600");
    checkEq(j.dump(), "\"\xF0\x9F\x98\x80\"", "surrogate pair: dumps as raw UTF-8");
  }
  {
    // A literal multi-byte UTF-8 character, no escapes at all.
    bool ok = false;
    Json j = Json::parse("\"\xE4\xB8\xAD\xE6\x96\x87\xF0\x9F\x98\x80\"", &ok);
    check(ok, "literal utf-8: parse succeeds");
    checkEq(j.str(), string("\xE4\xB8\xAD\xE6\x96\x87\xF0\x9F\x98\x80"),
            "literal utf-8: bytes preserved");
    checkEq(j.dump(), "\"\xE4\xB8\xAD\xE6\x96\x87\xF0\x9F\x98\x80\"",
            "literal utf-8: dump preserves bytes");
  }

  // ---- numbers: the original text must survive --------------------------
  {
    const string src = "[0,-5,3.14,1e3,2.5e-3,1234567890123456789]";
    bool ok = false;
    Json j = Json::parse(src, &ok);
    check(ok, "numbers: parse succeeds");
    checkEq(j.dump(), src, "numbers: all forms round-trip byte-exact");
    checkEq(j[5].dump(), "1234567890123456789",
            "numbers: 19-digit id survives round trip unchanged");
    checkEq(j[2].dump(), "3.14", "numbers: decimal text kept as written");
    checkEq(j[3].dump(), "1e3", "numbers: exponent text kept as written");
    checkEq(j[0].dump(), "0", "numbers: zero kept as written");
    checkEq(j[1].dump(), "-5", "numbers: negative kept as written");
    checkEqI(j[1].asInt(-99), -5, "numbers: asInt on negative");
    check(j[2].asNumber() > 3.13 && j[2].asNumber() < 3.15, "numbers: asNumber on decimal");
    // The raw text above survives, but the numeric accessor goes through a
    // double, so a 19-digit id comes back rounded. Asserting the exact value
    // keeps that limitation visible rather than silently accepted.
    checkEqI(j[5].asInt(-1), 1234567890123456789LL,
             "numbers: asInt on 19-digit id is exact");
  }

  // ---- nesting -----------------------------------------------------------
  {
    Json inner = Json(1);
    for (int k = 0; k < 100; k++) {
      Json a = Json::array();
      a.push(inner);
      inner = a;
    }
    const string d1 = inner.dump();
    bool ok = false;
    Json again = Json::parse(d1, &ok);
    check(ok, "nesting: 100-deep array reparses");
    checkEq(again.dump(), d1, "nesting: 100-deep array round-trips");
  }
  {
    bool ok = false;
    Json emptyArr = Json::parse("[]", &ok);
    check(ok && emptyArr.isArray() && emptyArr.size() == 0, "nesting: empty array");
    checkEq(emptyArr.dump(), "[]", "nesting: empty array dumps as []");
    Json emptyObj = Json::parse("{}", &ok);
    check(ok && emptyObj.isObject() && emptyObj.size() == 0, "nesting: empty object");
    checkEq(emptyObj.dump(), "{}", "nesting: empty object dumps as {}");
    Json nested = Json::parse("{\"a\":{\"b\":[{\"c\":[]}]}}", &ok);
    check(ok, "nesting: mixed containers parse");
    checkEq(nested.get("a").get("b")[0].get("c").dump(), "[]",
            "nesting: deep accessor reaches the leaf");
  }

  // ---- accessors and defaults -------------------------------------------
  {
    Json o = Json::object();
    o.set("s", Json("x"));
    o.set("i", Json(42));
    o.set("b", Json(true));
    checkEq(o.s("s"), "x", "accessor: s() reads a string");
    checkEqI(o.i("i"), 42, "accessor: i() reads an integer");
    check(o.b("b") == true, "accessor: b() reads a bool");
    checkEq(o.s("missing"), "", "accessor: s() default is empty");
    checkEq(o.s("missing", "d"), "d", "accessor: s() honours explicit default");
    checkEqI(o.i("missing", -1), -1, "accessor: i() honours explicit default");
    check(o.b("missing", true) == true, "accessor: b() honours explicit default");
    check(o.get("missing").isNull(), "accessor: get() on missing key is null");
    check(o.has("s") && !o.has("missing"), "accessor: has() distinguishes present/absent");
    check(o.get("s").isString() && o.get("i").isNumber() && o.get("b").isBool(),
          "accessor: types are as set");
  }

  // ---- object key order --------------------------------------------------
  {
    Json o = Json::object();
    o.set("z", Json(1));
    o.set("a", Json(2));
    o.set("m", Json(3));
    checkEq(o.dump(), "{\"z\":1,\"a\":2,\"m\":3}", "key order: insertion order preserved");
    bool ok = false;
    Json p = Json::parse("{\"z\":1,\"a\":2,\"m\":3}", &ok);
    checkEq(p.dump(), "{\"z\":1,\"a\":2,\"m\":3}", "key order: parse does not sort keys");
    o.set("a", Json(9));  // overwrite keeps position
    checkEq(o.dump(), "{\"z\":1,\"a\":9,\"m\":3}", "key order: overwrite keeps position");
  }

  // ---- pretty printing ---------------------------------------------------
  {
    Json p = Json::object();
    p.set("a", Json(1));
    checkEq(p.dump(2), "{\n  \"a\": 1\n}", "pretty: two-space indent");
    Json e = Json::array();
    checkEq(e.dump(2), "[]", "pretty: empty array stays compact");
  }

  // ---- malformed input: must report failure through *ok, must not crash ---
  {
    struct Case { const char* text; const char* name; };
    const Case cases[] = {
      { "{\"a\":",     "truncated object value" },
      { "[1,2",        "truncated array" },
      { "{\"a\":1,}",  "trailing comma in object" },
      { "[1,2,]",      "trailing comma in array" },
      { "{a:1}",       "unquoted key" },
      { "\"abc",       "unterminated string" },
      { "",            "empty input" },
      { "tru",         "truncated literal" },
    };
    for (const Case& c : cases) {
      bool ok = true;
      Json::parse(c.text, &ok);
      check(!ok, string("malformed: ") + c.name + " reports failure");
    }
  }

  // ---- trailing garbage (documented probe) -------------------------------
  // Strict JSON requires the whole input to be consumed. The header stops
  // after the first value, so this is expected to be accepted; the check
  // below asserts the strict behaviour so the deviation is visible.
  {
    bool ok = false;
    Json::parse("[1]xyz", &ok);
    check(!ok, "strictness: trailing garbage after a value is rejected");
  }

  printf("\n%d checks, %d failed\n", g_total, g_fail);
  return g_fail == 0 ? 0 : 1;
}
