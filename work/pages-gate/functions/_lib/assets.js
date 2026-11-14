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
    size: 84184120,
    sha256: '90c7b8e699623189af4c9a481c9ffc83287bbded8cad7376eb5294d6cecfe174'
  },
  'InfinityPackageManager-setup': {
    id: 'ipm',
    name: 'Infinity Package Manager',
    repo: 'Infinity-Studio',
    file: 'InfinityPackageManager_1.0.0-pre8_win64_setup.exe',
    size: 83960840,
    sha256: '8cc06ea521018553bfa019cef8043cb221d743e42a8a20b173b537dcc2cbf2a7'
  },
  'InfinityToolbox-setup': {
    id: 'int',
    name: 'Infinity Toolbox',
    repo: 'Infinity-Studio',
    file: 'InfinityToolbox_1.0.0-pre8_win64_setup.exe',
    size: 83960576,
    sha256: '1b7ba6031868f340104f0c0e40fa7aa918940d02b64370cf385f60a60d0def52'
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
