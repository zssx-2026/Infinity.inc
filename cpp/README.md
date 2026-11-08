# Infinity.Inc — the C++ build

`cpp/` is the C++ rewrite of the Infinity.Inc suite. The suite used to be Node
plus Electron: each application weighed roughly 80 MB and would not start until
a bundled runtime had been installed beside it. Here each product is a single
executable that needs nothing but Windows itself — no Node, no Electron, no
Visual C++ redistributable, no DLL to carry along. A copy on a USB stick runs on
a machine that has never seen the software.

That claim is not a hope; it is enforced. The CMake build links everything
statically (`-static -static-libgcc -static-libstdc++ -s`), and `tools/build.mjs`
then reads each executable's import table and fails the build if anything
outside Windows appears in it. The size difference is the point: a Node build
was about 80,000,000 bytes, the C++ build of the same application is a few
hundred kilobytes.

Everything here is Windows-only on purpose. The system HTTP stack (WinHTTP), the
console and the window are all Win32. Carrying three platform backends before
the first one worked would have been weight without value.

## Products and faces

There are six products. Each is **one** executable, built once, and then copied
under several names. The program reads its own file name to decide which face to
be — there is no separate binary per face and no configuration file to keep in
step.

| Product | Directory | What it is |
| --- | --- | --- |
| Infinity Cloud | `apps/inc` | The GitHub-backed cloud: credential, manifest, upload/download, recycle bin. |
| InfinityPackageManager | `apps/ipm` | The package catalogue: browse, verify and run installers. |
| Infinity Toolbox | `apps/int` | A registry of small utilities: list, describe and run built-in and plugin tools. |

A **face** is a way of presenting a product: `cli` is a command line, `gui` is a
native Win32 window, and `launcher` is a small console menu that starts one of
the other two. Every face also has an **administrator twin**, whose name carries
an `x` suffix on the product prefix (`inx`, `ipmx`). The twin is
the same file; it only records that it was started under an administrator name
and lets the caller decide what that means — a program cannot grant itself
elevation, so pretending to be root would be dishonest.

| Product | Faces | Names produced |
| --- | --- | --- |
| Infinity Cloud | cli, gui, launcher | `inc_cli`, `inc_gui`, `inc_launcher`, `inx_cli`, `inx_gui`, `inx_launcher` |
| InfinityPackageManager | cli, gui, launcher | `ipm_cli`, `ipm_gui`, `ipm_launcher`, `ipmx_cli`, `ipmx_gui`, `ipmx_launcher` |
| Infinity Toolbox | cli, gui | `int_cli`, `int_gui`, `intx_cli`, `intx_gui` |

So Infinity Cloud and InfinityPackageManager produce six names each, and
Infinity Toolbox produces four. The rule lives in `core/include/inc/mode.hpp`: `detectMode()`
takes the executable's own base name, splits it on the first `_`, maps the
prefix to a product (and to the administrator flag) and the suffix to a face. A
name that matches nothing yields an empty mode rather than an error. Infinity
Toolbox deliberately has no launcher — it has exactly two faces and nothing to
choose between.

Each `gui` face serves its page on loopback at its own port, so two applications
can be open at once without arguing over one number:

| Application | Port |
| --- | --- |
| Infinity Cloud | 7621 |
| InfinityPackageManager | 7632 |
| Infinity Toolbox | 7653 |

Because the mode lives in the name, a copy is genuinely a different program from
the user's point of view, and the build stays a single artifact per application.
When the program is started under a name that carries no mode — which is what
happens from a source build — the first command-line word is taken as the face,
so `inc gui` still works.

### The terminal interface was removed

An earlier revision also had a `tui` face: a full-screen terminal interface.
It was dropped from **every** application. It duplicated the window without
being better at anything, and a screen that has to be redrawn by hand — cursor
positioning, key handling, colour, its own layout arithmetic — was the single
most expensive thing in the suite to keep correct. What is left is one face for
scripts (`cli`) and one for people (`gui`). The `ansi.hpp` colour set outlived
the screen it was written for, because the command line still prints colour and
a named constant survives a theme change where a bare escape code does not.

## The shared core

`core/` is one static library, linked by all six products. It is written from
scratch with **no third-party code**, because the whole point of the port is
that a build needs nothing but a compiler — pulling in a JSON library or an HTTP
library would reintroduce exactly the dependency the rewrite exists to remove.

| Header | Purpose |
| --- | --- |
| `str.hpp` | String helpers the suite uses everywhere: trim, split, join, case folding, size formatting, and the UTF-8 / UTF-16 bridge the Win32 API needs. |
| `json.hpp` | A complete JSON reader and writer: objects, arrays, escapes, surrogate pairs, both round trips. |
| `http.hpp` | The HTTPS client, on WinHTTP: one request with or without a body, plus streaming download and upload of whole files. |
| `github.hpp` | The GitHub API calls the suite makes, and nothing more: identity, repositories, releases, assets, catalogue tags. |
| `env.hpp` | Reading the token from wherever the machine keeps it, and writing program locations to `HKCU\Environment` so a portable copy can register itself. |
| `mode.hpp` | Which face am I? — the file-name dispatch described above, plus sibling-executable and elevation helpers. |
| `store.hpp` | The GitHub-backed cloud filesystem: the manifest is the filesystem, data lives in release assets, and the API mirrors `list`/`mkdir`/`put`/`get`/`remove`. |
| `localfs.hpp` | Local file operations over Win32: list, create, rename, copy, move, recycle-bin delete. |
| `ansi.hpp` | The named colour set the command line prints with. |

The reasons behind the two least obvious choices are worth keeping:

- **`json.hpp` keeps a number's original text alongside its parsed value.** A
  manifest carries ids and sizes that are meaningful as digits. Re-printing a
  parsed `double` would turn `387565520` into `387565520.0000000001` on some
  platforms, and an id that changes shape is a bug that only appears in
  production. Keeping the raw text means a value that was written as an integer
  is printed back as the same integer.
- **`http.hpp` uses WinHTTP rather than a hand-rolled socket client.** WinHTTP is
  part of Windows and speaks TLS through the same stack the rest of the system
  trusts, so the suite gets HTTPS with no TLS library to carry and no runtime to
  install. (The Node build had to deal with a local relay whose certificate
  could not be verified; the system stack simply follows whatever the machine
  already trusts.) The `insecure` option exists only for that relay and says so
  on the way past.

The static core is linked only as far as each program actually references it, so
Infinity Cloud — the one product that pulls in the cloud filesystem — is
noticeably the largest executable of the six.

## InfinityPackageManager

InfinityPackageManager is the catalogue. Every package it offers is a release
asset in one repository, and what it adds on top of that repository is the
index, the digest check and the launch. A build is only ever run after its
SHA-256 has been checked against the digest GitHub reports for the asset.

### The catalogue

The catalogue is a single GitHub repository, `zssx-2026/applications`. **Every
release in it is one catalogue page.** A page advertises what it holds through a
`name.txt` asset whose lines read:

```
<asset name> <version> <package> <install kind> <company> <platform>
```

For example, a line for the Infinity Cloud installer looks like:

```
InfinityCloud_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
```

Only four fields are required, and the program says what a short line means:
`<asset name> <version> <package> <install kind>` on its own leaves the platform
as `any` and takes the company field from the release rather than the line. A
leading `v` is stripped from the version, so `v1.0.0-pre5` and `1.0.0-pre5` are
the same build.

A line in `name.txt` names an asset. If that name is **not also an asset of the
same release**, the line is skipped and nothing is offered for it. This is why
the installers are attached to the catalogue page *as well as* to their own
per-application repository: a page that lists a file it does not itself hold
would advertise a download that 404s. The page keeps one copy of each installer,
which is a few hundred kilobytes for the whole suite.

A release that yields no catalogue items - because it has no `name.txt`, or
because none of its lines named an asset of that release - falls back to reading
its build assets directly, inferring a package name, version and platform from
each file name, so an older page that predates the manifest still shows
something.

The catalogue is kept current in practice by `work/ghsync.mjs`, which publishes
the built installers and rewrites the `name.txt` of the product catalogue page
(the release tagged `application-inc`, a tag that names no plugin or resource
and therefore reads as a product page).

### Where a download lands

Downloads live under one directory per user:

```
%LOCALAPPDATA%\InfinityPackageManager\downloads\
```

The directory is created when it is needed and a download writes into it under
its real name, so an installer the user already fetched is still there. Nothing
is registered anywhere: the folder *is* the record of what has been downloaded.

### The digest rule

Nothing is installed or run unless the SHA-256 of the downloaded file matches
the digest GitHub reports for the asset. The digest must be a well-formed
`sha256:` followed by 64 hex digits - 71 characters, lower-cased; anything else
counts as no digest at all.

- A **build with no digest is refused.** The file is downloaded, the digest
  cannot be confirmed, and the download is deleted rather than installed.
- A **verified product that ships a setup program** - an item whose install kind
  is `setup` - is launched after verification.
- Anything else is placed in the downloads folder instead of being run.

InfinityPackageManager applies the same rule to its own catalogue, with the same
insistence: an installer that runs without its digest checked is just a download
that happens to end in `.exe`.

The download itself is written to a temporary `.part` file on the same volume as
its destination and moved into place only once it is complete and verified, so a
half-written file never appears under the real name.



## Building

The toolchain is MinGW-w64 (UCRT) plus CMake and Ninja, all static. From `cpp/`:

```sh
NODE_OPTIONS= node tools/build.mjs            # compile, then produce the names
NODE_OPTIONS= node tools/package.mjs          # wrap the executables in NSIS installers
NODE_OPTIONS= node tools/manifest.mjs         # write name.txt and release-assets.json
NODE_OPTIONS= node tools/publish.mjs [tag]    # upload installers to GitHub
```

- `build.mjs` configures and compiles with CMake/Ninja, then copies the single
  executable of each application into `cpp/out/<app>/` under all of its names.
  It uses real file copies rather than hard links: the binaries are a few hundred
  kilobytes now instead of eighty megabytes, and a real file survives being
  copied onto a USB stick or into an installer without any question about
  whether the link came along.
- `package.mjs` builds one self-contained NSIS installer per application into
  `cpp/release/v1.0pre5/`, and `manifest.mjs` writes the `name.txt` and
  `release-assets.json` beside them. Nothing is carried beside the installer:
  the only plug-in used is `System.dll`, which ships inside NSIS itself, and it
  is reached through `System::Call` because NSIS's own `Delete` cannot remove
  an alternate data stream. The product icon is taken from
  `installers/packaging/icons/<app>.ico` (falling back to `icons/<app>.ico`);
  the same file is also compiled into the executable's own resource section, not
  only used by the installer.
- `publish.mjs` uploads each installer to that application's own repository, so a
  user downloads exactly one file. It goes through `curl` (see the environment
  notes below). `work/ghsync.mjs` is the other publication path: it pushes the
  source, uploads the per-application assets, and maintains the `applications`
  catalogue page.
- `build.mjs` runs `ninja -j 2` (override with `INC_JOBS`). Two jobs build the
  six applications quickly enough and keep the machine responsive for other
  work running beside it.
- The current pre-release is `v1.0pre5` (`1.0.0-pre5`); `package.mjs`,
  `manifest.mjs` and `publish.mjs` all default to it.

### The import-table audit

The build does not take "self-contained" on faith. After linking, `build.mjs`
runs `objdump -p` over each executable, reads the `DLL Name:` lines, and checks
them against an allow-list of Windows libraries — `kernel32`, `user32`, `gdi32`,
`winhttp`, `advapi32`, `shell32`, `ole32`, `comdlg32`, `ws2_32`, `crypt32`,
`bcrypt`, `shlwapi`, `comctl32`, `uxtheme`, `ntdll`, `kernelbase` — plus the UCRT
forwarders (`api-ms-win-crt-*`, `api-ms-win-core-*`) that are part of Windows 10
and later and are not something a user installs. Anything else is a dependency
the user would have to install, which is exactly what this build exists to
avoid, so the build **fails**.

If the import table cannot be read at all, that is treated differently from an
empty one: the build refuses to report the dependencies as checked rather than
claiming a clean audit it did not actually perform.

### The resource section

The product icon and the version Explorer shows are carried by the executable
itself, not added by the installer. `build.mjs` writes one `.rc` per application
into the build directory before CMake configures - an `ICON` naming the product
`.ico` and a `VERSIONINFO` block (`Infinity.Inc`, the product name,
`1.0.0-pre5`) - and CMake hands that file to `windres`, which compiles it to an
object the link step includes. The result is checked the same way the import
table is: `build.mjs` parses each linked executable's resource directory and
fails the build if `RT_ICON` or `RT_GROUP_ICON` is missing, so a missing icon
cannot pass silently. The `.rc` files live under `cpp/build/rc/` and are build
artifacts; none of them is checked in.

### The download mark

A browser marks what it downloads with a `Zone.Identifier` stream, and a marked
program is one Windows questions before it will run. The suite's download pages
no longer hand out a script to clear it, so the programs clear it themselves:
`common/unblock.cpp` is linked by all six applications, and each `main` removes
the stream from its own executable and sweeps its own directory (two levels
deep, `.exe/.dll/.pak/.dat/.json/.txt` only) before anything else runs. The NSIS
installers clear the same stream from the files they drop, including the setup
itself. Only that stream is ever deleted - the file is never opened for writing,
and the path always comes from the running module, never from an argument.

Exact sizes and SHA-256 digests are not kept here. `tools/manifest.mjs` reads
them off disk and writes them to `cpp/release/<version>/release-assets.json`,
the file the publication step uploads - a number in that file cannot drift from
the bytes it describes. For scale: each executable and each NSIS installer is a
few hundred kilobytes.

## Environment notes

These are quirks of the machine this project is developed on, not general
recommendations. They are here so the next person does not rediscover them.

- **Prefix every `node` invocation with `NODE_OPTIONS=`.** The environment
  carries a `NODE_OPTIONS` value that this Node build refuses (it has held
  `--use-system-ca`, which Node rejects outright), so the tools clear it on the
  command line. `NODE_OPTIONS= node tools/build.mjs`.
- **`execFileSync` needs an explicit `stdio` and a large `maxBuffer`.** Every
  child process is spawned with `stdio: ['ignore', 'pipe', 'pipe']`, because
  inheriting stdin makes the spawn fail with `EBUSY`. The buffers are raised
  well above the 1 MB default (256 MB in `build.mjs` and `publish.mjs`, 64 MB in
  `package.mjs`): `objdump -p` on a statically linked binary prints more than
  1 MB, and the default failure surfaces as `ENOBUFS` — which once left the
  dependency audit reported as "skipped" while the summary still claimed the
  dependencies were Windows-only.
- **NSIS scripts are written with a UTF-8 BOM.** `package.mjs` prepends
  `\uFEFF` to the generated `.nsi` and runs `makensis` with UTF-8 input and
  output charsets; without the BOM the Chinese product strings in the script are
  mangled.
- **`curl` is called with `--ssl-no-revoke`.** This machine's schannel cannot
  reach the certificate revocation server, and an upload dies with
  `CRYPT_E_NO_REVOCATION_CHECK` before a single byte is sent. Skipping the
  revocation check is what makes uploads work here; it is not a general
  recommendation.
- **`git push` to github.com fails on this machine, so `ghsync.mjs` falls back
  to the Git Data API.** The git endpoint answers 502 here while the API is
  fine, so when a push fails the same tree is written through the API instead:
  blobs, a tree, a commit and a ref update. It is more requests and slower, but
  it is the same commit. The `git` calls also disable the proxy explicitly,
  because `~/.gitconfig` points at a local relay that is usually not running and
  the override has to name the URL-specific section (`[http "https://github.com"]`)
  to take effect.
---

## 中文摘要

- **三个应用**：Infinity Cloud、InfinityPackageManager、Infinity Toolbox。
  全部由 C++ 写成，静态链接，导入表里只有 Windows 自带的 DLL。
  管理面（管理员孪生）是在产品前缀后加 `x`：`inx`、`ipmx`、`intx`。
  名字即面孔：`<前缀>_<面孔>.exe`，程序按自身文件名的前缀与后缀判定产品、管理员身份与面孔；
  认不出的名字得到空面孔而不是报错。从源码目录启动时，也可以用第一个命令行词指定面孔（`inc gui`）。
- **面孔**：`inc` / `ipm` 两个产品各 6 个名字（cli / gui / launcher + 管理面），
  `int` 4 个（cli / gui + 管理面），合计 16 个名字。终端界面（tui）已从每个应用中移除。
- **端口**：`inc` 7621、`ipm` 7632、`int` 7653。
  每个 gui 面孔都在自己的环回端口上服务页面，所以两个应用可以同时打开而不会抢同一个端口。
- **共享内核**：`core/include/inc` 被静态链接到每个程序实际引用的程度——
  只有 Infinity Cloud 会拉入云文件系统那一部分，因此它是三者中最大的可执行文件。
- **InfinityPackageManager**：整个应用就是一份目录。每个包都是同一个仓库（`zssx-2026/applications`）
  里某个 release 的资产，程序只负责索引、摘要校验与启动。
  每个 release 就是一个目录页，用 `name.txt` 这个资产对外宣告内容：
  每行 `<资产名> <版本> <包名> <安装类型> <公司> <平台>`；前四个字段必需，缺省时平台记作 `any`、
  公司字段取自 release 本身，版本开头的 `v` 会被去掉。**行内资产名必须也是同一个 release 的资产**，
  否则该行被跳过——所以安装包既挂在各自的仓库上，也挂在目录页上。
  没有 `name.txt`（或没有一行命中本 release 的资产）时，回退为直接读取构建资产，从文件名推断包名、版本与平台。
- **下载落地位置**：`%LOCALAPPDATA%\InfinityPackageManager\downloads\`。不做任何注册——这个文件夹本身就是记录。
- **摘要规则**：文件不验证 SHA-256 就不安装、不运行。摘要必须是 `sha256:` + 64 个十六进制小写字母，
  共 71 字符；别的写法一律视为"没有摘要"。
  没有摘要的构建直接拒载（下载完成、无法确认、随即删除）；安装类型为 `setup` 的已验证产物才被启动，
  其余只放进下载目录。下载先写同卷的 `.part`，完整并校验通过后才改名，所以半成品不会以真名出现。
- **构建**：MinGW-w64（UCRT）+ CMake + Ninja，全静态。在 `cpp/` 下：
      node tools/build.mjs            # 编译，然后产出全部名字
      node tools/package.mjs          # 打成 NSIS 安装包
      node tools/manifest.mjs         # 写 name.txt 与 release-assets.json
      node tools/publish.mjs [tag]    # 上传安装包到 GitHub
  每个名字都是同一份 C++ 产物的真实副本（真复制，不是硬链接）；`ninja -j 2` 可用 `INC_JOBS` 覆盖。
  当前预发布版本为 `v1.0pre5`（`1.0.0-pre5`）。
- **导入表白名单审计**：链接后 `build.mjs` 对每个可执行文件跑 `objdump -p`，读 `DLL Name:` 行，
  与 Windows 库白名单（`kernel32`、`user32`、`gdi32`、`winhttp`、`advapi32`、`shell32`、`ole32`、
  `comdlg32`、`ws2_32`、`crypt32`、`bcrypt`、`shlwapi`、`comctl32`、`uxtheme`、`ntdll`、`kernelbase`）
  加上 UCRT 转发器（`api-ms-win-crt-*`、`api-ms-win-core-*`）比对；任何其它依赖都视为一项待修缺陷。
- **环境注意**：这台机器上 `git push` 到 github.com 失败（git 端点 502 而 API 正常），
  所以 `ghsync.mjs` 会改走 Git Data API：写 blob、tree、commit、更新 ref，请求更多、更慢，但提交相同；
  `curl` 必须带 `--ssl-no-revoke`，否则 schannel 连不上吊销服务器，上传会在第一个字节之前失败。
