// json.hpp - the JSON the suite reads and writes.
//
// GitHub speaks JSON and so does every file the suite stores, so this has to
// be real rather than approximate: objects, arrays, numbers, escapes,
// surrogate pairs and both round trips.
//
// It is written here rather than pulled in because the suite is built with no
// third party libraries - the whole point of the C++ port is that a build
// needs nothing but a compiler.
//
// Numbers keep their original text alongside the parsed value. A manifest
// carries ids and sizes that are meaningful as digits; re-printing a parsed
// double would turn 387565520 into 387565520.0000000001 on some platforms,
// and an id that changes shape is a bug that shows up only in production.

#pragma once

#include <string>
#include <vector>
#include <map>
#include <memory>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>

#include "str.hpp"

namespace inc {

class Json {
 public:
  enum class Type { Null, Bool, Number, String, Array, Object };

  Json() : type_(Type::Null), bool_(false), num_(0) {}
  Json(bool b) : type_(Type::Bool), bool_(b), num_(0) {}
  Json(double n) : type_(Type::Number), bool_(false), num_(n) { raw_ = format(n); }
  Json(int n) : type_(Type::Number), bool_(false), num_(n) { raw_ = format((double)n); }
  Json(long long n) : type_(Type::Number), bool_(false), num_(n) { raw_ = format((double)n); }
  Json(const char* s) : type_(Type::String), bool_(false), num_(0), str_(s ? s : "") {}
  Json(const std::string& s) : type_(Type::String), bool_(false), num_(0), str_(s) {}

  static Json array() { Json j; j.type_ = Type::Array; return j; }
  static Json object() { Json j; j.type_ = Type::Object; return j; }

  Type type() const { return type_; }
  bool isNull() const { return type_ == Type::Null; }
  bool isBool() const { return type_ == Type::Bool; }
  bool isNumber() const { return type_ == Type::Number; }
  bool isString() const { return type_ == Type::String; }
  bool isArray() const { return type_ == Type::Array; }
  bool isObject() const { return type_ == Type::Object; }

  bool asBool(bool d = false) const { return type_ == Type::Bool ? bool_ : d; }
  double asNumber(double d = 0) const { return type_ == Type::Number ? num_ : d; }
  long long asInt(long long d = 0) const { return type_ == Type::Number ? (long long)num_ : d; }
  const std::string& asString() const { static const std::string e; return type_ == Type::String ? str_ : e; }
  std::string str(const std::string& d = "") const { return type_ == Type::String ? str_ : d; }

  // Arrays and objects -------------------------------------------------

  size_t size() const {
    if (type_ == Type::Array) return arr_.size();
    if (type_ == Type::Object) return obj_.size();
    return 0;
  }

  void push(const Json& v) { type_ = Type::Array; arr_.push_back(v); }

  Json& operator[](size_t i) { return arr_[i]; }
  const Json& operator[](size_t i) const { return arr_[i]; }

  const std::vector<Json>& items() const { return arr_; }
  std::vector<Json>& items() { return arr_; }

  // Objects keep insertion order. A release asset list that reorders itself
  // between runs is impossible to diff, and diffs are how this project is
  // reviewed.
  void set(const std::string& k, const Json& v) {
    type_ = Type::Object;
    auto it = index_.find(k);
    if (it != index_.end()) { obj_[it->second].second = v; return; }
    index_[k] = obj_.size();
    obj_.push_back({ k, v });
  }

  bool has(const std::string& k) const { return index_.find(k) != index_.end(); }

  const Json& get(const std::string& k) const {
    static const Json nil;
    auto it = index_.find(k);
    return it == index_.end() ? nil : obj_[it->second].second;
  }

  // Convenience accessors: a missing key answers with the default rather
  // than throwing, because half the fields in a GitHub response are absent
  // on some endpoints and treating that as an error would be noise.
  std::string s(const std::string& k, const std::string& d = "") const { return get(k).str(d); }
  long long i(const std::string& k, long long d = 0) const { return get(k).asInt(d); }
  bool b(const std::string& k, bool d = false) const { return get(k).asBool(d); }
  double n(const std::string& k, double d = 0) const { return get(k).asNumber(d); }
  const Json& a(const std::string& k) const { return get(k); }

  const std::vector<std::pair<std::string, Json>>& entries() const { return obj_; }

  // Serialisation ------------------------------------------------------

  std::string dump(int indent = 0) const {
    std::string out;
    write(out, indent, 0);
    return out;
  }

  // Parsing ------------------------------------------------------------

  static Json parse(const std::string& text, bool* ok = nullptr) {
    Parser p(text);
    Json v = p.value();
    if (ok) *ok = p.good();
    return v;
  }

 private:
  Type type_;
  bool bool_;
  double num_;
  std::string raw_;
  std::string str_;
  std::vector<Json> arr_;
  std::vector<std::pair<std::string, Json>> obj_;
  std::map<std::string, size_t> index_;

  static std::string format(double v) {
    if (std::isnan(v) || std::isinf(v)) return "0";
    if (v == (double)(long long)v && std::fabs(v) < 1e15) {
      char buf[32];
      snprintf(buf, sizeof(buf), "%lld", (long long)v);
      return buf;
    }
    char buf[40];
    snprintf(buf, sizeof(buf), "%.17g", v);
    return buf;
  }

  static void escape(std::string& out, const std::string& s) {
    out.push_back('"');
    for (unsigned char c : s) {
      switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        default:
          if (c < 0x20) {
            char buf[8];
            snprintf(buf, sizeof(buf), "\\u%04x", c);
            out += buf;
          } else out.push_back((char)c);
      }
    }
    out.push_back('"');
  }

  void write(std::string& out, int indent, int depth) const {
    const bool pretty = indent > 0;
    const std::string pad = pretty ? std::string((size_t)(indent * (depth + 1)), ' ') : std::string();
    const std::string padEnd = pretty ? std::string((size_t)(indent * depth), ' ') : std::string();

    switch (type_) {
      case Type::Null: out += "null"; break;
      case Type::Bool: out += bool_ ? "true" : "false"; break;
      case Type::Number: out += raw_.empty() ? format(num_) : raw_; break;
      case Type::String: escape(out, str_); break;
      case Type::Array: {
        if (arr_.empty()) { out += "[]"; break; }
        out += "[";
        for (size_t i = 0; i < arr_.size(); i++) {
          if (i) out += ",";
          if (pretty) { out += "\n"; out += pad; }
          arr_[i].write(out, indent, depth + 1);
        }
        if (pretty) { out += "\n"; out += padEnd; }
        out += "]";
        break;
      }
      case Type::Object: {
        if (obj_.empty()) { out += "{}"; break; }
        out += "{";
        for (size_t i = 0; i < obj_.size(); i++) {
          if (i) out += ",";
          if (pretty) { out += "\n"; out += pad; }
          escape(out, obj_[i].first);
          out += pretty ? ": " : ":";
          obj_[i].second.write(out, indent, depth + 1);
        }
        if (pretty) { out += "\n"; out += padEnd; }
        out += "}";
        break;
      }
    }
  }

  struct Parser {
    const std::string& t;
    size_t p = 0;
    bool ok = true;

    explicit Parser(const std::string& text) : t(text) {}

    bool good() const { return ok; }

    void ws() {
      while (p < t.size() && ((unsigned char)t[p] == ' ' || (unsigned char)t[p] == '\t' ||
                              (unsigned char)t[p] == '\n' || (unsigned char)t[p] == '\r')) p++;
    }

    bool literal(const char* s) {
      size_t n = strlen(s);
      if (t.compare(p, n, s) != 0) return false;
      p += n;
      return true;
    }

    Json value() {
      ws();
      if (p >= t.size()) { ok = false; return Json(); }
      char c = t[p];
      if (c == '{') return object();
      if (c == '[') return array();
      if (c == '"') return Json(string());
      if (c == 't') { if (literal("true")) return Json(true); ok = false; return Json(); }
      if (c == 'f') { if (literal("false")) return Json(false); ok = false; return Json(); }
      if (c == 'n') { if (literal("null")) return Json(); ok = false; return Json(); }
      return number();
    }

    Json object() {
      Json o = Json::object();
      p++;  // {
      ws();
      if (p < t.size() && t[p] == '}') { p++; return o; }
      for (;;) {
        ws();
        if (p >= t.size() || t[p] != '"') { ok = false; return o; }
        std::string k = string();
        ws();
        if (p >= t.size() || t[p] != ':') { ok = false; return o; }
        p++;
        o.set(k, value());
        ws();
        if (p < t.size() && t[p] == ',') { p++; continue; }
        if (p < t.size() && t[p] == '}') { p++; break; }
        ok = false;
        break;
      }
      return o;
    }

    Json array() {
      Json a = Json::array();
      p++;  // [
      ws();
      if (p < t.size() && t[p] == ']') { p++; return a; }
      for (;;) {
        a.push(value());
        ws();
        if (p < t.size() && t[p] == ',') { p++; continue; }
        if (p < t.size() && t[p] == ']') { p++; break; }
        ok = false;
        break;
      }
      return a;
    }

    void utf8(std::string& out, unsigned cp) {
      if (cp < 0x80) out.push_back((char)cp);
      else if (cp < 0x800) {
        out.push_back((char)(0xC0 | (cp >> 6)));
        out.push_back((char)(0x80 | (cp & 0x3F)));
      } else if (cp < 0x10000) {
        out.push_back((char)(0xE0 | (cp >> 12)));
        out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back((char)(0x80 | (cp & 0x3F)));
      } else {
        out.push_back((char)(0xF0 | (cp >> 18)));
        out.push_back((char)(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back((char)(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back((char)(0x80 | (cp & 0x3F)));
      }
    }

    unsigned hex4() {
      unsigned v = 0;
      for (int k = 0; k < 4 && p < t.size(); k++, p++) {
        char c = t[p];
        v <<= 4;
        if (c >= '0' && c <= '9') v |= (unsigned)(c - '0');
        else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10);
        else { ok = false; break; }
      }
      return v;
    }

    std::string string() {
      std::string out;
      p++;  // opening quote
      while (p < t.size()) {
        char c = t[p++];
        if (c == '"') return out;
        if (c != '\\') { out.push_back(c); continue; }
        if (p >= t.size()) break;
        char e = t[p++];
        switch (e) {
          case '"': out.push_back('"'); break;
          case '\\': out.push_back('\\'); break;
          case '/': out.push_back('/'); break;
          case 'n': out.push_back('\n'); break;
          case 'r': out.push_back('\r'); break;
          case 't': out.push_back('\t'); break;
          case 'b': out.push_back('\b'); break;
          case 'f': out.push_back('\f'); break;
          case 'u': {
            unsigned cp = hex4();
            // A high surrogate is only half a character; the low half
            // follows in its own escape and the pair has to be joined.
            if (cp >= 0xD800 && cp <= 0xDBFF && p + 1 < t.size() && t[p] == '\\' && t[p + 1] == 'u') {
              p += 2;
              unsigned lo = hex4();
              if (lo >= 0xDC00 && lo <= 0xDFFF) cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            }
            utf8(out, cp);
            break;
          }
          default: out.push_back(e);
        }
      }
      ok = false;
      return out;
    }

    Json number() {
      size_t start = p;
      if (p < t.size() && (t[p] == '-' || t[p] == '+')) p++;
      while (p < t.size() && ((t[p] >= '0' && t[p] <= '9') || t[p] == '.' ||
                              t[p] == 'e' || t[p] == 'E' || t[p] == '+' || t[p] == '-')) p++;
      if (p == start) { ok = false; return Json(); }
      std::string text = t.substr(start, p - start);
      Json j;
      j.type_ = Type::Number;
      j.raw_ = text;
      j.num_ = strtod(text.c_str(), nullptr);
      return j;
    }
  };
};

}  // namespace inc
