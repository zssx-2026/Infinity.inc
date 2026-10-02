// github.cpp - the GitHub API calls behind github.hpp.

#include "inc/github.hpp"
#include "inc/str.hpp"

namespace inc {

const char* version() { return "1.0.0-pre3"; }

static std::string api(const std::string& path) {
  return std::string(GitHub::apiBase()) + path;
}

bool GitHub::me(std::string* error) {
  Response r = httpGetJson(api("/user"), token_);
  if (!r.ok()) {
    if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status)) : r.error;
    return false;
  }
  bool ok = false;
  Json j = Json::parse(r.body, &ok);
  if (!ok) { if (error) *error = "the user response was not JSON"; return false; }
  login_ = j.s("login");
  if (login_.empty()) { if (error) *error = "the token belongs to no account"; return false; }
  return true;
}

bool GitHub::verifyIdentity(std::string* error) {
  // Reading the authenticated user's own repositories is a cheap call that
  // still requires a usable token; a token that fails here cannot upload.
  Response r = httpGetJson(api("/user/repos?per_page=1"), token_);
  if (r.ok()) return true;
  if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status)) : r.error;
  return false;
}

Json GitHub::getJson(const std::string& path, std::string* error) {
  Response r = httpGetJson(api(path), token_);
  if (!r.ok()) {
    if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status)) : r.error;
    return Json();
  }
  bool ok = false;
  Json j = Json::parse(r.body, &ok);
  if (!ok && error) *error = "the response was not JSON";
  return j;
}

Response GitHub::post(const std::string& path, const Json& body) {
  return httpPostJson(api(path), body.dump(), token_);
}

Json GitHub::postJson(const std::string& path, const Json& body, std::string* error) {
  Response r = post(path, body);
  if (!r.ok()) {
    if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status)) : r.error;
    return Json();
  }
  bool ok = false;
  Json j = Json::parse(r.body, &ok);
  if (!ok && error) *error = "the response was not JSON";
  return j;
}

std::vector<std::string> GitHub::listRepos(std::string* error) {
  std::vector<std::string> out;
  for (int page = 1; page <= 20; page++) {
    Json j = getJson("/user/repos?per_page=100&affiliation=owner&sort=updated&page=" + std::to_string(page), error);
    if (!j.isArray() || j.size() == 0) break;
    for (const Json& r : j.items()) out.push_back(r.s("name"));
    if (j.size() < 100) break;
  }
  return out;
}

std::vector<std::string> GitHub::listStorageRepos(const std::string& prefix, std::string* error) {
  std::vector<std::string> out;
  for (const auto& name : listRepos(error)) if (startsWith(name, prefix)) out.push_back(name);
  return out;
}

bool GitHub::createRepo(const std::string& name, bool isPrivate, std::string* error) {
  Json body = Json::object();
  body.set("name", Json(name));
  body.set("private", Json(isPrivate));
  body.set("auto_init", Json(true));
  body.set("description", Json("Infinity Cloud storage"));
  Json r = postJson("/user/repos", body, error);
  return r.isObject() && !r.s("name").empty();
}

bool GitHub::deleteRepo(const std::string& owner, const std::string& repo, std::string* error) {
  RequestOptions o;
  o.method = "DELETE";
  o.token = token_;
  o.headers.push_back("Accept: application/vnd.github+json");
  o.headers.push_back("User-Agent: Infinity.Inc");
  Response r = httpRequest(api("/repos/" + owner + "/" + repo), o);
  if (r.status == 204) return true;
  if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status) + ": " + r.body) : r.error;
  return false;
}

bool GitHub::createRelease(const std::string& owner, const std::string& repo, const std::string& tag,
                           const std::string& title, std::string* error) {
  Json body = Json::object();
  body.set("tag_name", Json(tag));
  body.set("name", Json(title.empty() ? tag : title));
  body.set("body", Json(""));
  body.set("draft", Json(false));
  body.set("prerelease", Json(false));
  Json r = postJson("/repos/" + owner + "/" + repo + "/releases", body, error);
  return r.isObject() && r.i("id") != 0;
}

bool GitHub::deleteAsset(const std::string& owner, const std::string& repo, long long assetId,
                         std::string* error) {
  RequestOptions o;
  o.method = "DELETE";
  o.token = token_;
  o.headers.push_back("Accept: application/vnd.github+json");
  o.headers.push_back("User-Agent: Infinity.Inc");
  Response r = httpRequest(api("/repos/" + owner + "/" + repo + "/releases/assets/" + std::to_string(assetId)), o);
  if (r.status == 204 || (r.status >= 200 && r.status < 300)) return true;
  if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status) + ": " + r.body) : r.error;
  return false;
}

bool GitHub::downloadAsset(const std::string& owner, const std::string& repo, long long assetId,
                           const std::string& dest, std::string* error) {
  std::vector<std::string> headers;
  headers.push_back("Accept: application/octet-stream");
  Response r = httpDownloadFile(api("/repos/" + owner + "/" + repo + "/releases/assets/" + std::to_string(assetId)), dest, token_, headers);
  if (r.ok()) return true;
  if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status) + ": " + r.body) : r.error;
  return false;
}

long long GitHub::uploadAsset(const std::string& owner, const std::string& repo, long long releaseId,
                              const std::string& file, const std::string& assetName,
                              std::string* error) {
  std::string url = "https://uploads.github.com/repos/" + owner + "/" + repo + "/releases/" +
                    std::to_string(releaseId) + "/assets?name=" + urlEncode(assetName);
  Response r = httpUploadFile(url, file, assetName, token_);
  if (!r.ok()) {
    if (error) *error = r.error.empty() ? ("HTTP " + std::to_string(r.status) + ": " + r.body) : r.error;
    return 0;
  }
  bool ok = false;
  Json j = Json::parse(r.body, &ok);
  if (!ok) { if (error) *error = "upload response was not JSON"; return 0; }
  return j.i("id");
}

std::vector<Release> GitHub::listReleases(const std::string& owner, const std::string& repo,
                                          int perPage, std::string* error) {
  std::vector<Release> out;
  std::string path = "/repos/" + owner + "/" + repo + "/releases?per_page=" + std::to_string(perPage);
  Json j = getJson(path, error);
  if (!j.isArray()) return out;
  for (const Json& r : j.items()) {
    Release rel;
    rel.id = r.i("id");
    rel.tag = r.s("tag_name");
    rel.name = r.s("name");
    rel.publishedAt = r.s("published_at");
    rel.prerelease = r.b("prerelease");
    rel.draft = r.b("draft");
    rel.htmlUrl = r.s("html_url");
    rel.assets = r.get("assets");
    out.push_back(rel);
  }
  return out;
}

Release GitHub::releaseByTag(const std::string& owner, const std::string& repo,
                             const std::string& tag, std::string* error) {
  Release rel;
  Json j = getJson("/repos/" + owner + "/" + repo + "/releases/tags/" + tag, error);
  if (!j.isObject()) return rel;
  rel.id = j.i("id");
  rel.tag = j.s("tag_name");
  rel.name = j.s("name");
  rel.publishedAt = j.s("published_at");
  rel.prerelease = j.b("prerelease");
  rel.draft = j.b("draft");
  rel.htmlUrl = j.s("html_url");
  rel.assets = j.get("assets");
  return rel;
}

}  // namespace inc
