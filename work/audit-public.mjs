/* 公开面体检：三个域名、两道门、两个目录、一个下载闸、一套本地验证。
 *
 * 这个脚本只读线上，不改任何东西。它存在的理由是「部署过」不等于「现在还是
 * 对的」：目录里的字节、页面上的链接、闸门的拒绝方式都可能在上一次改代码后
 * 悄悄漂移，而漂移只有真的去请求才会暴露。
 *
 * 跑法：node work/audit-public.mjs
 * 通过：最后一行打印 PUBLIC-SURFACE PASS n/n，exit 0。 */
import { ASSETS, COMPONENTS, TAG, sourceUrl } from './pages-gate/functions/_lib/assets.js';

const LANDING = 'https://infinity-studio-craft.github.io/';
const VERIFY = 'https://infinity-verify.pages.dev/';
const GATE = 'https://infinity-downloads.pages.dev';
const SITEKEY = '0x4AAAAAAF-CBPThfL7uy0hi';

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fails.push(label + (detail ? ' :: ' + detail : ''));
}

async function get(url, opt) {
  const o = Object.assign({ redirect: 'manual' }, opt || {});
  o.signal = AbortSignal.timeout(25000);
  const res = await fetch(url, o);
  const text = o.method === 'HEAD' ? '' : await res.text();
  return { status: res.status, headers: res.headers, text };
}

const landing = await get(LANDING);
ok(landing.status === 200, 'landing 200', String(landing.status));
ok(/Infinity Studio/.test(landing.text) && /Infinity Server/.test(landing.text), 'landing 两个产品名');
ok((landing.text.match(/infinity-verify\.pages\.dev/g) || []).length >= 2, 'landing 两条验证页链接');
ok(!/github\.com/i.test(landing.text), 'landing 无 github 链接');
ok(!/InfinityCloud|InfinityPackageManager|InfinityToolbox/.test(landing.text), 'landing 不列子应用');
ok(!/turnstile/i.test(landing.text), 'landing 自身不嵌 Turnstile（验证独立成页）');

const verify = await get(VERIFY);
ok(verify.status === 200, 'verify 200', String(verify.status));
ok(verify.text.includes('challenges.cloudflare.com/turnstile'), 'verify 载 Turnstile');
ok(verify.text.includes(SITEKEY), 'verify sitekey 正确');
ok(verify.text.includes('infinity-downloads.pages.dev'), 'verify 指向下载门');
ok(/api\/verify/.test(verify.text), 'verify 有本地验证回退');

const root = await get(GATE + '/');
ok(root.status === 200, 'gate 根页 200', String(root.status));
ok((root.text.match(/infinity-verify\.pages\.dev/g) || []).length >= 2, 'gate 根页两条入口');

const catalog = JSON.parse((await get(GATE + '/api/catalog')).text);
ok(catalog.products.length === 2, 'catalog 两条', String(catalog.products.length));
for (const [asset, item] of Object.entries(ASSETS)) {
  const p = catalog.products.find((x) => x.asset === asset);
  ok(!!p, 'catalog 含 ' + asset);
  if (!p) continue;
  ok(p.size === item.size, asset + ' size', p.size + ' vs ' + item.size);
  ok(p.sha256 === item.sha256, asset + ' sha256');
  ok(p.url === sourceUrl(item), asset + ' url 是发行直链');
  ok(Array.isArray(p.mirrors) && p.mirrors.length === 2, asset + ' 两个镜像');
  ok(p.dl === GATE + '/dl/' + encodeURIComponent(asset), asset + ' dl 指向闸门');
}

const comps = JSON.parse((await get(GATE + '/api/components')).text);
ok(comps.products.length === 3, 'components 三条', String(comps.products.length));
for (const [asset, item] of Object.entries(COMPONENTS)) {
  const p = comps.products.find((x) => x.asset === asset);
  ok(!!p, 'components 含 ' + asset);
  if (!p) continue;
  ok(p.size === item.size && p.sha256 === item.sha256, asset + ' 字节与哈希');
  ok(p.component === true, asset + ' 标记为组件');
  ok(Array.isArray(p.mirrors) && p.mirrors.length === 2, asset + ' 两个镜像');
}

const gateHtml = await get(GATE + '/dl/InfinityStudio-setup', { headers: { accept: 'text/html' } });
ok(gateHtml.status === 200 && /turnstile|验证/.test(gateHtml.text), '闸门给 HTML 验证页');
const gateJson = await get(GATE + '/dl/InfinityStudio-setup', { headers: { accept: 'application/json' } });
ok(gateJson.status === 403 && /turnstile_required/.test(gateJson.text), '闸门无票 JSON 403');
const badTicket = await get(GATE + '/dl/InfinityStudio-setup?lt=deadbeef.0000', { headers: { accept: 'application/json' } });
ok(badTicket.status === 403 && /local_ticket_invalid/.test(badTicket.text), '闸门假本地票 403');
const componentDoor = await get(GATE + '/dl/InfinityCloud-setup', { headers: { accept: 'application/json' } });
ok(componentDoor.status === 404 && /unknown_asset/.test(componentDoor.text), '公开闸门不认组件');

const head = await get(GATE + '/cdn/InfinityServer-setup', { method: 'HEAD' });
ok(head.status === 200, '镜像 HEAD 200', String(head.status));
ok(head.headers.get('content-length') === String(ASSETS['InfinityServer-setup'].size), '镜像 HEAD 字节');
ok((head.headers.get('accept-ranges') || '') === 'bytes', '镜像声明可 Range');

const challenge = await get(GATE + '/api/verify?asset=InfinityStudio-setup');
ok(challenge.status === 200, '本地验证 challenge 200', String(challenge.status));
const ch = JSON.parse(challenge.text);
ok(typeof ch.challenge === 'string' && ch.challenge.length > 8, 'challenge 有票据');
ok(typeof ch.image === 'string' && ch.image.startsWith('data:image/png'), 'challenge 有 PNG');
const wrong = await get(GATE + '/api/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ challenge: ch.challenge, code: 'ZZZZZ', asset: 'InfinityStudio-setup' })
});
ok(wrong.status === 400 || wrong.status === 403, '错码被拒', String(wrong.status));

ok(TAG === 'v1.0.0-pre8', 'TAG 与目录一致');

if (fails.length) {
  for (const f of fails) console.error('FAIL ' + f);
  console.log('PUBLIC-SURFACE FAIL ' + pass + '/' + (pass + fails.length));
  process.exit(1);
}
console.log('PUBLIC-SURFACE PASS ' + pass + '/' + pass);
