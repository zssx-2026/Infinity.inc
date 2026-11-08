# Catalogue format

*A catalogue is how Infinity Package Manager (IPM) learns that a build exists.*
*This page is the format the code enforces, not a proposal.*

## Where a catalogue lives

The catalogue is the `applications` repository. **Every Release in that repository is one
catalogue page**; IPM lists those Releases and shows one entry per page. The page for the C++
suite is the Release tagged `application-inc`.

A catalogue page does not need a custom file format. It advertises builds through two ordinary
Release assets:

| Asset | Role |
|---|---|
| `name.txt` | the index: one line per installer |
| the installers themselves | the payload, attached to the catalogue page *and* to their own repository |

## `name.txt`

One line per installer, six whitespace-separated fields:

    <asset name> <company> <package> setup <company> <platform>

A real line, character for character:

    InfinityCloud_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64

| Field | Example | Meaning |
|---|---|---|
| asset name | `InfinityCloud_1.0.0-pre5_win64_setup.exe` | must also be an asset of this same Release |
| company | `Infinity.Inc` | shown as the publisher |
| package | `InfinityCloud` | the package the installer installs |
| install kind | `setup` | `setup` is the only kind in use |
| company (again) | `Infinity.Inc` | the company field of the installer itself |
| platform | `win64` | the only platform currently published |

**Rule:** a line whose asset name is not also an asset of the same Release is skipped.
That is why the installers are attached to the catalogue page as well as to their own repository.

## `release-assets.json`

`cpp/release/<version>/release-assets.json` is the manifest the publishing tool uploads from; the
catalogue page mirrors it asset for asset. Its shape:

    {
      "tag": "v1.0.0-pre5",
      "version": "1.0.0-pre5",
      "generated": "2026-10-06T00:00:00.000Z",
      "assets": [
        {
          "name": "InfinityCloud_1.0.0-pre5_win64_setup.exe",
          "size": 516504,
          "sha256": "78dd21b814f86352f639747f7f348ab9af0d6efe1aa2630ddcd32cb844d7c909",
          "fnv1a": "e3032c52",
          "repo": "zssx-2026/Infinity-Cloud",
          "url": "https://github.com/zssx-2026/Infinity-Cloud/releases/download/v1.0.0-pre5/InfinityCloud_1.0.0-pre5_win64_setup.exe"
        }
      ]
    }

Both `sha256` and `fnv1a` are recorded: the strong hash is what download pages and the checksum
file use, the short FNV-1a is a cheap identity for listings.

## What the publishing tool refuses to do

The catalogue is written only after the release directory passes validation, so a page can never
advertise a file that does not exist or does not match its hash:

- every asset named by `name.txt` must be listed in `release-assets.json`, and vice versa;
- each file on disk must match the `size` and `sha256` the manifest claims;
- a line still naming an older `pre<N>` build makes the run **refuse** to write the catalogue
  (`REFUSING catalogue write: outdated pre<N> names`) rather than roll the download page back;
- the historical `InfinityCloud_v0.1_*` installers are recognised as obsolete and dropped.

## Size

The whole suite is one copy of each installer: **1,920,380 bytes (1.83 MiB)** for the six
`v1.0.0-pre5` builds. Keeping the catalogue page small is deliberate — it is a listing, not a
second download site.

---

## 目录格式（中文摘要）

- 目录 = `applications` 仓库；**该仓库里的每一个 Release 就是一个目录页**，IPM 读取这些 Release；
- 目录页不需要自定义格式：靠两个普通 Release 资产 `name.txt`（索引）与安装包本体（同时挂在目录页和各自仓库）；
- `name.txt` 每行六个字段：`<资产名> <公司> <包名> setup <公司> <平台>`；
  **行内资产名必须也是同一 Release 的资产**，否则该行被跳过；
- `cpp/release/<版本>/release-assets.json` 记录 `tag/version/generated` 与每个资产的
  `name/size/sha256/fnv1a/repo/url`；发布工具只有在清单与磁盘文件逐项校验通过、且不残留旧 `pre<N>` 名字时才写目录；
- 整套六个 `v1.0.0-pre5` 安装包合计 **1,920,380 字节（1.83 MiB）**。
