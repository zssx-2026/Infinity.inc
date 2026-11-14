/* /cdn/<asset> - the mirror the download door points at.
 *
 * GitHub serves these installers at about 60 KB/s from some networks, which
 * makes an 80 MB setup a half-hour download; Cloudflare's edge pulls the same
 * object faster and hands it back over a connection that works here. So the
 * gate redirects here instead of straight to GitHub.
 *
 * Range requests are proxied, never cached: a partially cached object cannot be
 * sliced without buffering all of it. HEAD is answered locally from the asset
 * table so the desktop installer can see that this route does support ranges --
 * that is what lets it pull the mirror with eight connections when the release
 * host is unreachable, instead of falling back to one slow stream. */

import { ASSETS, COMPONENTS, sourceUrl } from '../_lib/assets.js';

/* Components are mirrored here too, so Studio has an own route when both the
 * release host and the public proxy are unusable. They are not reachable
 * through /dl: that door only knows ASSETS, so a component can never be handed
 * out as a public download -- only a caller who already knows the asset name
 * (Studio, reading /api/components) can ask for the bytes. */
function itemOf(asset) {
  return ASSETS[asset] || COMPONENTS[asset] || null;
}

const CACHE_SECONDS = 31536000;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
  });
}

function head(item, asset) {
  return new Response(null, {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(item.size),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      'x-infinity-asset': asset
    }
  });
}

export function onRequestHead(context) {
  const item = itemOf(context.params.asset);
  if (!item) return json({ error: 'unknown_asset', asset: context.params.asset }, 404);
  return head(item, context.params.asset);
}

export async function onRequestGet(context) {
  const asset = context.params.asset;
  const item = itemOf(asset);
  if (!item) return json({ error: 'unknown_asset', asset: asset }, 404);

  const request = context.request;
  const origin = new URL(request.url).origin;
  const range = request.headers.get('range') || '';

  if (range) {
    const upstream = await fetch(sourceUrl(item), { headers: { range: range } });
    const headers = new Headers();
    headers.set('content-type', 'application/octet-stream');
    for (const name of ['content-range', 'content-length', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has('accept-ranges')) headers.set('accept-ranges', 'bytes');
    headers.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: headers });
  }

  const cache = caches.default;
  const key = new Request(origin + '/cdn/' + encodeURIComponent(asset), { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('x-infinity-cache', 'hit');
    headers.set('accept-ranges', 'bytes');
    return new Response(hit.body, { status: 200, headers: headers });
  }

  const upstream = await fetch(sourceUrl(item));
  if (!upstream.ok) return json({ error: 'upstream_failed', status: upstream.status }, 502);

  const headers = new Headers();
  headers.set('content-type', 'application/octet-stream');
  headers.set('content-length', String(item.size));
  /* The body is a full read, but the route can slice, and saying so is what
   * lets the installer use it as a ranged host. */
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=' + CACHE_SECONDS + ', immutable');
  headers.set('x-infinity-cache', 'miss');
  headers.set('x-infinity-asset', asset);

  const response = new Response(upstream.body, { status: 200, headers: headers });
  context.waitUntil(cache.put(key, response.clone()));
  return response;
}
