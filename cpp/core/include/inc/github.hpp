// github.hpp - the GitHub API calls the suite makes.
//
// A thin layer over http.hpp, and deliberately thin: it knows the endpoints
// and the shape of the answers, and nothing else. Anything that needs
// judgement - what a release means, whether a manifest volume merges - lives
// in the application, not here.

#pragma once

#include <string>
#include <vector>

#include "json.hpp"
#include "http.hpp"

namespace inc {

struct Release {
  long long id = 0;
  std::string tag;
  std::string name;
  std::string publishedAt;
  bool prerelease = false;
  bool draft = false;
  Json assets;                 // the raw array, so nothing is lost in a copy
  std::string htmlUrl;
};

class GitHub {
 public:
  explicit GitHub(std::string token) : token_(std::move(token)) {}

  const std::string& token() const { return token_; }
  const std::string& login() const { return login_; }
  bool signedIn() const { return !login_.empty(); }

  // Confirms the token works and remembers who it belongs to. Every other
  // call assumes this has been called; the alternative is a 401 surfacing as
  // "no releases" three layers up.
  bool me(std::string* error = nullptr);

  // The identity check the original client made: a token that can read the
  // user endpoint but not this one is not a token this suite should use.
  bool verifyIdentity(std::string* error = nullptr);

  std::vector<std::string> listRepos(std::string* error = nullptr);
  std::vector<std::string> listStorageRepos(const std::string& prefix, std::string* error = nullptr);
  std::vector<Release> listReleases(const std::string& owner, const std::string& repo,
                                    int perPage = 100, std::string* error = nullptr);
  bool createRepo(const std::string& name, bool isPrivate = false, std::string* error = nullptr);
  bool deleteRepo(const std::string& owner, const std::string& repo, std::string* error = nullptr);
  bool createRelease(const std::string& owner, const std::string& repo, const std::string& tag,
                     const std::string& title, std::string* error = nullptr);
  bool deleteAsset(const std::string& owner, const std::string& repo, long long assetId,
                   std::string* error = nullptr);
  bool downloadAsset(const std::string& owner, const std::string& repo, long long assetId,
                     const std::string& dest, std::string* error = nullptr);
  long long uploadAsset(const std::string& owner, const std::string& repo, long long releaseId,
                        const std::string& file, const std::string& assetName,
                        std::string* error = nullptr);

  // The newest release carrying a tag, or an empty tag when there is none.
  Release releaseByTag(const std::string& owner, const std::string& repo,
                       const std::string& tag, std::string* error = nullptr);

  Json getJson(const std::string& path, std::string* error = nullptr);
  Json postJson(const std::string& path, const Json& body, std::string* error = nullptr);
  Response post(const std::string& path, const Json& body);

  static const char* apiBase() { return "https://api.github.com"; }

 private:
  std::string token_;
  std::string login_;
};

// The version this build reports. Kept in one place so a bump is one edit.
const char* version();

}  // namespace inc
