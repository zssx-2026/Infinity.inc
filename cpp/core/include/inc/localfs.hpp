#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace inc {
namespace localfs {

struct Entry {
  std::string name;
  std::string path;
  bool directory = false;
  uint64_t size = 0;
};

std::string currentDirectory();
std::string joinPath(const std::string& directory, const std::string& name);
std::string parentPath(const std::string& path);
bool isDirectory(const std::string& path);

bool list(const std::string& path, std::vector<Entry>* entries, std::string* error = nullptr);
bool createDirectory(const std::string& path, std::string* error = nullptr);
bool renamePath(const std::string& from, const std::string& to, std::string* error = nullptr);
bool copyPath(const std::string& from, const std::string& to, std::string* error = nullptr);
bool movePath(const std::string& from, const std::string& to, std::string* error = nullptr);
bool recycleDelete(const std::string& path, std::string* error = nullptr);

}  // namespace localfs
}  // namespace inc
