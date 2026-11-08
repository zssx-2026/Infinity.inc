/* =====================================================================
 * Infinity Edge Shell - window chrome for the Infinity suite (INC/ITB/IIM/IFM)
 * Runs as a plain classic script: no build step, no ES modules (file:// safe).
 *
 * Host bridge (see README.md):
 *   1. window.__INFINITY_HOST__.postMessage(frame)   custom bridge (CEF / native)
 *   2. window.chrome.webview.postMessage(frame)      WebView2
 *   3. window.parent.postMessage(frame, "*")         inframe host + window.postMessage
 *   4. demo mode                                      built-in demo host + <iframe>
 * ===================================================================== */
(function () {
  "use strict";

  var Icons = window.InfinityIcons;
  var I18n = window.InfinityI18n;
  var t = function (k, p) { return I18n.t(k, p); };

  var VERSION = "0.1.0";
  var CHANNEL = "infinity-shell";
  var PROTOCOL = CHANNEL + "/1";
  var STORE_KEY = "infinity-shell-state";
  var SEQ = 0;

  var APPS = [
    { id: "cloud", code: "INC", icon: "cloud", url: "inc://cloud", page: "apps/cloud/index.html", color: "#0f6cbd", nameKey: "app.cloud.name", descKey: "app.cloud.desc" },
    { id: "toolbox", code: "ITB", icon: "toolbox", url: "inc://toolbox", page: "apps/toolbox/index.html", color: "#7a5af5", nameKey: "app.toolbox.name", descKey: "app.toolbox.desc" },
    { id: "installer", code: "IIM", icon: "installer", url: "inc://installer", page: "apps/installer/index.html", color: "#0f8a6a", nameKey: "app.installer.name", descKey: "app.installer.desc" },
    { id: "files", code: "IFM", icon: "files", url: "inc://files", page: "apps/files/index.html", color: "#d97706", nameKey: "app.files.name", descKey: "app.files.desc" }
  ];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icon(name) { return Icons.svg(name); }
  function uid(p) { SEQ += 1; return (p || "id") + "-" + SEQ.toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ------------------------------------------------------------------ *
   * persistent settings
   * ------------------------------------------------------------------ */
  var DEFAULTS = {
    themeMode: "dark",
    locale: "zh-CN",
    sidebar: true,
    acrylic: true,
    restoreSession: true,
    exitAsk: false,
    home: "about:home",
    favorites: APPS.map(function (a) { return { labelKey: a.nameKey, label: "", url: a.url, code: a.code, color: a.color }; })
  };
  var settings = JSON.parse(JSON.stringify(DEFAULTS));

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) { if (parsed[k] !== undefined) { settings[k] = parsed[k]; } });
      }
    } catch (e) { /* file:// may block storage */ }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * host bridge
   * ------------------------------------------------------------------ */
  var host = { kind: "demo", api: "null", info: null, forced: null };

  function detectHost() {
    var forced = document.documentElement.dataset.hostforce;
    host.forced = forced || null;
    if (forced === "demo") { host.kind = "demo"; host.api = "demo://iframe"; return; }
    if (window.__INFINITY_HOST__ && typeof window.__INFINITY_HOST__.postMessage === "function") {
      host.kind = "bridge"; host.api = "window.__INFINITY_HOST__.postMessage"; return;
    }
    if (window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage === "function") {
      host.kind = "webview2"; host.api = "window.chrome.webview.postMessage"; return;
    }
    if (forced === "cef" || forced === "host" || forced === "1" || forced === "true" || forced === "yes") {
      host.kind = "cef"; host.api = "window.parent.postMessage"; return;
    }
    host.kind = "demo"; host.api = "demo://iframe";
  }

  var Log = { items: [], max: 300, listeners: [] };
  function logFrame(dir, type, payload, meta) {
    var entry = { dir: dir, type: type, payload: payload || {}, ts: Date.now(), meta: meta || "" };
    Log.items.push(entry);
    if (Log.items.length > Log.max) { Log.items.shift(); }
    Log.listeners.forEach(function (fn) { fn(entry); });
  }

  function send(type, payload) {
    var frame = { channel: CHANNEL, v: 1, dir: "to-host", type: type, payload: payload || {}, ts: Date.now(), id: uid("sh") };
    logFrame("to-host", type, frame.payload);
    try {
      if (host.kind === "webview2" && window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(frame);
      } else if (host.kind === "bridge" && window.__INFINITY_HOST__) {
        window.__INFINITY_HOST__.postMessage(frame);
      } else if (host.kind === "cef") {
        if (window.parent && window.parent !== window) { window.parent.postMessage(frame, "*"); }
        window.postMessage(frame, "*");
      }
    } catch (e) { logFrame("error", "shell.error", { message: String(e) }); }
    if (host.kind === "demo") { demoHost.handle(frame); }
    return frame;
  }

  function hostEmit(type, payload) {
    onHostFrame({ channel: CHANNEL, v: 1, dir: "to-shell", type: type, payload: payload || {}, ts: Date.now(), id: uid("host") });
  }

  function onHostFrame(frame) {
    if (!frame || frame.channel !== CHANNEL || frame.dir !== "to-shell") { return; }
    logFrame("to-shell", frame.type, frame.payload, frame.id || "");
    handleHostMessage(frame.type, frame.payload || {});
  }

  function wireHostListeners() {
    if (window.chrome && window.chrome.webview && typeof window.chrome.webview.addEventListener === "function") {
      window.chrome.webview.addEventListener("message", function (e) { onHostFrame(e.data); });
    }
    window.addEventListener("message", function (e) { onHostFrame(e.data); });
    document.addEventListener("infinity-shell-host", function (e) { onHostFrame(e.detail); });
  }

  /* Built-in demo host: echoes the protocol so the shell works with no host. */
  var demoHost = {
    handle: function (frame) {
      var p = frame.payload || {};
      var delay = 30 + Math.round(Math.random() * 50);
      window.setTimeout(function () {
        switch (frame.type) {
          case "shell.ready":
            hostEmit("host.info", {
              host: "demo", engine: "Chromium Trim (demo runtime)", runtime: "iframe",
              protocol: PROTOCOL, shell: VERSION, ua: navigator.userAgent
            });
            break;
          case "shell.open":
          case "shell.navigate": {
            var tab = p.tabId ? tabById(p.tabId) : activeTab();
            if (tab && !p.tabId) { /* keep local tab */ }
            if (tab) {
              hostEmit("host.tab-update", {
                tabId: tab.id, url: p.url, title: titleFor(p.url), kind: kindFor(p.url), loading: false
              });
            }
            break;
          }
          case "shell.command":
            hostEmit("host.command-result", { name: p.name, ok: false, reason: "demo host implements no native command", demo: true });
            break;
          case "shell.search":
            hostEmit("host.search-result", { query: p.query, provider: "infinity-demo", results: [] });
            break;
          case "shell.content-rect":
            break;
          default:
            hostEmit("host.ack", { of: frame.type, id: frame.id });
            break;
        }
      }, delay);
    }
  };

  /* ------------------------------------------------------------------ *
   * tabs / navigation model
   * ------------------------------------------------------------------ */
  var state = {
    tabs: [],
    activeTab: null,
    renderIframe: false,
    menuOpen: false,
    devtoolsOpen: false,
    devtoolsTab: "protocol",
    dialog: null
  };

  var els = {};
  var viewsEl;

  function activeTab() { return tabById(state.activeTab); }
  function tabById(id) {
    for (var i = 0; i < state.tabs.length; i++) { if (state.tabs[i].id === id) { return state.tabs[i]; } }
    return null;
  }
  function appById(id) {
    for (var i = 0; i < APPS.length; i++) { if (APPS[i].id === id) { return APPS[i]; } }
    return null;
  }
  function appFromUrl(u) {
    var m = /^inc:\/\/([^/?#]+)/i.exec(String(u || ""));
    if (!m) { return null; }
    var tok = m[1].toLowerCase();
    if (tok === "cloud" || tok === "inc" || tok === "infinity-cloud") { return appById("cloud"); }
    if (tok === "toolbox" || tok === "itb" || tok === "tools") { return appById("toolbox"); }
    if (tok === "installer" || tok === "iim" || tok === "manager" || tok === "installer-manager") { return appById("installer"); }
    if (tok === "files" || tok === "ifm" || tok === "filemanager" || tok === "file-manager") { return appById("files"); }
    return null;
  }
  function hostOf(u) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(String(u || ""));
    if (m) { return m[1]; }
    if (/^file:/i.test(u)) { var parts = String(u).split("/"); return parts[parts.length - 1] || "local file"; }
    return String(u || "");
  }
  function titleFor(u) {
    var app = appFromUrl(u);
    if (app) { return t(app.nameKey); }
    if (/^about:home$/i.test(u)) { return t("menu.newTab"); }
    if (/^search:/i.test(u)) { return t("search.title"); }
    return hostOf(u);
  }
  function kindFor(u) {
    if (/^about:home$/i.test(u)) { return "ntp"; }
    if (appFromUrl(u)) { return "app"; }
    if (/^https?:/i.test(u)) { return "web"; }
    if (/^search:/i.test(u)) { return "search"; }
    if (/^inc:\/\//i.test(u)) { return "error"; }
    return "page";
  }

  function resolveTarget(input) {
    var s = String(input == null ? "" : input).trim();
    if (!s) { return { url: "about:home", kind: "ntp" }; }
    if (/^(about:home|about:newtab|edge:\/\/newtab|infinity:\/\/home)$/i.test(s)) { return { url: "about:home", kind: "ntp" }; }
    var app = appFromUrl(s);
    if (app) { return { url: app.url, kind: "app", appId: app.id, frameUrl: app.page + "?embed=1" }; }
    if (/^inc:\/\//i.test(s)) { return { url: s, kind: "error" }; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(file|data|blob):/i.test(s)) {
      return { url: s, kind: /^https?:/i.test(s) ? "web" : "page", frameUrl: s };
    }
    if (/^[\w-]+(\.[\w-]+)+(?::\d+)?([/?#].*)?$/.test(s)) {
      return { url: "https://" + s, kind: "web", frameUrl: "https://" + s };
    }
    return { url: "search:" + encodeURIComponent(s), kind: "search", query: s };
  }

  function frameUrlFor(tab) {
    var app = appFromUrl(tab.url);
    if (app) {
      return app.page + "?embed=1&theme=" + effectiveTheme() + "&locale=" + encodeURIComponent(settings.locale);
    }
    if (tab.frameUrl) { return tab.frameUrl; }
    return tab.url;
  }

  function newTab(url, opts) {
    opts = opts || {};
    var target = resolveTarget(url || "about:home");
    var tab = {
      id: uid("tab"),
      url: target.url,
      kind: target.kind,
      frameUrl: target.frameUrl || null,
      appId: target.appId || null,
      query: target.query || null,
      title: opts.title || titleFor(target.url),
      loading: false,
      audio: false,
      view: null,
      history: [target.url],
      historyIndex: 0
    };
    state.tabs.push(tab);
    if (opts.activate !== false) { state.activeTab = tab.id; }
    renderTabs({ instant: !!opts.instant });
    if (opts.activate !== false) { showTab(tab.id); } else { renderSidebar(); }
    return tab;
  }

  function closeTab(id) {
    var idx = -1;
    for (var i = 0; i < state.tabs.length; i++) { if (state.tabs[i].id === id) { idx = i; } }
    if (idx < 0) { return; }
    var prevRects = TabAnim.measure();          // boxes before the strip reflows
    var node = TabAnim.nodeFor(id);
    var tab = state.tabs[idx];
    if (tab.view && tab.view.parentNode) { tab.view.parentNode.removeChild(tab.view); }
    state.tabs.splice(idx, 1);
    if (node) { TabAnim.exit(node); }           // collapse + fade, removes itself
    if (state.tabs.length === 0) { newTab("about:home"); return; }
    if (state.activeTab === id) {
      var next = state.tabs[Math.min(idx, state.tabs.length - 1)];
      state.activeTab = next.id;
      revealView(next);
      send("shell.activate-tab", { tabId: next.id, url: next.url });
    }
    renderTabs({ prevRects: prevRects });       // FLIP: remaining tabs slide
    renderSidebar();
    syncOmnibox();
    updateNavButtons();
  }

  function revealView(tab) {
    state.tabs.forEach(function (tb) { if (tb.view) { tb.view.hidden = tb.id !== tab.id; } });
    if (!tab.view) { renderView(tab); }
    tab.view.hidden = false;
    tab.view.classList.remove("view-enter");
    void tab.view.offsetWidth;
    tab.view.classList.add("view-enter");
    window.clearTimeout(tab.view._vt);
    tab.view._vt = window.setTimeout(function () { tab.view.classList.remove("view-enter"); }, 300);
  }

  function showTab(id) {
    var tab = tabById(id);
    if (!tab) { return; }
    state.activeTab = id;
    revealView(tab);
    renderTabs();
    renderSidebar();
    syncOmnibox();
    updateNavButtons();
    send("shell.activate-tab", { tabId: id, url: tab.url });
  }

  function navigate(tab, input, opts) {
    opts = opts || {};
    if (!tab) { return; }
    var target = resolveTarget(input);
    tab.url = target.url;
    tab.kind = target.kind;
    tab.frameUrl = target.frameUrl || null;
    tab.appId = target.appId || null;
    tab.query = target.query || null;
    tab.title = opts.title || titleFor(target.url);
    if (opts.push !== false) {
      tab.history = tab.history.slice(0, tab.historyIndex + 1);
      tab.history.push(target.url);
      tab.historyIndex = tab.history.length - 1;
    }
    setLoading(tab, true);
    renderView(tab);
    renderTabs();
    renderSidebar();
    if (tab.id === state.activeTab) { syncOmnibox(); updateNavButtons(); }
    send(opts.external === false ? "shell.navigate-local" : (opts.disposition === "newTab" ? "shell.open" : "shell.navigate"), {
      tabId: tab.id, url: tab.url, kind: tab.kind, title: tab.title, disposition: opts.disposition || "current"
    });
    window.setTimeout(function () { setLoading(tab, false); }, 420);
  }

  function setLoading(tab, loading) {
    tab.loading = !!loading;
    if (els.loadbar) { els.loadbar.hidden = !loading; }
    renderTabs();
  }

  function goBack(tab) {
    if (!tab || tab.historyIndex <= 0) { return; }
    tab.historyIndex -= 1;
    navigate(tab, tab.history[tab.historyIndex], { push: false });
    send("shell.back", { tabId: tab.id, url: tab.url });
  }
  function goForward(tab) {
    if (!tab || tab.historyIndex >= tab.history.length - 1) { return; }
    tab.historyIndex += 1;
    navigate(tab, tab.history[tab.historyIndex], { push: false });
    send("shell.forward", { tabId: tab.id, url: tab.url });
  }
  function reload(tab) {
    if (!tab) { return; }
    setLoading(tab, true);
    var frame = tab.view ? tab.view.querySelector("iframe") : null;
    if (frame) { try { frame.contentWindow.location.reload(); } catch (e) { frame.src = frameUrlFor(tab); } }
    else { renderView(tab); }
    send("shell.reload", { tabId: tab.id, url: tab.url });
    window.setTimeout(function () { setLoading(tab, false); }, 480);
  }
  function goHome() {
    var tab = activeTab();
    if (tab) { navigate(tab, settings.home); }
  }

  /* ------------------------------------------------------------------ *
   * rendering
   * ------------------------------------------------------------------ */

  /* Tab strip animation engine. renderTabs() below reconciles DOM nodes
   * (reuses them instead of rebuilding the strip) so enter / exit / FLIP
   * shift / sliding indicator / drag-sort transitions can actually run.
   * Timings live in the CSS variables --anim-* (shell.css). */
  var TabAnim = (function () {
    var indicator = null;
    var suppressClick = false;

    function tabNodes() {
      return $all(".tab", els.tabs).filter(function (n) { return !n.classList.contains("exit"); });
    }
    function nodeFor(id) {
      var found = null;
      $all(".tab", els.tabs).forEach(function (n) { if (n.dataset.tabId === id) { found = n; } });
      return found;
    }
    function measure() {
      var out = {};
      tabNodes().forEach(function (n) { out[n.dataset.tabId] = n.getBoundingClientRect(); });
      return out;
    }
    /* FLIP: put every reused node back at its old spot, then transition home. */
    function flip(nodes, prev) {
      if (!prev) { return; }
      var moved = [];
      nodes.forEach(function (n) {
        if (n.classList.contains("dragging")) { return; }
        var p = prev[n.dataset.tabId];
        if (!p) { return; }
        var r = n.getBoundingClientRect();
        var dx = p.left - r.left, dy = p.top - r.top;
        if (Math.abs(dx) < .5 && Math.abs(dy) < .5) { return; }
        n.style.transition = "none";
        n.style.transform = "translate3d(" + dx + "px," + dy + "px,0)";
        void n.offsetWidth;
        n.classList.add("flip");
        n.style.transition = "";
        n.style.transform = "";
        moved.push(n);
      });
      if (!moved.length) { return; }
      window.setTimeout(function () {
        moved.forEach(function (n) { n.classList.remove("flip"); });
      }, 340);
    }
    function enter(node) {
      node.classList.remove("flip");
      node.classList.add("enter");
      var done = function () { node.classList.remove("enter"); node.removeEventListener("animationend", done); };
      node.addEventListener("animationend", done);
      window.setTimeout(done, 700);
    }
    /* Pin the closing tab out of flow at its current box, then collapse it. */
    function exit(node) {
      var r = node.getBoundingClientRect();
      var pr = els.tabs.getBoundingClientRect();
      node.style.setProperty("--exit-w", Math.max(0, r.width) + "px");
      node.style.position = "absolute";
      node.style.left = (r.left - pr.left) + "px";
      node.style.top = (r.top - pr.top) + "px";
      node.style.width = Math.max(0, r.width) + "px";
      node.style.height = Math.max(0, r.height) + "px";
      node.style.flex = "0 0 auto";
      node.style.minWidth = "0";
      node.style.maxWidth = "none";
      node.style.margin = "0";
      node.style.zIndex = "3";
      node.classList.remove("active");
      node.classList.add("exit");
      var finish = function () {
        node.removeEventListener("animationend", finish);
        if (node.parentNode) { node.parentNode.removeChild(node); }
        TabAnim.updateIndicator(state.activeTab);
      };
      node.addEventListener("animationend", finish);
      window.setTimeout(finish, 600);
    }
    /* Sliding active-tab highlight bar: transform + width transition. */
    function updateIndicator(activeId) {
      if (indicator && indicator.parentNode !== els.tabs) { indicator = null; }
      if (!indicator) {
        indicator = document.getElementById("tabIndicator");
        if (!indicator) {
          indicator = document.createElement("span");
          indicator.id = "tabIndicator";
          indicator.className = "tab-indicator";
          indicator.setAttribute("aria-hidden", "true");
        }
        els.tabs.appendChild(indicator);
      }
      var node = nodeFor(activeId);
      if (!node) { indicator.style.opacity = "0"; return; }
      var r = node.getBoundingClientRect();
      var pr = els.tabs.getBoundingClientRect();
      var x = r.left - pr.left + 10;
      var w = Math.max(0, r.width - 20);
      if (!indicator.dataset.ready) {
        indicator.style.transition = "none";
        indicator.style.width = w + "px";
        indicator.style.transform = "translate3d(" + x + "px,0,0)";
        void indicator.offsetWidth;
        indicator.style.transition = "";
        indicator.dataset.ready = "1";
      } else {
        indicator.style.width = w + "px";
        indicator.style.transform = "translate3d(" + x + "px,0,0)";
      }
      indicator.style.top = (r.top - pr.top + 1) + "px";
      indicator.style.opacity = "1";
      indicator.dataset.x = String(Math.round(x));
    }
    return {
      tabNodes: tabNodes, nodeFor: nodeFor, measure: measure, flip: flip,
      enter: enter, exit: exit, updateIndicator: updateIndicator,
      suppressClick: function () { suppressClick = true; },
      consumeClickSuppress: function () { var s = suppressClick; suppressClick = false; return s; }
    };
  })();

  function updateTabNode(node, tab) {
    var active = tab.id === state.activeTab;
    node.classList.toggle("active", active);
    node.setAttribute("aria-selected", active ? "true" : "false");
    var fav = node.querySelector(".tab-fav");
    var sig = faviconHtml(tab, 16);
    if (fav.getAttribute("data-sig") !== sig) { fav.setAttribute("data-sig", sig); fav.innerHTML = sig; }
    var titleText = tab.title || titleFor(tab.url);
    var titleEl = node.querySelector(".tab-title");
    if (titleEl.textContent !== titleText) { titleEl.textContent = titleText; }
    node.title = titleText + "\n" + tab.url;
    node.classList.toggle("loading", !!tab.loading);
    var close = node.querySelector(".tab-close");
    if (!close.dataset.bound) { close.dataset.bound = "1"; close.setAttribute("title", t("tab.close")); }
  }

  function renderTabs(opts) {
    opts = opts || {};
    if (!els.tabs) { return; }
    var tpl = $("#tpl-tab");
    var existing = $all(".tab", els.tabs);
    var byId = {};
    existing.forEach(function (n) { if (!n.classList.contains("exit")) { byId[n.dataset.tabId] = n; } });
    var created = [];
    var order = [];
    state.tabs.forEach(function (tab) {
      var node = byId[tab.id];
      if (!node) {
        node = tpl.content.firstElementChild.cloneNode(true);
        node.dataset.tabId = tab.id;
        created.push(node);
      }
      updateTabNode(node, tab);
      order.push(node);
    });
    var wanted = {};
    order.forEach(function (n) { wanted[n.dataset.tabId] = true; });
    existing.forEach(function (n) {
      if (wanted[n.dataset.tabId] || n.classList.contains("exit")) { return; }
      if (opts.instantExit) { if (n.parentNode) { n.parentNode.removeChild(n); } }
      else { TabAnim.exit(n); }
    });
    order.forEach(function (n) { els.tabs.appendChild(n); });
    Icons.hydrate(els.tabs);
    if (created.length && !opts.instant) { created.forEach(function (n) { TabAnim.enter(n); }); }
    TabAnim.flip(order, opts.prevRects);
    TabAnim.updateIndicator(state.activeTab);
    if (opts.after) { opts.after(); }
  }

  function faviconHtml(tab, size) {
    var app = appFromUrl(tab.url);
    if (app) {
      return '<span class="fav-tile" style="--c:' + esc(app.color) + ';width:' + size + "px;height:" + size + 'px">' + esc(app.code) + "</span>";
    }
    if (tab.kind === "ntp") { return icon("sparkle"); }
    if (tab.kind === "search") { return icon("search"); }
    if (tab.kind === "web") { return icon("lock"); }
    return icon("globe");
  }

  function buildNtp(tab) {
    var node = $("#tpl-ntp").content.firstElementChild.cloneNode(true);
    var hour = new Date().getHours();
    var greeting = hour < 12 ? "ntp.greetingMorning" : (hour < 18 ? "ntp.greetingAfternoon" : "ntp.greetingEvening");
    $(".ntp-greeting", node).textContent = t(greeting);
    try {
      $(".ntp-date", node).textContent = new Intl.DateTimeFormat(settings.locale, {
        year: "numeric", month: "long", day: "numeric", weekday: "long"
      }).format(new Date());
    } catch (e) { $(".ntp-date", node).textContent = new Date().toLocaleDateString(); }

    $(".ntp-host-pill", node).textContent = host.kind === "demo" ? t("status.demo") : t("status.host");
    $(".ntp-host-pill", node).classList.toggle("live", host.kind !== "demo");
    $(".ntp-engine", node).textContent = host.kind === "demo" ? "Chromium Trim · iframe" : host.api;

    var grid = $(".app-grid", node);
    APPS.forEach(function (app) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "app-card";
      card.style.setProperty("--c", app.color);
      card.innerHTML =
        '<span class="app-card-tile">' + esc(app.code) + "</span>" +
        '<span class="app-card-body">' +
          '<span class="app-card-name">' + esc(t(app.nameKey)) + "</span>" +
          '<span class="app-card-sub">' + esc(app.code) + " \u00b7 " + esc(app.url) + "</span>" +
          '<span class="app-card-desc">' + esc(t(app.descKey)) + "</span>" +
          '<span class="app-card-open">' + esc(t("app.open")) + icon("chevron-right") + "</span>" +
        "</span>";
      card.addEventListener("click", function () { openUrl(app.url, "current"); });
      grid.appendChild(card);
    });

    var favRow = $(".fav-row", node);
    settings.favorites.forEach(function (fav) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "fav-chip";
      chip.innerHTML = (fav.code
        ? '<span class="fav-tile" style="--c:' + esc(fav.color || "#0f6cbd") + '">' + esc(fav.code) + "</span>"
        : icon("globe")) + "<span>" + esc(fav.labelKey ? t(fav.labelKey) : fav.label || hostOf(fav.url)) + "</span>";
      chip.addEventListener("click", function () { openUrl(fav.url, "current"); });
      favRow.appendChild(chip);
    });
    var add = $(".ntp-add-fav", node);
    if (add) { add.addEventListener("click", function () { toggleFavorite(); }); }

    var form = $(".ntp-search", node);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = $(".ntp-search-input", node).value;
      if (q && q.trim()) { navigate(tab, q.trim()); }
    });

    Icons.hydrate(node);
    return node;
  }

  function buildFrame(tab) {
    var wrap = document.createElement("div");
    wrap.style.cssText = "flex:1 1 auto;display:flex;min-width:0";
    var f = document.createElement("iframe");
    f.setAttribute("referrerpolicy", "no-referrer");
    f.setAttribute("title", tab.title || "");
    f.src = frameUrlFor(tab);
    wrap.appendChild(f);
    return wrap;
  }

  function buildInterstitial(tab) {
    var wrap = document.createElement("div");
    wrap.className = "interstitial";
    var isSearch = tab.kind === "search";
    var isError = tab.kind === "error";
    var title = isSearch ? t("search.title") : (isError ? t("error.title") : t("error.title"));
    var body = isSearch ? t("search.demoNote") : t("error.body");
    var detail = isSearch ? (t("search.query") + ": " + (tab.query || "")) : tab.url;
    wrap.innerHTML =
      '<div class="int-card">' +
        "<h2>" + esc(title) + "</h2>" +
        '<div class="int-url">' + esc(detail) + "</div>" +
        "<p>" + esc(body) + "</p>" +
        '<div class="int-actions">' +
          '<button class="btn primary" data-act="host">' + esc(t("error.openInHost")) + "</button>" +
          '<button class="btn" data-act="home">' + esc(t("error.back")) + "</button>" +
        "</div>" +
      "</div>";
    wrap.querySelector('[data-act="host"]').addEventListener("click", function () {
      send(isSearch ? "shell.search" : "shell.open", isSearch ? { query: tab.query } : { url: tab.url, tabId: tab.id, disposition: "current" });
      toast(isSearch ? t("toast.searchSent", { q: tab.query || "" }) : t("toast.favAdded"));
    });
    wrap.querySelector('[data-act="home"]').addEventListener("click", function () { navigate(tab, "about:home"); });
    return wrap;
  }

  function buildHostPlaceholder(tab) {
    var wrap = document.createElement("div");
    wrap.className = "interstitial";
    wrap.innerHTML =
      '<div class="int-card">' +
        "<h2>" + esc(tab.title || tab.url) + "</h2>" +
        '<div class="int-url">' + esc(tab.url) + "</div>" +
        "<p>" + esc(t("settings.hostWebview2")) + "</p>" +
        '<div class="int-actions"><span class="pill live">' + esc(host.kind) + "</span>" +
        '<span class="pill">' + esc(PROTOCOL) + "</span></div>" +
      "</div>";
    return wrap;
  }

  function renderView(tab) {
    if (!tab.view) {
      tab.view = document.createElement("div");
      tab.view.className = "view";
      viewsEl.appendChild(tab.view);
    } else if (tab.view.parentNode !== viewsEl) {
      viewsEl.appendChild(tab.view);
    }
    tab.view.innerHTML = "";
    if (tab.kind === "ntp") { tab.view.appendChild(buildNtp(tab)); }
    else if (tab.kind === "app" || tab.kind === "web" || tab.kind === "page") {
      tab.view.appendChild(state.renderIframe ? buildFrame(tab) : buildHostPlaceholder(tab));
    } else { tab.view.appendChild(buildInterstitial(tab)); }
    tab.view.hidden = tab.id !== state.activeTab;
  }

  function renderSidebar() {
    if (!els.sbApps) { return; }
    els.sbApps.innerHTML = "";
    APPS.forEach(function (app) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sb-app";
      b.title = t(app.nameKey);
      b.innerHTML = '<span class="sb-app-tile" style="--c:' + esc(app.color) + '">' + esc(app.code) + "</span>" +
                    '<span class="sb-app-name">' + esc(t(app.nameKey)) + "</span>";
      b.addEventListener("click", function () { openUrl(app.url, "current"); });
      els.sbApps.appendChild(b);
    });
    if (els.sbCount) { els.sbCount.textContent = String(state.tabs.length); }
    if (!els.sbTabs) { return; }
    var filter = (els.sbSearch && els.sbSearch.value || "").trim().toLowerCase();
    els.sbTabs.innerHTML = "";
    var shown = 0;
    state.tabs.forEach(function (tab) {
      if (filter && (tab.title || "").toLowerCase().indexOf(filter) < 0 && tab.url.toLowerCase().indexOf(filter) < 0) { return; }
      shown += 1;
      var row = document.createElement("button");
      row.type = "button";
      row.className = "sb-tab" + (tab.id === state.activeTab ? " active" : "");
      row.dataset.tabId = tab.id;
      row.innerHTML = '<span class="tab-fav">' + faviconHtml(tab, 16) + "</span>" +
                      '<span class="sb-tab-title">' + esc(tab.title) + "</span>" +
                      (tab.loading ? icon("reload") : "");
      row.addEventListener("click", function () { showTab(tab.id); });
      els.sbTabs.appendChild(row);
    });
    if (!shown) {
      var empty = document.createElement("div");
      empty.className = "sb-empty";
      empty.textContent = t("sidebar.empty");
      els.sbTabs.appendChild(empty);
    }
    Icons.hydrate(els.sbTabs);
  }

  function syncOmnibox() {
    if (!els.address) { return; }
    var tab = activeTab();
    var value = "";
    if (tab && tab.url !== "about:home") { value = tab.url; }
    els.address.value = value;
    if (document.activeElement !== els.address) { els.address.dataset.pristine = "1"; }
    var scheme = els.omniScheme;
    if (scheme) {
      var showScheme = !!(value && !/^(inc|about|search):/i.test(value));
      scheme.hidden = !showScheme;
      if (showScheme) {
        var m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
        scheme.textContent = (m ? m[1] : "https") + "://";
      }
    }
    if (els.omniLeading) {
      var kind = tab ? tab.kind : "ntp";
      els.omniLeading.innerHTML = kind === "web" ? icon("lock") : (kind === "ntp" ? icon("search") : icon("globe"));
    }
    updateFavoriteButton();
  }

  function updateFavoriteButton() {
    if (!els.btnFavorite) { return; }
    var tab = activeTab();
    var on = !!(tab && isFavorite(tab.url));
    els.btnFavorite.classList.toggle("on", on);
    els.btnFavorite.dataset.icon = on ? "star-fill" : "star";
    els.btnFavorite.innerHTML = icon(on ? "star-fill" : "star");
    els.btnFavorite.setAttribute("title", t("nav.favorite"));
  }

  function updateNavButtons() {
    var tab = activeTab();
    if (els.btnBack) { els.btnBack.disabled = !tab || tab.historyIndex <= 0; }
    if (els.btnForward) { els.btnForward.disabled = !tab || tab.historyIndex >= tab.history.length - 1; }
  }

  function openUrl(url, disposition) {
    if (disposition === "newTab") {
      var nt = newTab(url);
      send("shell.open", { tabId: nt.id, url: nt.url, kind: nt.kind, title: nt.title, disposition: "newTab" });
      return nt;
    }
    var tab = activeTab();
    if (tab) { navigate(tab, url); return tab; }
    return newTab(url);
  }

  /* ------------------------------------------------------------------ *
   * favorites
   * ------------------------------------------------------------------ */
  function isFavorite(url) {
    return settings.favorites.some(function (f) { return f.url === url; });
  }
  function toggleFavorite(url) {
    var u = url || (activeTab() && activeTab().url);
    if (!u) { return; }
    if (isFavorite(u)) {
      settings.favorites = settings.favorites.filter(function (f) { return f.url !== u; });
      toast(t("toast.favRemoved"));
    } else {
      var app = appFromUrl(u);
      settings.favorites.push({
        url: u, label: titleFor(u),
        code: app ? app.code : "", color: app ? app.color : "#0f6cbd"
      });
      toast(t("toast.favAdded"));
    }
    saveSettings();
    state.tabs.forEach(function (tb) { if (tb.kind === "ntp") { renderView(tb); } });
    updateFavoriteButton();
    send("shell.favorite", { url: u, active: isFavorite(u) });
  }

  /* ------------------------------------------------------------------ *
   * theme / locale
   * ------------------------------------------------------------------ */
  function effectiveTheme() {
    if (settings.themeMode === "system") {
      try { return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; } catch (e) { return "dark"; }
    }
    return settings.themeMode === "light" ? "light" : "dark";
  }
  function applyTheme(mode, opts) {
    opts = opts || {};
    settings.themeMode = mode;
    var th = effectiveTheme();
    document.documentElement.dataset.theme = th;
    document.documentElement.dataset.acrylic = settings.acrylic ? "on" : "off";
    $all("[data-theme-set]").forEach(function (b) { b.classList.toggle("active", b.dataset.themeSet === mode); });
    if (!opts.silent) { saveSettings(); send("shell.theme", { theme: th, mode: mode }); }
    if (!opts.noRerender) { reRenderNtp(); }
  }
  function applyLocale(loc, opts) {
    opts = opts || {};
    settings.locale = I18n.setLocale(loc);
    I18n.setLocale(settings.locale);
    document.documentElement.lang = settings.locale;
    $all("[data-locale-set]").forEach(function (b) { b.classList.toggle("active", b.dataset.localeSet === settings.locale); });
    applyI18n();
    state.tabs.forEach(function (tab) {
      if (tab.kind === "ntp" || tab.kind === "search" || tab.kind === "error" || tab.kind === "page") { renderView(tab); }
      else { tab.title = titleFor(tab.url); }
    });
    renderTabs(); renderSidebar(); syncOmnibox(); renderHostInfo();
    if (!opts.silent) { saveSettings(); send("shell.locale", { locale: settings.locale }); }
  }
  function reRenderNtp() {
    state.tabs.forEach(function (tab) { if (tab.kind === "ntp") { renderView(tab); } });
    if (state.tabs.some(function (x) { return x.kind === "ntp"; })) { renderSidebar(); }
  }

  function applyI18n() {
    $all("[data-i18n]").forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    $all("[data-i18n-title]").forEach(function (el) { el.setAttribute("title", t(el.dataset.i18nTitle)); });
    $all("[data-i18n-placeholder]").forEach(function (el) { el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder)); });
    document.title = t("app.title");
    if (els.aboutVersion) { els.aboutVersion.textContent = "v" + VERSION; }
    if (els.menuVersion) { els.menuVersion.textContent = "v" + VERSION; }
    var hostPill = els.menuHostPill;
    if (hostPill) {
      hostPill.textContent = host.kind === "demo" ? t("status.demo") : t("status.host") + " · " + host.kind;
      hostPill.classList.toggle("live", host.kind !== "demo");
    }
    if (els.hostModeHint) {
      els.hostModeHint.textContent = host.kind === "demo" ? t("settings.hostDemo")
        : host.kind === "webview2" ? t("settings.hostWebview2")
        : host.kind === "bridge" ? t("settings.hostBridge")
        : t("settings.hostCef");
    }
    if (els.setHostPill) { els.setHostPill.textContent = host.kind; }
    if (els.setHostApi) { els.setHostApi.textContent = host.api; }
    if (els.aboutHost) { els.aboutHost.textContent = host.kind + " (" + host.api + ")"; }
  }

  /* ------------------------------------------------------------------ *
   * menu / dialogs / toast / devtools
   * ------------------------------------------------------------------ */
  var toastTimer = null;
  function toast(msg) {
    if (!els.toast) { return; }
    els.toast.textContent = msg;
    els.toast.hidden = false;
    if (toastTimer) { window.clearTimeout(toastTimer); }
    toastTimer = window.setTimeout(function () { els.toast.hidden = true; }, 2600);
  }

  function toggleMenu(force) {
    var open = force === undefined ? els.menu.hidden : force;
    els.menu.hidden = !open;
    state.menuOpen = open;
    if (open) { Icons.hydrate(els.menu); }
  }

  function openDialog(name) {
    toggleMenu(false);
    els.overlay.hidden = false;
    $("#dialog-settings").hidden = name !== "settings";
    $("#dialog-about").hidden = name !== "about";
    $("#dialog-exit").hidden = name !== "exit";
    state.dialog = name;
    Icons.hydrate(els.overlay);
    if (name === "settings") {
      $("#setHome").value = settings.home;
      $("#setAcrylic").checked = !!settings.acrylic;
      $("#setSidebar").checked = !!settings.sidebar;
      $("#setRestore").checked = !!settings.restoreSession;
      $("#setExitAsk").checked = !!settings.exitAsk;
      updateSessionInfo();
      applyTheme(settings.themeMode, { silent: true, noRerender: true });
    }
  }
  function closeDialog() {
    els.overlay.hidden = true;
    state.dialog = null;
  }

  function logLine(entry) {
    if (!els.dtLog) { return; }
    if (els.dtLog.querySelector(".log-empty")) { els.dtLog.innerHTML = ""; }
    var div = document.createElement("div");
    div.className = "log-line " + entry.dir;
    var time = new Date(entry.ts);
    var hh = String(time.getHours()).padStart(2, "0");
    var mm = String(time.getMinutes()).padStart(2, "0");
    var ss = String(time.getSeconds()).padStart(2, "0");
    div.innerHTML = '<span class="log-time">' + hh + ":" + mm + ":" + ss + "</span>" +
      '<span class="log-dir">' + (entry.dir === "to-host" ? "\u2192 host" : "\u2190 shell") + "</span>" +
      '<span class="log-type">' + esc(entry.type) + "</span>" +
      '<span class="log-payload">' + esc(JSON.stringify(entry.payload)) + "</span>";
    els.dtLog.appendChild(div);
    els.dtLog.scrollTop = els.dtLog.scrollHeight;
  }

  function renderHostInfo() {
    if (!els.hostDl) { return; }
    var rect = els.content ? els.content.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    var rows = [
      ["host.mode", host.kind],
      ["host.api", host.api],
      ["protocol", PROTOCOL],
      ["shell.version", VERSION],
      ["engine", host.info && host.info.engine || "Chromium Trim"],
      ["host.forced", host.forced || "(auto)"],
      ["content.rect", Math.round(rect.x) + "," + Math.round(rect.y) + " " + Math.round(rect.width) + "x" + Math.round(rect.height)],
      ["tabs", state.tabs.length + " (" + state.tabs.filter(function (x) { return x.loading; }).length + " loading)"],
      ["locale", settings.locale],
      ["theme", document.documentElement.dataset.theme + " (" + settings.themeMode + ")"],
      ["ua", navigator.userAgent]
    ];
    els.hostDl.innerHTML = rows.map(function (r) {
      return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>";
    }).join("");
  }

  function setDevtools(open, which) {
    state.devtoolsOpen = !!open;
    els.devtools.hidden = !open;
    if (which) { state.devtoolsTab = which; }
    $all(".dt-tab").forEach(function (b) { b.classList.toggle("active", b.dataset.dt === state.devtoolsTab); });
    $("#dtPaneProtocol").hidden = state.devtoolsTab !== "protocol";
    $("#dtPaneHost").hidden = state.devtoolsTab !== "host";
    if (open && state.devtoolsTab === "host") { renderHostInfo(); }
  }

  /* ------------------------------------------------------------------ *
   * host -> shell message handling
   * ------------------------------------------------------------------ */
  function handleHostMessage(type, p) {
    switch (type) {
      case "host.info":
        host.info = p;
        applyI18n(); renderHostInfo();
        if (state.devtoolsOpen) { renderHostInfo(); }
        break;
      case "host.tab": {
        var nt = newTab(p.url || "about:home", { activate: p.activate !== false, title: p.title });
        if (p.tabId) { nt.id = p.tabId; renderTabs(); renderSidebar(); }
        break;
      }
      case "host.tab-update": {
        var tab = tabById(p.tabId) || activeTab();
        if (!tab) { break; }
        if (p.url) { tab.url = p.url; tab.kind = p.kind || kindFor(p.url); tab.frameUrl = p.frameUrl || tab.frameUrl; }
        if (p.title) { tab.title = p.title; }
        tab.loading = !!p.loading;
        renderTabs(); renderSidebar();
        if (tab.id === state.activeTab) { syncOmnibox(); }
        break;
      }
      case "host.close-tab":
        closeTab(p.tabId || state.activeTab);
        break;
      case "host.activate-tab":
        if (p.tabId) { showTab(p.tabId); }
        break;
      case "host.theme":
        applyTheme(p.mode || p.theme || "dark", { silent: true });
        break;
      case "host.locale":
        applyLocale(p.locale || "zh-CN", { silent: true });
        break;
      case "host.navigate":
        if (activeTab()) { navigate(activeTab(), p.url, { push: p.push !== false }); }
        break;
      case "host.favorite-list":
        if (p.favorites && p.favorites.length) {
          settings.favorites = p.favorites;
          saveSettings();
          state.tabs.forEach(function (tb) { if (tb.kind === "ntp") { renderView(tb); } });
          updateFavoriteButton();
        }
        break;
      case "host.config":
        if (p.themeMode) { applyTheme(p.themeMode, { silent: true }); }
        if (p.locale) { applyLocale(p.locale, { silent: true }); }
        if (p.sidebar !== undefined) { setSidebar(!!p.sidebar); }
        if (p.acrylic !== undefined) { settings.acrylic = !!p.acrylic; applyTheme(settings.themeMode, { silent: true, noRerender: true }); }
        if (p.home) { settings.home = p.home; }
        if (p.frame === false) { document.documentElement.dataset.frame = "0"; }
        if (p.render === "iframe") { state.renderIframe = true; }
        if (p.render === "native") { state.renderIframe = false; }
        if (activeTab()) { renderView(activeTab()); }
        break;
      case "host.command-result":
        toast(esc(p.name) + ": " + (p.ok ? "ok" : (p.reason || "unavailable")));
        break;
      case "host.search-result":
        break;
      case "host.session-restore":
        if (p && p.tabs && p.tabs.length) { restoreSession(p); }
        break;
      case "host.playzone":
        if (p && p.action === "close") { pzClose(); }
        else if (p && p.action === "open") { pzOpen(); }
        else if (p && p.music && p.music.src) { pzSetMusic(p.music.src, p.music.name); }
        break;
      default:
        break;
    }
  }

  function setSidebar(open) {
    settings.sidebar = !!open;
    els.body.classList.toggle("sb-collapsed", !open);
    saveSettings();
    renderHostInfo();
  }

  /* ------------------------------------------------------------------ *
   * menu actions
   * ------------------------------------------------------------------ */
  function menuAction(name) {
    switch (name) {
      case "new-tab": openUrl("about:home", "newTab"); toggleMenu(false); break;
      case "new-window": send("shell.window", { action: "new" }); toast("shell.window · new"); toggleMenu(false); break;
      case "history": send("shell.command", { name: "history" }); toast("shell.command · history"); toggleMenu(false); break;
      case "favorites": openUrl("about:home", "current"); toggleMenu(false); break;
      case "downloads": send("shell.command", { name: "downloads" }); toast("shell.command · downloads"); toggleMenu(false); break;
      case "collections": send("shell.command", { name: "collections" }); toast("shell.command · collections"); toggleMenu(false); break;
      case "playzone": pzToggle(); toggleMenu(false); break;
      case "print": send("shell.command", { name: "print" }); toast("shell.command · print"); toggleMenu(false); break;
      case "devtools":
      case "protocol":
        setDevtools(true, name === "protocol" ? "protocol" : state.devtoolsTab);
        send("shell.devtools", { open: true, tab: state.devtoolsTab });
        toggleMenu(false);
        break;
      case "settings": openDialog("settings"); break;
      case "about": openDialog("about"); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------ *
   * wiring
   * ------------------------------------------------------------------ */
  function cacheEls() {
    els = {
      body: $("#body"), sidebar: $("#sidebar"), tabs: $("#tabs"), views: $("#views"),
      address: $("#address"), omnibox: $("#omnibox"), omniLeading: $("#omniLeading"), omniScheme: $("#omniScheme"),
      btnBack: $("#btn-back"), btnForward: $("#btn-forward"), btnFavorite: $("#btn-favorite"),
      menu: $("#menu"), overlay: $("#overlay"), toast: $("#toast"), loadbar: $("#loadbar"),
      devtools: $("#devtools"), dtLog: $("#dtLog"), hostDl: $("#hostDl"),
      sbApps: $("#sbApps"), sbTabs: $("#sbTabs"), sbCount: $("#sbCount"), sbSearch: $("#sbSearch"),
      aboutVersion: $("#aboutVersion"), menuVersion: $("#menuVersion"), menuHostPill: $("#menuHostPill"),
      hostModeHint: $("#hostModeHint"), setHostPill: $("#setHostPill"), setHostApi: $("#setHostApi"),
      aboutHost: $("#aboutHost"), content: $("#content"),
      playzone: $("#playzone"), pzSelect: $("#pzSelect"), pzName: $("#pzName"),
      pzPrimary: $("#pzPrimary"), pzAccent: $("#pzAccent"), pzBg: $("#pzBg"),
      pzPreviewTile: $("#pzPreviewTile"), pzPreviewName: $("#pzPreviewName"), pzPreviewMeta: $("#pzPreviewMeta"),
      pzMusicName: $("#pzMusicName"), pzVolume: $("#pzVolume"), pzVolVal: $("#pzVolVal"),
      pzPlay: $("#pzPlay"), pzAudio: $("#pzAudio")
    };
    viewsEl = els.views;
  }

  /* Pointer drag-sort for the tab strip: lift on the first 5px of movement,
   * reorder live with a FLIP shift on the neighbours, then rebound on release. */
  function wireTabDrag() {
    var drag = null;

    els.tabs.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) { return; }
      var node = e.target.closest ? e.target.closest(".tab") : null;
      if (!node || node.classList.contains("exit")) { return; }
      if (e.target.closest && e.target.closest(".tab-close")) { return; }
      var rect = node.getBoundingClientRect();
      drag = {
        node: node, id: node.dataset.tabId, pointerId: e.pointerId,
        startX: e.clientX, startY: e.clientY, grabDX: e.clientX - rect.left,
        active: false, lastIndex: -1
      };
    });

    window.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.pointerId) { return; }
      var dx0 = e.clientX - drag.startX, dy0 = e.clientY - drag.startY;
      if (!drag.active) {
        if (Math.abs(dx0) < 5 && Math.abs(dy0) < 5) { return; }
        drag.active = true;
        drag.node.classList.add("dragging");
        els.tabs.classList.add("tab-dragging");
        try { drag.node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      if (e.cancelable) { e.preventDefault(); }

      /* live reorder: index = number of neighbours whose centre is left of the pointer */
      var others = TabAnim.tabNodes().filter(function (n) { return n !== drag.node; });
      var before = 0;
      others.forEach(function (n) { var rb = n.getBoundingClientRect(); if (e.clientX > rb.left + rb.width / 2) { before += 1; } });
      if (before !== drag.lastIndex) {
        var prevRects = TabAnim.measure();
        var arr = state.tabs.filter(function (x) { return x.id !== drag.id; });
        var moving = tabById(drag.id);
        if (moving) {
          arr.splice(Math.min(before, arr.length), 0, moving);
          state.tabs = arr;
          drag.lastIndex = before;
          renderTabs({ prevRects: prevRects });
        }
      }

      var pr = els.tabs.getBoundingClientRect();
      var dx = (e.clientX - drag.grabDX - pr.left) - drag.node.offsetLeft;
      var dy = Math.max(-6, Math.min(6, dy0 * 0.25));
      drag.node.style.transition = "none";
      drag.node.style.transform = "translate3d(" + dx + "px," + dy + "px,0) scale(1.03)";
    });

    function release() {
      var d = drag;
      drag = null;
      if (!d) { return; }
      if (!d.active) { return; }
      TabAnim.suppressClick();
      var node = d.node;
      els.tabs.classList.remove("tab-dragging");
      node.style.transition = "";
      node.style.transform = "";
      node.classList.remove("dragging");
      node.classList.add("settle");                       // rebound keyframes
      window.setTimeout(function () { node.classList.remove("settle"); }, 430);
      TabAnim.updateIndicator(state.activeTab);
      renderTabs();
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }

  function wireEvents() {
    $("#btn-new-tab").addEventListener("click", function () { openUrl("about:home", "newTab"); toast(t("toast.newTab")); });
    $("#btn-tab-list").addEventListener("click", function () {
      if (els.body.classList.contains("sb-collapsed")) { setSidebar(true); }
      if (els.sbSearch) { els.sbSearch.focus(); }
    });
    $("#btn-back").addEventListener("click", function () { goBack(activeTab()); });
    $("#btn-forward").addEventListener("click", function () { goForward(activeTab()); });
    $("#btn-reload").addEventListener("click", function () { reload(activeTab()); });
    $("#btn-home").addEventListener("click", goHome);
    $("#btn-sidebar").addEventListener("click", function () { setSidebar(els.body.classList.contains("sb-collapsed")); });
    $("#btn-sidebar-close").addEventListener("click", function () { setSidebar(false); });
    $("#btn-favorite").addEventListener("click", function () { toggleFavorite(); });
    $("#btn-translate").addEventListener("click", function () {
      send("shell.command", { name: "translate" });
      toast("shell.command · translate");
    });
    $("#btn-menu").addEventListener("click", function (e) { e.stopPropagation(); toggleMenu(els.menu.hidden); });
    $("#btn-collections").addEventListener("click", function () { menuAction("collections"); });
    $("#btn-extensions").addEventListener("click", function () { send("shell.command", { name: "extensions" }); toast("shell.command \u00b7 extensions"); });
    $("#btn-profile").addEventListener("click", function () { send("shell.command", { name: "profile" }); toast("shell.command · profile"); });
    $("#btn-sb-settings").addEventListener("click", function () { openDialog("settings"); });
    $all(".cap-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var map = { "cap-min": "minimize", "cap-max": "maximize", "cap-close": "close" };
        if (b.id === "cap-close") { requestExit(); return; }   // save session first
        send("shell.window", { action: map[b.id] });
        toast("shell.window · " + map[b.id]);
      });
    });

    // Play Zone entry points + panel
    $("#btn-playzone").addEventListener("click", pzToggle);
    $("#pz-close").addEventListener("click", function () { pzClose(); });
    $("#pz-new").addEventListener("click", function () {
      var z = pzNewZone();
      pzOpen(z.id);
      toast(t("playzone.created", { name: z.name }));
    });
    els.pzSelect.addEventListener("change", function () { pzOpen(els.pzSelect.value); });
    $all("#pzTheme button").forEach(function (b) {
      b.addEventListener("click", function () {
        var z = pzActive();
        if (!z) { return; }
        z.theme = b.dataset.pzTheme;
        pzSave(); pzRender();
      });
    });
    els.pzName.addEventListener("input", function () { var z = pzActive(); if (z) { z.name = els.pzName.value; pzSave(); pzRender(); } });
    els.pzPrimary.addEventListener("input", function () { var z = pzActive(); if (z) { z.primary = els.pzPrimary.value; pzSave(); pzRender(); } });
    els.pzAccent.addEventListener("input", function () { var z = pzActive(); if (z) { z.accent = els.pzAccent.value; pzSave(); pzRender(); } });
    els.pzBg.addEventListener("input", function () { var z = pzActive(); if (z) { z.bg = els.pzBg.value; pzSave(); pzRender(); } });
    $("#pzMusicPick").addEventListener("click", function () { $("#pzMusicFile").click(); });
    $("#pzMusicFile").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) { return; }
      var url = URL.createObjectURL(f);
      pzSetMusic(url, f.name);
      toast(t("toast.musicPicked", { name: f.name }));
      pzPlay();
    });
    els.pzPlay.addEventListener("click", function () { if (pzPlaying()) { pzPause(); } else { pzPlay(); } });
    els.pzVolume.addEventListener("input", function () {
      pzSetVolume(parseInt(els.pzVolume.value, 10) / 100);
      els.pzVolVal.textContent = els.pzVolume.value + "%";
      if (els.pzAudio) { els.pzAudio.volume = playzone.activeId ? (pzActive().music.volume) : 0.6; }
      pzSave();
    });

    // session settings
    $("#setRestore").addEventListener("change", function (e) { settings.restoreSession = e.target.checked; saveSettings(); });
    $("#setExitAsk").addEventListener("change", function (e) { settings.exitAsk = e.target.checked; saveSettings(); });
    $("#btn-session-save").addEventListener("click", function () {
      var s = saveSession("manual");
      if (s) { toast(t("toast.sessionSaved", { n: s.tabs.length })); }
    });
    $("#btn-session-clear").addEventListener("click", function () { clearSession(); toast(t("toast.sessionCleared")); });
    $("#btn-exit-confirm").addEventListener("click", function () {
      var chk = document.getElementById("exitDontAsk");
      if (chk && chk.checked) { settings.exitAsk = true; saveSettings(); }
      var snap = saveSession("exit");
      closeDialog();
      send("shell.window", { action: "close", session: snap });
      toast(t("toast.sessionSaved", { n: snap ? snap.tabs.length : 0 }));
    });

    // tab strip
    els.tabs.addEventListener("click", function (e) {
      if (TabAnim.consumeClickSuppress()) { return; }   // click that ended a drag
      var closeBtn = e.target.closest(".tab-close");
      var tabEl = e.target.closest(".tab");
      if (!tabEl) { return; }
      var id = tabEl.dataset.tabId;
      if (closeBtn) { e.stopPropagation(); closeTab(id); toast(t("toast.closed")); return; }
      showTab(id);
    });
    els.tabs.addEventListener("auxclick", function (e) {
      if (e.button !== 1) { return; }
      var tabEl = e.target.closest(".tab");
      if (tabEl) { e.preventDefault(); closeTab(tabEl.dataset.tabId); }
    });
    wireTabDrag();

    // omnibox
    els.address.addEventListener("focus", function () {
      els.omnibox.classList.add("focus");
      var tab = activeTab();
      if (tab && tab.url !== "about:home") { els.address.value = tab.url; }
      window.setTimeout(function () { els.address.select(); }, 0);
    });
    els.address.addEventListener("blur", function () { els.omnibox.classList.remove("focus"); syncOmnibox(); });
    els.address.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") { return; }
      e.preventDefault();
      var value = els.address.value.trim();
      if (!value) { return; }
      if (e.altKey) { openUrl(value, "newTab"); }
      else { navigate(activeTab(), value); }
      els.address.blur();
    });
    els.address.addEventListener("input", function () {
      els.omniScheme.hidden = true;
      els.omniLeading.innerHTML = /^[a-z][a-z0-9+.-]*:\/\//i.test(els.address.value) ? icon("globe") : icon("search");
    });

    // sidebar search
    if (els.sbSearch) { els.sbSearch.addEventListener("input", renderSidebar); }

    // menu
    els.menu.addEventListener("click", function (e) {
      var item = e.target.closest(".mi[data-action]");
      if (item) { menuAction(item.dataset.action); return; }
      var themeBtn = e.target.closest("[data-theme-set]");
      if (themeBtn) { applyTheme(themeBtn.dataset.themeSet); return; }
      var localeBtn = e.target.closest("[data-locale-set]");
      if (localeBtn) { applyLocale(localeBtn.dataset.localeSet); return; }
    });
    document.addEventListener("click", function (e) {
      if (!state.menuOpen) { return; }
      if (e.target.closest("#menu") || e.target.closest("#btn-menu")) { return; }
      toggleMenu(false);
    });

    // dialogs
    els.overlay.addEventListener("click", function (e) {
      if (e.target === els.overlay) { closeDialog(); }
      var closeBtn = e.target.closest("[data-close-dialog]");
      if (closeBtn) { closeDialog(); }
      var themeBtn = e.target.closest("#dialog-settings [data-theme-set]");
      if (themeBtn) { applyTheme(themeBtn.dataset.themeSet); }
      var localeBtn = e.target.closest("#dialog-settings [data-locale-set]");
      if (localeBtn) { applyLocale(localeBtn.dataset.localeSet); }
    });
    $("#btn-reset").addEventListener("click", function () {
      settings = JSON.parse(JSON.stringify(DEFAULTS));
      saveSettings();
      applyTheme(settings.themeMode, { silent: true });
      applyLocale(settings.locale, { silent: true });
      setSidebar(settings.sidebar);
      $("#setHome").value = settings.home;
      $("#setAcrylic").checked = settings.acrylic;
      $("#setSidebar").checked = settings.sidebar;
      toast(t("toast.reset"));
    });
    $("#setAcrylic").addEventListener("change", function (e) {
      settings.acrylic = e.target.checked; saveSettings();
      applyTheme(settings.themeMode, { silent: true, noRerender: true });
    });
    $("#setSidebar").addEventListener("change", function (e) { setSidebar(e.target.checked); });
    $("#setHome").addEventListener("change", function (e) { settings.home = e.target.value.trim() || "inc://cloud"; saveSettings(); });

    // devtools
    $all(".dt-tab").forEach(function (b) {
      b.addEventListener("click", function () { setDevtools(true, b.dataset.dt); });
    });
    $("#dt-clear").addEventListener("click", function () { Log.items = []; els.dtLog.innerHTML = '<div class="log-empty">' + esc(t("devtools.empty")) + "</div>"; });
    $("#dt-close").addEventListener("click", function () { setDevtools(false); });
    $("#dt-simulate").addEventListener("click", function () {
      var tab = activeTab();
      if (tab) { hostEmit("host.tab-update", { tabId: tab.id, url: tab.url, title: tab.title, loading: true }); }
      hostEmit("host.info", { host: "demo", engine: "Chromium Trim (demo runtime)", runtime: "iframe", protocol: PROTOCOL, shell: VERSION, ua: navigator.userAgent });
    });
    $("#dt-copy").addEventListener("click", function () {
      var text = Log.items.map(function (e) { return e.dir + " " + e.type + " " + JSON.stringify(e.payload); }).join("\n");
      try {
        if (navigator.clipboard) { navigator.clipboard.writeText(text); }
        else {
          var ta = document.createElement("textarea");
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand("copy"); document.body.removeChild(ta);
        }
        toast(t("toast.copied"));
      } catch (err) { toast("copy failed"); }
    });

    window.addEventListener("resize", function () {
      send("shell.content-rect", rectPayload());
      TabAnim.updateIndicator(state.activeTab);
      if (state.devtoolsOpen && state.devtoolsTab === "host") { renderHostInfo(); }
    });
    if (window.matchMedia) {
      try {
        window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () {
          if (settings.themeMode === "system") { applyTheme("system", { silent: true }); }
        });
      } catch (e) { /* older engines */ }
    }

    document.addEventListener("keydown", onKeydown);
  }

  function rectPayload() {
    var r = els.content ? els.content.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }

  function onKeydown(e) {
    var ctrl = e.ctrlKey || e.metaKey;
    var key = e.key;
    if (key === "Escape") {
      if (state.dialog) { closeDialog(); return; }
      if (state.menuOpen) { toggleMenu(false); return; }
      if (playzone.open) { pzClose(); return; }
      if (state.devtoolsOpen) { setDevtools(false); return; }
    }
    if (key === "F12" || (ctrl && e.shiftKey && (key === "I" || key === "i"))) {
      e.preventDefault(); setDevtools(!state.devtoolsOpen); send("shell.devtools", { open: state.devtoolsOpen, tab: state.devtoolsTab }); return;
    }
    if (key === "F5") { e.preventDefault(); reload(activeTab()); return; }
    if (key === "F6") { e.preventDefault(); els.address.focus(); return; }
    if (ctrl && !e.shiftKey && (key === "l" || key === "L")) { e.preventDefault(); els.address.focus(); return; }
    if (ctrl && !e.shiftKey && (key === "t" || key === "T")) { e.preventDefault(); openUrl("about:home", "newTab"); return; }
    if (ctrl && !e.shiftKey && (key === "w" || key === "W")) { e.preventDefault(); closeTab(state.activeTab); return; }
    if (ctrl && !e.shiftKey && (key === "r" || key === "R")) { e.preventDefault(); reload(activeTab()); return; }
    if (ctrl && !e.shiftKey && (key === "d" || key === "D")) { e.preventDefault(); toggleFavorite(); return; }
    if (ctrl && !e.shiftKey && (key === "p" || key === "P")) { e.preventDefault(); menuAction("print"); return; }
    if (ctrl && e.shiftKey && (key === "P" || key === "p")) { e.preventDefault(); setDevtools(true, "protocol"); return; }
    if (ctrl && e.shiftKey && (key === "E" || key === "e")) { e.preventDefault(); setSidebar(els.body.classList.contains("sb-collapsed")); return; }
    if (ctrl && e.shiftKey && (key === "G" || key === "g")) { e.preventDefault(); pzToggle(); return; }
    if (e.altKey && key === "ArrowLeft") { e.preventDefault(); goBack(activeTab()); return; }
    if (e.altKey && key === "ArrowRight") { e.preventDefault(); goForward(activeTab()); return; }
    if (e.altKey && key === "Home") { e.preventDefault(); goHome(); return; }
    if (ctrl && key === "Tab") {
      e.preventDefault();
      var i = state.tabs.findIndex(function (x) { return x.id === state.activeTab; });
      var n = state.tabs.length;
      var next = e.shiftKey ? (i - 1 + n) % n : (i + 1) % n;
      showTab(state.tabs[next].id);
      return;
    }
    if (ctrl && /^[1-9]$/.test(key)) {
      var idx = parseInt(key, 10) - 1;
      if (state.tabs[idx]) { e.preventDefault(); showTab(state.tabs[idx].id); }
      return;
    }
    if (e.altKey && (key === "f" || key === "F")) { e.preventDefault(); toggleMenu(els.menu.hidden); return; }
  }

  /* ------------------------------------------------------------------ *
   * ?anim-demo=1 - automatic loop over the tab animations
   *   phases: newtab -> close -> switch -> drag  (repeats)
   *   ?anim-demo=1&freeze=1&phase=newtab&at=120   freeze mid-animation
   *   #animProbe (hidden <pre>) carries the computed-state JSON evidence
   * ------------------------------------------------------------------ */
  var ANIM_PHASES = ["newtab", "close", "switch", "drag"];
  var ANIM_PHASE_MS = { newtab: 1600, close: 1400, switch: 1300, drag: 1700 };
  var ANIM_PHASE_LABEL = {
    newtab: "enter  260ms cubic-bezier(.16,1,.3,1)   width expand + fade-in",
    close: "exit   200ms cubic-bezier(.55,.06,.68,.19) collapse + fade-out (.tab.flip 240ms)",
    switch: "switch 220ms cubic-bezier(.2,.9,.3,1)   sliding indicator + highlight",
    drag: "drag   380ms cubic-bezier(.18,1.42,.42,1) lift + reorder FLIP 240ms + rebound"
  };
  var ANIM_SEED = ["about:home", "inc://cloud", "inc://toolbox", "inc://files"];
  var animDemo = { on: false, cycle: 0, index: 0, timer: null, frozen: false };

  function animHud() {
    var hud = document.getElementById("animHud");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "animHud";
      hud.className = "anim-hud";
      document.body.appendChild(hud);
    }
    return hud;
  }
  function updateAnimHud(phase) {
    var hud = animHud();
    var frozen = document.documentElement.getAttribute("data-anim-frozen");
    var idx = state.tabs.findIndex(function (x) { return x.id === state.activeTab; }) + 1;
    hud.innerHTML =
      '<span class="hud-title">ANIM DEMO &middot; ?anim-demo=1</span>' +
      '<span class="hud-sub">phase ' + esc(phase) + ' &middot; loop #' + (animDemo.cycle + 1) +
        ' &middot; active tab ' + idx + "/" + state.tabs.length + "</span>" +
      '<span class="hud-sub">' + esc(ANIM_PHASE_LABEL[phase] || "") + "</span>" +
      (frozen ? '<span class="hud-frozen">FROZEN @ ' + esc(frozen) + 'ms &middot; animations paused (WAAPI)</span>' : "");
  }

  function demoSeed() {
    state.tabs.slice().forEach(function (tb) { if (tb.view && tb.view.parentNode) { tb.view.parentNode.removeChild(tb.view); } });
    state.tabs = [];
    $all(".tab", els.tabs).forEach(function (n) { if (n.parentNode) { n.parentNode.removeChild(n); } });
    ANIM_SEED.forEach(function (u) { newTab(u, { activate: false, instant: true }); });
    state.activeTab = state.tabs[1] ? state.tabs[1].id : state.tabs[0].id;
    showTab(state.activeTab);
    renderTabs({ instant: true });
  }

  function demoDrag() {
    if (state.tabs.length < 4) { newTab("inc://files", { activate: false, instant: true }); }
    var from = Math.min(1, state.tabs.length - 2);
    var moving = state.tabs[from];
    var node = moving ? TabAnim.nodeFor(moving.id) : null;
    if (!node) { return; }
    var prevRects = TabAnim.measure();
    var arr = state.tabs.filter(function (x) { return x.id !== moving.id; });
    arr.splice(Math.min(from + 2, arr.length), 0, moving);
    state.tabs = arr;
    node.classList.add("dragging");
    els.tabs.classList.add("tab-dragging");
    node.style.transition = "none";
    node.style.transform = "translate3d(26px,-5px,0) scale(1.03)";
    renderTabs({ prevRects: prevRects });
    window.setTimeout(function () {
      node.style.transition = "";
      node.style.transform = "";
      node.classList.remove("dragging");
      els.tabs.classList.remove("tab-dragging");
      node.classList.add("settle");
      window.setTimeout(function () { node.classList.remove("settle"); }, 430);
      TabAnim.updateIndicator(state.activeTab);
    }, 320);
  }

  function demoPhase(name) {
    if (ANIM_PHASES.indexOf(name) < 0) { return; }
    document.documentElement.dataset.animPhase = name;
    document.documentElement.dataset.animCycle = String(animDemo.cycle);
    updateAnimHud(name);
    if (name === "newtab") {
      var pool = ["about:home", "inc://toolbox", "inc://cloud", "inc://files"];
      newTab(pool[animDemo.index % pool.length]);
    } else if (name === "close") {
      if (state.tabs.length < 3) { newTab("inc://cloud", { activate: false, instant: true }); }
      var victim = null;
      for (var i = 0; i < state.tabs.length && !victim; i++) {
        if (state.tabs[i].id !== state.activeTab) { victim = state.tabs[i]; }
      }
      if (victim) { closeTab(victim.id); }
    } else if (name === "switch") {
      var cur = state.tabs.findIndex(function (x) { return x.id === state.activeTab; });
      var next = state.tabs[(cur + 1) % state.tabs.length];
      if (next && next.id !== state.activeTab) { showTab(next.id); }
    } else if (name === "drag") {
      demoDrag();
    }
  }

  function animStep() {
    var name = ANIM_PHASES[animDemo.index % ANIM_PHASES.length];
    animDemo.index += 1;
    if (animDemo.index % ANIM_PHASES.length === 1 && animDemo.index > 1) { animDemo.cycle += 1; }
    demoPhase(name);
    animDemo.timer = window.setTimeout(animStep, ANIM_PHASE_MS[name]);
  }

  /* Machine-readable state dump: #animProbe stays hidden, --dump-dom reads it. */
  function writeAnimProbe() {
    var probe = document.getElementById("animProbe");
    if (!probe) {
      probe = document.createElement("pre");
      probe.id = "animProbe";
      probe.hidden = true;
      document.body.appendChild(probe);
    }
    var tabs = $all(".tab", els.tabs).map(function (n) {
      var rect = n.getBoundingClientRect();
      var cs = window.getComputedStyle(n);
      return {
        id: n.dataset.tabId, title: (n.querySelector(".tab-title") || {}).textContent || "",
        cls: n.className, active: n.classList.contains("active"),
        x: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height),
        opacity: cs.opacity, transform: cs.transform,
        animation: cs.animationName + " " + cs.animationDuration + " " + cs.animationTimingFunction,
        transition: cs.transitionProperty + " " + cs.transitionDuration
      };
    });
    var ind = document.getElementById("tabIndicator");
    var ics = ind ? window.getComputedStyle(ind) : null;
    var anims = [];
    try {
      anims = document.getAnimations().map(function (a) {
        var d = 0;
        try { d = Math.round(a.effect.getComputedTiming().duration || 0); } catch (e) { /* ignore */ }
        return (a.animationName || a.transitionProperty || "?") + " " + Math.round(a.currentTime || 0) + "/" + d + " " + a.playState;
      });
    } catch (e) { anims = [String(e)]; }
    probe.textContent = JSON.stringify({
      phase: document.documentElement.dataset.animPhase || null,
      cycle: document.documentElement.dataset.animCycle || null,
      frozenAt: document.documentElement.getAttribute("data-anim-frozen"),
      pausedAnimations: document.documentElement.getAttribute("data-anim-count"),
      animations: anims,
      indicator: ind ? { x: ind.dataset.x, width: ics.width, transform: ics.transform, transitionDuration: ics.transitionDuration } : null,
      tabs: tabs,
      bootError: document.documentElement.getAttribute("data-boot-error") || null,
      jsError: document.documentElement.getAttribute("data-js-error") || null
    });
  }

  function freezeAnim(at) {
    animDemo.frozen = true;
    var apply = function () {
      var n = 0;
      try {
        document.getAnimations().forEach(function (a) {
          try {
            a.pause();
            var d = 1e6;
            try { d = a.effect.getComputedTiming().duration || 1e6; } catch (e2) { /* ignore */ }
            a.currentTime = Math.min(at, d);
            n += 1;
          } catch (e3) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      document.documentElement.setAttribute("data-anim-frozen", String(at));
      document.documentElement.setAttribute("data-anim-count", String(n));
      updateAnimHud(document.documentElement.dataset.animPhase);
      window.setTimeout(writeAnimProbe, 40);
    };
    window.requestAnimationFrame(function () { window.requestAnimationFrame(apply); });
  }

  function startAnimDemo(q) {
    animDemo.on = true;
    demoSeed();
    var phase = q.get("phase");
    var valid = phase && ANIM_PHASES.indexOf(phase) >= 0;
    if (valid) { demoPhase(phase); animDemo.index = ANIM_PHASES.indexOf(phase) + 1; }
    else { demoPhase(ANIM_PHASES[0]); animDemo.index = 1; }
    if (q.get("freeze") === "1") { freezeAnim(parseInt(q.get("at") || "130", 10) || 130); return; }
    animDemo.timer = window.setTimeout(animStep, ANIM_PHASE_MS[ANIM_PHASES[(animDemo.index - 1 + ANIM_PHASES.length) % ANIM_PHASES.length]]);
  }

  /* ------------------------------------------------------------------ *
   * session persistence: save tabs on exit, restore them on next launch
   * localStorage["infinity-shell-session"] (schema documented in report.md)
   * ------------------------------------------------------------------ */
  var SESSION_KEY = "infinity-shell-session";
  var WINDOW_KEY = "infinity-shell-window-id";
  var _winId = null;

  function windowId() {
    if (_winId) { return _winId; }
    try {
      var v = sessionStorage.getItem(WINDOW_KEY);
      if (!v) { v = uid("win"); sessionStorage.setItem(WINDOW_KEY, v); }
      _winId = v;
    } catch (e) { _winId = uid("win"); }
    return _winId;
  }
  function sessionSnapshot() {
    return {
      v: 1, windowId: windowId(), savedAt: Date.now(), activeTabId: state.activeTab,
      home: settings.home,
      tabs: state.tabs.map(function (tb) {
        return { id: tb.id, url: tb.url, title: tb.title, kind: tb.kind, appId: tb.appId || null, frameUrl: tb.frameUrl || null };
      })
    };
  }
  function saveSession(reason) {
    if (!state.tabs.length) { return null; }
    var snap = sessionSnapshot();
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(snap)); } catch (e) { /* storage blocked */ }
    send("shell.session-save", {
      reason: reason || "auto", windowId: snap.windowId, savedAt: snap.savedAt,
      activeTabId: snap.activeTabId, tabs: snap.tabs
    });
    updateSessionInfo();
    return snap;
  }
  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) { return null; }
      var s = JSON.parse(raw);
      if (!s || s.v !== 1 || !s.tabs || !s.tabs.length) { return null; }
      return s;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
    updateSessionInfo();
  }
  /* Rebuild the tab list without touching the network: the active tab is
   * rendered, the rest stay lazy and are rendered on first activation. */
  function restoreSession(snap) {
    state.tabs = [];
    $all(".tab", els.tabs).forEach(function (n) { if (n.parentNode) { n.parentNode.removeChild(n); } });
    snap.tabs.forEach(function (st) {
      var url = st.url || "about:home";
      var target = resolveTarget(url);
      state.tabs.push({
        id: uid("tab"), url: target.url, kind: st.kind || target.kind,
        frameUrl: st.frameUrl || target.frameUrl || null, appId: st.appId || target.appId || null,
        query: null, title: st.title || titleFor(target.url), loading: false, audio: false,
        view: null, history: [target.url], historyIndex: 0, lazy: true
      });
    });
    var idx = 0;
    for (var i = 0; i < snap.tabs.length; i++) { if (snap.tabs[i].id === snap.activeTabId) { idx = i; } }
    state.activeTab = state.tabs[idx] ? state.tabs[idx].id : state.tabs[0].id;
    showTab(state.activeTab);
    renderTabs({ instant: true });
    send("shell.session-restored", {
      windowId: snap.windowId, savedAt: snap.savedAt, activeTabId: state.activeTab,
      tabs: state.tabs.map(function (tb) { return { url: tb.url, title: tb.title }; })
    });
    return state.tabs.length;
  }
  function updateSessionInfo() {
    var el = document.getElementById("sessionInfo");
    if (!el) { return; }
    var s = readSession();
    if (!s) { el.textContent = t("settings.sessionNone"); return; }
    var when = new Date(s.savedAt || Date.now());
    el.textContent = t("settings.sessionSaved", { n: s.tabs.length, time: when.toLocaleTimeString(settings.locale) });
  }
  function requestExit() {
    if (settings.exitAsk) { saveSession("exit"); send("shell.window", { action: "close" }); return; }
    var list = document.getElementById("exitSummary");
    if (list) {
      list.innerHTML = state.tabs.map(function (tb) {
        return '<span class="ss-row' + (tb.id === state.activeTab ? " active" : "") + '">' +
          '<span class="tab-fav">' + faviconHtml(tb, 16) + "</span>" +
          "<span>" + esc(tb.title || tb.url) + '</span><span class="ss-url">' + esc(tb.url) + "</span></span>";
      }).join("");
      Icons.hydrate(list);
    }
    var chk = document.getElementById("exitDontAsk");
    if (chk) { chk.checked = false; }
    openDialog("exit");
  }

  /* ------------------------------------------------------------------ *
   * Play Zone: one open zone per window, enforced in-window + by window id
   * localStorage["infinity-shell-playzone"] + BroadcastChannel
   * ------------------------------------------------------------------ */
  var PZ_KEY = "infinity-shell-playzone";
  var PZ_CHANNEL = "infinity-shell-playzone";
  var PZ_PALETTE = ["#0f6cbd", "#7a5af5", "#0f8a6a", "#d97706", "#c42b1c", "#1aa4a0"];
  var playzone = { zones: [], activeId: null, open: false, channel: null, audio: null, claim: 0, remoteGuard: 0, objUrl: null };

  function pzById(id) {
    for (var i = 0; i < playzone.zones.length; i++) { if (playzone.zones[i].id === id) { return playzone.zones[i]; } }
    return null;
  }
  function pzActive() { return pzById(playzone.activeId); }
  function pzNewZone(name) {
    var i = playzone.zones.length;
    var z = {
      id: uid("pz"), name: name || t("playzone.title") + " " + (i + 1),
      theme: "system", primary: PZ_PALETTE[i % PZ_PALETTE.length], accent: "#4cc2ff", bg: "#101418",
      music: { name: "", volume: 0.6, playing: false, src: null }
    };
    playzone.zones.push(z);
    return z;
  }
  function pzLoad() {
    try {
      var raw = localStorage.getItem(PZ_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && d.v === 1) {
          playzone.zones = d.zones || [];
          playzone.activeId = d.activeId || null;
          playzone.open = !!d.open && !!playzone.activeId;
        }
      }
    } catch (e) { /* ignore */ }
    if (!playzone.zones.length) { pzNewZone(); }
  }
  function pzSave() {
    var payload = { v: 1, zones: playzone.zones, activeId: playzone.activeId, open: playzone.open,
      windowId: windowId(), activeWindow: playzone.open ? windowId() : null, updatedAt: Date.now() };
    try { localStorage.setItem(PZ_KEY, JSON.stringify(payload)); } catch (e) { /* ignore */ }
    return payload;
  }
  function pzBroadcast(kind) {
    playzone.claim = Date.now();
    try {
      if (playzone.channel) {
        playzone.channel.postMessage({ channel: PZ_CHANNEL, kind: kind, windowId: windowId(),
          zoneId: playzone.activeId, open: playzone.open, ts: playzone.claim });
      }
    } catch (e) { /* BroadcastChannel unavailable */ }
  }
  function pzWireChannel() {
    try {
      if (typeof BroadcastChannel === "function") {
        playzone.channel = new BroadcastChannel(PZ_CHANNEL);
        playzone.channel.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.windowId === windowId() && m.ts > playzone.claim) {
            /* another instance claims this window id: keep at most one zone per window */
            if (playzone.open) { pzClose(true); playzone.remoteGuard += 1; toast(t("playzone.dupWindow")); }
            playzone.claim = m.ts;
          } else if (m.kind === "closed" && playzone.open && !els.playzone.hidden) {
            pzGuardText();
          }
        };
      }
    } catch (e) { /* ignore */ }
    window.addEventListener("storage", function (ev) {
      if (ev.key === PZ_KEY) { pzGuardText(); }
    });
  }
  function pzOpen(id) {
    var z = pzById(id) || pzActive() || playzone.zones[0] || pzNewZone();
    if (playzone.open && playzone.activeId && playzone.activeId !== z.id) {
      /* switching: close the previous zone first - never two in one window */
      playzone.open = false;
    }
    playzone.activeId = z.id;
    playzone.open = true;
    els.playzone.hidden = false;
    els.playzone.classList.remove("pz-flash");
    void els.playzone.offsetWidth;
    els.playzone.classList.add("pz-flash");
    document.documentElement.setAttribute("data-pz-open", "1");
    pzRender();
    pzSave();
    pzBroadcast("claim");
    return z;
  }
  function pzClose(silent) {
    playzone.open = false;
    if (els.playzone) { els.playzone.hidden = true; }
    document.documentElement.removeAttribute("data-pz-open");
    if (playzone.audio && !playzone.audio.paused) { playzone.audio.pause(); }
    var z = pzActive();
    if (z) { z.music.playing = false; }
    pzSave();
    pzBroadcast("closed");
    pzGuardText();
    if (!silent) { toast(t("playzone.closed")); }
  }
  function pzToggle() { if (playzone.open) { pzClose(); } else { pzOpen(playzone.activeId); } }
  function pzPlaying() { return !!(playzone.audio && playzone.audio.src && !playzone.audio.paused); }
  function pzRender() {
    var z = pzActive();
    if (!z || !els.playzone) { return; }
    var sysLight = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches);
    var eff = z.theme === "system" ? (sysLight ? "light" : "dark") : z.theme;
    els.playzone.dataset.pzTheme = eff;
    els.playzone.style.setProperty("--pz-primary", z.primary);
    els.playzone.style.setProperty("--pz-accent", z.accent);
    els.playzone.style.setProperty("--pz-bg", z.bg);
    els.pzSelect.innerHTML = playzone.zones.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === z.id ? " selected" : "") + ">" + esc(x.name) + "</option>";
    }).join("");
    els.pzName.value = z.name;
    els.pzPrimary.value = z.primary;
    els.pzAccent.value = z.accent;
    els.pzBg.value = z.bg;
    $all("#pzTheme button").forEach(function (b) { b.classList.toggle("active", b.dataset.pzTheme === z.theme); });
    els.pzPreviewTile.style.background = "linear-gradient(140deg," + z.primary + "," + z.accent + ")";
    els.pzPreviewName.textContent = z.name;
    els.pzPreviewMeta.textContent = z.theme + " · " + z.primary + " · " + (z.music.name || t("playzone.noMusic"));
    els.pzMusicName.textContent = z.music.name || t("playzone.noMusic");
    var vol = z.music.volume != null ? z.music.volume : 0.6;
    els.pzVolume.value = String(Math.round(vol * 100));
    els.pzVolVal.textContent = Math.round(vol * 100) + "%";
    var playing = pzPlaying();
    els.pzPlay.dataset.icon = playing ? "pause" : "play";
    els.pzPlay.innerHTML = icon(playing ? "pause" : "play");
    els.pzPlay.setAttribute("title", t(playing ? "playzone.pause" : "playzone.play"));
    pzGuardText();
  }
  function pzGuardText() {
    var el = document.getElementById("pzGuardText");
    var pill = document.getElementById("pzGuardPill");
    var n = playzone.open ? 1 : 0;
    document.documentElement.setAttribute("data-pz-count", String(n));
    if (el) {
      el.textContent = t("playzone.guard", { win: windowId().slice(-6), n: String(n) }) +
        (playzone.remoteGuard ? " · dup-closed:" + playzone.remoteGuard : "");
    }
    if (pill) { pill.textContent = n + "/1"; pill.classList.toggle("live", n === 1); }
    var badge = document.getElementById("pzBadge");
    if (badge) { badge.hidden = playzone.zones.length < 1; badge.textContent = String(n || playzone.zones.length); }
  }
  function pzSetMusic(src, name) {
    var z = pzActive();
    if (!z || !els.pzAudio) { return; }
    els.pzAudio.src = src;
    playzone.audio = els.pzAudio;
    z.music.name = name || "audio";
    z.music.src = /^blob:/.test(String(src)) ? null : src;
    pzSave();
    pzRender();
  }
  function pzSetVolume(v) {
    var z = pzActive();
    if (!z) { return; }
    z.music.volume = Math.max(0, Math.min(1, v));
    if (els.pzAudio) { els.pzAudio.volume = z.music.volume; }
  }
  function pzPlay() {
    var z = pzActive();
    if (!z || !els.pzAudio || !els.pzAudio.src) { toast(t("playzone.noMusic")); return; }
    els.pzAudio.volume = z.music.volume != null ? z.music.volume : 0.6;
    var p = els.pzAudio.play();
    if (p && p.catch) { p.catch(function () { toast(t("playzone.noMusic")); }); }
    z.music.playing = true;
    pzSave();
    pzRender();
  }
  function pzPause() {
    var z = pzActive();
    if (els.pzAudio && !els.pzAudio.paused) { els.pzAudio.pause(); }
    if (z) { z.music.playing = false; pzSave(); }
    pzRender();
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */
  function params() {
    try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(""); }
  }

  function boot() {
    loadSettings();
    var q = params();
    if (q.get("theme")) { settings.themeMode = q.get("theme"); }
    if (q.get("locale")) { settings.locale = I18n.normalize(q.get("locale")); }
    if (q.get("home")) { settings.home = q.get("home"); }
    if (q.get("sidebar") === "0") { settings.sidebar = false; }
    if (q.get("acrylic") === "0") { settings.acrylic = false; }

    detectHost();
    state.renderIframe = host.kind === "demo";
    if (q.get("render") === "iframe") { state.renderIframe = true; }
    if (q.get("render") === "native") { state.renderIframe = false; }
    cacheEls();
    I18n.setLocale(settings.locale);
    applyI18n();
    Icons.hydrate(document);
    applyTheme(settings.themeMode, { silent: true, noRerender: true });
    applyLocale(settings.locale, { silent: true });
    setSidebar(settings.sidebar);
    wireHostListeners();
    wireEvents();

    /* One-line boot diagnostic: visible in DevTools and in --enable-logging=stderr runs. */
    if (window.console && console.log) {
      console.log("[InfinityEdgeShell] host=" + host.kind + " api=" + host.api +
        " render=" + (state.renderIframe ? "iframe" : "native") +
        " locale=" + settings.locale + " theme=" + document.documentElement.dataset.theme);
    }

    Log.listeners.push(logLine);

    /* No fixed home page: without ?url/?app the shell always opens the locally
     * rendered new tab page, or restores the saved session when enabled. */
    var explicit = q.get("url") || (q.get("app") ? "inc://" + q.get("app") : null);
    var snap = (explicit || q.get("tabs")) ? null : (settings.restoreSession ? readSession() : null);
    if (snap && snap.tabs.length && snap.tabs.every(function (x) { return /^(about:home|about:newtab)$/i.test(x.url || ""); })) {
      snap = null;                                    // session was only NTPs: still show the NTP
      window.setTimeout(function () { toast(t("toast.newTabOnly")); }, 500);
    }
    var opener = null;
    if (snap) {
      var restored = restoreSession(snap);
      window.setTimeout(function () { toast(t("toast.sessionRestored", { n: restored })); }, 500);
    } else {
      opener = newTab(explicit || "about:home");
    }

    var extra = parseInt(q.get("tabs") || "1", 10);
    if (extra > 1 && !snap) {
      var pool = APPS.filter(function (a) { return !opener || a.url !== opener.url; });
      for (var i = 0; i < extra - 1 && i < pool.length; i++) { newTab(pool[i].url, { activate: false }); }
      renderTabs(); renderSidebar();
    }

    if (q.get("devtools") === "1") { setDevtools(true, "protocol"); }
    if (q.get("log") === "1") { logFrame("to-shell", "host.info", { note: "screenshot fixture" }); }

    send("shell.ready", {
      version: VERSION, protocol: PROTOCOL, locale: settings.locale,
      theme: document.documentElement.dataset.theme, host: host.kind, ua: navigator.userAgent
    });
    send("shell.content-rect", rectPayload());
    renderHostInfo();

    pzLoad();
    pzWireChannel();
    if (playzone.open) { pzOpen(playzone.activeId); } else { pzGuardText(); }
    if (q.get("playzone") === "1") { pzOpen(playzone.activeId); }   // screenshot / host-test hook
    if (q.get("music")) { pzSetMusic(q.get("music"), q.get("music").split("/").pop()); }
    updateSessionInfo();
    window.addEventListener("beforeunload", function () { saveSession("beforeunload"); });
    window.addEventListener("pagehide", function () { saveSession("pagehide"); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") { saveSession("hidden"); }
    });

    if (q.get("anim-demo") === "1") { startAnimDemo(q); }
    else if (q.get("anim-probe") === "1") { window.setTimeout(writeAnimProbe, 700); }

    window.__InfinityShell = {
      version: VERSION, protocol: PROTOCOL, state: state, settings: settings,
      send: send, emit: hostEmit, open: openUrl, navigate: function (u) { navigate(activeTab(), u); },
      close: function (id) { closeTab(id || state.activeTab); }, toast: toast,
      setTheme: function (m) { applyTheme(m); }, setLocale: function (l) { applyLocale(l); },
      session: {
        save: saveSession, read: readSession, clear: clearSession, restore: restoreSession,
        key: SESSION_KEY, windowId: windowId, snapshot: sessionSnapshot
      },
      playzone: {
        open: pzOpen, close: pzClose, toggle: pzToggle, create: pzNewZone,
        setMusic: pzSetMusic, play: pzPlay, pause: pzPause, render: pzRender,
        state: playzone, key: PZ_KEY
      },
      log: function () { return Log.items.slice(); },
      anim: {
        phases: ANIM_PHASES, state: animDemo, run: demoPhase, step: animStep, freeze: freezeAnim,
        probe: writeAnimProbe, start: function () { animStep(); }, stop: function () { window.clearTimeout(animDemo.timer); }
      }
    };
  }

  /* Diagnostics: a boot failure becomes visible to the host (data-boot-error). */
  function bootSafe() {
    try { boot(); }
    catch (err) {
      document.documentElement.setAttribute("data-boot-error", String(err && err.message || err));
      if (window.console && console.error) { console.error("[InfinityEdgeShell] boot failed:", err); }
    }
  }
  window.addEventListener("error", function (e) {
    document.documentElement.setAttribute("data-js-error", String(e.message || "error"));
  });

  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", bootSafe); }
  else { bootSafe(); }
})();
