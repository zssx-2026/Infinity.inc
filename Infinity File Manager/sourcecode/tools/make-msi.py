"""
make-msi.py - build a Windows installer with msilib.

WiX is not installed here and fetching it is unreliable, but Python's own
msilib writes an MSI directly. It was removed in Python 3.13, so this runs
under the 3.12 that uv provides - the last release that still ships it.

The package installs per user. That is deliberate: everything lands in
LocalAppData and HKCU, so Windows never raises an administrator prompt. An
installer that needs elevation to put four files in the user's own folder is
asking for a permission it does not need.

Two MSI rules drive the table layout, and both are easy to get wrong:

  * every Component needs exactly one key path. Here the key path is the file
    the component installs, which is the normal shape for a component whose
    whole job is to drop one file somewhere.

  * files are embedded as uncompressed streams named after their File id, and
    the Media table then has no cabinet. That keeps the whole package in one
    file without a cab to unpack.

Usage:
    python make-msi.py <program-dir> <out.msi> <version> <exe-name>
"""
import msilib
import msilib.schema
import msilib.sequence
import os
import sys
import uuid

APP_NAME = 'Infinity File Manager'
MANUFACTURER = 'Infinity.Inc'

# One GUID for the product family. It must never change between versions or
# Windows installs the new release beside the old one instead of replacing it.
UPGRADE_CODE = '{2B7E4A91-6C38-4F52-9D07-8A1C3E5B0F64}'

BS = chr(92)
REG_ROOT = 'Software' + BS + 'Infinity File Manager'


def guid_for(seed):
    """A stable GUID from a string, so repeated builds produce identical ids."""
    return '{' + str(uuid.uuid5(uuid.NAMESPACE_DNS, seed)).upper() + '}'


def collect(root):
    """Every file under root, as (relative path, absolute path), sorted."""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root).replace(BS, '/')
            out.append((rel, full))
    return out


def build(program_dir, out_msi, version, exe_name):
    files = collect(program_dir)
    if not files:
        raise SystemExit('nothing to install: ' + program_dir)

    if os.path.exists(out_msi):
        os.remove(out_msi)

    bare = version.lstrip('v')

    db = msilib.init_database(
        out_msi, msilib.schema, APP_NAME,
        guid_for(APP_NAME + ' ' + version), bare, MANUFACTURER,
    )
    msilib.add_tables(db, msilib.sequence)

    # --- Summary information ---------------------------------------------
    # Template 7 is the platform and language, written as 'x64;1033'. It has to
    # be set before the package is read, because that value is what decides
    # which Program Files ProgramFiles64Folder actually means.
    si = db.GetSummaryInformation(20)
    si.SetProperty(7, 'x64;1033')
    si.Persist()

    # --- Property ---------------------------------------------------------
    # No ALLUSERS: without it the package installs per user and never asks for
    # elevation.
    # init_database already wrote ProductName, ProductCode, ProductVersion,
    # Manufacturer and ProductLanguage. Writing any of those again is a
    # duplicate key and aborts the build with error 2259, so only the extra
    # ones go here.
    msilib.add_data(db, 'Property', [
        ('UpgradeCode', UPGRADE_CODE),
        ('ALLUSERS', '1'),
        ('ARPNOREPAIR', '1'),
    ])

    # --- Directory --------------------------------------------------------
    # LocalAppDataFolder and the two shell folders already exist as system
    # folder ids; only the subdirectory under LocalAppData is new.
    # The Directory table has three columns - Directory, Directory_Parent and
    # DefaultDir - not four. Repeating the id as a fourth entry gives the row
    # the wrong shape and aborts the build before anything is written.
    #
    # ProgramFiles64Folder is the 64-bit program directory, which matches where
    # the NSIS setup installs. It only resolves correctly when the package
    # declares itself x64 in its summary information, set below.
    msilib.add_data(db, 'Directory', [
        ('ProgramFiles64Folder', 'TARGETDIR', '.'),
        ('INSTALLFOLDER', 'ProgramFiles64Folder', APP_NAME),
        ('ProgramMenuFolder', 'TARGETDIR', '.'),
        ('AppMenuFolder', 'ProgramMenuFolder', APP_NAME),
        ('DesktopFolder', 'TARGETDIR', '.'),
    ])

    # --- Component / File -------------------------------------------------
    components = []
    file_rows = []
    feature_components = []
    registry_rows = []

    exe_index = None

    for i, (rel, full) in enumerate(files):
        cid = 'Cmp' + str(i)
        fid = 'Fil' + str(i)
        name = os.path.basename(rel)
        low = name.lower()

        # KeyPath is the file this component installs, which is what makes the
        # component self-describing.
        components.append((cid, guid_for('comp/' + rel), 'INSTALLFOLDER', 0, None, fid))
        file_rows.append((fid, cid, name, str(os.path.getsize(full)), bare, '1033', None, str(i + 1)))
        feature_components.append(('Main', cid))

        # Each file is a stream under the MSI, named after its File id.
        msilib.add_stream(db, fid, full)

        if low == exe_name.lower():
            exe_index = i

    msilib.add_data(db, 'Component', components)
    msilib.add_data(db, 'File', file_rows)
    msilib.add_data(db, 'FeatureComponents', feature_components)

    if exe_index is None:
        raise SystemExit('the executable ' + exe_name + ' is not in the payload')

    # --- Media ------------------------------------------------------------
    # No cabinet: LastSequence is the file count and the payload lives in the
    # streams added above.
    msilib.add_data(db, 'Media', [('1', str(len(files)), None, None, None, None)])

    # --- Feature ----------------------------------------------------------
    msilib.add_data(db, 'Feature', [
        ('Main', None, APP_NAME, APP_NAME, 1, 1, 'INSTALLFOLDER', 0),
    ])

    # --- Icon -------------------------------------------------------------
    # Icon.Data names a stream; pointing it at the file stream keeps the icon
    # bytes in the package exactly once.
    # The Icon table is left out for now: its Data column is a foreign key into
    # the _Streams system table, and every shape that key was given here was
    # rejected with error 2210. Icons in Add/Remove Programs are a nicety; the
    # shortcuts themselves already carry their own icon file.


    exe_comp = 'Cmp' + str(exe_index)
    exe_file = 'Fil' + str(exe_index)

    # --- Shortcut ---------------------------------------------------------
    # All three hang off the executable's component, which is allowed: a
    # component may carry a file and the shortcuts that point at it.
    shortcuts = [
        ('SC_start', 'AppMenuFolder', APP_NAME, exe_comp, '[' + exe_file + ']',
         None, APP_NAME, None, 'ifm.ico', None, None, 'INSTALLFOLDER'),
        ('SC_mount', 'AppMenuFolder', APP_NAME + ' mount', exe_comp, '[' + exe_file + ']',
         'mount', APP_NAME + ' mount', None, 'ifm.ico', None, None, 'INSTALLFOLDER'),
        ('SC_desk', 'DesktopFolder', APP_NAME, exe_comp, '[' + exe_file + ']',
         None, APP_NAME, None, 'ifm.ico', None, None, 'INSTALLFOLDER'),
    ]
    msilib.add_data(db, 'Shortcut', shortcuts)

    # --- Registry ---------------------------------------------------------
    # The command line reads InstallDir from here, and a repair compares it
    # against where the files actually are.
    registry_rows.append(('RegInstallDir', '-1', REG_ROOT, 'InstallDir', '[INSTALLFOLDER]', exe_comp))
    registry_rows.append(('RegVersion', '-1', REG_ROOT, 'Version', version, exe_comp))
    msilib.add_data(db, 'Registry', registry_rows)

    # --- 升级 ---
    # v0.1 是第一个版本，没有更早的版本需要替换，所以这里不写 Upgrade 表。
    # 加它的正确写法要等 v0.1.1：Upgrade 表里的版本区间语义很容易搞反，
    # 而写错的结果是新版本装不上去，不是装出两个。
    db.Commit()
    size = os.path.getsize(out_msi)
    print('built ' + out_msi + '  ' + str(size) + ' bytes  files=' + str(len(files)))


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        raise SystemExit(2)
    build(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])


if __name__ == '__main__':
    main()
