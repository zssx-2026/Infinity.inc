// delete-remote-paths.mjs - remove paths the publisher (which only adds) left behind.
import { execFileSync } from 'node:child_process';
const TOKEN = process.env.EV_GH_TOKEN;
const OWNER = 'zssx-2026';
const REPO = 'zssx-2026.github.io';
const BRANCH = 'main';
function curl(args) {
  return execFileSync('curl.exe', ['-sS', '--ssl-no-revoke', '--max-time', '60'].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function api(method, route, body) {
  const args = ['-X', method,
    '-H', 'Authorization: Bearer ' + TOKEN,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: Infinity.Inc-site'];
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body));
  args.push('https://api.github.com' + route);
  try { return JSON.parse(curl(args)); } catch (e) { return { error: String(e).slice(0, 200) }; }
}
const paths = process.argv.slice(2);
for (const p of paths) {
  const info = api('GET', '/repos/' + OWNER + '/' + REPO + '/contents/' + p + '?ref=' + BRANCH);
  if (!info || !info.sha) { console.log(p + ' -> already gone (' + JSON.stringify(info).slice(0, 90) + ')'); continue; }
  const res = api('DELETE', '/repos/' + OWNER + '/' + REPO + '/contents/' + p, {
    message: 'remove the error page', sha: info.sha, branch: BRANCH
  });
  console.log(p + ' -> ' + (res && res.commit ? 'deleted ' + res.commit.sha.slice(0, 12) : JSON.stringify(res).slice(0, 160)));
}
