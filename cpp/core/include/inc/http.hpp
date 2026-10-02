// http.hpp - the HTTPS client, on WinHTTP.
//
// WinHTTP is part of Windows and speaks TLS through the same stack the rest
// of the system uses, so the suite gets HTTPS without carrying a TLS library
// and without a runtime to install. That is the reason it is used here rather
// than a hand-rolled socket client: the Node version had to deal with a local
// relay whose certificate could not be verified, and the system stack simply
// follows whatever the machine already trusts.
//
// Only what the suite needs is exposed: one request, with a body or without,
// answering with a status, the headers and the bytes. GitHub's API is the
// only thing it talks to.

#pragma once

#include <string>
#include <vector>
#include <map>
#include <cstdint>

namespace inc {

struct Response {
  int status = 0;
  std::string body;
  std::map<std::string, std::string> headers;
  std::string error;                 // empty when the request completed
  bool ok() const { return error.empty() && status >= 200 && status < 300; }

  std::string header(const std::string& k) const {
    auto it = headers.find(k);
    return it == headers.end() ? std::string() : it->second;
  }
};

struct RequestOptions {
  std::string method = "GET";
  std::vector<std::string> headers;
  std::string body;
  std::string contentType;
  std::string token;                 // sent as Authorization: Bearer
  bool followRedirects = true;
  int timeoutMs = 120000;
  bool insecure = false;             // accept an unverifiable certificate
};

// One request. https:// is assumed when the URL has no scheme.
Response httpRequest(const std::string& url, const RequestOptions& opts = RequestOptions());

// Convenience wrappers, because most call sites are one of these three.
Response httpGet(const std::string& url, const std::string& token = "");
Response httpGetJson(const std::string& url, const std::string& token = "");
Response httpPostJson(const std::string& url, const std::string& json, const std::string& token);

// Download a response straight to disk. This is used for GitHub's asset API,
// which redirects to a short-lived release-assets URL; WinHTTP follows that
// redirect while the bytes stream into the file, not into RAM.
Response httpDownloadFile(const std::string& url, const std::string& filePath,
                          const std::string& token, const std::vector<std::string>& headers = {});

// Upload a file as a release asset. WinHTTP is told the exact length up
// front, which is what lets GitHub accept a body it cannot buffer.
Response httpUploadFile(const std::string& url, const std::string& filePath,
                        const std::string& assetName, const std::string& token);

// Percent-encode everything that is not unreserved, so an asset name with
// spaces or non-ASCII characters survives the query string.
std::string urlEncode(const std::string& s);

// Pull one header out of a URL, e.g. the "next" link in a Link header.
std::string urlHost(const std::string& url);
std::string urlPath(const std::string& url);

}  // namespace inc
