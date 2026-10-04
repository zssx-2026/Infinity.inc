// dl-render-test.mjs - run the real assets/download.js against live API data with a stub DOM.
import fs from 'node:fs';
const SRC = fs.readFileSync('web/infinity/assets/download.js', 'utf8');
const rels = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

function el(tag, attrs, kids) {
  const n = {
    tag, attrs: {}, children: [], text: '', className: '',
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener() {},
  };
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.text = attrs[k];
    else if (k === 'class') n.className = attrs[k];
    else n.attrs[k] = attrs[k];
  }
  if (kids) for (const k of [].concat(kids)) n.children.push(k);
  return n;
}
function serialise(n, depth = 0) {
  const pad = '  '.repeat(depth);
  const cls = n.className ? '.' + String(n.className).split(' ')[0] : '';
  const open = n.attrs && n.attrs.open !== undefined ? ' [open]' : '';
  const href = n.attrs && n.attrs.href ? ' -> ' + n.attrs.href : '';
  let line = pad + n.tag + cls + open + href + (n.text ? '  "' + String(n.text).slice(0, 90) + '"' : '');
  let out = line + '\n';
  for (const c of n.children) out += serialise(c, depth + 1);
  return out;
}

function run(langCode, search, platform) {
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  if (platform) localStorage.setItem('inc.download.platform', platform);
  const document = {
    documentElement: { getAttribute: () => langCode },
    createElement: (t) => el(t), querySelector: () => null,
    head: { appendChild: () => {} },
  };
  const window = { INFINITY: {
    el, clear: (n) => { n.children.length = 0; }, t: (k) => k,
    productCard: () => el('div', { class: 'fallback-card' }),
    productHref: () => 'https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4',
  } };
  const root = el('section', { class: 'dl' });
  const fetchStub = async () => ({ ok: true, json: async () => rels });
  new Function('window', 'document', 'localStorage', 'fetch', 'location', SRC)(window, document, localStorage, fetchStub, { search, pathname: '/infinity/download/infinitycloud/' });
  return window.INFINITY.download.render(root, { slug: 'infinitycloud', repo: 'Infinity-Cloud', name: 'Infinity Cloud' });
}

// render returns nothing; capture through the tree
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const document = { documentElement: { getAttribute: () => process.argv[3] || 'en' }, createElement: (t) => el(t), querySelector: () => null, head: { appendChild: () => {} } };
const window = { INFINITY: { el, clear: (n) => { n.children.length = 0; }, t: (k) => k, productCard: () => el('div', { class: 'fallback-card' }), productHref: () => 'https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0.0-pre4' } };
const root = el('section', { class: 'dl' });
const fetchStub = async () => ({ ok: true, json: async () => rels });
new Function('window', 'document', 'localStorage', 'fetch', 'location', SRC)(window, document, localStorage, fetchStub, { search: process.argv[4] || '', pathname: '/infinity/download/infinitycloud/' });
Promise.resolve(window.INFINITY.download.render(root, { slug: 'infinitycloud', repo: 'Infinity-Cloud', name: 'Infinity Cloud' }))
  .then(() => new Promise((r) => setTimeout(r, 50)))
  .then(() => { console.log(serialise(root)); });
