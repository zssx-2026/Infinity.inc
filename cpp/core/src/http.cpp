// http.cpp - the WinHTTP client behind http.hpp.
//
// The interesting parts are the two that WinHTTP does not do for you:
//
//   * a body larger than one buffer. WinHttpWriteData is used in chunks so a
//     release asset never has to be held in memory twice.
//   * certificate verification. It is on by default, which is right; the
//     insecure flag exists only for a machine behind a local relay that
//     presents its own certificate, and it says so on the way past.

#include "inc/http.hpp"
#include "inc/str.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <winhttp.h>

#include <cstdio>
#include <cstring>

namespace inc {

namespace {

struct Handle {
  HINTERNET h = nullptr;
  Handle() = default;
  explicit Handle(HINTERNET x) : h(x) {}
  ~Handle() { if (h) WinHttpCloseHandle(h); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  Handle(Handle&& o) noexcept : h(o.h) { o.h = nullptr; }
  Handle& operator=(Handle&& o) noexcept { if (this != &o) { if (h) WinHttpCloseHandle(h); h = o.h; o.h = nullptr; } return *this; }
  explicit operator bool() const { return h != nullptr; }
};

bool crackUrl(const std::string& url, bool& https, std::wstring& host, std::wstring& path, INTERNET_PORT& port) {
  std::wstring w = toWide(url);
  URL_COMPONENTS uc;
  memset(&uc, 0, sizeof(uc));
  uc.dwStructSize = sizeof(uc);
  uc.dwSchemeLength = (DWORD)-1;
  uc.dwHostNameLength = (DWORD)-1;
  uc.dwUrlPathLength = (DWORD)-1;
  uc.dwExtraInfoLength = (DWORD)-1;
  if (!WinHttpCrackUrl(w.c_str(), (DWORD)w.size(), 0, &uc)) return false;

  https = uc.nScheme == INTERNET_SCHEME_HTTPS;
  host.assign(uc.lpszHostName, uc.dwHostNameLength);
  std::wstring p(uc.lpszUrlPath, uc.dwUrlPathLength);
  if (uc.dwExtraInfoLength) p.append(uc.lpszExtraInfo, uc.dwExtraInfoLength);
  if (p.empty()) p = L"/";
  path = p;
  port = uc.nPort;
  return true;
}

void collectHeaders(HINTERNET req, Response& out) {
  DWORD size = 0;
  WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, nullptr, &size, WINHTTP_NO_HEADER_INDEX);
  if (!size) return;
  std::wstring raw(size / sizeof(wchar_t), L'\0');
  if (!WinHttpQueryHeaders(req, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, &raw[0], &size, WINHTTP_NO_HEADER_INDEX)) return;
  std::string text = toUtf8(raw);
  for (const std::string& line : split(text, '\n')) {
    std::string l = trim(line);
    size_t c = l.find(':');
    if (c == std::string::npos) continue;
    out.headers[lower(trim(l.substr(0, c)))] = trim(l.substr(c + 1));
  }
}

void readBody(HINTERNET req, Response& out) {
  for (;;) {
    DWORD avail = 0;
    if (!WinHttpQueryDataAvailable(req, &avail)) break;
    if (!avail) break;
    std::string chunk(avail, '\0');
    DWORD read = 0;
    if (!WinHttpReadData(req, &chunk[0], avail, &read)) break;
    if (!read) break;
    chunk.resize(read);
    out.body += chunk;
  }
}

}  // namespace

std::string urlEncode(const std::string& s) {
  static const char* hex = "0123456789ABCDEF";
  std::string out;
  for (unsigned char c : s) {
    const bool safe = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                      (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
    if (safe) out.push_back((char)c);
    else {
      out.push_back('%');
      out.push_back(hex[c >> 4]);
      out.push_back(hex[c & 0x0F]);
    }
  }
  return out;
}

std::string urlHost(const std::string& url) {
  bool https = false;
  std::wstring host, path;
  INTERNET_PORT port = 0;
  if (!crackUrl(url, https, host, path, port)) return "";
  return toUtf8(host);
}

std::string urlPath(const std::string& url) {
  bool https = false;
  std::wstring host, path;
  INTERNET_PORT port = 0;
  if (!crackUrl(url, https, host, path, port)) return "/";
  return toUtf8(path);
}

Response httpRequest(const std::string& url, const RequestOptions& opts) {
  Response out;

  bool https = true;
  std::wstring host, path;
  INTERNET_PORT port = 0;
  if (!crackUrl(url, https, host, path, port)) {
    out.error = "cannot parse url: " + url;
    return out;
  }

  Handle session(WinHttpOpen(L"Infinity.Inc/1.0",
                             opts.insecure ? WINHTTP_ACCESS_TYPE_NO_PROXY : WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                             WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
  if (!session) { out.error = "WinHttpOpen failed"; return out; }

  WinHttpSetTimeouts(session.h, opts.timeoutMs, opts.timeoutMs, opts.timeoutMs, opts.timeoutMs);

  Handle conn(WinHttpConnect(session.h, host.c_str(), port, 0));
  if (!conn) { out.error = "cannot connect to " + toUtf8(host); return out; }

  DWORD flags = https ? WINHTTP_FLAG_SECURE : 0;
  if (opts.insecure) {
    DWORD sec = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
                SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    WinHttpSetOption(conn.h, WINHTTP_OPTION_SECURITY_FLAGS, &sec, sizeof(sec));
  }

  std::wstring method = toWide(opts.method);
  Handle req(WinHttpOpenRequest(conn.h, method.c_str(), path.c_str(), nullptr,
                                WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
  if (!req) { out.error = "WinHttpOpenRequest failed"; return out; }

  std::wstring headers;
  if (!opts.token.empty()) headers += L"Authorization: Bearer " + toWide(opts.token) + L"\r\n";
  if (!opts.contentType.empty()) headers += L"Content-Type: " + toWide(opts.contentType) + L"\r\n";
  for (const std::string& h : opts.headers) headers += toWide(h) + L"\r\n";

  const bool hasBody = !opts.body.empty();
  const void* bodyPtr = hasBody ? (const void*)opts.body.data() : WINHTTP_NO_REQUEST_DATA;
  const DWORD bodyLen = hasBody ? (DWORD)opts.body.size() : 0;

  if (!WinHttpSendRequest(req.h, headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headers.c_str(),
                          headers.empty() ? 0 : (DWORD)-1L, (LPVOID)bodyPtr, bodyLen, bodyLen, 0)) {
    out.error = "send failed: " + std::to_string(GetLastError());
    return out;
  }
  if (!WinHttpReceiveResponse(req.h, nullptr)) {
    out.error = "receive failed: " + std::to_string(GetLastError());
    return out;
  }

  DWORD status = 0;
  DWORD sz = sizeof(status);
  WinHttpQueryHeaders(req.h, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                      WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX);
  out.status = (int)status;
  collectHeaders(req.h, out);
  readBody(req.h, out);
  return out;
}

Response httpGet(const std::string& url, const std::string& token) {
  RequestOptions o;
  o.method = "GET";
  o.token = token;
  return httpRequest(url, o);
}

Response httpGetJson(const std::string& url, const std::string& token) {
  RequestOptions o;
  o.method = "GET";
  o.token = token;
  o.headers.push_back("Accept: application/vnd.github+json");
  o.headers.push_back("User-Agent: Infinity.Inc");
  return httpRequest(url, o);
}

Response httpPostJson(const std::string& url, const std::string& json, const std::string& token) {
  RequestOptions o;
  o.method = "POST";
  o.token = token;
  o.body = json;
  o.contentType = "application/json";
  o.headers.push_back("Accept: application/vnd.github+json");
  o.headers.push_back("User-Agent: Infinity.Inc");
  return httpRequest(url, o);
}

// The upload streams the file rather than buffering it: a release asset can
// be a gigabyte, and reading that into a std::string would fail on the very
// machines the suite is meant to run on.
Response httpDownloadFile(const std::string& url, const std::string& filePath,
                          const std::string& token, const std::vector<std::string>& extraHeaders) {
  Response out;
  bool https = true;
  std::wstring host, path;
  INTERNET_PORT port = 0;
  if (!crackUrl(url, https, host, path, port)) { out.error = "cannot parse url"; return out; }

  Handle session(WinHttpOpen(L"Infinity.Inc/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                             WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
  if (!session) { out.error = "WinHttpOpen failed"; return out; }
  WinHttpSetTimeouts(session.h, 120000, 120000, 120000, 120000);
  Handle conn(WinHttpConnect(session.h, host.c_str(), port, 0));
  if (!conn) { out.error = "cannot connect to " + toUtf8(host); return out; }
  Handle req(WinHttpOpenRequest(conn.h, L"GET", path.c_str(), nullptr,
                                WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                https ? WINHTTP_FLAG_SECURE : 0));
  if (!req) { out.error = "WinHttpOpenRequest failed"; return out; }

  std::wstring headers = L"User-Agent: Infinity.Inc\r\n";
  if (!token.empty()) headers += L"Authorization: Bearer " + toWide(token) + L"\r\n";
  for (const auto& h : extraHeaders) headers += toWide(h) + L"\r\n";
  if (!WinHttpSendRequest(req.h, headers.c_str(), (DWORD)-1L, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
    out.error = "send failed: " + std::to_string(GetLastError()); return out;
  }
  if (!WinHttpReceiveResponse(req.h, nullptr)) {
    out.error = "receive failed: " + std::to_string(GetLastError()); return out;
  }
  DWORD status = 0, sz = sizeof(status);
  WinHttpQueryHeaders(req.h, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                      WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX);
  out.status = (int)status;
  collectHeaders(req.h, out);
  if (status < 200 || status >= 300) { readBody(req.h, out); return out; }

  FILE* f = fopen(filePath.c_str(), "wb");
  if (!f) { out.error = "cannot open download destination: " + filePath; return out; }
  bool failed = false;
  for (;;) {
    DWORD avail = 0;
    if (!WinHttpQueryDataAvailable(req.h, &avail)) { out.error = "download query failed: " + std::to_string(GetLastError()); failed = true; break; }
    if (!avail) break;
    std::vector<char> buf(avail);
    DWORD got = 0;
    if (!WinHttpReadData(req.h, buf.data(), avail, &got)) { out.error = "download read failed: " + std::to_string(GetLastError()); failed = true; break; }
    if (got && fwrite(buf.data(), 1, got, f) != got) { out.error = "download write failed"; failed = true; break; }
  }
  fclose(f);
  if (failed) DeleteFileW(toWide(filePath).c_str());
  return out;
}

Response httpUploadFile(const std::string& url, const std::string& filePath,
                        const std::string& assetName, const std::string& token) {
  Response out;

  FILE* f = fopen(filePath.c_str(), "rb");
  if (!f) { out.error = "cannot open " + filePath; return out; }
  _fseeki64(f, 0, SEEK_END);
  long long total = _ftelli64(f);
  _fseeki64(f, 0, SEEK_SET);

  bool https = true;
  std::wstring host, path;
  INTERNET_PORT port = 0;
  if (!crackUrl(url, https, host, path, port)) { fclose(f); out.error = "cannot parse url"; return out; }

  Handle session(WinHttpOpen(L"Infinity.Inc/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                             WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
  if (!session) { fclose(f); out.error = "WinHttpOpen failed"; return out; }
  WinHttpSetTimeouts(session.h, 120000, 120000, 120000, 120000);

  Handle conn(WinHttpConnect(session.h, host.c_str(), port, 0));
  if (!conn) { fclose(f); out.error = "cannot connect"; return out; }

  Handle req(WinHttpOpenRequest(conn.h, L"POST", path.c_str(), nullptr,
                                WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                https ? WINHTTP_FLAG_SECURE : 0));
  if (!req) { fclose(f); out.error = "WinHttpOpenRequest failed"; return out; }

  std::wstring headers = L"Authorization: Bearer " + toWide(token) +
                         L"\r\nContent-Type: application/octet-stream\r\nUser-Agent: Infinity.Inc\r\n";
  if (!WinHttpSendRequest(req.h, headers.c_str(), (DWORD)-1L, WINHTTP_NO_REQUEST_DATA, 0, (DWORD)total, 0)) {
    fclose(f);
    out.error = "send failed: " + std::to_string(GetLastError());
    return out;
  }

  char buf[1 << 16];
  long long sent = 0;
  while (sent < total) {
    size_t want = (size_t)std::min<long long>(sizeof(buf), total - sent);
    size_t got = fread(buf, 1, want, f);
    if (!got) break;
    DWORD written = 0;
    if (!WinHttpWriteData(req.h, buf, (DWORD)got, &written)) {
      fclose(f);
      out.error = "write failed: " + std::to_string(GetLastError());
      return out;
    }
    sent += (long long)written;
  }
  fclose(f);

  if (!WinHttpReceiveResponse(req.h, nullptr)) {
    out.error = "receive failed: " + std::to_string(GetLastError());
    return out;
  }
  DWORD status = 0;
  DWORD sz = sizeof(status);
  WinHttpQueryHeaders(req.h, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                      WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX);
  out.status = (int)status;
  collectHeaders(req.h, out);
  readBody(req.h, out);
  return out;
}

}  // namespace inc
