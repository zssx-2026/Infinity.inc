import msilib, msilib.schema as s, msilib.sequence
import tempfile, os
p = os.path.join(tempfile.gettempdir(), 'probe2.msi')
if os.path.exists(p): os.remove(p)
db = msilib.init_database(p, s, 'X', '{11111111-2222-3333-4444-555555555555}', '1.0', 'X')
msilib.add_tables(db, msilib.sequence)
for name in ['FeatureComponents', 'Shortcut', 'Registry', 'Property', 'Icon', 'Upgrade', 'Media']:
    t = getattr(s, name, None)
    if t is None:
        print(name + '=NOTINSHCEMA')
        continue
    print(name + '=' + str(len(list(t._Table__columns))))
