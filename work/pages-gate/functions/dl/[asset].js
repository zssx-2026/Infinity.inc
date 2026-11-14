/* /dl/<asset> - the download door.
 *
 * Two ways in, both of them short-lived and signed by this deployment:
 *   ?token=<turnstile token>  - Cloudflare Turnstile said a human is here
 *   ?lt=<local ticket>        - the local code page said a human is here
 * Nothing hands out a file URL without one of them, and the ticket is bound to
 * the asset, so a copied link is worthless after two minutes. */

import { read, secretOf } from '../_lib/ticket.js';
import { ASSETS, mirrorUrl } from '../_lib/assets.js';

const VERIFY_PAGE = 'https://infinity-verify.pages.dev/';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
  });
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gatePage(sitekey, asset, message) {
  const action = '/dl/' + encodeURIComponent(asset);
  const local = VERIFY_PAGE + '?asset=' + encodeURIComponent(asset) + '&local=1';
  const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>下载验证 · ' + escapeHtml(asset) + '</title>' +
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' +
    '<style>html,body{margin:0;height:100%;background:#0b0d10;color:#e8edf2;font:16px/1.6 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}' +
    '.box{min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px}' +
    '.card{background:#14181d;border:1px solid #242b33;border-radius:16px;padding:28px;max-width:420px;width:100%;text-align:center}' +
    'h1{font-size:18px;margin:0 0 8px}p{color:#9aa7b4;font-size:14px;margin:0 0 18px}' +
    '#w{min-height:65px;display:flex;justify-content:center}#m{color:#ff9a9a;font-size:13px;min-height:20px;margin-top:10px}' +
    'a.alt{color:#5b9bff;font-size:13px;text-decoration:none;display:inline-block;margin-top:10px}</style>' +
    '</head><body><div class="box"><div class="card"><h1>下载前验证一次</h1>' +
    '<p>' + (message ? escapeHtml(message) : '这一步由 Cloudflare Turnstile 确认，通过后自动开始下载。') + '</p>' +
    '<div id="w"></div><div id="m"></div>' +
    '<a class="alt" href="' + escapeHtml(local) + '">验证组件打不开？改用本地验证</a>' +
    '</div></div>' +
    '<script>function go(t){location.replace(' + JSON.stringify(action) + ' + "?token=" + encodeURIComponent(t));}' +
    'function boot(){if(!window.turnstile){setTimeout(boot,150);return;}' +
    'turnstile.render("#w",{sitekey:' + JSON.stringify(sitekey) + ',theme:"dark",language:"zh-cn",callback:go,' +
    '"error-callback":function(){document.getElementById("m").textContent="验证失败，请刷新页面重试，或改用本地验证。";},' +
    '"expired-callback":function(){document.getElementById("m").textContent="票据已过期，请再验证一次。";turnstile.reset("#w");}});}' +
    'boot();</script></body></html>';
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function verifyTurnstile(secret, token, ip) {
  if (!secret || !token) return false;
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: body });
  if (!res.ok) return false;
  const data = await res.json();
  return data && data.success === true;
}

export async function onRequestGet(context) {
  const asset = context.params.asset;
  if (!ASSETS[asset]) return json({ error: 'unknown_asset', asset: asset }, 404);

  const url = new URL(context.request.url);
  /* The redirect points at this deployment's mirror rather than at GitHub: the
   * browser still gets a 302 from Cloudflare, but the bytes come from an edge
   * cache instead of a 60 KB/s origin. */
  const target = mirrorUrl(url.origin, asset);
  const accept = context.request.headers.get('accept') || '';
  const wantsHtml = accept.indexOf('text/html') >= 0;

  /* Local ticket first: it needs no third-party host, so it keeps working on
   * networks where the Turnstile challenge frame cannot load. */
  const localTicket = url.searchParams.get('lt') || '';
  if (localTicket) {
    const payload = await read(secretOf(context.env), localTicket);
    if (payload && payload.t === 'd' && payload.a === asset) {
      return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
    }
    if (wantsHtml) return gatePage(context.env.TURNSTILE_SITEKEY || '', asset, '本地验证已过期，请再验证一次。');
    return json({ error: 'local_ticket_invalid' }, 403);
  }

  const sitekey = context.env.TURNSTILE_SITEKEY || '';
  const token = url.searchParams.get('token') || '';
  if (!sitekey) {
    if (wantsHtml) return gatePage('', asset, '下载验证未配置（缺少 TURNSTILE_SITEKEY）。');
    return json({ error: 'turnstile_not_configured' }, 503);
  }
  if (!token) {
    if (wantsHtml) return gatePage(sitekey, asset, '');
    return json({ error: 'turnstile_required' }, 403);
  }
  const ip = context.request.headers.get('cf-connecting-ip') || '';
  if (!(await verifyTurnstile(context.env.TURNSTILE_SECRET || '', token, ip))) {
    if (wantsHtml) return gatePage(sitekey, asset, '验证未通过，请再验证一次。');
    return json({ error: 'turnstile_failed' }, 403);
  }
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
}