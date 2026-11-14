/* The component list Studio reads for itself.
 *
 * Separate from /api/catalog on purpose: the site renders whatever /api/catalog
 * returns, and the site must only ever offer Infinity Studio and Infinity
 * Server. Studio is an installer, so it is allowed to know that the things it
 * installs exist. Same shape as a catalog product so one client code path
 * handles both, plus component: true so the studio can label them. */

import { COMPONENTS, TAG, sourceUrl, proxyUrl, mirrorUrl } from '../_lib/assets.js';

const CORS = {
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8'
};

export function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const products = Object.keys(COMPONENTS).map((asset) => {
    const item = COMPONENTS[asset];
    return {
      asset: asset,
      id: item.id,
      name: item.name,
      version: TAG.replace(/^v/, ''),
      size: item.size,
      sha256: item.sha256,
      url: sourceUrl(item),
      mirror: mirrorUrl(origin, asset),
      mirrors: [proxyUrl(item), mirrorUrl(origin, asset)],
      component: true
    };
  });
  return new Response(
    JSON.stringify({ version: TAG.replace(/^v/, ''), updated: '2026-11-14T01:20:00Z', products: products }, null, 2),
    { status: 200, headers: CORS }
  );
}
