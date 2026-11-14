/* One place that knows what the download door serves.
 *
 * Three functions need the same table: the catalog that lists it, the gate that
 * hands out a redirect, and the mirror that streams the bytes. Keeping one copy
 * means a version bump cannot leave them disagreeing. */

export const ASSETS = {
  'InfinityStudio-setup': {
    id: 'studio',
    name: 'Infinity Studio',
    repo: 'Infinity-Studio',
    file: 'InfinityStudio_1.0.0-pre8_win64_setup.exe',
    size: 83807192,
    sha256: 'd5dd3415968f1dc121abce519fb3b656fbd4c334dd87eff27c5772a124798b03'
  },
  'InfinityServer-setup': {
    id: 'server',
    name: 'Infinity Server',
    repo: 'Infinity-Server',
    file: 'InfinityServer_1.0.0-pre8_win64_setup.exe',
    size: 83716680,
    sha256: 'b69635364069217b241b14eae9ba25e2535f5cf6856579443d6ed884837ea526'
  }
};

/* The sub-products Studio installs for itself. They are deliberately not part
 * of ASSETS: the public page offers exactly two downloads (Studio and Server),
 * and a component is only reachable from inside Studio, which asks the
 * /api/components door for its own list. Publishing them as release assets is
 * how Studio gets the bytes; it is not a download offer on the site. */
export const COMPONENTS = {
  'InfinityCloud-setup': {
    id: 'inc',
    name: 'Infinity Cloud',
    repo: 'Infinity-Studio',
    file: 'InfinityCloud_1.0.0-pre8_win64_setup.exe',
    size: 84188040,
    sha256: '5e035cf6fbcd991e28fe39336721b9e7f8d914b7c2377a8cb6f2c96c842e70a4'
  },
  'InfinityPackageManager-setup': {
    id: 'ipm',
    name: 'Infinity Package Manager',
    repo: 'Infinity-Studio',
    file: 'InfinityPackageManager_1.0.0-pre8_win64_setup.exe',
    size: 84440992,
    sha256: '068a1ca5240a08b68d9dd8de9f8e10b8b3d9ecdf655f3807146a9be4e929ac55'
  },
  'InfinityToolbox-setup': {
    id: 'int',
    name: 'Infinity Toolbox',
    repo: 'Infinity-Studio',
    file: 'InfinityToolbox_1.0.0-pre8_win64_setup.exe',
    size: 84416216,
    sha256: '87995fa9649faeeb39932a4a1e346f4575cfb7b0ce8eedbcf5e187d1f4cb31fa'
  }
};

export const TAG = 'v1.0.0-pre8';

export function sourceUrl(item) {
  return 'https://github.com/zssx-2026/' + item.repo + '/releases/download/' + TAG + '/' + item.file;
}

export function mirrorUrl(origin, asset) {
  return origin + '/cdn/' + encodeURIComponent(asset);
}

/* A public GitHub proxy, used as the second host. It is not ours and it can
 * disappear, so it is never the only route: the release URL and our own /cdn
 * stay in the list, and every byte is checked against the catalog sha256 before
 * the installer is run -- a proxy that serves something else fails the hash
 * instead of being installed. Measured from this network it is several times
 * faster than our edge proxy for the same range requests. */
export const GH_PROXY = 'https://gh-proxy.com/';

export function proxyUrl(item) {
  return GH_PROXY + sourceUrl(item);
}
