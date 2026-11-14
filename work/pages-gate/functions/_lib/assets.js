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
    size: 84229152,
    sha256: 'dc05546a9efa428b69fdb302fecfe62d18d8f163e31101159f51781c4093b7dd'
  },
  'InfinityPackageManager-setup': {
    id: 'ipm',
    name: 'Infinity Package Manager',
    repo: 'Infinity-Studio',
    file: 'InfinityPackageManager_1.0.0-pre8_win64_setup.exe',
    size: 84419152,
    sha256: '7be59d5983fbf823e2d1975c3dc666eac39f003059385fadb20790ee252347fe'
  },
  'InfinityToolbox-setup': {
    id: 'int',
    name: 'Infinity Toolbox',
    repo: 'Infinity-Studio',
    file: 'InfinityToolbox_1.0.0-pre8_win64_setup.exe',
    size: 84420080,
    sha256: '6df13d8a09d920385132b498c6ef554fc49cc3e70dc5a2f60ae54d287f7b953a'
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
