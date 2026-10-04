// uiserver.cpp - the loopback HTTP server behind uiserver.hpp.
//
// This is deliberately a small server, and the places where it is small are
// the places where the alternative would be dangerous:
//
//   * it binds 127.0.0.1 and nothing else. There is no authentication because
//     there is no other machine to authenticate - the process it fronts holds
//     the user's GitHub token, so the socket has to stay local. That is also
//     why SO_EXCLUSIVEADDRUSE is set: on Windows a plain bind() lets a second
//     process, or a second copy of ourselves, attach to the same port and
//     silently take half the traffic.
//   * one request per connection, then close. No keep-alive, no chunked
//     bodies, no pipelining. The client is Electron on the same machine and
//     the payloads are small, so the state machine that doing those correctly
//     would require is not worth writing.
//   * the accept loop is single-threaded and runs the handler inline. A
//     handler that blocks blocks its own request and nothing else, which is
//     the guarantee the header promises - and it keeps the server free of a
//     worker pool that would need its own shutdown story.
//   * every read is bounded. A request line over 8 KB, a header block over
//     64 KB or a body over 16 MB is refused before it is buffered, so a
//     client cannot make the server allocate without limit.
//
// The two subtle pieces are the wake-up and the self-join guard in stop().
// accept() blocks, so stopping from another thread has to unblock it: stop()
// connects to its own port, accept() returns that throwaway socket, and the
// loop notices the flag. And because a handler runs on the very thread that
// stop() would otherwise join, stop() refuses to join itself - a handler only
// sets the flag, and the loop leaves after the request it is already in.

#include "inc/uiserver.hpp"
#include "inc/str.hpp"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <thread>

namespace inc {

namespace {

constexpr size_t kMaxRequestLine = 8 * 1024;
constexpr size_t kMaxHeadBytes = 64 * 1024;
constexpr size_t kMaxBodyBytes = 16 * 1024 * 1024;

// A client that connects and then says nothing must not be able to wedge the
// accept thread - and through it stop(), which joins that thread. The timeout
// is long enough that a real request over loopback never hits it.
constexpr int kRecvTimeoutMs = 5000;

// UiServer can be constructed many times in one process (a test builds one per
// case), and WSAStartup/WSACleanup are not reference counted by the OS. Without
// this counter the second destructor would tear Winsock down from under a
// server that is still accepting.
std::mutex g_wsaMutex;
int g_wsaRefs = 0;

bool wsaAcquire() {
  std::lock_guard<std::mutex> lock(g_wsaMutex);
  if (g_wsaRefs == 0) {
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return false;
  }
  g_wsaRefs++;
  return true;
}

void wsaRelease() {
  std::lock_guard<std::mutex> lock(g_wsaMutex);
  if (g_wsaRefs > 0 && --g_wsaRefs == 0) WSACleanup();
}

// Winsock error numbers are what start() reports, so translate the few that a
// user can actually act on; the rest go out as the bare number.
std::string wsaError(int code) {
  switch (code) {
    case WSAEADDRINUSE: return "address already in use";
    case WSAEACCES: return "permission denied";
    case WSAEADDRNOTAVAIL: return "address not available";
    case WSAEINVAL: return "invalid argument";
    case WSAENOTSOCK: return "not a socket";
    default: return "winsock error " + std::to_string(code);
  }
}

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Percent-decoding is strict: a stray '%' is a malformed target, not a literal
// percent. Being lenient here is how a path and the route it is matched
// against drift apart.
bool percentDecode(const std::string& in, std::string& out) {
  out.clear();
  out.reserve(in.size());
  for (size_t i = 0; i < in.size(); i++) {
    if (in[i] != '%') {
      out.push_back(in[i]);
      continue;
    }
    if (i + 2 >= in.size()) return false;
    const int hi = hexDigit(in[i + 1]);
    const int lo = hexDigit(in[i + 2]);
    if (hi < 0 || lo < 0) return false;
    out.push_back((char)((hi << 4) | lo));
    i += 2;
  }
  return true;
}

std::string escapeJson(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 8);
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          static const char* hex = "0123456789abcdef";
          out += "\\u00";
          out.push_back(hex[c >> 4]);
          out.push_back(hex[c & 0x0F]);
        } else {
          out.push_back((char)c);
        }
    }
  }
  return out;
}

const char* reasonPhrase(int status) {
  switch (status) {
    case 200: return "OK";
    case 201: return "Created";
    case 204: return "No Content";
    case 301: return "Moved Permanently";
    case 302: return "Found";
    case 304: return "Not Modified";
    case 400: return "Bad Request";
    case 401: return "Unauthorized";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 408: return "Request Timeout";
    case 413: return "Payload Too Large";
    case 414: return "URI Too Long";
    case 415: return "Unsupported Media Type";
    case 431: return "Request Header Fields Too Large";
    case 500: return "Internal Server Error";
    case 501: return "Not Implemented";
    case 503: return "Service Unavailable";
    default: return "Unknown";
  }
}

bool sendAll(SOCKET s, const char* data, size_t len) {
  size_t sent = 0;
  while (sent < len) {
    const int n = send(s, data + sent, (int)(len - sent), 0);
    if (n <= 0) return false;
    sent += (size_t)n;
  }
  return true;
}

// The blank line ends the head. Both spellings are accepted because the body
// length is what actually matters here and a client that sends bare LF is
// still parseable.
size_t findHeadEnd(const std::string& raw) {
  const size_t crlf = raw.find("\r\n\r\n");
  const size_t lf = raw.find("\n\n");
  if (crlf == std::string::npos) return lf == std::string::npos ? std::string::npos : lf + 2;
  if (lf == std::string::npos) return crlf + 4;
  return std::min(crlf + 4, lf + 2);
}

}  // namespace

// ------------------------------------------------------------- UiResponse

UiResponse UiResponse::json(const std::string& text) {
  UiResponse r;
  r.contentType = "application/json; charset=utf-8";
  r.body = text;
  return r;
}

UiResponse UiResponse::html(const std::string& text) {
  UiResponse r;
  r.contentType = "text/html; charset=utf-8";
  r.body = text;
  return r;
}

UiResponse UiResponse::css(const std::string& text) {
  UiResponse r;
  r.contentType = "text/css; charset=utf-8";
  r.body = text;
  return r;
}

UiResponse UiResponse::js(const std::string& text) {
  UiResponse r;
  r.contentType = "text/javascript; charset=utf-8";
  r.body = text;
  return r;
}

UiResponse UiResponse::text(const std::string& text, int status) {
  UiResponse r;
  r.status = status;
  r.contentType = "text/plain; charset=utf-8";
  r.body = text;
  return r;
}

UiResponse UiResponse::error(int status, const std::string& message) {
  UiResponse r;
  r.status = status;
  r.contentType = "application/json; charset=utf-8";
  r.body = "{\"error\":\"" + escapeJson(message) + "\"}";
  return r;
}

// ---------------------------------------------------------------- Impl

struct UiServer::Impl {
  std::map<std::string, std::map<std::string, UiHandler>> routes;
  std::mutex routesMutex;

  std::mutex sockMutex;
  SOCKET listen = INVALID_SOCKET;
  std::atomic<int> boundPort{0};

  std::thread thread;
  std::atomic<bool> running{false};
  bool wsaOk = false;

  // Reads the head, then exactly Content-Length body bytes. Returns a status
  // to send on the way out; 0 means the request parsed and dispatch should
  // run.
  int readRequest(SOCKET c, UiRequest& out) {
    std::string raw;
    char buf[16384];
    size_t headEnd = std::string::npos;

    for (;;) {
      headEnd = findHeadEnd(raw);
      if (headEnd != std::string::npos) break;

      // Bound the request line first: it is the part a client can make
      // arbitrarily long before it ever sends a blank line.
      const size_t lineEnd = raw.find('\n');
      if (lineEnd != std::string::npos) {
        if (lineEnd > kMaxRequestLine) return 413;
      } else if (raw.size() > kMaxRequestLine) {
        return 413;
      }
      if (raw.size() > kMaxHeadBytes) return 431;
      if (!running.load()) return 400;

      const int n = recv(c, buf, (int)sizeof(buf), 0);
      // A closed socket here is either the wake-up connection stop() dialed
      // (which runLoop() never hands to us) or a client that gave up; both
      // are answered with a 400 on a socket nobody is listening to.
      if (n <= 0) return 400;
      raw.append(buf, (size_t)n);
    }

    const std::string head = raw.substr(0, headEnd);
    std::vector<std::string> lines = split(head, '\n');
    for (std::string& line : lines) {
      if (!line.empty() && line.back() == '\r') line.pop_back();
    }
    if (lines.empty()) return 400;

    // Request line: method, target, version - exactly three words.
    const std::vector<std::string> first = words(lines[0]);
    if (first.size() != 3) return 400;
    if (!startsWith(first[2], "HTTP/")) return 400;
    out.method = upper(first[0]);

    const std::string& target = first[1];
    const size_t q = target.find('?');
    const std::string rawPath = q == std::string::npos ? target : target.substr(0, q);
    const std::string rawQuery = q == std::string::npos ? std::string() : target.substr(q + 1);
    if (!percentDecode(rawPath, out.path)) return 400;
    if (out.path.empty() || out.path[0] != '/') return 400;

    for (const std::string& piece : split(rawQuery, '&')) {
      if (piece.empty()) continue;
      const size_t eq = piece.find('=');
      const std::string rawKey = eq == std::string::npos ? piece : piece.substr(0, eq);
      const std::string rawValue = eq == std::string::npos ? std::string() : piece.substr(eq + 1);
      std::string key, value;
      // A form-encoded space arrives as '+' in the query and as %20 in the
      // path, so the substitution belongs to the query half only.
      if (!percentDecode(replaceAll(rawKey, "+", " "), key)) return 400;
      if (!percentDecode(replaceAll(rawValue, "+", " "), value)) return 400;
      if (key.empty()) continue;
      out.query.emplace(key, value);  // first value wins
    }

    for (size_t i = 1; i < lines.size(); i++) {
      if (lines[i].empty()) continue;
      const size_t colon = lines[i].find(':');
      if (colon == std::string::npos) return 400;
      const std::string name = lower(trim(lines[i].substr(0, colon)));
      if (name.empty()) return 400;
      out.headers.emplace(name, trim(lines[i].substr(colon + 1)));
    }

    size_t contentLength = 0;
    const auto len = out.headers.find("content-length");
    if (len != out.headers.end()) {
      const std::string& v = len->second;
      if (v.empty()) return 400;
      for (char ch : v) {
        if (ch < '0' || ch > '9') return 400;
        contentLength = contentLength * 10 + (size_t)(ch - '0');
        if (contentLength > kMaxBodyBytes) return 413;
      }
    }

    out.body = raw.substr(headEnd);
    if (out.body.size() > contentLength) out.body.resize(contentLength);
    while (out.body.size() < contentLength) {
      if (!running.load()) return 400;
      const int n = recv(c, buf, (int)sizeof(buf), 0);
      if (n <= 0) return 400;  // truncated body
      out.body.append(buf, (size_t)n);
    }
    if (out.body.size() > contentLength) out.body.resize(contentLength);
    return 0;
  }

  UiResponse dispatch(const UiRequest& req) {
    UiHandler handler;
    bool pathKnown = false;
    {
      std::lock_guard<std::mutex> lock(routesMutex);
      const auto path = routes.find(req.path);
      if (path != routes.end()) {
        pathKnown = true;
        const auto method = path->second.find(req.method);
        if (method != path->second.end()) handler = method->second;
      }
    }
    if (!pathKnown) return UiResponse::error(404, "no route for " + req.path);
    if (!handler) return UiResponse::error(405, req.method + " not allowed on " + req.path);
    // The handler is copied out of the table before it runs, so a handler is
    // free to register another route, or stop the server, without deadlocking
    // on the lock that found it.
    try {
      return handler(req);
    } catch (const std::exception& e) {
      return UiResponse::error(500, std::string("handler threw: ") + e.what());
    } catch (...) {
      return UiResponse::error(500, "handler threw");
    }
  }

  void handleClient(SOCKET c) {
    DWORD timeout = kRecvTimeoutMs;
    setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));

    UiRequest req;
    const int status = readRequest(c, req);

    UiResponse resp;
    if (status != 0) {
      resp = UiResponse::error(status, status == 413 ? "request too large"
                                  : status == 431 ? "request header too large"
                                                  : "malformed request");
    } else {
      resp = dispatch(req);
    }

    std::string out;
    out += "HTTP/1.1 " + std::to_string(resp.status) + " " + reasonPhrase(resp.status) + "\r\n";
    out += "Content-Type: " + resp.contentType + "\r\n";
    out += "Content-Length: " + std::to_string(resp.body.size()) + "\r\n";
    // Caller-supplied headers go here rather than being folded into
    // Content-Type: a download needs Content-Disposition, and a handler that
    // has to reach into a string to add one would eventually add two.
    for (const auto& header : resp.headers) {
      if (header.first.empty()) continue;
      out += header.first + ": " + header.second + "\r\n";
    }
    out += "Connection: close\r\n";
    // The responses carry the user's token and repository state; a cache on
    // the way past is not part of the deal.
    out += "Cache-Control: no-store\r\n";
    out += "\r\n";
    // A HEAD keeps the headers of what GET would have produced but never the
    // bytes; that is the whole point of the method.
    if (req.method != "HEAD") out += resp.body;
    sendAll(c, out.data(), out.size());
  }

  void runLoop() {
    for (;;) {
      if (!running.load()) break;
      SOCKET listener;
      {
        std::lock_guard<std::mutex> lock(sockMutex);
        listener = listen;
      }
      if (listener == INVALID_SOCKET) break;

      const SOCKET c = accept(listener, nullptr, nullptr);
      if (c == INVALID_SOCKET) {
        if (!running.load()) break;
        // A real error on a listening socket is rare; sleeping keeps a
        // persistent one from spinning a core while stop() is on its way.
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        continue;
      }
      if (!running.load()) {  // the throwaway socket stop() dialed to wake us
        closesocket(c);
        break;
      }
      handleClient(c);
      closesocket(c);
    }

    std::lock_guard<std::mutex> lock(sockMutex);
    if (listen != INVALID_SOCKET) {
      closesocket(listen);
      listen = INVALID_SOCKET;
    }
    running.store(false);
  }

  // Dial our own port so the accept() blocked in runLoop() returns. Errors are
  // ignored on purpose: if the loop already left, there is nothing to wake.
  void wakeAccept() {
    SOCKET listener;
    int port;
    {
      std::lock_guard<std::mutex> lock(sockMutex);
      listener = listen;
      port = boundPort.load();
    }
    if (listener == INVALID_SOCKET || port <= 0) return;
    const SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return;
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons((u_short)port);
    connect(s, (const sockaddr*)&addr, sizeof(addr));
    closesocket(s);
  }
};

// -------------------------------------------------------------- UiServer

UiServer::UiServer() : impl_(new Impl()) {
  impl_->wsaOk = wsaAcquire();
}

UiServer::~UiServer() {
  stop();
  wsaRelease();
  delete impl_;
}

void UiServer::route(const std::string& method, const std::string& path, UiHandler handler) {
  std::lock_guard<std::mutex> lock(impl_->routesMutex);
  // Assigning into the map is what makes a second registration replace the
  // first, which the header asks for.
  impl_->routes[path][upper(method)] = std::move(handler);
}

bool UiServer::start(int port, std::string* error) {
  const auto fail = [error](const std::string& why) {
    if (error) *error = why;
    return false;
  };

  if (impl_->running.load()) return fail("server is already running");
  if (!impl_->wsaOk) return fail("Winsock could not be initialized");

  const SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == INVALID_SOCKET) return fail("socket() failed: " + wsaError(WSAGetLastError()));

  // Set before bind(). Without it, Windows lets another process bind the same
  // port and steal connections - which for this server would mean handing the
  // user's token to whatever asked first.
  BOOL exclusive = TRUE;
  setsockopt(s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char*)&exclusive, sizeof(exclusive));

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // 127.0.0.1, never 0.0.0.0
  addr.sin_port = htons((u_short)port);

  if (bind(s, (const sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
    const std::string why = wsaError(WSAGetLastError());
    closesocket(s);
    return fail("cannot bind 127.0.0.1:" + std::to_string(port) + ": " + why);
  }
  if (listen(s, SOMAXCONN) == SOCKET_ERROR) {
    const std::string why = wsaError(WSAGetLastError());
    closesocket(s);
    return fail("listen() failed: " + why);
  }

  // Port 0 is "any free port"; getsockname() is the only way to learn which
  // one the system picked, and the tests rely on port() reporting it.
  int bound = port;
  sockaddr_in actual{};
  int actualLen = sizeof(actual);
  if (getsockname(s, (sockaddr*)&actual, &actualLen) == 0) bound = ntohs(actual.sin_port);
  impl_->boundPort.store(bound);

  {
    std::lock_guard<std::mutex> lock(impl_->sockMutex);
    impl_->listen = s;
  }
  impl_->running.store(true);
  impl_->thread = std::thread([this] { impl_->runLoop(); });
  return true;
}

int UiServer::port() const { return impl_->boundPort.load(); }

bool UiServer::running() const { return impl_->running.load(); }

void UiServer::stop() {
  impl_->running.store(false);

  // Called from a handler, this is the accept thread joining itself - which
  // would deadlock. The flag is already set, so the loop will leave as soon as
  // the handler returns; there is nothing left for us to do.
  if (impl_->thread.joinable() && impl_->thread.get_id() == std::this_thread::get_id()) return;

  if (impl_->thread.joinable()) {
    impl_->wakeAccept();
    impl_->thread.join();
  }

  // Normally runLoop() closed the socket on its way out; this covers a start()
  // that never reached the thread.
  std::lock_guard<std::mutex> lock(impl_->sockMutex);
  if (impl_->listen != INVALID_SOCKET) {
    closesocket(impl_->listen);
    impl_->listen = INVALID_SOCKET;
  }
}

void UiServer::wait() {
  if (impl_->thread.joinable() && impl_->thread.get_id() != std::this_thread::get_id()) {
    impl_->thread.join();
  }
}

std::string UiServer::url() const {
  return "http://127.0.0.1:" + std::to_string(impl_->boundPort.load());
}

}  // namespace inc
