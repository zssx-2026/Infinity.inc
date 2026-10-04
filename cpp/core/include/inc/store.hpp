// store.hpp - the GitHub-backed cloud filesystem.
//
// The manifest is the filesystem. Data lives in release assets, each file is
// split into parts, and a small JSON document says where every byte belongs.
// The API here is intentionally close to a normal filesystem - list, mkdir,
// put, get, remove - because the CLI, TUI and GUI should all manipulate the
// same paths, not each invent their own view of the cloud.

#pragma once

#include <string>
#include <vector>
#include <cstdint>

#include "github.hpp"

namespace inc {

struct StoreConfig {
  std::string repoPrefix = "inc_";
  uint64_t chunkBytes = 1990ULL * 1024ULL * 1024ULL;
  int maxReleases = 900;
};

class Store {
 public:
  Store(GitHub& gh, const std::string& owner, StoreConfig config = StoreConfig());

  const Json& manifest() const { return manifest_; }
  const std::vector<std::string>& repos() const { return repos_; }

  // Pulls every manifest-vN release from each inc_* repository and merges
  // them without overwriting entries from a later repository.
  bool pull(std::string* error = nullptr);
  bool flush(std::string* error = nullptr);

  std::vector<Json> list(const std::string& cloudPath = "/", bool recursive = false) const;
  const Json* stat(const std::string& cloudPath) const;
  uint64_t totalBytes() const;

  bool mkdir(const std::string& cloudPath, std::string* error = nullptr);
  bool put(const std::string& localPath, const std::string& cloudPath,
           std::string* error = nullptr);
  bool get(const std::string& cloudPath, const std::string& localPath,
           bool hashCheck = true, std::string* error = nullptr);
  bool remove(const std::string& cloudPath, bool permanent = false,
              std::string* error = nullptr);
  std::vector<Json> listTrash() const;
  bool restore(const std::string& cloudPath, std::string* error = nullptr);
  bool purge(const std::string& cloudPath = "", std::string* error = nullptr);

  static std::string normalizePath(const std::string& p);
  static std::string parentPath(const std::string& p);
  static std::string baseName(const std::string& p);

 private:
  GitHub& gh_;
  std::string owner_;
  StoreConfig cfg_;
  Json manifest_;
  std::vector<std::string> repos_;

  bool ensureRepo(std::string& repo, std::string* error);
  bool ensureParents(const std::string& p, std::string* error);
  std::string cacheDir() const;
  bool saveManifestToRepo(const std::string& repo, std::string* error);
};

}  // namespace inc
