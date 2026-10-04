# Infinity.Inc

Infinity.Inc is a suite of six Windows applications. Each product is built once
as a single C++ executable and then copied under several names; the program
reads its own file name to decide which face to run. The executables import only
DLLs that ship with Windows — no Node, no Electron, no Visual C++ redistributable,
no runtime to install — and the build enforces that claim:
`cpp/tools/build.mjs` reads each executable's import table with `objdump -p`
and fails the build if anything outside Windows appears in it.

This repository (`zssx-2026/Infinity.inc`) is the umbrella repository for the
suite: the C++ rewrite (`cpp/`), the Electron shell that hosts the `gui` face
(`shell/`), the website (`web/`), the icons (`icons/`), the
InfinityPackageManager distribution (`dist/`), and the working/history data.

## Products

| Product | Prefix (admin twin) | Repository | Downloads |
| --- | --- | --- | --- |
| Infinity Cloud | `inc` (`inx`) | [zssx-2026/Infinity-Cloud](https://github.com/zssx-2026/Infinity-Cloud) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4) |
| Infinity File Manager | `ifm` (`ifmx`) | [zssx-2026/Infinity-File-Manager](https://github.com/zssx-2026/Infinity-File-Manager) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0.0-pre4) |
| InfinityPackageManager | `ipm` (`ipmx`) | [zssx-2026/InfinityPackageManager](https://github.com/zssx-2026/InfinityPackageManager) | [v1.0.0-pre4](https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0.0-pre4) |
| Infinity Installer Manager | `iim` (`iimx`) | [zssx-2026/Infinity-Installer-Manager](https://github.com/zssx-2026/Infinity-Installer-Manager) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Installer-Manager/releases/tag/v1.0.0-pre4) |
| Infinity Toolbox | `int` (`intx`) | [zssx-2026/Infinity-Toolbox](https://github.com/zssx-2026/Infinity-Toolbox) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Toolbox/releases/tag/v1.0.0-pre4) |
| Infinity Games | `ing` (`ingx`) | [zssx-2026/Infinity-Games](https://github.com/zssx-2026/Infinity-Games) | [v1.0.0-pre4](https://github.com/zssx-2026/Infinity-Games/releases/tag/v1.0.0-pre4) |

A name is `<prefix>_<face>.exe`: the prefix selects the product and the suffix
selects the face, and the administrator twin adds an `x` to the prefix
(`inx_cli.exe`, `ifmx_gui.exe`, …). The faces are `cli`, `gui` and
`launcher`; Infinity Cloud, Infinity File Manager and InfinityPackageManager
ship all three, while Infinity Installer Manager, Infinity Toolbox and Infinity
Games ship `cli` and `gui` only (they have no launcher). The per-application
face list in the build has to match `cpp/core/include/inc/mode.hpp`, which
rejects a face an application does not have.

Website: <https://zssx-2026.github.io/infinity/> (English),
<https://zssx-2026.github.io/infinity/cn/> (Chinese).

## Building and releasing

Prerequisites:

- **build** — MinGW-w64 (UCRT), CMake and Ninja on `PATH`.
- **package** — NSIS; `makensis` is expected at
  `C:\Program Files (x86)\NSIS\makensis.exe`.
- **publish** — `curl` and a GitHub token in the `EV_GH_TOKEN` environment
  variable.

From the repository root:

```sh
node cpp/tools/build.mjs      # compile with CMake + Ninja, copy the executable to cpp/out/<app>/ under every name, audit the imports
node cpp/tools/package.mjs    # build one NSIS installer per application into cpp/release/v1.0pre4/
node cpp/tools/publish.mjs    # upload each installer to that application's own repository release
```

The scripts also accept being run from `cpp/` as `node tools/<script>.mjs`.
`publish.mjs` takes an optional tag and `--dry-run` (GET only: it resolves
the repositories and releases, checks the local file names and prints what a
real run would do, without creating, deleting or uploading anything).

On this development machine, node is invoked with `NODE_OPTIONS` cleared
(`$env:NODE_OPTIONS=''`), because the environment default is rejected by this
Node build.

### Release conventions

- Git tag: `v1.0.0-preN`.
- Release directory: `cpp/release/v1.0preN` (from `INC_RELEASE`, default
  `v1.0pre4`).
- Installer file name: `<package>_<version>_win64_setup.exe`, with
  `<version>` = `1.0.0-preN` (from `INC_VERSION`, by default derived from
  the tag), e.g. `InfinityCloud_1.0.0-pre4_win64_setup.exe`.
- Package names: `InfinityCloud`, `InfinityFileManager`,
  `InfinityPackageManager`, `InfinityInstallerManager`, `InfinityToolbox`,
  `InfinityGames`.

Each application has its own repository, and its single installer is attached to
the release in that repository, so a user downloads exactly one file.
`publish.mjs` only touches the release named by the tag; within it, it only
replaces an asset carrying exactly the name it is about to upload and never
removes an asset with any other name. A repository that does not exist is
reported and skipped, never created. After uploading, the script re-reads the
asset and compares its size, and its `sha256` digest when GitHub exposes one.

`cpp/release/v1.0preN/` also holds two description files: `name.txt` (the
catalogue lines) and `release-assets.json` (per asset: name, size, `sha256`,
`fnv1a`, repository and download URL, plus the tag and version).

## Directory structure

```
cpp/     The C++ suite. apps/ holds the per-application sources, core/ the
         shared static library, tools/ the build/package/publish/manifest
         scripts, tests/ the C++ tests. out/ holds the named executables,
         release/ the installers plus name.txt and release-assets.json, and
         build/ the CMake/NSIS working files (not published).
shell/   The Electron shell that hosts the gui face (main.js, preload.js,
         build.mjs, payload.mjs).
web/     The static website. web/infinity/ holds the product and download
         pages; web/infinity/cn/ holds the Chinese pages.
icons/   The application icons (inc, ifm, ipm, iim, int, ing) and their SVG
         sources.
dist/    The InfinityPackageManager distribution: ipm.exe, the catalogue and
         registry JSON, and the language files.
history/ history.jsonl.
```

Source repository: <https://github.com/zssx-2026/Infinity.inc>
