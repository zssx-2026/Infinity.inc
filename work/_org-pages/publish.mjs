import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ORG = 'Infinity-Studio-craft';
const REPO = 'infinity-studio-craft.github.io';
const API = 'https://api.github.com';

function token() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8'
  });
  const line = out.split(/\r?\n/).find(function (l) { return l.startsWith('password='); });
  if (!line) throw new Error('no stored credential');
  return line.slice('password='.length).trim();
}

const TOKEN = token();
const H = {
  Authorization: 'Bearer ' + TOKEN,
  'User-Agent': 'infinity-pages',
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json'
};

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method: method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = data && data.message ? data.message : String(res.status);
    throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + msg);
  }
  return data;
}

async function main() {
  let repo = null;
  try {
    repo = await call('GET', '/repos/' + ORG + '/' + REPO);
    console.log('repo exists: ' + repo.full_name + ' default=' + repo.default_branch);
  } catch (e) {
    console.log('repo missing, creating');
    repo = await call('POST', '/orgs/' + ORG + '/repos', {
      name: REPO,
      description: 'Infinity.Studio organisation site',
      homepage: 'https://' + REPO,
      private: false,
      auto_init: false,
      has_issues: false,
      has_wiki: false,
      has_projects: false
    });
    console.log('created ' + repo.full_name);
  }

  /* A freshly created repository has no git database yet, so blob creation
   * answers 409 until a first commit exists. The contents API can seed it. */
  let seeded = false;
  try {
    await call('GET', '/repos/' + ORG + '/' + REPO + '/contents/README.md');
    seeded = true;
  } catch (e) {
    seeded = false;
  }
  if (!seeded) {
    await call('PUT', '/repos/' + ORG + '/' + REPO + '/contents/README.md', {
      message: 'init: repository seed',
      content: Buffer.from('# Infinity.Studio' + String.fromCharCode(10), 'utf8').toString('base64')
    });
    console.log('seeded README (first commit)');
  }

  const files = ['index.html'];
  const tree = [];
  for (const name of files) {
    const content = readFileSync(new URL('./' + name, import.meta.url));
    const blob = await call('POST', '/repos/' + ORG + '/' + REPO + '/git/blobs', {
      content: content.toString('base64'),
      encoding: 'base64'
    });
    tree.push({ path: name, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('blob ' + name + ' ' + blob.sha.slice(0, 10) + ' ' + content.length + 'B');
  }

  const newTree = await call('POST', '/repos/' + ORG + '/' + REPO + '/git/trees', { tree: tree });
  console.log('tree ' + newTree.sha);

  let parents = [];
  try {
    const ref = await call('GET', '/repos/' + ORG + '/' + REPO + '/git/ref/heads/main');
    parents = [ref.object.sha];
    console.log('parent ' + ref.object.sha.slice(0, 10));
  } catch (e) {
    console.log('no main yet');
  }

  const commit = await call('POST', '/repos/' + ORG + '/' + REPO + '/git/commits', {
    message: 'site: Infinity.Studio landing page',
    tree: newTree.sha,
    parents: parents
  });
  console.log('commit ' + commit.sha);

  if (parents.length) {
    await call('PATCH', '/repos/' + ORG + '/' + REPO + '/git/refs/heads/main', { sha: commit.sha, force: true });
  } else {
    await call('POST', '/repos/' + ORG + '/' + REPO + '/git/refs', { ref: 'refs/heads/main', sha: commit.sha });
  }
  console.log('ref main -> ' + commit.sha.slice(0, 10));

  let pages = null;
  try {
    pages = await call('GET', '/repos/' + ORG + '/' + REPO + '/pages');
    console.log('pages already: ' + pages.status + ' ' + pages.html_url);
  } catch (e) {
    console.log('pages not enabled, enabling');
    pages = await call('POST', '/repos/' + ORG + '/' + REPO + '/pages', {
      source: { branch: 'main', path: '/' }
    });
    console.log('pages ' + (pages.status || 'null') + ' ' + (pages.html_url || ''));
  }

  for (let i = 0; i < 20; i++) {
    await new Promise(function (r) { setTimeout(r, 6000); });
    const st = await call('GET', '/repos/' + ORG + '/' + REPO + '/pages');
    console.log('build status=' + st.status + ' url=' + st.html_url + ' cname=' + (st.cname || '-'));
    if (st.status === 'built' || st.status === 'errored') break;
  }
}

main().catch(function (e) {
  console.error('FAIL ' + e.message);
  process.exit(1);
});
