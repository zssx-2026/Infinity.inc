/* Catalog for the download page. Sizes and hashes are the ones the release
 * actually carries, so the page can show them before anyone downloads.
 *
 * url points at this deployment's mirror, not at GitHub: the desktop installer
 * reads this field and downloads from it, and GitHub answers at about 60 KB/s
 * from some networks. source keeps the release URL so a broken mirror can be
 * traced back to the bytes it is supposed to serve. */

import { ASSETS, TAG, sourceUrl, mirrorUrl, proxyUrl } from '../_lib/assets.js';

const UPDATED = '2026-11-11T12:10:00Z';

export function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const products = Object.keys(ASSETS).map(function (asset) {
    const item = ASSETS[asset];
    return {
      asset: asset,
      id: item.id,
      name: item.name,
      version: TAG.replace(/^v/, ''),
      size: item.size,
      sha256: item.sha256,
      /* The desktop installer prefers the release URL: it advertises ranges,
       * so the download can run in parallel, and the mirror is the fallback. */
      url: sourceUrl(item),
      /* Tried in this order after the release URL: the public proxy (fastest on
       * a line where GitHub is throttled), then our own edge proxy. */
      mirrors: [proxyUrl(item), mirrorUrl(origin, asset)],
      mirror: mirrorUrl(origin, asset),
      dl: origin + '/dl/' + encodeURIComponent(asset)
    };
  });
  return new Response(JSON.stringify({ version: TAG.replace(/^v/, ''), updated: UPDATED, products: products }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    }
  });
}
