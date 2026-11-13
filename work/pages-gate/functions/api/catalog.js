/* Catalog for the download page. Sizes and hashes are the ones the release
 * actually carries, so the page can show them before anyone downloads. */

const VERSION = '1.0.0-pre8';
const UPDATED = '2026-11-11T12:10:00Z';

const ASSETS = {
  'InfinityStudio-setup': {
    id: 'studio',
    name: 'Infinity Studio',
    url: 'https://github.com/zssx-2026/Infinity-Studio/releases/download/v1.0.0-pre8/InfinityStudio_1.0.0-pre8_win64_setup.exe',
    size: 83742472,
    sha256: '7283a3f6a409ae4495a9de2e84eb006d35a8f4f9c6204006e308ebc49c5f5312'
  },
  'InfinityServer-setup': {
    id: 'server',
    name: 'Infinity Server',
    url: 'https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe',
    size: 83745744,
    sha256: '129e4ec138aa760ebad1df0ca149faf84eb52ba2b53b1c365fbc067cdbc654a4'
  }
};

export function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const products = Object.keys(ASSETS).map(function (asset) {
    const item = ASSETS[asset];
    return {
      asset: asset,
      id: item.id,
      name: item.name,
      version: VERSION,
      size: item.size,
      sha256: item.sha256,
      url: item.url,
      dl: origin + '/dl/' + encodeURIComponent(asset)
    };
  });
  return new Response(JSON.stringify({ version: VERSION, updated: UPDATED, products: products }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    }
  });
}
