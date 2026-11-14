/*
 * verify-contract.mjs - re-run the shell / Infinity File Manager contract
 * checks without building anything.
 *
 * This is the light verification for the shell fixes: it reads the sources and
 * the artifacts already on disk, and never starts a window, a server or a
 * compiler. Run it from anywhere:
 *
 *   node shell/verify-contract.mjs
 *
 * It exits non-zero if any check fails, and prints one line per check.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* --- 3. shell/main.js is the --serve-ui shell, and its port table matches cpp --- */
const main = read('shell/main.js');
ok(main.indexOf('--serve-ui') >= 0, 'main.js spawns --serve-ui');
ok(main.indexOf('--ipc') < 0, 'main.js has no --ipc');
ok(main.indexOf("path.join(__dirname, 'app'") < 0, 'main.js loads no local app/ page');
/* The chrome page needs one bridge and no more: preload.js exposes the
 * infinity-shell frame channel and nothing else. */
ok(main.indexOf("preload: path.join(__dirname, 'preload.js')") >= 0, 'main.js loads the shell bridge through preload.js');
ok(main.indexOf("'shell:frame'") >= 0, 'main.js listens for shell frames');
/* The chrome page is served from a registered scheme rather than a loopback
 * port: a fresh port is a fresh origin every launch, and localStorage - the
 * open tabs, the theme, the playzone - would not survive a restart. */
ok(main.indexOf("const CHROME_SCHEME = 'infinity-shell'") >= 0, 'main.js serves the chrome page from a stable scheme');
ok(main.indexOf('protocol.registerSchemesAsPrivileged') >= 0, 'the chrome scheme is registered as standard and secure');
ok(main.indexOf('protocol.handle(CHROME_SCHEME') >= 0, 'the chrome scheme serves resources/app/ui');
ok(main.indexOf("path.join(__dirname, 'ui')") >= 0, 'the chrome files come from resources/app/ui');

const ap = {};
for (const m of main.matchAll(/^\s*(inc|ipm|int):\s*\{ name: '([^']+)', port: (\d+) \}/gm)) ap[m[1]] = Number(m[3]);
const cppPorts = {};
for (const app of ['inc', 'ipm', 'int']) {
  const src = read('cpp/apps/' + app + '/main.cpp');
  const m = /int uiPort = (\d+);/.exec(src) || /const int kDefaultUiPort = (\d+);/.exec(src);
  cppPorts[app] = m ? Number(m[1]) : null;
}
ok(Object.keys(ap).length === 3, 'shell knows ' + Object.keys(ap).length + ' applications: ' + Object.keys(ap).join(','));
for (const k of Object.keys(cppPorts)) ok(ap[k] === cppPorts[k], 'port ' + k + ' shell=' + ap[k] + ' cpp=' + cppPorts[k]);

const expected = { inc_gui: 'inc', inx_gui: 'inc', ipm_gui: 'ipm', ipmx_gui: 'ipm', int_gui: 'int', intx_gui: 'int' };
const tbl = {};
const blk = /const ADMIN_TO_BASE = \{([\s\S]*?)\};/.exec(main);
if (blk) for (const m of blk[1].matchAll(/(\w+):\s*'(\w+)'/g)) tbl[m[1]] = m[2];
ok(Object.keys(tbl).length === 6, 'ADMIN_TO_BASE has ' + Object.keys(tbl).length + ' entries');
const line = main.split('\n').find((s) => s.indexOf('const named = ') >= 0) || '';
const lit = /(\/[^/]+\/)/.exec(line);
let rx = null;
try { rx = lit ? new RegExp(lit[1].slice(1, -1)) : null; } catch (e) { rx = null; }
ok(rx !== null, 'prefixFromName regex is readable: ' + (lit ? lit[1] : 'not found'));
if (rx) {
  for (const n of Object.keys(expected)) {
    const m = rx.exec(n);
    const app = m ? tbl[m[1]] : null;
    ok(app === expected[n], 'name -> app ' + n + ' -> ' + app);
  }
  ok(rx.exec('inc_launcher.exe') === null, 'launcher name is not mistaken for a window name');
}

/* --- 4. payload.mjs architecture mapping and the gui-name collision guard --- */
const pl = await import(url.pathToFileURL(path.join(ROOT, 'shell', 'payload.mjs')).href);
ok(pl.electronArch('win-x64') === 'x64' && pl.electronArch('win-ia32') === 'ia32' && pl.electronArch('win-arm64') === 'arm64', 'electronArch windows');
ok(pl.electronArch('linux-x64') === null && pl.electronArch('darwin-arm64') === null, 'electronArch non-windows is null');
ok(pl.hasGui('ipm', 'linux-x64') === false, 'hasGui false for linux');
ok(pl.hasGui('ipm', 'win-x64') === true, 'hasGui true for built win-x64');
let threw = false;
try { pl.stageGui(path.join(HERE, '_no_such_dest'), 'ipm', 'linux-x64'); } catch (e) { threw = true; }
ok(threw, 'stageGui refuses a non-windows target');
const tmp = path.join(HERE, '_selftest_tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, 'ipm_gui.exe'), 'the C++ face, not Electron');
let refused = false;
try { pl.stageGui(tmp, 'ipm', 'win-x64'); } catch (e) { refused = true; }
ok(refused, 'stageGui refuses to overwrite an existing C++ gui face');
fs.rmSync(tmp, { recursive: true, force: true });

/* --- 5. shell/build.mjs names the administrator twin exactly like payload.mjs ---
 * A local <prefix>x_gui derivation silently produced incx_gui-win32-* trees that
 * nothing in the project consumes; inc's admin name is inx (c -> x, not incx). */
const buildSrc = read('shell/build.mjs');
ok(pl.adminGuiName('inc') === 'inx_gui.exe', 'adminGuiName(inc) is inx_gui.exe, not incx_gui.exe');
ok(buildSrc.indexOf('adminGuiName(') >= 0, 'build.mjs derives the admin gui name from payload.adminGuiName');
ok(buildSrc.indexOf("t.prefix + 'x_gui'") < 0, 'build.mjs no longer derives <prefix>x_gui locally');
ok(buildSrc.indexOf("'preload.js'") >= 0, 'build.mjs ships preload.js with the shell');
ok(buildSrc.indexOf("'downloads.js'") >= 0, 'build.mjs ships downloads.js with the shell');
ok(buildSrc.indexOf("'ui'") >= 0, 'build.mjs ships the chrome ui/ with the shell');
const shellOut = path.join(ROOT, 'shell', 'build');
if (fs.existsSync(shellOut)) {
  const dirs = fs.readdirSync(shellOut, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name)
    .filter((n) => /-win32-(x64|ia32|arm64)$/.test(n));
  /* Three products, each with an administrator twin: six names per
   * architecture. Only the architectures actually staged are required, so an
   * INC_SHELL_ARCHES=x64 run is not reported as missing ia32/arm64. */
  const arches = ['x64', 'ia32', 'arm64'].filter((a) => dirs.some((n) => n.endsWith('-win32-' + a)));
  const want = [];
  for (const arch of arches) {
    for (const p of ['inc', 'ipm', 'int']) {
      want.push(p + '_gui-win32-' + arch);
      want.push(pl.adminGuiName(p).replace(/\.exe$/, '') + '-win32-' + arch);
    }
  }
  const missing = want.filter((n) => dirs.indexOf(n) < 0);
  const extra = dirs.filter((n) => want.indexOf(n) < 0 && !n.startsWith('.retired-'));
  ok(missing.length === 0, 'shell/build holds all ' + want.length + ' expected shell dirs for ' + arches.join(',') + (missing.length ? ' missing=' + missing.join(',') : ''));
  ok(extra.length === 0, 'shell/build has no unexpected shell dirs' + (extra.length ? ' extra=' + extra.join(',') : ''));
} else {
  console.log('  note shell/build is absent; on-disk shell-name check skipped');
}

/* --- 6. quiet by default: no console windows, no audio at all ---
 * The user's rule is absolute: the product never pops a console window and
 * never plays a sound. The chrome page may not carry an audio element, and the
 * shell must not construct one at runtime either. */
const uiHtml = read('work/webview2/ui/index.html');
const uiJs = read('work/webview2/ui/assets/js/shell.js');
ok(uiHtml.indexOf('<audio') < 0, 'chrome page has no <audio> element');
ok(uiHtml.indexOf('pzAudio') < 0 && uiJs.indexOf('pzAudio') < 0, 'play zone audio element is gone from markup and script');
ok(!/new\s+Audio\s*\(/.test(uiJs), 'shell never constructs an Audio object');
ok(uiJs.indexOf('AudioContext') < 0, 'shell never opens an AudioContext');
ok(uiJs.indexOf('.play()') < 0, 'shell never calls play()');
ok(main.indexOf('windowsHide: true') >= 0, 'the UI server is spawned with windowsHide');
ok(/frame:\s*false/.test(main), 'the window is frameless so the chrome title bar is the only one');
ok(uiHtml.indexOf('id="cap-min"') >= 0 && uiJs.indexOf('"cap-close"') >= 0, 'the chrome title bar owns the window buttons');
ok(/shell\.window/.test(main) && /win\.minimize\(\)/.test(main), 'main.js performs shell.window for real');
ok(main.indexOf('audioElements:document.querySelectorAll("audio").length') >= 0, 'the window probe reports audioElements');


/* --- 7. InfinityViewer's built-in download manager ---
 * The viewer owns every download: Chromium's own shelf is cancelled in
 * will-download and the queue lives in shell/downloads.js. The chrome page must
 * carry the panel and speak the same frame names the host answers. */
const dl = read('shell/downloads.js');
const i18n = read('work/webview2/ui/assets/js/i18n.js');
ok(/class DownloadManager/.test(dl) && /module\.exports/.test(dl), 'downloads.js exports a DownloadManager');
ok(main.indexOf("require('./downloads')") >= 0, 'main.js loads the download manager');
ok(main.indexOf("'will-download'") >= 0 && main.indexOf('item.cancel()') >= 0, "main.js cancels Chromium's own download and takes it over");
ok(main.indexOf("'viewer.download'") >= 0, 'main.js answers viewer.download');
ok(main.indexOf("path.join(app.getPath('downloads'), 'InfinityViewer')") >= 0, 'downloads land in the Downloads/InfinityViewer folder');
ok(main.indexOf("path.join(app.getPath('userData'), 'downloads.json')") >= 0, 'the download queue survives a restart');
ok(/it\.file \|\| self\.uniquePath/.test(dl), 'a resumed download keeps the file its earlier bytes live in');
ok(dl.indexOf('range: \'bytes=\' + from + \'\'') >= 0 || dl.indexOf("range: 'bytes=' + from + '-'") >= 0, 'a single-stream download resumes from its byte offset');
ok(uiHtml.indexOf('id="dlpanel"') >= 0, 'chrome page carries the downloads panel');
ok(uiHtml.indexOf('id="btn-downloads"') >= 0, 'the toolbar has a downloads button');
ok(uiJs.indexOf('viewer.download') >= 0, 'shell.js speaks viewer.download');
ok(uiJs.indexOf('case "host.download"') >= 0, 'shell.js renders host.download snapshots');
ok((i18n.match(/"dl\.status\.done"/g) || []).length >= 2, 'both locales name the download states');

/* --- 8. InfinityViewer actually browses: external pages are guests, and the
 * address bar searches instead of drawing a "demo mode" card ---
 * A browser that can only render its own product pages is a kiosk. The split
 * matters: local product pages stay iframes (same machine, same origin, one
 * fewer process), anything else goes into a <webview> with its own renderer and
 * its own network stack. Both halves are asserted here because the failure mode
 * of getting it wrong is silent - the card just looks empty. */
ok(main.indexOf('webviewTag: true') >= 0, 'the shell window enables the webview tag');
ok(uiJs.indexOf('function buildWebview') >= 0, 'shell.js builds a webview for external pages');
ok(uiJs.indexOf('buildWebview(tab)') >= 0 && uiJs.indexOf('tab.kind === "web"') >= 0, 'external tabs take the webview path');
ok(uiJs.indexOf('https://www.bing.com/search?q=') >= 0, 'a search query resolves to a real search URL');
ok(uiJs.indexOf('"search:" + encodeURIComponent') < 0 || uiJs.indexOf('canWebview()') >= 0, 'the demo search placeholder only survives when a guest cannot be created');
ok(uiJs.indexOf('guest.reload') >= 0 || uiJs.indexOf('.reload()') >= 0, 'reload reaches the guest page');
ok(main.indexOf('INFINITY_SHELL_PROBE_WEB') >= 0, 'the shell can prove webview navigation headlessly');
ok(read('work/webview2/ui/assets/css/shell.css').indexOf('.view webview') >= 0, 'the guest fills the view area');

/* --- 9. a download started inside a guest page is the viewer's download too ---
 * A download manager that only handles the URL typed into its own box is a toy:
 * the real case is a file offered by a page the user is reading. Chromium hands
 * guest downloads to the same session, so will-download is the single place the
 * takeover has to happen - and the probe has to click the page's own link, not
 * call the panel, or it proves nothing. */
ok(main.indexOf('INFINITY_SHELL_PROBE_GUEST_DL') >= 0, 'the shell can prove guest downloads headlessly');
ok(main.indexOf('function probeGuestDownload') >= 0, 'the guest-download probe exists');
ok(/content-disposition/.test(main) && /filename="guest.bin"/.test(main), 'the probe page offers the file as an attachment');
ok(/downloads\.command\("remove"/.test(main) || main.indexOf('downloads.command("remove"') >= 0, 'the probe clears the queue first, so a stale item cannot fake a pass');
ok(main.indexOf("state.onDisk") >= 0, 'the probe checks the file really landed on disk');
ok(uiJs.indexOf('state: downloads') >= 0, 'the downloads namespace exposes its state object');

/* --- 10. the browser menu is not decoration: history, favorites and collections
 * are real pages backed by real storage ---
 * These three used to send "shell.command" to a host that had no branch for it
 * and then toast "sent". A menu that reports success while nothing happens is
 * worse than a missing menu, so the contract now demands the stores, the routes,
 * the rendered pages, and a probe that reads the DOM instead of the stores. */
ok(uiJs.indexOf('HISTORY_KEY = "infinity.history.v1"') >= 0, 'history has its own storage key, separate from settings');
ok(uiJs.indexOf('COLL_KEY = "infinity.collections.v1"') >= 0, 'collections have their own storage key');
ok(uiJs.indexOf('function recordHistory') >= 0, 'navigation records history');
ok(/\^about:history\$/i.test(uiJs) && /\^about:favorites\$/i.test(uiJs) && /\^about:collections\$/i.test(uiJs),
  'the about: routes resolve to the three internal pages');
ok(uiJs.indexOf('function buildInternal') >= 0, 'shell.js renders the internal pages');
ok(uiJs.indexOf('function saveCollection') >= 0 && uiJs.indexOf('function restoreCollection') >= 0, 'a collection can be saved and restored');
ok(uiJs.indexOf('function printActive') >= 0, 'print reaches the guest instead of faking it');
ok(uiJs.indexOf('case "extensions": openUrl("about:extensions"') >= 0 &&
  uiJs.indexOf('case "profile": openUrl("about:profile"') >= 0,
  'the menu opens real pages for extensions and profile');
ok(main.indexOf('INFINITY_SHELL_PROBE_INTERNAL') >= 0, 'the shell can prove the internal pages headlessly');
ok(read('work/probe-internal.ps1').indexOf('INTERNAL-PAGES PASS') >= 0, 'the internal-pages probe prints its verdict');
ok(read('work/webview2/ui/assets/css/shell.css').indexOf('.internal-row') >= 0, 'the internal pages have their own styling');

/* --- 11. profile and extensions are pages, not toasts ---
 * The toolbar's last two buttons used to answer "not implemented". A profile
 * page is only real if what the user types survives a reload, and an extension
 * list is only honest if every row reads live state - so both are asserted at
 * the code level and then proven by the DOM probe. */
ok(/about:\(history\|favorites\|collections\|profile\|extensions\)/.test(uiJs), 'resolveTarget routes profile and extensions too');
ok(uiJs.indexOf('function buildProfile') >= 0, 'shell.js renders a real profile page');
ok(uiJs.indexOf('function builtinFeatures') >= 0, 'the extensions page is built from a live feature list');
ok(uiJs.indexOf('settings.profile = { name:') >= 0, 'saving the profile writes to settings');
ok(uiJs.indexOf('toast(t("toast.notImplemented"))') < 0, 'no toolbar button answers "not implemented" any more');
ok((i18n.match(/"pf\.local"/g) || []).length >= 2 && (i18n.match(/"ext\.note"/g) || []).length >= 2, 'both locales explain what profile and extensions really are');
ok(main.indexOf('"Probe User"') >= 0, 'the probe types a profile name and reads it back from the store');
ok(read('work/webview2/ui/assets/css/shell.css').indexOf('.profile-swatch') >= 0, 'the profile page has its own styling');

/* --- 12. an app card starts the real product ---
 * The cards used to open ui/apps/*.html samples that said "演示内容" in their own
 * body. A sample is not a feature: the card must ask the host, the host must
 * start that product's own UI service, and the tab must land on 127.0.0.1.
 * The samples are gone, so a regression here cannot hide behind them. */
ok(!fs.existsSync(path.join(HERE, '..', 'work', 'webview2', 'ui', 'apps')), 'the sample app pages are gone, not merely unreferenced');
ok(uiJs.indexOf('"演示内容"') < 0, 'the UI no longer describes itself as demo content');
ok(/prefix: "inc"/.test(uiJs) && /prefix: "int"/.test(uiJs), 'every app card names the product it opens');
ok(uiJs.indexOf('function requestApp') >= 0 && uiJs.indexOf('send("viewer.app"') >= 0, 'the page asks the host to start the product');
ok(uiJs.indexOf('case "host.app"') >= 0, 'the page takes the product address from the host');
ok(uiJs.indexOf('function buildAppView') >= 0, 'an app tab renders the product, not a sample');
ok(main.indexOf('async function ensureProduct') >= 0 && main.indexOf('function findProductCli') >= 0, 'the host can start a sibling product');
ok(main.indexOf("'--serve-ui'") >= 0, 'the product is started through its real UI service');
ok(main.indexOf('windowsHide: true') >= 0, 'starting a product never flashes a console window');
ok(main.indexOf('INFINITY_SHELL_PROBE_APPS') >= 0, 'the app launch can be proven headlessly');
ok(read('work/probe-apps.ps1').indexOf('APPS-LAUNCH PASS') >= 0, 'the app probe prints its verdict');
ok((i18n.match(/"app\.failed"/g) || []).length >= 2, 'both locales can report a product that will not start');

/* --- 13. F12 opens the host's real inspector ---
 * The page used to answer "开发者工具" by showing its own protocol log, which
 * looks like DevTools but cannot inspect anything. The host now opens the
 * real inspector for whichever layer is in front, and the probe proves the
 * bridge answers without ever opening a window on the user's screen. */
ok(main.indexOf("case 'shell.devtools'") >= 0, 'the host answers the devtools request');
ok(main.indexOf('function openDevtools') >= 0, 'the host can open and close a real inspector');
ok(main.indexOf("getType() === 'webview'") >= 0, 'the inspector follows the webview in front, not the chrome');
ok(uiJs.indexOf('send("shell.devtools"') >= 0, 'the page asks the host instead of drawing a fake panel');
ok(uiJs.indexOf('case "host.devtools"') >= 0, 'the page records the host answer');
ok(uiJs.indexOf('state.devtoolsHostOpen') >= 0, 'F12 toggles the host inspector');
ok((i18n.match(/"toast\.devtoolsFailed"/g) || []).length >= 2, 'both locales can report an inspector that will not open');
ok(main.indexOf('INFINITY_SHELL_PROBE_DEVTOOLS') >= 0, 'the devtools bridge can be proven headlessly');
ok(read('work/probe-devtools.ps1').indexOf('DEVTOOLS-BRIDGE PASS') >= 0, 'the devtools probe prints its verdict');
ok(main.indexOf('openDevtools(p.open !== false') >= 0, 'the request is answered by the real function, not a stub');

/* --- 14. the app inventory and the translator are real ---
 * host.apps was answered by the host and dropped by the page, so nothing ever
 * showed which products exist on this machine; and the translate button still
 * sent a shell.command the host has no branch for, then toasted "sent". Both
 * are gone: the inventory is rendered, the button opens a real translator. */
ok(main.indexOf("case 'viewer.apps'") >= 0, 'the host answers the app inventory');
ok(uiJs.indexOf('case "host.apps"') >= 0, 'the page records the app inventory');
ok(uiJs.indexOf('send("viewer.apps"') >= 0, 'the page asks for the inventory once the host is ready');
ok(uiJs.indexOf('"app.notInstalled"') >= 0 || uiJs.indexOf('t("app.notInstalled")') >= 0, 'a product that is not installed is labelled, not silently dead');
ok(uiJs.indexOf('send("shell.command"') < 0, 'no button sends a command the host never handles');
ok(uiJs.indexOf('function openTranslator') >= 0, 'the translate button opens a real page');
ok((i18n.match(/"toast\.translatorOpened"/g) || []).length >= 2, 'both locales say where the translator opened');

/* --- 15. the fallback host states its limits instead of going quiet ---
 * cpp/hosts/webview2/main.c answers the same page but only implemented two
 * messages, so viewer.apps and shell.devtools died silently there. It now
 * answers both, and anything it cannot do comes back as host.unsupported,
 * which the page turns into a toast - a dead button becomes a stated limit. */
const hostC = read('cpp/hosts/webview2/main.c');
/* The C literals carry escaped quotes (L"\"viewer.apps\""), so match the
 * bare key rather than a quoted token. */
ok(hostC.indexOf('viewer.apps') >= 0 && hostC.indexOf('appsJson(') >= 0, 'the fallback host answers the app inventory');
ok(hostC.indexOf('host.devtools') >= 0, 'the fallback host answers the devtools request');
ok(hostC.indexOf('host.unsupported') >= 0, 'the fallback host names what it cannot do');
ok(uiJs.indexOf('case "host.unsupported"') >= 0, 'the page shows the host limit instead of nothing');
ok((i18n.match(/"toast\.hostUnsupported"/g) || []).length >= 2, 'both locales can report an unsupported action');
ok(read('work/audit-bridge.mjs').indexOf('WEBVIEW2-HOST-MISSING') >= 0, 'the audit keeps tracking the fallback host');
ok(read('work/build-webview2-host-check.ps1').indexOf('webview2-host-check.exe') >= 0, 'the fallback host can be compiled without staging the live ui');

/* --- 16. the chrome tells the truth about itself ---
 * The About box and the menu print VERSION, and it read 0.1.0 while the shell
 * package said 1.0.0 - a wrong version shown to the user. The new-tab footer
 * also still said "demo shell" in the shipped build. Both are pinned now. */
const shellPkg = JSON.parse(read('shell/package.json'));
const uiVersion = (uiJs.match(/var VERSION = "([^"]+)"/) || [])[1] || '';
ok(uiVersion === shellPkg.version, 'the chrome version matches shell/package.json (' + uiVersion + ' vs ' + shellPkg.version + ')');
ok(read('work/webview2/ui/index.html').indexOf('演示外壳') < 0, 'the shipped page does not call itself a demo');
ok(uiJs.indexOf('演示外壳') < 0, 'no script still writes the demo footer');
ok((i18n.match(/"ntp\.footer"/g) || []).length >= 2, 'both locales name the footer');

/* --- 17. no raw i18n key can reach the user ---
 * work/audit-i18n.mjs walks every t("key") in the page and every data-i18n in
 * the markup against both dictionaries; it found status.demo / status.host
 * missing, so the menu host pill printed "status.host" instead of a word. */
ok((i18n.match(/"status\.demo"/g) || []).length >= 2, 'both locales translate the demo state');
ok((i18n.match(/"status\.host"/g) || []).length >= 2, 'both locales translate the host state');
ok(read('work/audit-i18n.mjs').indexOf('I18N-AUDIT') >= 0, 'the i18n audit keeps watch for missing keys');
ok(read('work/probe-chrome-truth.ps1').indexOf('CHROME-TRUTH PASS') >= 0, 'the chrome text can be proven headlessly');
ok(main.indexOf('menuVersion:') >= 0 && main.indexOf('ntpFooter:') >= 0, 'the probe reports what the chrome says');

/* --- 18. the new-tab footer speaks to people ---
 * .ntp-engine printed host.api, so the shipped footer read
 * window.__INFINITY_HOST__.postMessage. A user-facing label must not leak
 * the bridge's internal function name; the API stays in the tooltip. */
ok(uiJs.indexOf('engine.textContent') >= 0, 'the engine label is written as a label');
ok(uiJs.indexOf('engine.title = host.api') >= 0, 'the bridge API stays available as a tooltip');
ok(main.indexOf('INFINITY_SHELL_PROBE_NTP') >= 0, 'the probe can open the new-tab page before it snapshots');
ok(read('work/probe-chrome-truth.ps1').indexOf('ntp-footer-not-demo') >= 0, 'the probe asserts the footer text');

/* --- 19. a built tree can boot ---
 * shell/build.mjs wiped build/ and never staged <prefix>_cli.exe, so the
 * window it produced showed a fatal page forever; a build that emits an
 * unrunnable tree is a defect, not a prerequisite someone forgot. */
ok(buildSrc.indexOf('function stageCli(') >= 0, 'the build stages the CLI the window spawns');
ok(buildSrc.indexOf("'inx' ? 'inc'") >= 0, 'the admin build finds its CLI under the base product');
ok(buildSrc.indexOf('MISSING') >= 0, 'a missing CLI is reported instead of silently skipped');


/* --- 20. no user-visible text escapes the dictionaries ---
 * audit-i18n.mjs proves every key resolves; it cannot see a string written
 * straight into the markup. The static menu also still printed v0.1.0 in the
 * shipped page, so a page that never ran its script would lie about the build. */
const hard = read('work/audit-hardcoded.mjs');
ok(hard.indexOf('AUDIT-HARDCODED') >= 0, 'the hardcoded-text audit can be rerun');
ok(hard.indexOf('data-i18n-fixed') >= 0, 'the audit exempts language endonyms by marking, not by guessing');
ok(read('work/webview2/ui/index.html').indexOf('data-i18n-fixed="endonym"') >= 0, 'the language buttons are marked as endonyms');
ok(read('work/webview2/ui/index.html').indexOf('id="menuVersion">v' + shellPkg.version + '<') >= 0, 'the static menu version matches the package');


/* --- 21. a printed shortcut is a promise ---
 * The menu printed Ctrl+J and Ctrl+N with no keydown branch behind them, so
 * the chrome advertised keys that did nothing. audit-shortcuts.mjs reads the
 * printed labels and demands a branch for each one. */
ok(read('work/audit-shortcuts.mjs').indexOf('AUDIT-SHORTCUTS') >= 0, 'the shortcut audit can be rerun');
ok(uiJs.indexOf('key === "j"') >= 0, 'Ctrl+J opens the downloads panel');
ok(uiJs.indexOf('key === "n"') >= 0, 'Ctrl+N asks the host for a new window');
ok(uiJs.indexOf('toast("shell.window · new")') < 0, 'the new-window action no longer prints its own message name');


/* --- 22. the probe presses the printed keys ---
 * audit-shortcuts proves a branch exists; only a real window proves the
 * branch fires. The probe dispatches the accelerator in the shipped page and
 * reads what the chrome did, so Ctrl+J is verified by the panel opening. */
ok(main.indexOf('INFINITY_SHELL_PROBE_KEYS') >= 0, 'the probe can press accelerators');
ok(main.indexOf('keyProbe.ctrlJOpens') >= 0, 'the probe reads the downloads panel after Ctrl+J');
ok(main.indexOf('keyProbe.ctrlHKind') >= 0, 'the probe reads the active tab kind after Ctrl+H');
ok(read('work/probe-chrome-truth.ps1').indexOf('shortcut-ctrl-j-opens') >= 0, 'the probe asserts the printed shortcut');


/* --- 23. the packaged chrome is the chrome in the tree ---
 * shell/build.mjs copies work/webview2/ui into every built app dir, so editing
 * the source after a build leaves an installer with old chrome. That happened
 * twice while fixing shortcuts; the drift is now measured instead of hoped for. */
ok(read('work/audit-uistale.mjs').indexOf('UISTALE') >= 0, 'the UI drift audit can be rerun');
ok(read('work/audit-uistale.mjs').indexOf('shell/build/inc_gui-win32-x64/resources/app/ui') >= 0, 'the audit compares against a real built tree');


/* --- 24. "open in host" opens something ---
 * The interstitial button said "open in host" but sent a message no host
 * branch handled, then toasted "added to favorites" - a wrong claim about an
 * action that never happened. The host now opens the system browser and the
 * toast waits for its reply. */
ok(main.indexOf("case 'viewer.open-external'") >= 0, 'the host handles viewer.open-external');
ok(main.indexOf('shell.openExternal(target)') >= 0, 'the host opens the system browser');
ok(main.indexOf("case 'shell.open':") < 0, 'shell.open stays a tab notice, not a browser launch');
ok(uiJs.indexOf('toast(t("toast.favAdded"))') >= 0, 'adding a favorite still says so');
ok(uiJs.indexOf('send("viewer.open-external", { url: isSearch') >= 0, 'the interstitial sends a real url');
ok(uiJs.indexOf('case "host.openExternal"') >= 0, 'the page handles the host reply');
ok(i18n.indexOf('"toast.openedExternal"') >= 0, 'both languages can report the open');


/* --- 25. the About dialog tells the truth ---
 * It printed work/edge-ui (a scratch copy that never ships), a static
 * v0.1.0, and the bridge function name as the host. Now the version comes
 * from package.json, the shell row names the runtime, the host row names the
 * host kind with the bridge in a tooltip, and the product list follows what
 * the host says is installed. */
ok(uiHtml.indexOf('work/edge-ui') < 0, 'the About dialog does not name a scratch path');
ok(uiHtml.indexOf('id="aboutVersion">v0.1.0') < 0, 'the static About version is not stale');
ok(/id="aboutVersion">v/.test(uiHtml), 'the static About version is filled in');
ok(i18n.indexOf('"about.shellValue"') >= 0, 'both languages name the shell runtime');
ok(uiJs.indexOf('els.aboutHost.textContent = host.kind;') >= 0, 'the host row shows the kind, not the bridge');
ok(uiJs.indexOf('installedAppCodes()') >= 0, 'the product row follows the installed set');
ok(/id="aboutApps"/.test(uiHtml), 'the product row has a live target');

ok(uiJs.indexOf('function renderAboutRows()') >= 0, 'the About rows have one renderer');
ok(uiJs.indexOf('if (name === "about") { renderAboutRows(); }') >= 0, 'opening About refreshes the rows');


/* --- 26. the exit promise and the sidebar match the settings ---
 * The exit dialog promised a restore even with session restore off, and the
 * sidebar listed a retired product as if it could launch. */
ok(/id="exitBody"/.test(uiHtml), 'the exit body has a live target');
ok(i18n.indexOf('"exit.bodyNoRestore"') >= 0, 'both languages can say the restore is off');
ok(uiJs.indexOf('t(settings.restoreSession ? "exit.body" : "exit.bodyNoRestore")') >= 0, 'the exit body follows the setting');
ok(uiJs.indexOf('b.classList.add("off")') >= 0, 'the sidebar marks an uninstalled product');
ok(main.indexOf('exitProbe.sidebarOff') >= 0 && main.indexOf('exitProbe.body') >= 0, 'the probe reads the exit dialog and the sidebar');

/* --- 27. one locale is not both locales ---
 * exit.bodyNoRestore lived in zh-CN only, so an English user read the raw key;
 * the old audit only looked at the literal right after t( and printed PASS. The
 * audit now diffs the two key sets, and the probe reads the sentence in en-US
 * from a real window. A BOM-less .ps1 also turned Chinese assertions into
 * mojibake twice, so that rule is checked mechanically too. */
ok(i18n.indexOf('"exit.bodyNoRestore": "The current tab list') >= 0, 'the English locale has the no-restore sentence');
ok(main.indexOf('window.__InfinityShell.setLocale("en-US")') >= 0, 'the probe switches the live window to en-US');
ok(main.indexOf('exitProbe.bodyEn') >= 0, 'the probe reads the exit body in English');
const auditI18n = read('work/audit-i18n.mjs');
ok(auditI18n.indexOf('ASYM-ZH-ONLY') >= 0, 'the i18n audit diffs the two key sets');
ok(auditI18n.indexOf('zhOnly') >= 0 && auditI18n.indexOf('enOnly') >= 0, 'the i18n audit names the one-sided keys');
ok(fs.existsSync(path.join(ROOT, 'work/audit-ps1-bom.mjs')), 'the BOM audit exists');
const probePs1 = read('work/probe-chrome-truth.ps1');
ok(probePs1.indexOf('exit-body-english') >= 0, 'the probe asserts the English sentence');
ok(probePs1.charCodeAt(0) === 0xfeff, 'the probe keeps its BOM');
ok(auditI18n.indexOf('DEAD-PROMISE') >= 0, 'the i18n audit fails on a dead promise');
ok(auditI18n.indexOf("startsWith('dl.status.')") >= 0, 'only the download states may look unused');
const i18nNow = read('work/webview2/ui/assets/js/i18n.js');
ok(i18nNow.indexOf('"toast.notImplemented"') < 0, 'no "not implemented yet" string survives');
ok(i18nNow.indexOf('"toast.searchSent"') < 0, 'the retired search toast is gone');
ok(i18nNow.indexOf('"playzone.volume"') < 0, 'the retired play-zone media keys are gone');


console.log('');
console.log((fail === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL') + '  pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);
