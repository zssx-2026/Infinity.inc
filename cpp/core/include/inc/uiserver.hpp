// uiserver.hpp - the local HTTP server every application's window talks to.
//
// The window is Electron. It renders HTML; it does not know how to read a
// GitHub release, and it should not. What it needs is an origin to fetch from
// and a JSON shape to expect, so each application serves its own interface
// from its own process, on loopback, and Electron is only the shell that
// draws it.
//
// That split is deliberate. The C++ side stays a single self-contained
// executable - no runtime, no assets on disk, nothing to install beside it -
// and the front end stays HTML, which is the only way to get a window that
// looks like it was written this decade without dragging a UI toolkit into a
// program that is supposed to need nothing.
//
// Contract, and the parts that matter:
//
//   * bound to 127.0.0.1 only. This server has no authentication because it
//     is not reachable from anywhere else; binding it to 0.0.0.0 would turn
//     the user's GitHub token into a network service.
//   * one request per connection, `Connection: close`. No keep-alive, no
//     chunked encoding, no pipelining. The client is a browser on the same
//     machine and the payloads are small.
//   * the handler runs on the server thread, so a handler that blocks blocks
//     that one request and nothing else.
//   * a route is matched exactly after the query string is stripped. No
//     pattern matching, no parameters in the path - the four interfaces are
//     small enough that exact routes are clearer than a router.
//
// Usage in an application:
//
//   UiServer server;
//   server.route("GET", "/", [](const UiRequest&) { return UiResponse::html(page()); });
//   server.route("GET", "/api/catalog", [&](const UiRequest& r) { return UiResponse::json(catalogJson(r)); });
//   std::string error;
//   if (!server.start(port, &error)) { ... }
//   server.wait();          // blocks until stop() is called

#pragma once

#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace inc {

struct UiRequest {
  std::string method;                                   // GET, POST, ...
  std::string path;                                     // decoded, query removed
  std::map<std::string, std::string> query;             // decoded, first value wins
  std::map<std::string, std::string> headers;           // lower-cased names
  std::string body;                                     // raw bytes
};

struct UiResponse {
  int status = 200;
  std::string contentType = "application/json; charset=utf-8";
  std::string body;

  // Extra headers, emitted after Content-Type. The only thing that needs one
  // today is Content-Disposition on a download, and a download that arrives
  // without a filename is a file the browser names "download" - which is a
  // worse outcome than a slightly larger response type.
  std::vector<std::pair<std::string, std::string>> headers;

  static UiResponse json(const std::string& text);
  static UiResponse html(const std::string& text);
  static UiResponse css(const std::string& text);
  static UiResponse js(const std::string& text);
  static UiResponse text(const std::string& text, int status = 200);
  static UiResponse error(int status, const std::string& message);

  // A body with a status. Inline because it is the two factories above with
  // the status moved, and giving it a translation unit of its own would be
  // more ceremony than it is worth.
  static UiResponse withStatus(UiResponse response, int status) {
    response.status = status;
    return response;
  }
};

using UiHandler = std::function<UiResponse(const UiRequest&)>;

class UiServer {
 public:
  UiServer();
  ~UiServer();

  UiServer(const UiServer&) = delete;
  UiServer& operator=(const UiServer&) = delete;

  // Register a handler. Registering the same method and path twice replaces
  // the first, so an application can build its table in one place and a test
  // can override one entry.
  void route(const std::string& method, const std::string& path, UiHandler handler);

  // Bind and start accepting. Returns false with a reason in *error when the
  // port is taken or Winsock refuses to start. `port` 0 asks the system for a
  // free one, which port() then reports - useful for tests.
  bool start(int port, std::string* error);

  // The port actually bound. Meaningful once start() has returned true.
  int port() const;

  // True while the accept loop is running.
  bool running() const;

  // Ask the loop to stop and wait for the thread. Safe to call twice, safe
  // from a handler, and called by the destructor.
  void stop();

  // Block until the server stops. This is what a `--serve-ui` mode calls
  // instead of inventing its own sleep loop.
  void wait();

  // A human-readable one-line summary, for the console: the URL and the port.
  std::string url() const;

 private:
  struct Impl;
  Impl* impl_;
};

}  // namespace inc
