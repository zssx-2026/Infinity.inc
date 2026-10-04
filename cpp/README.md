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

There are four products. Each is **one** executable, built once, and then copied
under several names. The program reads its own file name to decide which face to
be — there is no separate binary per face and no configuration file to keep in
step.

| Product | Directory | What it is |
| --- | --- | --- |
| Infinity Cloud | `apps/inc` | The GitHub-backed cloud: credential, manifest, upload/download, recycle bin. |
| Infinity File Manager | `apps/ifm` | Local file operations: list, copy, move, rename, recycle-bin delete. |
| InfinityPackageManager | `apps/ipm` | The package catalogue: browse, verify and run installers. |
| Infinity Installer Manager | `apps/iim` | The one installer for the whole suite — products, plugins and resource packs. |

A **face** is a way of presenting a product: `cli` is a command line, `gui` is a
native Win32 window, and `launcher` is a small console menu that starts one of
the other two. Every face also has an **administrator twin**, whose name carries
an `x` suffix on the product prefix (`inx`, `ifmx`, `ipmx`, `iimx`). The twin is
the same file; it only records that it was started under an administrator name
and lets the caller decide what that means — a program cannot grant itself
elevation, so pretending to be root would be dishonest.

| Product | Faces | Names produced |
| --- | --- | --- |
| Infinity Cloud | cli, gui, launcher | `inc_cli`, `inc_gui`, `inc_launcher`, `inx_cli`, `inx_gui`, `inx_launcher` |
| Infinity File Manager | cli, gui, launcher | `ifm_cli`, `ifm_gui`, `ifm_launcher`, `ifmx_cli`, `ifmx_gui`, `ifmx_launcher` |
| InfinityPackageManager | cli, gui, launcher | `ipm_cli`, `ipm_gui`, `ipm_launcher`, `ipmx_cli`, `ipmx_gui`, `ipmx_launcher` |
| Infinity Installer Manager | cli, gui | `iim_cli`, `iim_gui`, `iimx_cli`, `iimx_gui` |

So the three applications produce six names each and Infinity Installer Manager
produces four. The rule lives in `core/include/inc/mode.hpp`: `detectMode()`
takes the executable's own base name, splits it on the first `_`, maps the
prefix to a product (and to the administrator flag) and the suffix to a face. A
name that matches nothing yields an empty mode rather than an error. Infinity
Installer Manager deliberately has no launcher — it has exactly two faces and
nothing to choose between.

Because the mode lives in the name, a copy is genuinely a different program from
the user's point of view, and the build stays a single artifact per application.
When the program is started under a name that carries no mode — which is what
happens from a source build — the first command-line word is taken as the face,
so `inc gui` and `iim cli` still work.

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

`core/` is one static library, linked by all four products. It is written from
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
noticeably the largest executable of the four.

## Infinity Installer Manager

Infinity Installer Manager is the one entry point that installs everything: the
products, the plugins they drive, and the resource packs they load. It is
deliberately the only program that knows where an install lands, so "where did
that plugin go" has exactly one answer.

### The catalogue

The catalogue is a single GitHub repository, `zssx-2026/applications`. **Every
release in it is one catalogue page.** A page advertises what it holds through a
`name.txt` asset whose lines read:

```
<asset name> <version> <package> <install kind> <company> <platform>
```

For example, a line for the Infinity Cloud installer looks like:

```
InfinityCloud_1.0.0-pre3_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
```

The page's **tag** is what decides the category, because it is the only thing
that says what a release holds — there is no second index to keep in step with
it:

| Tag starts with | Category | Install folder |
| --- | --- | --- |
| `plugin` | plugin | `plugin` |
| `resource`, `pack` | resource pack | `resource` |
| anything else | product | `product` |

A line in `name.txt` names an asset. If that name is **not also an asset of the
same release**, the line is skipped and nothing is offered for it. This is why
the installers are attached to the catalogue page *as well as* to their own
per-application repository: a page that lists a file it does not itself hold
would advertise a download that 404s. The page keeps one copy of each installer,
which is a few hundred kilobytes for the whole suite.

A release that yields no catalogue items — because it has no `name.txt`, or
because none of its lines named an asset of that release — falls back to reading
its build assets directly, inferring a package name, version and platform from
each file name, so an older page that predates the manifest still shows
something.

`iim publish <type> <file> <name> <version>` adds to the catalogue: the asset is
uploaded first and the `name.txt` line that makes it visible is written second,
in that order, for the same reason — a file nothing lists is better than a page
that lists a file it does not have.

The catalogue is kept current in practice by `work/ghsync.mjs`, which publishes
the built installers and rewrites the `name.txt` of the product catalogue page
(the release tagged `application-inc`, a tag that names no plugin or resource
and therefore reads as a product page).

### Where an install lands

Everything an install places lives under one root, split by category so that
removing a plugin can never take a product with it:

```
%LOCALAPPDATA%\Infinity.Inc\<category>\<name>\
```

where `<category>` is `product`, `plugin` or `resource`. The downloaded file is
placed inside that folder, and an `item.json` record is written beside it
carrying the name, version, platform, category, file name, digest, install kind,
size, source URL, catalogue page and install time.

The list of what is installed is **read off the disk**, not remembered. There is
no registry key or index file that says what is installed; `iim installed` walks
the three category folders and reads each `item.json` it finds. A remembered list
and a folder can disagree; a folder cannot disagree with itself. A folder without
a readable record is simply not counted.

Package names become directory names, so they are validated rather than trusted:
the catalogue is remote data, and `../..` is a legal package name only until
somebody types it. Names containing path separators, control characters, reserved
device names (`CON`, `NUL`, `COM1`, …) or a trailing dot are rejected.

### The digest rule

Nothing is installed or run unless the SHA-256 of the downloaded file matches
the digest GitHub reports for the asset. The digest must be a well-formed
`sha256:` followed by 64 hex digits; anything else counts as no digest at all.

- A **build with no digest is refused**. The file is downloaded, the digest
  cannot be confirmed, and the download is deleted rather than installed.
- A **verified product that ships a setup program** — an item whose install kind
  is `setup` — is launched after verification.
- A **plugin, a resource pack, or a portable product** is placed in its folder
  instead of being run.

`iim download` is the one place a file is kept without being run: it is written
to a path you name and marked as verified or not, and it is never executed.
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
NODE_OPTIONS= node tools/publish.mjs [tag]    # upload installers to GitHub
```

- `build.mjs` configures and compiles with CMake/Ninja, then copies the single
  executable of each application into `cpp/out/<app>/` under all of its names.
  It uses real file copies rather than hard links: the binaries are a few hundred
  kilobytes now instead of eighty megabytes, and a real file survives being
  copied onto a USB stick or into an installer without any question about
  whether the link came along.
- `package.mjs` builds one self-contained NSIS installer per application into
  `cpp/release/v1.0pre3/`. NSIS is used without a plug-in or a DLL; no icons are
  assumed.
- `publish.mjs` uploads each installer to that application's own repository, so a
  user downloads exactly one file. It goes through `curl` (see the environment
  notes below). `work/ghsync.mjs` is the other publication path: it pushes the
  source, uploads the per-application assets, and maintains the `applications`
  catalogue page.

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

Sizes from a recent build, in bytes:

| Executable | Size |
| --- | --- |
| `inc` (Infinity Cloud) | 1,345,024 |
| `ifm` (Infinity File Manager) | 375,808 |
| `ipm` (InfinityPackageManager) | 529,920 |
| `iim` (Infinity Installer Manager) | 589,824 |

and the NSIS installers built from them:

| Installer | Size |
| --- | --- |
| `InfinityCloud_1.0.0-pre3_win64_setup.exe` | 441,856 |
| `InfinityFileManager_1.0.0-pre3_win64_setup.exe` | 187,658 |
| `InfinityPackageManager_1.0.0-pre3_win64_setup.exe` | 241,405 |
| `InfinityInstallerManager_1.0.0-pre3_win64_setup.exe` | 262,570 |

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
