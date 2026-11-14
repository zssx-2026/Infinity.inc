/*
 * page.js - the studio window: one page, five views, no network.
 *
 * The installer view answers 'what do I install'; this one answers 'what is
 * this machine, what am I working on, what does Studio know how to open, and
 * which sub-product modules are actually loaded'.
 *
 * Both are served by the same loopback service, so the page reaches nothing
 * outside the machine: no CDN, no web font, no remote image.
 *
 * Five views, one tab strip:
 *   suite      the component tree from the product specification
 *   workspace  the .is-ws file: what this workbench holds
 *   project    the .is-ccp / .is-ccpx container: create and open
 *   apps       the sub-product modules and a raw call box
 *   settings   hosts found on this machine, file associations, installer
 */

export function renderPage(input) {
  const opts = input || {};
  const strings = opts.strings || {};
  const languages = Array.isArray(opts.languages) ? opts.languages : [];
  const languageOptions = languages
    .map((entry) => '<option value="' + entry[0] + '">' + entry[1] + '</option>')
    .join('');
  const localeData = JSON.stringify(strings).replace(/</g, '\\u003c');
  return String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>InfinityStudio</title>
<style>
  :root { color-scheme: dark; --line:#33343a; --panel:#202024; --ink:#f3f3f3; --dim:#a5a5ad; --accent:#0e639c; }
  * { box-sizing: border-box; }
  body { margin:0; height:100vh; display:flex; flex-direction:column; background:#1b1b1f; color:var(--ink); font:13px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  header { padding:14px 22px; border-bottom:1px solid var(--line); background:var(--panel); display:flex; align-items:center; gap:18px; }
  header .heading { flex:1; }
  header h1 { margin:0; font-size:17px; font-weight:600; }
  header .sub { color:var(--dim); font-size:12px; margin-top:2px; }
  .language { display:flex; align-items:center; gap:8px; color:var(--dim); font-size:12px; }
  .language select { background:#242428; color:var(--ink); border:1px solid #4a4b52; border-radius:4px; padding:5px 8px; font:inherit; }
  nav { display:flex; gap:2px; padding:0 18px; border-bottom:1px solid var(--line); background:#1f1f23; }
  .tab { background:transparent; color:var(--dim); border:none; border-bottom:2px solid transparent; padding:9px 14px; cursor:pointer; font:inherit; }
  .tab:hover { color:var(--ink); }
  .tab.on { color:#fff; border-bottom-color:var(--accent); }
.badge { display:inline-block; padding:1px 7px; border-radius:9px; background:#2c2d33; color:var(--dim); font-size:11px; }
.badge.ok { background:#1d3a26; color:#7ee08a; }
.badge.bad { background:#3a1f1f; color:#ff7b72; }
  main { flex:1; min-height:0; overflow:auto; padding:16px 20px 28px; }
  h2 { font-size:12px; margin:18px 0 8px; color:#c9c9d1; text-transform:uppercase; letter-spacing:.6px; }
  h2:first-child { margin-top:0; }
  .card { border:1px solid #2c2d33; border-radius:8px; background:var(--panel); padding:14px 16px; margin-bottom:14px; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .row > label { color:var(--dim); font-size:12px; min-width:56px; }
  input[type=text], textarea, select { background:#242428; color:var(--ink); border:1px solid #4a4b52; border-radius:4px; padding:6px 9px; font:inherit; }
  input[type=text] { min-width:240px; }
  textarea { width:100%; min-height:104px; font-family:Consolas,"Cascadia Mono",monospace; font-size:12px; }
  button { background:var(--accent); color:#fff; border:none; border-radius:4px; padding:7px 15px; cursor:pointer; font:inherit; font-weight:600; }
  button.ghost { background:transparent; color:var(--dim); border:1px solid #4a4b52; font-weight:400; }
  button.ghost:hover { color:var(--ink); border-color:#6a6b72; }
  .branch { border:1px solid var(--line); border-radius:8px; margin-bottom:12px; background:var(--panel); }
  .branch.deferred { opacity:.62; }
  .branch-head { padding:10px 14px; border-bottom:1px solid var(--line); }
  .branch-name { font-weight:600; }
  .branch-sum { display:block; color:var(--dim); font-size:12px; margin-top:2px; }
  .comp { display:grid; grid-template-columns:1fr auto auto; gap:10px; align-items:center; padding:9px 14px; border-bottom:1px solid #2a2b31; }
  .comp:last-child { border-bottom:none; }
  .comp-name { font-weight:600; }
  .comp-ver { color:#8fb8ff; font-size:11px; margin-left:8px; }
  .comp-sum { display:block; color:var(--dim); font-size:12px; margin-top:2px; }
  .comp-tags { display:flex; gap:6px; flex-wrap:wrap; }
  .chip { background:#2a2b31; border:1px solid #3a3b42; border-radius:10px; padding:1px 8px; font-size:11px; color:#c9c9d1; font-family:Consolas,monospace; }
  .chip.host { color:#7ee08a; border-color:#2e6b3c; }
  .comp-act { display:flex; gap:6px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:5px 7px; border-bottom:1px solid #2c2d33; }
  th { color:var(--dim); font-weight:600; }
  .ok { color:#7ee08a; }
  .bad { color:#8a8a92; }
  pre { margin:0; white-space:pre-wrap; word-break:break-word; font-family:Consolas,monospace; font-size:12px; color:#c9c9d1; }
  .hint { color:var(--dim); font-size:12px; margin:6px 0 0; }
  [hidden] { display:none !important; }
</style></head>
<body>
<header>
  <div class="heading">
    <h1 id="pageTitle">InfinityStudio</h1>
    <div class="sub" id="pageSub">InfinityStudio Installer</div>
  </div>
  <div class="language">
    <span data-i18n="language">界面语言</span>
    <select id="language">${languageOptions}</select>
  </div>
</header>
<nav>
  <button class="tab on" data-view="suite" data-i18n="suite">组件套件</button>
  <button class="tab" data-view="workspace" data-i18n="workspace">工作区</button>
  <button class="tab" data-view="project" data-i18n="projects">项目</button>
  <button class="tab" data-view="apps" data-i18n="apps">子产品</button>
  <button class="tab" data-view="install">在线安装</button>
  <button class="tab" data-view="settings" data-i18n="settings">设置</button>
</nav>
<main>
  <div data-pane="suite">
    <div class="card">
      <div class="row">
        <span class="hint" id="suiteCount"></span>
        <button class="ghost" id="suiteRefresh" data-i18n="refresh">刷新</button>
      </div>
    </div>
    <div id="suiteTree"></div>
    <pre id="suiteMsg"></pre>
  </div>

  <div data-pane="workspace" hidden>
    <div class="card">
      <h2 data-i18n="createWorkspace">新建工作区</h2>
      <div class="row">
        <label data-i18n="name">名称</label>
        <input type="text" id="wsName" value="workspace">
        <label data-i18n="workspacePath">路径</label>
        <input type="text" id="wsPath" placeholder=".is-ws">
        <button id="wsCreate" data-i18n="create">创建</button>
      </div>
      <p class="hint" data-i18n="workspaceHint">工作区把组件、项目与默认打开方式记在一个 .is-ws 文件里。</p>
    </div>
    <div class="card">
      <h2 data-i18n="loadWorkspace">打开工作区</h2>
      <div class="row">
        <input type="text" id="wsLoadPath" placeholder=".is-ws">
        <button id="wsLoad">打开</button>
      </div>
    </div>
    <pre id="wsResult"></pre>
  </div>

  <div data-pane="project" hidden>
    <div class="card">
      <h2 data-i18n="createProject">新建项目</h2>
      <div class="row">
        <label data-i18n="projectName">项目名</label>
        <input type="text" id="prjName" value="project">
        <label data-i18n="components">组件</label>
        <input type="text" id="prjComponent" value="craft.code">
        <label><input type="checkbox" id="prjCompressed"> .is-ccpx</label>
        <button id="prjCreate" data-i18n="create">创建</button>
      </div>
      <p class="hint" data-i18n="projectFilesHint">一行一个文件：路径|内容。</p>
      <textarea id="prjFiles" placeholder="main.txt|hello&#10;notes/readme.md|second file"></textarea>
    </div>
    <div class="card">
      <h2 data-i18n="openProject">打开项目</h2>
      <div class="row">
        <input type="text" id="prjOpenPath" placeholder=".is-ccp / .is-ccpx">
        <button id="prjOpen">打开</button>
      </div>
    </div>
    <pre id="prjResult"></pre>
  </div>

  <div data-pane="settings" hidden>
    <div class="card">
      <h2 data-i18n="host">宿主</h2>
      <div class="row"><button class="ghost" id="hostRefresh" data-i18n="refresh">刷新</button></div>
      <table><thead><tr><th data-i18n="name">名称</th><th data-i18n="status">状态</th><th data-i18n="version">版本</th><th>Path</th></tr></thead>
        <tbody id="hostTable"></tbody></table>
      <p class="hint" data-i18n="hostHint">宿主只探测，不安装。缺的宿主由对应 Craft 提示。</p>
    </div>
    <div class="card">
      <h2 data-i18n="associate">设置默认打开方式</h2>
      <div class="row">
        <button class="ghost" id="assocPlan" data-i18n="associateDryRun">只看计划</button>
        <button id="assocApply">写入注册表</button>
      </div>
      <p class="hint" data-i18n="associateHint">只写 HKCU，不需要管理员，也不会抢走别的程序的文件类型。</p>
      <pre id="assocResult"></pre>
    </div>
    <div class="card">
      <h2>Infinity Server</h2>
      <div class="row">
        <input type="text" id="srvBase" value="http://127.0.0.1:7711">
        <button class="ghost" id="srvCheck" data-i18n="connect">连接</button>
      </div>
      <pre id="srvResult"></pre>
    </div>
    <div class="card">
      <h2 data-i18n="workloads">工作负载</h2>
      <div id="wlList"></div>
    </div>
  </div>
  <div data-pane="apps" hidden>
    <div class="card">
      <div class="row">
        <span class="hint" id="appsCount"></span>
        <button class="ghost" id="appsRefresh" data-i18n="refresh">刷新</button>
      </div>
      <p class="hint">每个子产品是一个独立模块，能力自报。未安装的模块显示为缺失，不影响其它模块。</p>
    </div>
    <div id="appsList"></div>
    <div id="appsDetail" class="card" hidden>
      <h2 id="detailTitle"></h2>
      <div id="detailBody"></div>
      <div class="row" style="margin-top:10px;">
        <label>动作</label>
        <input type="text" id="detailAction" value="run">
        <label>输入(JSON)</label>
        <input type="text" id="detailInput" value="{}" style="width:260px;">
        <button id="detailCall" data-i18n="run">执行</button>
      </div>
      <pre id="detailResult"></pre>
    </div>
    <div class="card">
      <h2>调用</h2>
      <div class="row">
        <label>模块</label>
        <input type="text" id="appId" placeholder="codecraft">
        <label>动作</label>
        <input type="text" id="appAction" value="capabilities">
        <button id="appCall">执行</button>
      </div>
      <p class="hint">动作 capabilities 只看能力；其余动作交给模块的 run()，输入用 JSON。</p>
      <textarea id="appInput" placeholder="{}</textarea>
      <pre id="appResult"></pre>
    </div>
  </div>
  <div data-pane="install" hidden>
    <div class="card">
      <div class="row">
        <span class="hint" id="remoteBase"></span>
        <button class="ghost" id="remoteRefresh">刷新目录</button>
        <button id="remoteInstall">安装全部</button>
      </div>
      <p class="hint">安装包从发布服务器下载，先校验 sha256 再静默安装；不需要源码工作区，也不需要先装别的产品。</p>
    </div>
    <div id="remoteList"></div>
    <div class="card">
      <div class="row"><span class="hint" id="remotePhase">空闲</span><span class="hint" id="remoteProgress"></span></div>
      <pre id="remoteLog"></pre>
    </div>
  </div>
</main>
<script>
var LOCALES = ${localeData};
var state = { view: "suite", lang: "zh-CN", appOk: {}, pendingApp: "" };

function el(id) { return document.getElementById(id); }
function pack() { return LOCALES[state.lang] || LOCALES["zh-CN"] || {}; }
function t(key) { var p = pack(); return p[key] || (LOCALES["zh-CN"] || {})[key] || key; }
function esc(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function show(id, value) {
  var node = el(id);
  if (!node) return;
  node.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
function api(method, url, body) {
  var init = { method: method, headers: {} };
  if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  return fetch(url, init).then(function (response) { return response.json(); });
}

function applyLabels() {
  var nodes = document.querySelectorAll("[data-i18n]");
  for (var i = 0; i < nodes.length; i++) {
    var key = nodes[i].getAttribute("data-i18n");
    var value = t(key);
    if (value && value !== key) nodes[i].textContent = value;
  }
  document.documentElement.lang = state.lang;
}

function setView(view) {
  state.view = view;
  var tabs = document.querySelectorAll("[data-view]");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].className = tabs[i].getAttribute("data-view") === view ? "tab on" : "tab";
  }
  var panes = document.querySelectorAll("[data-pane]");
  for (var j = 0; j < panes.length; j++) {
    panes[j].hidden = panes[j].getAttribute("data-pane") !== view;
  }
  if (view === "suite") loadSuite();
  if (view === "apps") loadApps();
  if (view === "install") loadRemote();
  if (view === "settings") { loadHosts(); loadWorkloads(); }
}

/* 组件 id 的段前缀就是子产品分支：craft.<x> 对应 <x>craft，其余分支用同名模块。
 * studio 是本体、cloud 是延后分支，都没有独立模块，返回空表示不渲染入口。 */
function appForComponent(id) {
  if (typeof id !== "string") return "";
  var dot = id.indexOf(".");
  if (dot <= 0 || dot === id.length - 1) return "";
  var branch = id.slice(0, dot);
  if (branch === "studio" || branch === "cloud") return "";
  if (branch === "craft") return id.slice(dot + 1) + "craft";
  return branch;
}

function loadSuite() {
  Promise.all([
    api("GET", "/v1/suite"),
    api("GET", "/v1/apps").catch(function () { return { apps: [] }; })
  ]).then(function (all) {
    var data = all[0];
    var okMap = {};
    var appRows = (all[1] && all[1].apps) || [];
    for (var r = 0; r < appRows.length; r++) {
      if (appRows[r] && appRows[r].ok) okMap[appRows[r].id] = true;
    }
    state.appOk = okMap;
    var host = el("suiteTree");
    if (!host) return;
    var branches = data.branches || [];
    var total = 0;
    var html = "";
    for (var i = 0; i < branches.length; i++) {
      var b = branches[i];
      var comps = b.components || [];
      total += comps.length;
      html += "<div class=\"branch" + (b.deferred ? " deferred" : "") + "\">";
      html += "<div class=\"branch-head\"><span class=\"branch-name\">" + esc(b.name) + "</span>";
      html += "<span class=\"branch-sum\">" + esc(b.summary || "") + "</span></div>";
      for (var j = 0; j < comps.length; j++) {
        var c = comps[j];
        html += "<div class=\"comp\"><div>";
        html += "<span class=\"comp-name\">" + esc(c.name) + "</span>";
        html += "<span class=\"comp-ver\">" + esc(c.version || "") + "</span>";
        html += "<span class=\"comp-sum\">" + esc(c.summary || "") + "</span></div>";
        html += "<div class=\"comp-tags\">";
        var codecs = c.codecs || [];
        for (var k = 0; k < codecs.length; k++) {
          html += "<code class=\"chip\">" + esc(codecs[k].ext) + "</code>";
        }
        if (c.rea) html += "<span class=\"chip host\">" + esc(c.rea) + "</span>";
        html += "</div><div class=\"comp-act\">";
        html += "<button data-install=\"" + esc(c.id) + "\">" + esc(t("installComponent")) + "</button>";
        html += "<button class=\"ghost\" data-remove=\"" + esc(c.id) + "\">" + esc(t("removeComponent")) + "</button>";
        var appOf = appForComponent(c.id);
        if (appOf) {
          if (state.appOk[appOf]) {
            html += "<button class=\"ghost\" data-enter=\"" + esc(appOf) + "\">进入</button>";
          } else {
            html += "<span class=\"chip\">未接入</span>";
          }
        }
        html += "</div></div>";
      }
      html += "</div>";
    }
    host.innerHTML = html;
    show("suiteCount", t("componentCount") + ": " + total);
  });
}

function loadApps() {
  api("GET", "/v1/apps").then(function (data) {
    var rows = data.apps || [];
    var host = el("appsList");
    if (!host) return;
    var live = 0;
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var app = rows[i];
      if (app.ok) live += 1;
      html += "<div class='card'>";
      html += "<div class='row'><strong>" + esc(app.name) + "</strong>";
      html += "<span class='badge " + (app.ok ? '' : 'bad') + "'>" + esc(app.id) + "</span>";
      if (app.version) html += "<span class='hint'>" + esc(app.version) + "</span>";
      if (app.branch) html += "<span class='hint'>" + esc(app.branch) + "</span>";
      html += "</div>";
      if (app.formats && app.formats.length) html += "<p class='hint'>" + esc(app.formats.join('  ')) + "</p>";
      if (app.features && app.features.length) html += "<p class='hint'>" + esc(app.features.join(' · ')) + "</p>";
      if (!app.ok) html += "<p class='hint'>" + esc(app.error || "不可用") + "</p>";
      if (app.ok) html += "<div class='row'><button class='ghost' data-open='" + esc(app.id) + "'>打开子产品</button></div>";
      html += "</div>";
    }
    if (!rows.length) html = "<div class='card'><p class='hint'>还没有子产品模块。</p></div>";
    host.innerHTML = html;
    var count = el("appsCount");
    if (count) count.textContent = live + " / " + rows.length + " 可用";
    var buttons = host.querySelectorAll('[data-open]');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        openAppDetail(btn.getAttribute('data-open'));
      });
    });
    if (state.pendingApp) {
      var pid = state.pendingApp;
      state.pendingApp = "";
      openAppDetail(pid);
    }
  });
}

function openAppDetail(id) {
  api("POST", "/v1/apps/call", { id: id, action: "capabilities", input: {} }).then(function (data) {
    var detail = el("appsDetail");
    var title = el("detailTitle");
    var body = el("detailBody");
    var act = el("detailAction");
    var inp = el("detailInput");
    var res = el("detailResult");
    if (!detail || !title || !body) return;
    detail.hidden = false;
    var result = data.result || {};
    title.textContent = (result.name || id) + (result.version ? " · " + result.version : '');
    var html = '';
    if (result.formats && result.formats.length) html += "<p class='hint'><b>项目格式：</b>" + esc(result.formats.join(' ')) + "</p>";
    if (result.features && result.features.length) html += "<p class='hint'><b>能力：</b>" + esc(result.features.join(' · ')) + "</p>";
    if (result.hosts && result.hosts.length) html += "<p class='hint'><b>宿主：</b>" + esc(result.hosts.join(' ')) + "</p>";
    if (data.error) html += "<p class='hint'>错误：" + esc(data.error) + "</p>";
    body.innerHTML = html;
    act.value = "capabilities";
    inp.value = '{}';
    res.textContent = '';
    var callBtn = el("detailCall");
    if (callBtn) {
      callBtn.onclick = function () {
        var action = act.value || "capabilities";
        var rawInput = inp.value || '{}';
        var input = {};
        try { input = JSON.parse(rawInput); } catch (err) { res.textContent = "输入不是合法 JSON"; return; }
        api("POST", "/v1/apps/call", { id: id, action: action, input: input }).then(function (d) {
          res.textContent = JSON.stringify(d, null, 2);
        });
      };
    }
  });
}

function callApp() {
  var id = (el("appId") || {}).value || "";
  var action = (el("appAction") || {}).value || "capabilities";
  var raw = (el("appInput") || {}).value || "";
  var input = {};
  if (raw.trim()) { try { input = JSON.parse(raw); } catch (err) { show("appResult", "输入不是合法 JSON"); return; } }
  api("POST", "/v1/apps/call", { id: id, action: action, input: input }).then(function (data) {
    show("appResult", data);
  });
}

function loadHosts() {
  api("GET", "/v1/hosts").then(function (data) {
    var body = el("hostTable");
    if (!body) return;
    var hosts = data.hosts || [];
    var html = "";
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i];
      html += "<tr><td>" + esc(h.name || h.id) + "</td>";
      html += "<td class=\"" + (h.found ? "ok" : "bad") + "\">" + esc(h.found ? t("installed") : t("hostMissing")) + "</td>";
      html += "<td>" + esc(h.version || "") + "</td><td>" + esc(h.path || "") + "</td></tr>";
    }
    body.innerHTML = html;
  });
}

function loadWorkloads() {
  api("GET", "/v1/workloads").then(function (data) {
    var host = el("wlList");
    if (!host) return;
    var list = data.workloads || [];
    var html = "<table><thead><tr><th>" + esc(t("name")) + "</th><th>" + esc(t("summary")) + "</th></tr></thead><tbody>";
    for (var i = 0; i < list.length; i++) {
      html += "<tr><td>" + esc(list[i].name) + "</td><td>" + esc(list[i].summary || "") + "</td></tr>";
    }
    html += "</tbody></table>";
    host.innerHTML = html;
  });
}

function humanBytes(bytes) {
  var units = ["B", "KiB", "MiB", "GiB"];
  var n = Number(bytes) || 0;
  var i = 0;
  while (n >= 1024 && i < units.length - 1) { n = n / 1024; i += 1; }
  return (i === 0 ? String(n) : n.toFixed(1)) + " " + units[i];
}

/* 在线安装：目录来自发布服务器，装的是已签名的安装包，不是工作区里的构建产物。 */
function renderRemote(data) {
  var list = el("remoteList");
  var base = el("remoteBase");
  if (!list) return;
  var catalog = data && data.catalog;
  var products = (catalog && catalog.products) || [];
  if (base) base.textContent = (data && data.base ? data.base : "") + (catalog && catalog.version ? " · " + catalog.version : "");
  if (!products.length) {
    list.innerHTML = "<div class='card'><p class='hint'>" + esc((data && data.error) || "目录为空：发布服务器还没有上架安装包。") + "</p></div>";
    return;
  }
  var html = "<table><thead><tr><th>产品</th><th>安装包</th><th>大小</th><th>SHA256</th><th>操作</th></tr></thead><tbody>";
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    html += "<tr><td>" + esc(p.name || p.id) + (p.component ? " <span class='chip'>组件</span>" : "") + "</td><td><code class='chip'>" + esc(p.asset) + "</code></td>";
    html += "<td>" + esc(humanBytes(p.size)) + "</td><td><code class='chip'>" + esc(String(p.sha256 || "").slice(0, 12)) + "</code></td>";
    html += "<td><button class='ghost' data-rid='" + esc(p.id || p.asset) + "'>安装</button></td></tr>";
  }
  html += "</tbody></table>";
  if (data && data.error) html += "<p class='hint'>目录错误：" + esc(data.error) + "</p>";
  list.innerHTML = html;
  var buttons = list.querySelectorAll("[data-rid]");
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener("click", function () { installRemote([btn.getAttribute("data-rid")]); });
  });
}

function renderRemoteState(st) {
  if (!st) return;
  var phase = el("remotePhase");
  var bar = el("remoteProgress");
  var names = { idle: "空闲", start: "准备", download: "下载中", install: "安装中", done: "完成", failed: "失败" };
  if (phase) {
    var text = names[st.phase] || st.phase;
    if (st.total) text += " · " + (st.index || 0) + "/" + st.total;
    if (st.current) text += " · " + st.current;
    phase.textContent = text;
  }
  if (bar) {
    var pct = st.expected ? Math.min(100, Math.round((st.received / st.expected) * 100)) : 0;
    bar.textContent = st.expected ? humanBytes(st.received) + " / " + humanBytes(st.expected) + " · " + pct + "%" : "";
  }
  var log = el("remoteLog");
  if (log) {
    var lines = (st.log || []).map(function (row) { return row.text; });
    log.textContent = lines.join("\n");
  }
}

function pollRemote() {
  api("GET", "/v1/remote/state").then(function (st) {
    renderRemoteState(st);
    if (st && st.running) setTimeout(pollRemote, 700);
    else if (st && st.phase === "done") loadRemote();
  }).catch(function () { setTimeout(pollRemote, 1500); });
}

function installRemote(ids) {
  api("POST", "/v1/remote/install", { ids: ids || [] }).then(function (data) {
    if (data && data.error && !data.started) { show("remoteLog", data.error); return; }
    renderRemoteState({ running: true, phase: "start", total: data.total || 0, index: 0, log: [{ text: "已排队 " + (data.total || 0) + " 个安装包" }] });
    pollRemote();
  });
}

function loadRemote() {
  api("GET", "/v1/remote").then(function (data) {
    renderRemote(data);
    renderRemoteState(data.state);
    if (data.state && data.state.running) pollRemote();
  }).catch(function (error) {
    show("remoteLog", String(error));
  });
}

function boot() {
  var saved = null;
  try { saved = localStorage.getItem("infinitystudio.language"); } catch (error) { saved = null; }
  if (saved && LOCALES[saved]) state.lang = saved;
  var select = el("language");
  if (select) {
    select.value = state.lang;
    select.addEventListener("change", function () {
      state.lang = select.value;
      try { localStorage.setItem('infinitystudio.language', state.lang); } catch (error) { /* private mode */ }
      applyLabels();
      setView(state.view);
    });
  }
  var tabs = document.querySelectorAll("[data-view]");
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener("click", function (event) {
      setView(event.currentTarget.getAttribute("data-view"));
    });
  }
  var tree = el("suiteTree");
  if (tree) {
    tree.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("button") : null;
      if (!button) return;
      var install = button.getAttribute("data-install");
      var remove = button.getAttribute("data-remove");
      var enter = button.getAttribute("data-enter");
      if (install) api("POST", "/v1/suite/install", { id: install }).then(function (d) { show("suiteMsg", d); });
      if (remove) api("POST", "/v1/suite/remove", { id: remove }).then(function (d) { show("suiteMsg", d); });
      if (enter) { state.pendingApp = enter; setView("apps"); }
    });
  }
  if (el("suiteRefresh")) el("suiteRefresh").addEventListener("click", loadSuite);
  if (el("hostRefresh")) el("hostRefresh").addEventListener("click", loadHosts);
  if (el("wsCreate")) el("wsCreate").addEventListener("click", function () {
    var body = { name: el("wsName").value || "workspace" };
    var target = el("wsPath").value;
    if (target) body.path = target;
    api("POST", "/v1/workspace/create", body).then(function (data) { show("wsResult", data); });
  });
  if (el("wsLoad")) el("wsLoad").addEventListener("click", function () {
    api("POST", "/v1/workspace/load", { path: el("wsLoadPath").value }).then(function (data) { show("wsResult", data); });
  });
  if (el("prjCreate")) el("prjCreate").addEventListener("click", function () {
    var lines = String(el("prjFiles").value || "").split("\n");
    var files = [];
    for (var n = 0; n < lines.length; n++) {
      var line = lines[n];
      if (!line.trim()) continue;
      var cut = line.indexOf("|");
      if (cut < 0) files.push({ path: "file" + (n + 1) + ".txt", content: line });
      else files.push({ path: line.slice(0, cut).trim(), content: line.slice(cut + 1) });
    }
    api("POST", "/v1/project/create", {
      name: el("prjName").value || "project",
      component: el("prjComponent").value || "craft.code",
      compressed: !!el("prjCompressed").checked,
      files: files
    }).then(function (data) { show("prjResult", data); });
  });
  if (el("prjOpen")) el("prjOpen").addEventListener("click", function () {
    api("POST", "/v1/project/open", { path: el("prjOpenPath").value }).then(function (data) { show("prjResult", data); });
  });
  if (el("assocPlan")) el("assocPlan").addEventListener("click", function () {
    api("POST", "/v1/associate", { apply: false }).then(function (data) { show("assocResult", data); });
  });
  if (el("assocApply")) el("assocApply").addEventListener("click", function () {
    api("POST", "/v1/associate", { apply: true }).then(function (data) { show("assocResult", data); });
  });
  if (el("srvCheck")) el("srvCheck").addEventListener("click", function () {
    api("POST", "/v1/server/status", { base: el("srvBase").value }).then(function (data) { show("srvResult", data); });
  });
  if (el("remoteRefresh")) el("remoteRefresh").addEventListener("click", function () {
    api("POST", "/v1/remote/refresh", {}).then(function (data) { renderRemote(data); });
  });
  if (el("remoteInstall")) el("remoteInstall").addEventListener("click", function () { installRemote([]); });
  applyLabels();
  setView("suite");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
</script>
</body></html>`;
}
