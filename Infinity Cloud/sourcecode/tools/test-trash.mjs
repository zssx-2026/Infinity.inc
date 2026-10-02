import fs from "node:fs";
import { Store } from "../src/store/store.js";

const N = String.fromCharCode(10);
let bad = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  process.stdout.write((ok ? "  ok   " : "  FAIL ") + label + (ok ? "" : "  got " + JSON.stringify(got) + " want " + JSON.stringify(want)) + N);
}

function fakeGh() {
  let asset = 1, rel = 1;
  const repos = [], deleted = [];
  return {
    user: { login: "t" }, deleted, repos,
    async listStorageRepos() { return repos.slice(); },
    async createRepo(n) { repos.push({ name: n, releases: [] }); },
    async ensureReleasable() {},
    async listReleases() { return repos[0] ? repos[0].releases : []; },
    async getRelease(o, r, tag) { const x = repos.find(y => y.name === r); return x ? (x.releases.find(z => z.tag_name === tag) || null) : null; },
    async createRelease(o, r, tag) { const x = repos.find(y => y.name === r); const q = { id: rel++, tag_name: tag, assets: [] }; x.releases.push(q); return q; },
    async uploadAsset(o, r, id, file, name) { const x = repos.find(y => y.name === r); const q = x.releases.find(z => z.id === id); const a = { id: asset++, name, size: fs.statSync(file).size }; q.assets.push(a); return a; },
    async deleteAsset(o, r, id) { deleted.push(id); for (const x of repos) for (const q of x.releases) q.assets = q.assets.filter(z => z.id !== id); }
  };
}

const TMP = "D:/temp/trash-test";
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const cfg = { repoPrefix: "inc_", maxAssets: 60, chunkBytes: 64 * 1024 * 1024 };
const gh = fakeGh();
const store = new Store(gh, cfg);
store.owner = "t";
function mk(n, b) { const p = TMP + "/" + n; fs.writeFileSync(p, Buffer.alloc(b, 7)); return p; }

await store.put(mk("a.bin", 4096), "/a.bin");
await store.put(mk("b.bin", 8192), "/dir/b.bin");
await store.put(mk("c.bin", 2048), "/dir/sub/c.bin");
check("live entries", Object.keys(store.manifest.files).length, 6);

const before = gh.deleted.length;
check("rm returns the count", await store.rm("/a.bin"), 1);
check("no asset destroyed", gh.deleted.length, before);
check("gone from live", store.stat("/a.bin"), null);
check("one in the bin", store.listTrash().length, 1);
check("parts kept", store.listTrash()[0].parts.length > 0, true);

check("restore returns the entry", store.restore("/a.bin").size, 4096);
check("bin emptied", store.listTrash().length, 0);
check("live again", store.stat("/a.bin").size, 4096);

check("folder takes the subtree", await store.rm("/dir"), 4);
check("child gone", store.stat("/dir/b.bin"), null);
check("grandchild gone", store.stat("/dir/sub/c.bin"), null);
check("subtree in the bin", store.listTrash().length, 4);

store.mkdir("/dir");
let code = "";
try { store.restore("/dir"); } catch (e) { code = e.code; }
check("restore will not overwrite", code, "path_exists");

check("purge takes the subtree", await store.purge("/dir"), 4);
check("purge touched github", gh.deleted.length > before, true);
check("bin is now empty", store.listTrash().length, 0);
check("purge all on an empty bin", await store.purge(null), 0);
check("bin empty", store.listTrash().length, 0);

process.stdout.write(N + (bad ? bad + " FAILURES" + N : "all passed" + N));
process.exit(bad ? 1 : 0);
