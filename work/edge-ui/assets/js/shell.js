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
    home: "inc://cloud",
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
    if (forced === "cef" || forced === "host") { host.kind = "cef"; host.api = "window.parent.postMessage"; return; }
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
    renderTabs();
    if (opts.activate !== false) { showTab(tab.id); } else { renderSidebar(); }
    return tab;
  }

  function closeTab(id) {
    var idx = -1;
    for (var i = 0; i < state.tabs.length; i++) { if (state.tabs[i].id === id) { idx = i; } }
    if (idx < 0) { return; }
    var tab = state.tabs[idx];
    if (tab.view && tab.view.parentNode) { tab.view.parentNode.removeChild(tab.view); }
    state.tabs.splice(idx, 1);
    if (state.tabs.length === 0) { newTab("about:home"); return; }
    if (state.activeTab === id) {
      var next = state.tabs[Math.min(idx, state.tabs.length - 1)];
      showTab(next.id);
    } else { renderTabs(); renderSidebar(); }
  }

  function showTab(id) {
    var tab = tabById(id);
    if (!tab) { return; }
    state.activeTab = id;
    state.tabs.forEach(function (tb) {
      if (tb.view) { tb.view.hidden = tb.id !== id; }
    });
    if (!tab.view) { renderView(tab); tab.view.hidden = false; }
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
  function renderTabs() {
    if (!els.tabs) { return; }
    var tpl = $("#tpl-tab");
    els.tabs.innerHTML = "";
    state.tabs.forEach(function (tab) {
      var node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.tabId = tab.id;
      node.classList.toggle("active", tab.id === state.activeTab);
      node.setAttribute("aria-selected", tab.id === state.activeTab ? "true" : "false");
      var fav = node.querySelector(".tab-fav");
      fav.innerHTML = faviconHtml(tab, 16);
      var title = node.querySelector(".tab-title");
      title.textContent = tab.title || titleFor(tab.url);
      node.title = title.textContent + "\n" + tab.url;
      if (tab.loading) { node.classList.add("loading"); }
      var close = node.querySelector(".tab-close");
      close.setAttribute("title", t("tab.close"));
      els.tabs.appendChild(node);
    });
    Icons.hydrate(els.tabs);
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
      tab.view.appendChild(host.kind === "demo" ? buildFrame(tab) : buildHostPlaceholder(tab));
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
    state.dialog = name;
    Icons.hydrate(els.overlay);
    if (name === "settings") {
      $("#setHome").value = settings.home;
      $("#setAcrylic").checked = !!settings.acrylic;
      $("#setSidebar").checked = !!settings.sidebar;
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
        break;
      case "host.command-result":
        toast(esc(p.name) + ": " + (p.ok ? "ok" : (p.reason || "unavailable")));
        break;
      case "host.search-result":
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
      aboutHost: $("#aboutHost"), content: $("#content")
    };
    viewsEl = els.views;
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
        send("shell.window", { action: map[b.id] });
        toast("shell.window · " + map[b.id]);
      });
    });

    // tab strip
    els.tabs.addEventListener("click", function (e) {
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
    cacheEls();
    I18n.setLocale(settings.locale);
    applyI18n();
    Icons.hydrate(document);
    applyTheme(settings.themeMode, { silent: true, noRerender: true });
    applyLocale(settings.locale, { silent: true });
    setSidebar(settings.sidebar);
    wireHostListeners();
    wireEvents();

    Log.listeners.push(logLine);

    var start = q.get("url") || (q.get("app") ? "inc://" + q.get("app") : "about:home");
    var first = newTab(start);
    showTab(first.id);

    var extra = parseInt(q.get("tabs") || "1", 10);
    if (extra > 1) {
      var pool = APPS.filter(function (a) { return a.url !== first.url; });
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

    window.__InfinityShell = {
      version: VERSION, protocol: PROTOCOL, state: state, settings: settings,
      send: send, emit: hostEmit, open: openUrl, navigate: function (u) { navigate(activeTab(), u); },
      close: function (id) { closeTab(id || state.activeTab); }, toast: toast,
      setTheme: function (m) { applyTheme(m); }, setLocale: function (l) { applyLocale(l); },
      log: function () { return Log.items.slice(); }
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
