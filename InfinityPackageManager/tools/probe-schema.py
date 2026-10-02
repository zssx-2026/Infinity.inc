import msilib.schema as s
TABLES = ['Directory', 'Component', 'File', 'Feature', 'FeatureComponents', 'Media', 'Shortcut', 'Registry', 'Property', 'Icon', 'Upgrade']
for name in TABLES:
    t = getattr(s, name, None)
    if t is None:
        print(name + ' MISSING')
        continue
    cols = list(t._Table__columns)
    print(name + ' ' + str(len(cols)) + ' ' + ' '.join(cols))
