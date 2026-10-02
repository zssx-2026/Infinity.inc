// str.hpp - the string helpers the whole suite uses.
//
// Everything here is deliberately small. The suite is built with no third
// party libraries, so the string work that a framework would normally
// provide lives here instead: trimming, splitting, joining, case folding and
// the UTF-8 / UTF-16 bridge the Win32 API needs.
//
// The bridge is the only part that is not obvious. Windows talks UTF-16,
// the wire and the files talk UTF-8, and mixing them silently produces
// mojibake rather than an error - so both directions are explicit and named.

#pragma once

#include <string>
#include <vector>
#include <cstdint>

namespace inc {

using std::string;
using std::vector;

// ---------------------------------------------------------------- basics

inline bool startsWith(const string& s, const string& p) {
  return s.size() >= p.size() && s.compare(0, p.size(), p) == 0;
}

inline bool endsWith(const string& s, const string& p) {
  return s.size() >= p.size() && s.compare(s.size() - p.size(), p.size(), p) == 0;
}

inline string lower(string s) {
  for (char& c : s) if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
  return s;
}

inline string upper(string s) {
  for (char& c : s) if (c >= 'a' && c <= 'z') c = char(c - 'a' + 'A');
  return s;
}

inline bool iequals(const string& a, const string& b) {
  return a.size() == b.size() && lower(a) == lower(b);
}

inline string trim(const string& s) {
  size_t a = 0, b = s.size();
  while (a < b && (unsigned char)s[a] <= ' ') a++;
  while (b > a && (unsigned char)s[b - 1] <= ' ') b--;
  return s.substr(a, b - a);
}

inline string replaceAll(string s, const string& from, const string& to) {
  if (from.empty()) return s;
  size_t at = 0;
  while ((at = s.find(from, at)) != string::npos) {
    s.replace(at, from.size(), to);
    at += to.size();
  }
  return s;
}

inline vector<string> split(const string& s, char sep) {
  vector<string> out;
  string cur;
  for (char c : s) {
    if (c == sep) { out.push_back(cur); cur.clear(); }
    else cur.push_back(c);
  }
  out.push_back(cur);
  return out;
}

// Split on whitespace, dropping empty pieces. Command lines are parsed with
// this, so "a   b" and "a b" have to come out the same.
inline vector<string> words(const string& s) {
  vector<string> out;
  string cur;
  for (char c : s) {
    if ((unsigned char)c <= ' ') {
      if (!cur.empty()) { out.push_back(cur); cur.clear(); }
    } else cur.push_back(c);
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

inline string join(const vector<string>& v, const string& sep) {
  string out;
  for (size_t i = 0; i < v.size(); i++) {
    if (i) out += sep;
    out += v[i];
  }
  return out;
}

inline string padRight(const string& s, size_t n) {
  string out = s;
  while (out.size() < n) out.push_back(' ');
  return out;
}

// ------------------------------------------------------------- numbers

inline string humanSize(uint64_t n) {
  static const char* unit[] = { "B", "KB", "MB", "GB", "TB", "PB" };
  double v = (double)n;
  int i = 0;
  while (v >= 1024.0 && i < 5) { v /= 1024.0; i++; }
  char buf[64];
  if (i == 0) snprintf(buf, sizeof(buf), "%.0f %s", v, unit[i]);
  else snprintf(buf, sizeof(buf), "%.1f %s", v, unit[i]);
  return buf;
}

// ------------------------------------------------------------- utf-8/16

// UTF-8 bytes to UTF-16, as every wide Win32 call wants. Invalid input
// becomes U+FFFD rather than being dropped, so a bad byte shows up as a
// replacement character instead of silently shortening the string.
inline std::wstring toWide(const string& s) {
  std::wstring out;
  size_t i = 0;
  while (i < s.size()) {
    unsigned char c = (unsigned char)s[i];
    uint32_t cp = 0;
    size_t extra = 0;
    if (c < 0x80) { cp = c; extra = 0; }
    else if ((c & 0xE0) == 0xC0) { cp = c & 0x1F; extra = 1; }
    else if ((c & 0xF0) == 0xE0) { cp = c & 0x0F; extra = 2; }
    else if ((c & 0xF8) == 0xF0) { cp = c & 0x07; extra = 3; }
    else { out.push_back(0xFFFD); i++; continue; }

    if (i + extra >= s.size()) { out.push_back(0xFFFD); break; }
    bool ok = true;
    for (size_t k = 1; k <= extra; k++) {
      unsigned char cc = (unsigned char)s[i + k];
      if ((cc & 0xC0) != 0x80) { ok = false; break; }
      cp = (cp << 6) | (cc & 0x3F);
    }
    if (!ok) { out.push_back(0xFFFD); i++; continue; }

    if (cp <= 0xFFFF) {
      out.push_back((wchar_t)cp);
    } else {
      cp -= 0x10000;
      out.push_back((wchar_t)(0xD800 + (cp >> 10)));
      out.push_back((wchar_t)(0xDC00 + (cp & 0x3FF)));
    }
    i += extra + 1;
  }
  return out;
}

inline string toUtf8(const std::wstring& w) {
  string out;
  for (size_t i = 0; i < w.size(); i++) {
    uint32_t cp = (uint16_t)w[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < w.size()) {
      uint32_t lo = (uint16_t)w[i + 1];
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
        i++;
      }
    }
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
  return out;
}

}  // namespace inc
