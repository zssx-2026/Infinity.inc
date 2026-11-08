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
InfinityCloud_1.0.0-pre5_win64_setup.exe Infinity.Inc InfinityCloud setup Infinity.Inc win64
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
no registry key or index file that says what is installed; the catalogue walks
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

InfinityPackageManager applies the same rule to its own catalogue, with the same
insistence: an installer that runs without its digest checked is just a download
that happens to end in `.exe`.

The download itself is written to a temporary `.part` file on the same volume as
its destination and moved into place only once it is complete and verified, so a
half-written file never appears under the real name.
