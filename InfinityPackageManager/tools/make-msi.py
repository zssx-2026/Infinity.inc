"""
make-msi.py - build a Windows installer with msilib.

WiX is not installed on this machine and fetching it proved unreliable, but
Python's own msilib writes an MSI directly. It was removed in 3.13, so this
runs under the 3.12 that uv provides - the last release that still ships it.

Two MSI rules shape the whole file:

  * init_database already writes ProductName, ProductCode, ProductVersion,
    Manufacturer and ProductLanguage. Writing any of them again in the
    Property table is a duplicate key and aborts the build with error 2259.

  * every Component needs exactly one key path. Here the key path is the
    file the component installs, which is what makes the component
    self-describing and lets the installer repair it.

Usage:
    python make-msi.py <program-dir> <out.msi> <version> <exe-name>
"""
import msilib
import msilib.schema
import msilib.sequence
import os
import sys
import uuid

APP_NAME = 'Infinity Package Manager'
MANUFACTURER = 'Infinity.Inc'
UPGRADE_CODE = '{3C1D20A8-44F9-4C11-8B6E-2D5F0A1C9E78}'

BS = chr(92)
REG_ROOT = 'Software' + BS + 'InfinityPackageManager'


def guid_for(seed):
    return '{' + str(uuid.uuid5(uuid.NAMESPACE_DNS, seed)).upper() + '}'


def collect(root):
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
        guid_for(APP_NAME + ' ' + version), bare, MANUFACTURER)
    msilib.add_tables(db, msilib.sequence)

    # Template 7 declares the package x64. Without it ProgramFiles64Folder
    # resolves to the 32-bit Program Files and the app lands in the wrong tree.
    si = db.GetSummaryInformation(20)
    si.SetProperty(7, 'x64;1033')
    si.Persist()

    msilib.add_data(db, 'Property', [
        ('UpgradeCode', UPGRADE_CODE),
        ('ALLUSERS', '1'),
        ('ARPNOREPAIR', '1'),
    ])

    # Every directory in the payload needs a row, or the files inside it are
    # dropped into the install root. Directory ids are derived from the
    # relative path so a nested folder like lang/ gets its own row and its
    # files keep their place.
    dir_rows = [
        ('ProgramFiles64Folder', 'TARGETDIR', '.'),
        ('INSTALLFOLDER', 'ProgramFiles64Folder', APP_NAME),
        ('ProgramMenuFolder', 'TARGETDIR', '.'),
        ('AppMenuFolder', 'ProgramMenuFolder', APP_NAME),
        ('DesktopFolder', 'TARGETDIR', '.'),
    ]
    for rel, _full in files:
        head = os.path.dirname(rel)
        if not head:
            continue
        parent = 'INSTALLFOLDER'
        built = ''
        for part in head.split('/'):
            built = part if not built else built + '/' + part
            did = 'DIR_' + built.replace('/', '_')
            if not any(r[0] == did for r in dir_rows):
                dir_rows.append((did, parent, part))
            parent = did
    msilib.add_data(db, 'Directory', dir_rows)

    components = []
    file_rows = []
    feature_components = []
    registry_rows = []
    exe_index = None

    for i, (rel, full) in enumerate(files):
        cid = 'Cmp' + str(i)
        fid = 'Fil' + str(i)
        name = os.path.basename(rel)
        head = os.path.dirname(rel)
        target_dir = 'INSTALLFOLDER' if not head else 'DIR_' + head.replace('/', '_')
        components.append((cid, guid_for('comp/' + rel), target_dir, 0, None, fid))
        file_rows.append((fid, cid, name, str(os.path.getsize(full)), bare, '1033', None, str(i + 1)))
        feature_components.append(('Main', cid))
        msilib.add_stream(db, fid, full)
        if name.lower() == exe_name.lower():
            exe_index = i

    msilib.add_data(db, 'Component', components)
    msilib.add_data(db, 'File', file_rows)
    msilib.add_data(db, 'FeatureComponents', feature_components)

    if exe_index is None:
        raise SystemExit('the executable ' + exe_name + ' is not in the payload')

    msilib.add_data(db, 'Media', [('1', str(len(files)), None, None, None, None)])
    msilib.add_data(db, 'Feature', [('Main', None, APP_NAME, APP_NAME, 1, 1, 'INSTALLFOLDER', 0)])

    exe_comp = 'Cmp' + str(exe_index)
    exe_file = 'Fil' + str(exe_index)

    msilib.add_data(db, 'Shortcut', [
        ('SC_start', 'AppMenuFolder', APP_NAME, exe_comp, '[' + exe_file + ']', None, APP_NAME, None, None, None, None, 'INSTALLFOLDER'),
        ('SC_desk', 'DesktopFolder', APP_NAME, exe_comp, '[' + exe_file + ']', None, APP_NAME, None, None, None, None, 'INSTALLFOLDER'),
    ])

    registry_rows.append(('RegInstallDir', '-1', REG_ROOT, 'InstallDir', '[INSTALLFOLDER]', exe_comp))
    registry_rows.append(('RegVersion', '-1', REG_ROOT, 'Version', version, exe_comp))
    msilib.add_data(db, 'Registry', registry_rows)

    db.Commit()
    print('built ' + out_msi + ' ' + str(os.path.getsize(out_msi)) + ' bytes files=' + str(len(files)))


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        raise SystemExit(2)
    build(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])


if __name__ == '__main__':
    main()
