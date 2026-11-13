import { sign, read, secretOf, makeCode, mac, sameText } from '../_lib/ticket.js';
import { codePng } from '../_lib/captcha.js';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }
  });
}

/* GET /api/verify -> a fresh local challenge: a PNG of the code plus a signed
 * token that only carries the code's HMAC (never the code itself).
 * POST /api/verify {challenge, answer, asset} -> a short-lived download ticket. */
export async function onRequestGet(context) {
  const secret = secretOf(context.env);
  if (!secret) return json({ error: 'not_configured' }, 503);
  const code = makeCode(5);
  const challenge = await sign(secret, { t: 'c', h: await mac(secret, code), exp: Date.now() + 180000 });
  return json({ challenge: challenge, image: await codePng(code, 6), expiresIn: 180 });
}

export async function onRequestPost(context) {
  const secret = secretOf(context.env);
  if (!secret) return json({ error: 'not_configured' }, 503);
  let body = null;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'bad_request' }, 400); }
  const payload = await read(secret, body && body.challenge);
  if (!payload || payload.t !== 'c' || typeof payload.h !== 'string') {
    return json({ error: 'challenge_expired' }, 400);
  }
  const answer = String((body && body.answer) || '').replace(/\s+/g, '').toUpperCase();
  if (!answer) return json({ error: 'wrong_code' }, 400);
  if (!sameText(await mac(secret, answer), payload.h)) return json({ error: 'wrong_code' }, 400);
  const asset = String((body && body.asset) || '');
  const ticket = await sign(secret, { t: 'd', a: asset, exp: Date.now() + 120000 });
  return json({ ticket: ticket, asset: asset, expiresIn: 120 });
}
