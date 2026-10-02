#!/usr/bin/env node
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/platform.js
var require_platform = __commonJS({
  "src/platform.js"(exports2, module2) {
    "use strict";
    var os = require("os");
    var path2 = require("path");
    var fs = require("fs");
    function isWindows() {
      return process.platform === "win32";
    }
    function isMac() {
      return process.platform === "darwin";
    }
    function isLinux() {
      return process.platform === "linux";
    }
    function platformTokens() {
      const list = [];
      if (isWindows()) list.push("win32", "windows", "win", "pc-windows");
      else if (isMac()) list.push("darwin", "macos", "mac", "osx", "apple");
      else if (isLinux()) list.push("linux", "gnu", "ubuntu", "debian");
      return list;
    }
    function archTokens() {
      const arch = process.arch;
      const list = [arch];
      if (arch === "x64") list.push("amd64", "x86_64");
      if (arch === "ia32") list.push("x86", "i386", "i686");
      if (arch === "arm64") list.push("aarch64");
      if (arch === "arm") list.push("armv7", "armhf");
      return list;
    }
    function defaultInstallDir() {
      if (isWindows()) {
        const local = process.env.LOCALAPPDATA || process.env.APPDATA || path2.join(os.homedir(), "AppData", "Local");
        return path2.join(local, "InfinityPackageManager");
      }
      if (isMac()) return path2.join(os.homedir(), "Library", "Application Support", "InfinityPackageManager");
      return path2.join(os.homedir(), ".local", "share", "InfinityPackageManager");
    }
    function isExecutable(fileName) {
      return /\.(exe|bat|cmd|com|msi|app|run|bin)$/i.test(fileName);
    }
    function chmodExec(file) {
      if (isWindows()) return;
      try {
        fs.chmodSync(file, 493);
      } catch (_) {
      }
    }
    function pickAsset(files, pkgName) {
      if (!files || !files.length) return null;
      if (files.length === 1) return files[0];
      const ptokens = platformTokens();
      const atokens = archTokens();
      for (const pt of ptokens) {
        for (const at of atokens) {
          const hit = files.find(function(f) {
            const n = f.name.toLowerCase();
            return n.indexOf(pt) !== -1 && n.indexOf(at) !== -1;
          });
          if (hit) return hit;
        }
      }
      for (const pt of ptokens) {
        const hit = files.find(function(f) {
          return f.name.toLowerCase().indexOf(pt) !== -1;
        });
        if (hit) return hit;
      }
      const universal = files.find(function(f) {
        return /\b(universal|all|noarch|any)\b/i.test(f.name);
      });
      if (universal) return universal;
      const others = ["win32", "windows", "darwin", "macos", "linux"];
      const mine = ptokens;
      const notMine = files.filter(function(f) {
        const n = f.name.toLowerCase();
        for (const o of others) {
          if (mine.indexOf(o) === -1 && n.indexOf(o) !== -1) return false;
        }
        return true;
      });
      if (notMine.length) return notMine[0];
      return files[0];
    }
    module2.exports = {
      isWindows,
      isMac,
      isLinux,
      platformTokens,
      archTokens,
      defaultInstallDir,
      isExecutable,
      chmodExec,
      pickAsset,
      platform: process.platform,
      arch: process.arch
    };
  }
});

// src/i18n.js
var require_i18n = __commonJS({
  "src/i18n.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var LANG_DIR = path2.join(config.ROOT, "lang");
    var FALLBACK = {
      cn: { unknownCommand: "\u672A\u77E5\u6216\u4E0D\u53EF\u7528\u7684\u547D\u4EE4", inputIpmHelp: "\uFF0C\u8F93\u5165ipm help\u67E5\u770B\u5E2E\u52A9" },
      "en-US": { unknownCommand: "Unknown or unavailable command", inputIpmHelp: ', run "ipm help" to see available commands' }
    };
    var DEFAULT_LANG = "en-US";
    var SYSTEM_ALIAS = {
      zh: "cn",
      "zh-cn": "cn",
      "zh-tw": "cn",
      "zh-hans": "cn",
      "zh-hant": "cn",
      "en-us": "en-US",
      "en-us-posix": "en-US",
      en_us: "en-US",
      "en-gb": "en-GB",
      en_gb: "en-GB",
      "en-gb-oed": "en-GB",
      ja: "ja",
      "ja-jp": "ja",
      jp: "ja",
      "ja_jp": "ja",
      ko: "ko",
      "ko-kr": "ko",
      kr: "ko",
      "ko_kr": "ko",
      de: "de",
      "de-de": "de",
      "de-at": "de",
      "de-ch": "de",
      fr: "fr",
      "fr-fr": "fr",
      "fr-ca": "fr",
      "fr-be": "fr"
    };
    var cache = {};
    var current = null;
    function unescapeValue(v) {
      return String(v).replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    function parseLangText(text) {
      const dict = {};
      for (let raw of String(text).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line[0] === "#" || line[0] === ";") continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
          value = unescapeValue(value.slice(1, -1));
        }
        dict[key] = value;
      }
      return dict;
    }
    function listLangs() {
      try {
        return fs.readdirSync(LANG_DIR).filter(function(f) {
          return f.toLowerCase().endsWith(".lang");
        }).map(function(f) {
          return f.slice(0, -5);
        }).sort();
      } catch (_) {
        return [];
      }
    }
    function langFile(name) {
      return path2.join(LANG_DIR, name + ".lang");
    }
    function loadLang(name) {
      if (!name) return null;
      if (cache[name]) return cache[name];
      const f = langFile(name);
      if (!fs.existsSync(f)) return null;
      try {
        const dict = parseLangText(fs.readFileSync(f, "utf8"));
        cache[name] = dict;
        return dict;
      } catch (_) {
        return null;
      }
    }
    function detectSystemLang() {
      const loc = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || typeof Intl !== "undefined" && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().locale || "";
      const lower = String(loc).toLowerCase();
      if (SYSTEM_ALIAS[lower]) return SYSTEM_ALIAS[lower];
      const parts = lower.split(/[-_]/);
      const lang2 = parts[0];
      if (lang2 === "zh") return "cn";
      if (lang2 === "en") {
        const region = parts[1] || "";
        return region === "gb" || region === "uk" ? "en-GB" : "en-US";
      }
      if (lang2 === "ja") return "ja";
      if (lang2 === "ko") return "ko";
      if (lang2 === "de") return "de";
      if (lang2 === "fr") return "fr";
      return DEFAULT_LANG;
    }
    function resolveName() {
      let explicit = "";
      try {
        explicit = config.get("lang") || "";
      } catch (_) {
      }
      if (explicit && fs.existsSync(langFile(explicit))) return explicit;
      const sys = detectSystemLang();
      if (fs.existsSync(langFile(sys))) return sys;
      const all2 = listLangs();
      if (all2.length) {
        if (all2.indexOf(DEFAULT_LANG) !== -1) return DEFAULT_LANG;
        return all2[0];
      }
      return sys;
    }
    function reload() {
      cache = {};
      current = null;
    }
    function currentName() {
      if (!current) current = resolveName();
      return current;
    }
    function t(key) {
      const dict = loadLang(currentName());
      if (dict && dict[key] != null) return dict[key];
      const sys = detectSystemLang();
      if (FALLBACK[sys] && FALLBACK[sys][key] != null) return FALLBACK[sys][key];
      if (FALLBACK[DEFAULT_LANG] && FALLBACK[DEFAULT_LANG][key] != null) return FALLBACK[DEFAULT_LANG][key];
      if (FALLBACK.cn[key] != null) return FALLBACK.cn[key];
      return key;
    }
    function all() {
      return loadLang(currentName()) || {};
    }
    function info(name) {
      const target = name || currentName();
      const dict = loadLang(target);
      if (!dict) return null;
      return {
        name: dict.name || target,
        displayName: dict.displayName || (dict.name || target),
        file: langFile(target)
      };
    }
    module2.exports = {
      t,
      all,
      info,
      current: currentName,
      listLangs,
      loadLang,
      reload,
      detectSystemLang,
      LANG_DIR,
      FALLBACK,
      DEFAULT_LANG
    };
  }
});

// src/config.js
var require_config = __commonJS({
  "src/config.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var os = require("os");
    var platform = require_platform();
    function detectRoot() {
      if (process.env.IPM_ROOT) {
        try {
          return path2.resolve(process.env.IPM_ROOT);
        } catch (_) {
        }
      }
      const exec = process.execPath || "";
      const isNodeExe = /(^|[\\/])node(\.exe)?$/i.test(exec);
      if (isNodeExe) return path2.resolve(__dirname, "..");
      return path2.dirname(exec);
    }
    var ROOT = detectRoot();
    var DATA_DIR = process.env.IPM_HOME ? path2.resolve(process.env.IPM_HOME) : path2.join(os.homedir(), ".ipm");
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (_) {
    }
    var SETTINGS_FILE = path2.join(ROOT, "settings.json");
    var DEFAULTS = {
      tempdir: "",
      installdir: "",
      registryfile: "",
      lang: "",
      hotkey: "ctrl+x",
      "network.retries": 4,
      "network.retryDelayMs": 800,
      "network.timeoutMs": 3e4,
      "github.token": "",
      "github.apiBase": "https://api.github.com"
    };
    function loadRaw() {
      try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
      } catch (_) {
        return {};
      }
    }
    function saveRaw(d) {
      try {
        fs.mkdirSync(path2.dirname(SETTINGS_FILE), { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(d, null, 2) + "\n", "utf8");
      } catch (_) {
      }
    }
    function resolvePath(p) {
      if (!p) return p;
      if (p === "~" || p.indexOf("~/") === 0 || p.indexOf("~\\") === 0) {
        return path2.join(os.homedir(), p.slice(1).replace(/^[\\/]/, ""));
      }
      return path2.isAbsolute(p) ? p : path2.resolve(ROOT, p);
    }
    function get(key) {
      const raw = loadRaw();
      if (key === "tempdir") return raw.tempdir ? resolvePath(raw.tempdir) : path2.join(DATA_DIR, "temp");
      if (key === "installdir") return raw.installdir ? resolvePath(raw.installdir) : platform.defaultInstallDir();
      if (key === "registryfile") return raw.registryfile ? resolvePath(raw.registryfile) : path2.join(DATA_DIR, "registry.json");
      if (key === "versionfile") return path2.join(DATA_DIR, "versions.json");
      if (key === "lang") return raw.lang || "";
      if (key === "hotkey") return raw.hotkey || DEFAULTS.hotkey;
      if (key === "github.token") return raw.github && raw.github.token || "";
      if (key === "github.apiBase") return raw.github && raw.github.apiBase || DEFAULTS["github.apiBase"];
      if (key.indexOf("network.") === 0) {
        const sub = key.slice(8);
        return raw.network && raw.network[sub] != null ? raw.network[sub] : DEFAULTS[key];
      }
      return raw[key];
    }
    function set(key, value) {
      const raw = loadRaw();
      if (key === "tempdir" || key === "installdir" || key === "registryfile" || key === "lang" || key === "hotkey") {
        raw[key] = value;
      } else if (key.indexOf("github.") === 0) {
        if (!raw.github) raw.github = {};
        raw.github[key.slice(7)] = value;
      } else if (key.indexOf("network.") === 0) {
        if (!raw.network) raw.network = {};
        let v = value;
        if (key === "network.retries" || key === "network.retryDelayMs" || key === "network.timeoutMs") v = Number(value);
        raw.network[key.slice(8)] = v;
      } else {
        raw[key] = value;
      }
      saveRaw(raw);
    }
    function list() {
      const raw = loadRaw();
      let i18n = null;
      try {
        i18n = require_i18n();
      } catch (_) {
      }
      let langDisplay;
      if (raw.lang) langDisplay = raw.lang;
      else if (i18n) langDisplay = i18n.current() + " (" + i18n.t("langFollowSystem") + ")";
      else langDisplay = "";
      return {
        tempdir: get("tempdir"),
        installdir: get("installdir"),
        registryfile: get("registryfile"),
        lang: langDisplay,
        hotkey: get("hotkey"),
        "network.retries": get("network.retries"),
        "network.retryDelayMs": get("network.retryDelayMs"),
        "network.timeoutMs": get("network.timeoutMs"),
        "github.token": raw.github && raw.github.token || "",
        "github.apiBase": raw.github && raw.github.apiBase || DEFAULTS["github.apiBase"]
      };
    }
    module2.exports = { get, set, list, ROOT, DATA_DIR, SETTINGS_FILE };
  }
});

// src/utils.js
var require_utils = __commonJS({
  "src/utils.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    function ensureDir(dir) {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function rmrf(t) {
      if (!t) return;
      try {
        fs.rmSync(t, { recursive: true, force: true });
      } catch (_) {
      }
    }
    function copyDir(src, dest) {
      ensureDir(dest);
      for (const e of fs.readdirSync(src, { withFileTypes: true })) {
        const from = path2.join(src, e.name);
        const to = path2.join(dest, e.name);
        if (e.isDirectory()) copyDir(from, to);
        else fs.copyFileSync(from, to);
      }
    }
    function readJson(f, d) {
      try {
        return JSON.parse(fs.readFileSync(f, "utf8"));
      } catch (_) {
        return d === void 0 ? null : d;
      }
    }
    function writeJson(f, d) {
      ensureDir(path2.dirname(f));
      fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n", "utf8");
    }
    var useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
    function wrap(code) {
      return function(t) {
        return useColor ? "\x1B[" + code + "m" + t + "\x1B[0m" : String(t);
      };
    }
    var color = {
      red: wrap(31),
      green: wrap(32),
      yellow: wrap(33),
      blue: wrap(34),
      magenta: wrap(35),
      cyan: wrap(36),
      gray: wrap(90),
      bold: wrap(1),
      dim: wrap(2),
      italic: wrap(3),
      underline: wrap(4),
      brightRed: wrap(91),
      brightGreen: wrap(92),
      brightYellow: wrap(93),
      brightBlue: wrap(94),
      brightMagenta: wrap(95),
      brightCyan: wrap(96),
      brightWhite: wrap(97),
      bgBlue: wrap(44),
      bgMagenta: wrap(45),
      bgCyan: wrap(46)
    };
    function link(text, command) {
      const cmd = String(command || "");
      const osc = "\x1B]8;;ipm:" + encodeURIComponent(cmd) + "\x07";
      const end = "\x1B]8;;\x07";
      const paint = "\x1B[4;36m" + text + "\x1B[0m";
      if (!useColor) return text;
      return osc + paint + end;
    }
    var log = {
      info: function(m) {
        console.log(color.cyan("i") + " " + m);
      },
      success: function(m) {
        console.log(color.green("+") + " " + m);
      },
      warn: function(m) {
        console.log(color.yellow("!") + " " + m);
      },
      error: function(m) {
        console.error(color.red("x") + " " + m);
      },
      step: function(m) {
        console.log(color.blue(">") + " " + m);
      }
    };
    function formatBytes(b) {
      if (b == null) return "-";
      const u = ["B", "KB", "MB", "GB", "TB"];
      let v = Number(b), i = 0;
      while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i++;
      }
      return v.toFixed(i === 0 ? 0 : 1) + " " + u[i];
    }
    function clearScreen() {
      process.stdout.write("\x1B[2J\x1B[0;0H");
    }
    module2.exports = {
      ensureDir,
      rmrf,
      copyDir,
      readJson,
      writeJson,
      color,
      log,
      formatBytes,
      clearScreen,
      link
    };
  }
});

// src/process.js
var require_process = __commonJS({
  "src/process.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var { execFileSync } = require("child_process");
    var config = require_config();
    var { ensureDir } = require_utils();
    function pidFile() {
      const dir = config.DATA_DIR || config.get("tempdir");
      try {
        ensureDir(dir);
      } catch (_) {
      }
      return path2.join(dir, ".ipm.pids.json");
    }
    function isAlive(pid) {
      if (!pid || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (_) {
        return false;
      }
    }
    function readPids() {
      try {
        const data = JSON.parse(fs.readFileSync(pidFile(), "utf8"));
        if (!Array.isArray(data)) return [];
        return data.filter(function(p) {
          return typeof p === "number" && isAlive(p);
        });
      } catch (_) {
        return [];
      }
    }
    function writePids(pids) {
      try {
        const f = pidFile();
        if (!pids || !pids.length) {
          try {
            fs.unlinkSync(f);
          } catch (_) {
          }
          return;
        }
        fs.writeFileSync(f, JSON.stringify(pids), "utf8");
      } catch (_) {
      }
    }
    function register() {
      const pid = process.pid;
      const pids = readPids().filter(function(p) {
        return p !== pid;
      });
      pids.push(pid);
      writePids(pids);
      return pid;
    }
    function unregister() {
      const pid = process.pid;
      writePids(readPids().filter(function(p) {
        return p !== pid;
      }));
    }
    function killOne(pid) {
      if (!pid || pid <= 0) return false;
      if (pid === process.pid) return false;
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/PID", String(pid), "/F", "/T"], { stdio: "ignore", timeout: 3e3 });
        } else {
          try {
            process.kill(-pid, "SIGKILL");
          } catch (_) {
            process.kill(pid, "SIGKILL");
          }
        }
        return true;
      } catch (_) {
        return false;
      }
    }
    function killAll() {
      const pids = readPids();
      const killed = [];
      for (const pid of pids) {
        if (pid === process.pid) continue;
        if (killOne(pid)) killed.push(pid);
      }
      return killed;
    }
    function exitAll(code) {
      if (typeof code !== "number") code = 0;
      let killed = [];
      try {
        killed = killAll();
      } catch (_) {
      }
      writePids([]);
      if (killed.length) {
        let i18n;
        try {
          i18n = require_i18n();
        } catch (_) {
        }
        const msg = i18n ? i18n.t("exitKilled") + " " + killed.length + " " + i18n.t("processUnit") : "Terminated " + killed.length + " process(es)";
        console.log("\x1B[36mi\x1B[0m " + msg);
      }
      process.exit(code);
    }
    module2.exports = {
      register,
      unregister,
      killAll,
      killOne,
      exitAll,
      isAlive,
      pidFile
    };
  }
});

// src/registry.js
var require_registry = __commonJS({
  "src/registry.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    function file() {
      return config.get("registryfile");
    }
    function load() {
      try {
        const d = JSON.parse(fs.readFileSync(file(), "utf8"));
        if (!d.packages) d.packages = {};
        return d;
      } catch (_) {
        return { version: 1, packages: {} };
      }
    }
    function save(d) {
      try {
        fs.mkdirSync(path2.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), JSON.stringify(d, null, 2) + "\n", "utf8");
      } catch (_) {
      }
    }
    function get(n) {
      return load().packages[n] || null;
    }
    function has(n) {
      return Boolean(get(n));
    }
    function add(n, info) {
      const d = load();
      d.packages[n] = Object.assign({}, d.packages[n], info, { name: n });
      save(d);
      return d.packages[n];
    }
    function remove(n) {
      const d = load();
      const existed = Boolean(d.packages[n]);
      delete d.packages[n];
      save(d);
      return existed;
    }
    function list() {
      return Object.values(load().packages).sort(function(a, b) {
        return String(a.name).localeCompare(String(b.name));
      });
    }
    module2.exports = { load, save, get, has, add, remove, list, file };
  }
});

// src/version.js
var require_version = __commonJS({
  "src/version.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var VERSION_FILE = config.get("versionfile");
    function parseVer(v) {
      if (!v) return [0, 0, 0, ""];
      const s = String(v).replace(/^v/i, "").trim();
      const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(.*)$/);
      if (!m) return [0, 0, 0, "", s];
      return [
        parseInt(m[1] || "0", 10),
        parseInt(m[2] || "0", 10),
        parseInt(m[3] || "0", 10),
        m[4] ? parseInt(m[4], 10) : 0,
        (m[5] || "").trim()
      ];
    }
    function compareVer(a, b) {
      const av = parseVer(a), bv = parseVer(b);
      for (let i = 0; i < 4; i++) {
        if (av[i] > bv[i]) return 1;
        if (av[i] < bv[i]) return -1;
      }
      if (av[4] && bv[4]) return av[4].localeCompare(bv[4]);
      if (av[4]) return 1;
      if (bv[4]) return -1;
      return 0;
    }
    function isValidVersion(v) {
      if (!v) return false;
      const s = String(v).replace(/^v/i, "");
      return /^\d+(?:\.\d+){0,3}(?:[.\-][\w]+)*$/.test(s);
    }
    function loadState() {
      try {
        const d = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
        if (!d.packages || typeof d.packages !== "object") d.packages = {};
        return d;
      } catch (_) {
        return { version: 1, packages: {} };
      }
    }
    function saveState(d) {
      d.version = 1;
      d.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      try {
        fs.mkdirSync(path2.dirname(VERSION_FILE), { recursive: true });
        fs.writeFileSync(VERSION_FILE, JSON.stringify(d, null, 2) + "\n", "utf8");
      } catch (_) {
      }
    }
    function getCurrent(name) {
      const d = loadState();
      if (name) return d.packages[name] || null;
      return null;
    }
    function setCurrent(name, ver) {
      const d = loadState();
      d.packages[name] = {
        version: ver,
        installedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      saveState(d);
    }
    function removeCurrent(name) {
      const d = loadState();
      delete d.packages[name];
      saveState(d);
    }
    function listInstalled() {
      const d = loadState();
      return Object.keys(d.packages).map(function(n) {
        return { name: n, version: d.packages[n].version, installedAt: d.packages[n].installedAt };
      }).sort(function(a, b) {
        return a.name.localeCompare(b.name);
      });
    }
    function getPkgVersion() {
      try {
        const pkg = JSON.parse(fs.readFileSync(path2.join(config.ROOT, "package.json"), "utf8"));
        return pkg.version || "0.0.0";
      } catch (_) {
        return "0.0.0";
      }
    }
    module2.exports = {
      parseVer,
      compareVer,
      isValidVersion,
      loadState,
      saveState,
      getCurrent,
      setCurrent,
      removeCurrent,
      listInstalled,
      getPkgVersion,
      VERSION_FILE
    };
  }
});

// src/pinyin.js
var require_pinyin = __commonJS({
  "src/pinyin.js"(exports2, module2) {
    "use strict";
    var PY = {
      "\u963F": "a",
      "\u7231": "a",
      "\u5B89": "a",
      "\u6309": "a",
      "\u50B2": "a",
      "\u5965": "a",
      "\u516B": "b",
      "\u628A": "b",
      "\u767D": "b",
      "\u767E": "b",
      "\u677F": "b",
      "\u529E": "b",
      "\u534A": "b",
      "\u5E2E": "b",
      "\u5305": "b",
      "\u5B9D": "b",
      "\u4FDD": "b",
      "\u62A5": "b",
      "\u66B4": "b",
      "\u5907": "b",
      "\u80CC": "b",
      "\u88AB": "b",
      "\u672C": "b",
      "\u6BD4": "b",
      "\u7B14": "b",
      "\u5E01": "b",
      "\u6BD5": "b",
      "\u8FB9": "b",
      "\u53D8": "b",
      "\u904D": "b",
      "\u6807": "b",
      "\u8868": "b",
      "\u522B": "b",
      "\u5BBE": "b",
      "\u51B0": "b",
      "\u75C5": "b",
      "\u6CE2": "b",
      "\u64AD": "b",
      "\u535A": "b",
      "\u8584": "b",
      "\u4E0D": "b",
      "\u5E03": "b",
      "\u6B65": "b",
      "\u90E8": "b",
      "\u624D": "c",
      "\u6750": "c",
      "\u8D22": "c",
      "\u91C7": "c",
      "\u5F69": "c",
      "\u83DC": "c",
      "\u53C2": "c",
      "\u9910": "c",
      "\u6B8B": "c",
      "\u4ED3": "c",
      "\u82CD": "c",
      "\u64CD": "c",
      "\u8349": "c",
      "\u518C": "c",
      "\u4FA7": "c",
      "\u6D4B": "c",
      "\u5C42": "c",
      "\u53C9": "c",
      "\u5DEE": "c",
      "\u63D2": "c",
      "\u5BDF": "c",
      "\u62C6": "c",
      "\u4EA7": "c",
      "\u957F": "c",
      "\u5E38": "c",
      "\u5382": "c",
      "\u573A": "c",
      "\u7545": "c",
      "\u8D85": "c",
      "\u671D": "c",
      "\u6F6E": "c",
      "\u8F66": "c",
      "\u5F7B": "c",
      "\u6C89": "c",
      "\u9648": "c",
      "\u886C": "c",
      "\u79F0": "c",
      "\u57CE": "c",
      "\u6210": "c",
      "\u5448": "c",
      "\u7A0B": "c",
      "\u627F": "c",
      "\u5403": "c",
      "\u6C60": "c",
      "\u8FDF": "c",
      "\u6301": "c",
      "\u5145": "c",
      "\u51B2": "c",
      "\u866B": "c",
      "\u62BD": "c",
      "\u4EC7": "c",
      "\u81ED": "c",
      "\u51FA": "c",
      "\u521D": "c",
      "\u9664": "c",
      "\u53A8": "c",
      "\u5904": "c",
      "\u4F20": "c",
      "\u8239": "c",
      "\u4E32": "c",
      "\u521B": "c",
      "\u7A97": "c",
      "\u5E8A": "c",
      "\u5439": "c",
      "\u6625": "c",
      "\u7EAF": "c",
      "\u8BCD": "c",
      "\u6B64": "c",
      "\u4ECE": "c",
      "\u7C97": "c",
      "\u4FC3": "c",
      "\u6751": "c",
      "\u5B58": "c",
      "\u9519": "c",
      "\u7B54": "d",
      "\u6253": "d",
      "\u5927": "d",
      "\u4EE3": "d",
      "\u5E26": "d",
      "\u5F85": "d",
      "\u5355": "d",
      "\u62C5": "d",
      "\u4F46": "d",
      "\u6DE1": "d",
      "\u5F39": "d",
      "\u5F53": "d",
      "\u6321": "d",
      "\u515A": "d",
      "\u5200": "d",
      "\u5BFC": "d",
      "\u5C9B": "d",
      "\u5230": "d",
      "\u5012": "d",
      "\u9053": "d",
      "\u7684": "d",
      "\u5F97": "d",
      "\u706F": "d",
      "\u767B": "d",
      "\u7B49": "d",
      "\u4F4E": "d",
      "\u654C": "d",
      "\u5E95": "d",
      "\u5730": "d",
      "\u7B2C": "d",
      "\u70B9": "d",
      "\u7535": "d",
      "\u57AB": "d",
      "\u5E97": "d",
      "\u8C03": "d",
      "\u6389": "d",
      "\u4E01": "d",
      "\u9876": "d",
      "\u5B9A": "d",
      "\u4E22": "d",
      "\u4E1C": "d",
      "\u51AC": "d",
      "\u61C2": "d",
      "\u52A8": "d",
      "\u90FD": "d",
      "\u8BFB": "d",
      "\u72EC": "d",
      "\u5EA6": "d",
      "\u77ED": "d",
      "\u6BB5": "d",
      "\u65AD": "d",
      "\u953B": "d",
      "\u961F": "d",
      "\u5BF9": "d",
      "\u5428": "d",
      "\u591A": "d",
      "\u593A": "d",
      "\u989D": "e",
      "\u6076": "e",
      "\u513F": "e",
      "\u800C": "e",
      "\u8033": "e",
      "\u4E8C": "e",
      "\u53D1": "f",
      "\u6CD5": "f",
      "\u7FFB": "f",
      "\u51E1": "f",
      "\u53CD": "f",
      "\u8FD4": "f",
      "\u996D": "f",
      "\u65B9": "f",
      "\u623F": "f",
      "\u9632": "f",
      "\u4EFF": "f",
      "\u8BBF": "f",
      "\u98DE": "f",
      "\u975E": "f",
      "\u5E9F": "f",
      "\u8D39": "f",
      "\u5206": "f",
      "\u4EFD": "f",
      "\u594B": "f",
      "\u4E30": "f",
      "\u98CE": "f",
      "\u5C01": "f",
      "\u75AF": "f",
      "\u5426": "f",
      "\u592B": "f",
      "\u670D": "f",
      "\u5E45": "f",
      "\u798F": "f",
      "\u5E9C": "f",
      "\u8F85": "f",
      "\u4ED8": "f",
      "\u5987": "f",
      "\u8D1F": "f",
      "\u590D": "f",
      "\u526F": "f",
      "\u5BCC": "f",
      "\u8BE5": "g",
      "\u6539": "g",
      "\u6982": "g",
      "\u5E72": "g",
      "\u7518": "g",
      "\u611F": "g",
      "\u521A": "g",
      "\u5C97": "g",
      "\u94A2": "g",
      "\u9AD8": "g",
      "\u641E": "g",
      "\u544A": "g",
      "\u54E5": "g",
      "\u6B4C": "g",
      "\u683C": "g",
      "\u9694": "g",
      "\u4E2A": "g",
      "\u5404": "g",
      "\u7ED9": "g",
      "\u6839": "g",
      "\u8DDF": "g",
      "\u66F4": "g",
      "\u5DE5": "g",
      "\u516C": "g",
      "\u529F": "g",
      "\u653B": "g",
      "\u4F9B": "g",
      "\u5171": "g",
      "\u4F30": "g",
      "\u5B64": "g",
      "\u53E4": "g",
      "\u80A1": "g",
      "\u9F13": "g",
      "\u6545": "g",
      "\u56FA": "g",
      "\u74DC": "g",
      "\u6302": "g",
      "\u5173": "g",
      "\u89C2": "g",
      "\u5B98": "g",
      "\u7BA1": "g",
      "\u60EF": "g",
      "\u5149": "g",
      "\u5E7F": "g",
      "\u89C4": "g",
      "\u5F52": "g",
      "\u8D35": "g",
      "\u56FD": "g",
      "\u679C": "g",
      "\u8FC7": "g",
      "\u54C8": "h",
      "\u5B69": "h",
      "\u6D77": "h",
      "\u542B": "h",
      "\u5BD2": "h",
      "\u558A": "h",
      "\u6C49": "h",
      "\u6C57": "h",
      "\u884C": "h",
      "\u822A": "h",
      "\u597D": "h",
      "\u53F7": "h",
      "\u6D69": "h",
      "\u5408": "h",
      "\u6CB3": "h",
      "\u6838": "h",
      "\u548C": "h",
      "\u4F55": "h",
      "\u9ED1": "h",
      "\u5F88": "h",
      "\u6068": "h",
      "\u7EA2": "h",
      "\u6D2A": "h",
      "\u7334": "h",
      "\u540E": "h",
      "\u539A": "h",
      "\u547C": "h",
      "\u6E56": "h",
      "\u80E1": "h",
      "\u864E": "h",
      "\u4E92": "h",
      "\u6237": "h",
      "\u82B1": "h",
      "\u534E": "h",
      "\u6ED1": "h",
      "\u5316": "h",
      "\u753B": "h",
      "\u8BDD": "h",
      "\u6000": "h",
      "\u574F": "h",
      "\u6B22": "h",
      "\u8FD8": "h",
      "\u73AF": "h",
      "\u7F13": "h",
      "\u6362": "h",
      "\u5524": "h",
      "\u8352": "h",
      "\u9EC4": "h",
      "\u7687": "h",
      "\u7070": "h",
      "\u6062": "h",
      "\u56DE": "h",
      "\u6094": "h",
      "\u4F1A": "h",
      "\u6C47": "h",
      "\u7ED8": "h",
      "\u6D51": "h",
      "\u6D3B": "h",
      "\u706B": "h",
      "\u6216": "h",
      "\u8D27": "h",
      "\u83B7": "h",
      "\u51FB": "j",
      "\u673A": "j",
      "\u79EF": "j",
      "\u57FA": "j",
      "\u6FC0": "j",
      "\u53CA": "j",
      "\u5409": "j",
      "\u5373": "j",
      "\u6781": "j",
      "\u6025": "j",
      "\u96C6": "j",
      "\u7EA7": "j",
      "\u6324": "j",
      "\u51E0": "j",
      "\u5DF1": "j",
      "\u8BA1": "j",
      "\u8BB0": "j",
      "\u7EAA": "j",
      "\u6280": "j",
      "\u9645": "j",
      "\u5242": "j",
      "\u5B63": "j",
      "\u65E2": "j",
      "\u7EE7": "j",
      "\u5BC4": "j",
      "\u52A0": "j",
      "\u5939": "j",
      "\u4F73": "j",
      "\u5BB6": "j",
      "\u7532": "j",
      "\u4EF7": "j",
      "\u9A7E": "j",
      "\u67B6": "j",
      "\u5047": "j",
      "\u5AC1": "j",
      "\u5C16": "j",
      "\u575A": "j",
      "\u95F4": "j",
      "\u80A9": "j",
      "\u8270": "j",
      "\u76D1": "j",
      "\u517C": "j",
      "\u51CF": "j",
      "\u68C0": "j",
      "\u7B80": "j",
      "\u89C1": "j",
      "\u4EF6": "j",
      "\u5EFA": "j",
      "\u5065": "j",
      "\u8230": "j",
      "\u6E10": "j",
      "\u8DF5": "j",
      "\u6C5F": "j",
      "\u5C06": "j",
      "\u8BB2": "j",
      "\u5956": "j",
      "\u964D": "j",
      "\u4EA4": "j",
      "\u90CA": "j",
      "\u5A07": "j",
      "\u9A84": "j",
      "\u80F6": "j",
      "\u89D2": "j",
      "\u811A": "j",
      "\u53EB": "j",
      "\u6559": "j",
      "\u9636": "j",
      "\u7686": "j",
      "\u63A5": "j",
      "\u8857": "j",
      "\u8282": "j",
      "\u7ED3": "j",
      "\u622A": "j",
      "\u59D0": "j",
      "\u89E3": "j",
      "\u4ECB": "j",
      "\u754C": "j",
      "\u501F": "j",
      "\u5DFE": "j",
      "\u4ECA": "j",
      "\u65A4": "j",
      "\u91D1": "j",
      "\u4EC5": "j",
      "\u7D27": "j",
      "\u8FD1": "j",
      "\u8FDB": "j",
      "\u52B2": "j",
      "\u7981": "j",
      "\u4EAC": "j",
      "\u7ECF": "j",
      "\u60CA": "j",
      "\u7CBE": "j",
      "\u4E95": "j",
      "\u666F": "j",
      "\u8B66": "j",
      "\u51C0": "j",
      "\u7ADE": "j",
      "\u7ADF": "j",
      "\u656C": "j",
      "\u9759": "j",
      "\u5883": "j",
      "\u7A76": "j",
      "\u4E5D": "j",
      "\u4E45": "j",
      "\u9152": "j",
      "\u65E7": "j",
      "\u6551": "j",
      "\u5C31": "j",
      "\u5C45": "j",
      "\u5C40": "j",
      "\u4E3E": "j",
      "\u5DE8": "j",
      "\u62D2": "j",
      "\u5177": "j",
      "\u5267": "j",
      "\u636E": "j",
      "\u8DDD": "j",
      "\u805A": "j",
      "\u5377": "j",
      "\u51B3": "j",
      "\u7EDD": "j",
      "\u519B": "j",
      "\u5747": "j",
      "\u5361": "k",
      "\u5F00": "k",
      "\u770B": "k",
      "\u5EB7": "k",
      "\u6297": "k",
      "\u8003": "k",
      "\u9760": "k",
      "\u79D1": "k",
      "\u9897": "k",
      "\u53EF": "k",
      "\u514B": "k",
      "\u523B": "k",
      "\u5BA2": "k",
      "\u8BFE": "k",
      "\u80AF": "k",
      "\u7A7A": "k",
      "\u5B54": "k",
      "\u6050": "k",
      "\u63A7": "k",
      "\u53E3": "k",
      "\u6263": "k",
      "\u54ED": "k",
      "\u82E6": "k",
      "\u5E93": "k",
      "\u5757": "k",
      "\u5FEB": "k",
      "\u5BBD": "k",
      "\u6B3E": "k",
      "\u72C2": "k",
      "\u77FF": "k",
      "\u51B5": "k",
      "\u56F0": "k",
      "\u6269": "k",
      "\u62C9": "l",
      "\u6765": "l",
      "\u5170": "l",
      "\u680F": "l",
      "\u84DD": "l",
      "\u89C8": "l",
      "\u61D2": "l",
      "\u70C2": "l",
      "\u72FC": "l",
      "\u6717": "l",
      "\u6D6A": "l",
      "\u52B3": "l",
      "\u7262": "l",
      "\u8001": "l",
      "\u4E50": "l",
      "\u96F7": "l",
      "\u7D2F": "l",
      "\u6CEA": "l",
      "\u7C7B": "l",
      "\u51B7": "l",
      "\u79BB": "l",
      "\u674E": "l",
      "\u91CC": "l",
      "\u7406": "l",
      "\u529B": "l",
      "\u5386": "l",
      "\u5389": "l",
      "\u7ACB": "l",
      "\u5229": "l",
      "\u4F8B": "l",
      "\u96B6": "l",
      "\u7C92": "l",
      "\u8FDE": "l",
      "\u83B2": "l",
      "\u8054": "l",
      "\u5EC9": "l",
      "\u8138": "l",
      "\u7EC3": "l",
      "\u70BC": "l",
      "\u826F": "l",
      "\u51C9": "l",
      "\u6881": "l",
      "\u91CF": "l",
      "\u4E24": "l",
      "\u4EAE": "l",
      "\u8C05": "l",
      "\u7597": "l",
      "\u8FBD": "l",
      "\u4E86": "l",
      "\u6599": "l",
      "\u5217": "l",
      "\u52A3": "l",
      "\u70C8": "l",
      "\u730E": "l",
      "\u88C2": "l",
      "\u90BB": "l",
      "\u6797": "l",
      "\u4E34": "l",
      "\u7075": "l",
      "\u94C3": "l",
      "\u96F6": "l",
      "\u9886": "l",
      "\u4EE4": "l",
      "\u53E6": "l",
      "\u6D41": "l",
      "\u7559": "l",
      "\u516D": "l",
      "\u9F99": "l",
      "\u697C": "l",
      "\u6F0F": "l",
      "\u9732": "l",
      "\u5F55": "l",
      "\u9646": "l",
      "\u8DEF": "l",
      "\u4E71": "l",
      "\u8BBA": "l",
      "\u7F57": "l",
      "\u843D": "l",
      "\u5F8B": "l",
      "\u7387": "l",
      "\u7EFF": "l",
      "\u8651": "l",
      "\u6EE4": "l",
      "\u7565": "l",
      "\u8F6E": "l",
      "\u5988": "m",
      "\u9EBB": "m",
      "\u9A6C": "m",
      "\u7801": "m",
      "\u57CB": "m",
      "\u4E70": "m",
      "\u9EA6": "m",
      "\u5356": "m",
      "\u6EE1": "m",
      "\u6162": "m",
      "\u5FD9": "m",
      "\u732B": "m",
      "\u6BDB": "m",
      "\u77DB": "m",
      "\u8C8C": "m",
      "\u4E48": "m",
      "\u6CA1": "m",
      "\u7709": "m",
      "\u5A92": "m",
      "\u6BCF": "m",
      "\u7F8E": "m",
      "\u59B9": "m",
      "\u95E8": "m",
      "\u95F7": "m",
      "\u4EEC": "m",
      "\u731B": "m",
      "\u68A6": "m",
      "\u8FF7": "m",
      "\u7C73": "m",
      "\u5BC6": "m",
      "\u871C": "m",
      "\u514D": "m",
      "\u52C9": "m",
      "\u9762": "m",
      "\u79D2": "m",
      "\u6C11": "m",
      "\u654F": "m",
      "\u540D": "m",
      "\u660E": "m",
      "\u547D": "m",
      "\u6478": "m",
      "\u6A21": "m",
      "\u6469": "m",
      "\u78E8": "m",
      "\u62B9": "m",
      "\u672B": "m",
      "\u964C": "m",
      "\u83AB": "m",
      "\u58A8": "m",
      "\u9ED8": "m",
      "\u8C0B": "m",
      "\u67D0": "m",
      "\u6BCD": "m",
      "\u4EA9": "m",
      "\u6728": "m",
      "\u76EE": "m",
      "\u7267": "m",
      "\u5893": "m",
      "\u5E55": "m",
      "\u6155": "m",
      "\u7A46": "m",
      "\u62FF": "n",
      "\u54EA": "n",
      "\u90A3": "n",
      "\u7EB3": "n",
      "\u4E43": "n",
      "\u5976": "n",
      "\u8010": "n",
      "\u7537": "n",
      "\u5357": "n",
      "\u96BE": "n",
      "\u56CA": "n",
      "\u8111": "n",
      "\u95F9": "n",
      "\u5462": "n",
      "\u5185": "n",
      "\u80FD": "n",
      "\u5C3C": "n",
      "\u4F60": "n",
      "\u6CE5": "n",
      "\u5E74": "n",
      "\u5FF5": "n",
      "\u5A18": "n",
      "\u60A8": "n",
      "\u5B81": "n",
      "\u725B": "n",
      "\u519C": "n",
      "\u5F04": "n",
      "\u5974": "n",
      "\u52AA": "n",
      "\u6012": "n",
      "\u5973": "n",
      "\u6696": "n",
      "\u8BFA": "n",
      "\u54E6": "o",
      "\u6B27": "o",
      "\u5076": "o",
      "\u722C": "p",
      "\u6015": "p",
      "\u62CD": "p",
      "\u6392": "p",
      "\u724C": "p",
      "\u6D3E": "p",
      "\u76D8": "p",
      "\u5224": "p",
      "\u53DB": "p",
      "\u76FC": "p",
      "\u65C1": "p",
      "\u80D6": "p",
      "\u629B": "p",
      "\u8DD1": "p",
      "\u6CE1": "p",
      "\u966A": "p",
      "\u57F9": "p",
      "\u8D54": "p",
      "\u4F69": "p",
      "\u914D": "p",
      "\u55B7": "p",
      "\u670B": "p",
      "\u84EC": "p",
      "\u78B0": "p",
      "\u6279": "p",
      "\u62AB": "p",
      "\u76AE": "p",
      "\u75B2": "p",
      "\u5339": "p",
      "\u504F": "p",
      "\u7BC7": "p",
      "\u9A97": "p",
      "\u6F02": "p",
      "\u7968": "p",
      "\u62FC": "p",
      "\u8D2B": "p",
      "\u54C1": "p",
      "\u5E73": "p",
      "\u8BC4": "p",
      "\u51ED": "p",
      "\u74F6": "p",
      "\u5761": "p",
      "\u6CFC": "p",
      "\u7834": "p",
      "\u9B44": "p",
      "\u5256": "p",
      "\u6251": "p",
      "\u94FA": "p",
      "\u666E": "p",
      "\u4E03": "q",
      "\u59BB": "q",
      "\u5176": "q",
      "\u5947": "q",
      "\u9A91": "q",
      "\u68CB": "q",
      "\u65D7": "q",
      "\u4E5E": "q",
      "\u4F01": "q",
      "\u542F": "q",
      "\u8D77": "q",
      "\u6C14": "q",
      "\u5F03": "q",
      "\u6C7D": "q",
      "\u5668": "q",
      "\u6070": "q",
      "\u5343": "q",
      "\u8FC1": "q",
      "\u7275": "q",
      "\u94C5": "q",
      "\u8C26": "q",
      "\u7B7E": "q",
      "\u524D": "q",
      "\u94B1": "q",
      "\u6F5C": "q",
      "\u6D45": "q",
      "\u9063": "q",
      "\u6B20": "q",
      "\u67AA": "q",
      "\u5F3A": "q",
      "\u5899": "q",
      "\u62A2": "q",
      "\u6084": "q",
      "\u6572": "q",
      "\u6865": "q",
      "\u77A7": "q",
      "\u5DE7": "q",
      "\u5207": "q",
      "\u4E14": "q",
      "\u7A83": "q",
      "\u4EB2": "q",
      "\u4FB5": "q",
      "\u52E4": "q",
      "\u9752": "q",
      "\u8F7B": "q",
      "\u6C22": "q",
      "\u503E": "q",
      "\u6E05": "q",
      "\u60C5": "q",
      "\u6674": "q",
      "\u9877": "q",
      "\u8BF7": "q",
      "\u5E86": "q",
      "\u7A77": "q",
      "\u4E18": "q",
      "\u79CB": "q",
      "\u6C42": "q",
      "\u7403": "q",
      "\u533A": "q",
      "\u66F2": "q",
      "\u9A71": "q",
      "\u5C48": "q",
      "\u8D8B": "q",
      "\u6E20": "q",
      "\u53D6": "q",
      "\u53BB": "q",
      "\u5168": "q",
      "\u6743": "q",
      "\u529D": "q",
      "\u7F3A": "q",
      "\u5374": "q",
      "\u7FA4": "q",
      "\u7136": "r",
      "\u71C3": "r",
      "\u67D3": "r",
      "\u56B7": "r",
      "\u8BA9": "r",
      "\u9976": "r",
      "\u6270": "r",
      "\u7ED5": "r",
      "\u60F9": "r",
      "\u70ED": "r",
      "\u4EBA": "r",
      "\u4EC1": "r",
      "\u5FCD": "r",
      "\u8BA4": "r",
      "\u4EFB": "r",
      "\u6254": "r",
      "\u4ECD": "r",
      "\u65E5": "r",
      "\u8363": "r",
      "\u5BB9": "r",
      "\u6EB6": "r",
      "\u878D": "r",
      "\u67D4": "r",
      "\u8089": "r",
      "\u5982": "r",
      "\u8FB1": "r",
      "\u5165": "r",
      "\u8F6F": "r",
      "\u9510": "r",
      "\u6DA6": "r",
      "\u82E5": "r",
      "\u5F31": "r",
      "\u6492": "s",
      "\u6D12": "s",
      "\u585E": "s",
      "\u8D5B": "s",
      "\u4E09": "s",
      "\u6563": "s",
      "\u6851": "s",
      "\u55D3": "s",
      "\u626B": "s",
      "\u8272": "s",
      "\u6740": "s",
      "\u6C99": "s",
      "\u50BB": "s",
      "\u6652": "s",
      "\u5C71": "s",
      "\u5220": "s",
      "\u95EA": "s",
      "\u6247": "s",
      "\u5584": "s",
      "\u4F24": "s",
      "\u5546": "s",
      "\u4E0A": "s",
      "\u5C1A": "s",
      "\u70E7": "s",
      "\u5C11": "s",
      "\u7ECD": "s",
      "\u820C": "s",
      "\u86C7": "s",
      "\u820D": "s",
      "\u8BBE": "s",
      "\u793E": "s",
      "\u5C04": "s",
      "\u6D89": "s",
      "\u4F38": "s",
      "\u8EAB": "s",
      "\u6DF1": "s",
      "\u795E": "s",
      "\u5BA1": "s",
      "\u5A76": "s",
      "\u80BE": "s",
      "\u751A": "s",
      "\u6E17": "s",
      "\u614E": "s",
      "\u5347": "s",
      "\u751F": "s",
      "\u58F0": "s",
      "\u80DC": "s",
      "\u7525": "s",
      "\u7EF3": "s",
      "\u7701": "s",
      "\u5723": "s",
      "\u5E08": "s",
      "\u5931": "s",
      "\u65BD": "s",
      "\u6E7F": "s",
      "\u5341": "s",
      "\u77F3": "s",
      "\u65F6": "s",
      "\u8BC6": "s",
      "\u5B9E": "s",
      "\u62FE": "s",
      "\u98DF": "s",
      "\u53F2": "s",
      "\u4F7F": "s",
      "\u59CB": "s",
      "\u9A76": "s",
      "\u58EB": "s",
      "\u6C0F": "s",
      "\u793A": "s",
      "\u4E16": "s",
      "\u5E02": "s",
      "\u5F0F": "s",
      "\u4E8B": "s",
      "\u4F8D": "s",
      "\u52BF": "s",
      "\u89C6": "s",
      "\u8BD5": "s",
      "\u9970": "s",
      "\u5BA4": "s",
      "\u662F": "s",
      "\u9002": "s",
      "\u901D": "s",
      "\u91CA": "s",
      "\u6536": "s",
      "\u624B": "s",
      "\u5B88": "s",
      "\u9996": "s",
      "\u5BFF": "s",
      "\u53D7": "s",
      "\u517D": "s",
      "\u6388": "s",
      "\u552E": "s",
      "\u7626": "s",
      "\u4E66": "s",
      "\u53D4": "s",
      "\u6B8A": "s",
      "\u8212": "s",
      "\u758F": "s",
      "\u8F93": "s",
      "\u719F": "s",
      "\u6691": "s",
      "\u5C5E": "s",
      "\u7F72": "s",
      "\u9F20": "s",
      "\u6570": "s",
      "\u672F": "s",
      "\u675F": "s",
      "\u8FF0": "s",
      "\u6811": "s",
      "\u7AD6": "s",
      "\u5237": "s",
      "\u8870": "s",
      "\u5E05": "s",
      "\u53CC": "s",
      "\u8C01": "s",
      "\u6C34": "s",
      "\u7761": "s",
      "\u7A0E": "s",
      "\u987A": "s",
      "\u8BF4": "s",
      "\u7855": "s",
      "\u4E1D": "s",
      "\u53F8": "s",
      "\u79C1": "s",
      "\u601D": "s",
      "\u65AF": "s",
      "\u6B7B": "s",
      "\u56DB": "s",
      "\u5BFA": "s",
      "\u4F3C": "s",
      "\u677E": "s",
      "\u5B8B": "s",
      "\u9001": "s",
      "\u8BF5": "s",
      "\u641C": "s",
      "\u8258": "s",
      "\u82CF": "s",
      "\u4FD7": "s",
      "\u8BC9": "s",
      "\u7D20": "s",
      "\u901F": "s",
      "\u5BBF": "s",
      "\u5851": "s",
      "\u9178": "s",
      "\u7B97": "s",
      "\u867D": "s",
      "\u968F": "s",
      "\u5C81": "s",
      "\u788E": "s",
      "\u7A57": "s",
      "\u5B59": "s",
      "\u635F": "s",
      "\u7F29": "s",
      "\u6240": "s",
      "\u7D22": "s",
      "\u9501": "s",
      "\u4ED6": "t",
      "\u5B83": "t",
      "\u5979": "t",
      "\u584C": "t",
      "\u5854": "t",
      "\u53F0": "t",
      "\u62AC": "t",
      "\u592A": "t",
      "\u6001": "t",
      "\u6CF0": "t",
      "\u8D2A": "t",
      "\u644A": "t",
      "\u6EE9": "t",
      "\u575B": "t",
      "\u8C08": "t",
      "\u75F0": "t",
      "\u5766": "t",
      "\u6BEF": "t",
      "\u53F9": "t",
      "\u70AD": "t",
      "\u63A2": "t",
      "\u78B3": "t",
      "\u6C64": "t",
      "\u5510": "t",
      "\u5802": "t",
      "\u7CD6": "t",
      "\u8EBA": "t",
      "\u6D9B": "t",
      "\u9003": "t",
      "\u6843": "t",
      "\u9676": "t",
      "\u8BA8": "t",
      "\u5957": "t",
      "\u7279": "t",
      "\u75BC": "t",
      "\u817E": "t",
      "\u68AF": "t",
      "\u8E22": "t",
      "\u63D0": "t",
      "\u9898": "t",
      "\u8E44": "t",
      "\u4F53": "t",
      "\u5243": "t",
      "\u66FF": "t",
      "\u5929": "t",
      "\u6DFB": "t",
      "\u7530": "t",
      "\u751C": "t",
      "\u586B": "t",
      "\u6311": "t",
      "\u6761": "t",
      "\u8DF3": "t",
      "\u8D34": "t",
      "\u94C1": "t",
      "\u5385": "t",
      "\u542C": "t",
      "\u4EAD": "t",
      "\u505C": "t",
      "\u633A": "t",
      "\u901A": "t",
      "\u540C": "t",
      "\u94DC": "t",
      "\u7AE5": "t",
      "\u7EDF": "t",
      "\u75DB": "t",
      "\u5077": "t",
      "\u5934": "t",
      "\u6295": "t",
      "\u900F": "t",
      "\u7A81": "t",
      "\u56FE": "t",
      "\u5F92": "t",
      "\u9014": "t",
      "\u6D82": "t",
      "\u571F": "t",
      "\u5410": "t",
      "\u5154": "t",
      "\u56E2": "t",
      "\u63A8": "t",
      "\u817F": "t",
      "\u9000": "t",
      "\u541E": "t",
      "\u6258": "t",
      "\u62D6": "t",
      "\u8131": "t",
      "\u9A7C": "t",
      "\u59A5": "t",
      "\u62D3": "t",
      "\u6316": "w",
      "\u5A03": "w",
      "\u74E6": "w",
      "\u6B6A": "w",
      "\u5916": "w",
      "\u5F2F": "w",
      "\u73A9": "w",
      "\u987D": "w",
      "\u4E38": "w",
      "\u5B8C": "w",
      "\u665A": "w",
      "\u7897": "w",
      "\u4E07": "w",
      "\u738B": "w",
      "\u7F51": "w",
      "\u5F80": "w",
      "\u5FD8": "w",
      "\u65FA": "w",
      "\u671B": "w",
      "\u5371": "w",
      "\u5A01": "w",
      "\u5FAE": "w",
      "\u4E3A": "w",
      "\u56F4": "w",
      "\u8FDD": "w",
      "\u552F": "w",
      "\u7EF4": "w",
      "\u4F1F": "w",
      "\u4F2A": "w",
      "\u5C3E": "w",
      "\u59D4": "w",
      "\u536B": "w",
      "\u672A": "w",
      "\u4F4D": "w",
      "\u5473": "w",
      "\u754F": "w",
      "\u80C3": "w",
      "\u8C13": "w",
      "\u5582": "w",
      "\u9B4F": "w",
      "\u6E29": "w",
      "\u6587": "w",
      "\u95FB": "w",
      "\u7EB9": "w",
      "\u543B": "w",
      "\u7A33": "w",
      "\u95EE": "w",
      "\u7FC1": "w",
      "\u7A9D": "w",
      "\u6211": "w",
      "\u63E1": "w",
      "\u6C83": "w",
      "\u5367": "w",
      "\u6C61": "w",
      "\u5C4B": "w",
      "\u65E0": "w",
      "\u5434": "w",
      "\u4E94": "w",
      "\u5348": "w",
      "\u4F0D": "w",
      "\u6B66": "w",
      "\u821E": "w",
      "\u52A1": "w",
      "\u7269": "w",
      "\u8BEF": "w",
      "\u96FE": "w",
      "\u5915": "x",
      "\u897F": "x",
      "\u5438": "x",
      "\u5E0C": "x",
      "\u6790": "x",
      "\u606F": "x",
      "\u6089": "x",
      "\u60DC": "x",
      "\u7A00": "x",
      "\u6EAA": "x",
      "\u7184": "x",
      "\u819D": "x",
      "\u4E60": "x",
      "\u5E2D": "x",
      "\u88AD": "x",
      "\u5AB3": "x",
      "\u6D17": "x",
      "\u559C": "x",
      "\u7CFB": "x",
      "\u7EC6": "x",
      "\u9699": "x",
      "\u867E": "x",
      "\u778E": "x",
      "\u5CE1": "x",
      "\u72ED": "x",
      "\u971E": "x",
      "\u4E0B": "x",
      "\u5413": "x",
      "\u590F": "x",
      "\u4ED9": "x",
      "\u5148": "x",
      "\u7EA4": "x",
      "\u6380": "x",
      "\u9C9C": "x",
      "\u95F2": "x",
      "\u5F26": "x",
      "\u8D24": "x",
      "\u54B8": "x",
      "\u8854": "x",
      "\u5ACC": "x",
      "\u663E": "x",
      "\u9669": "x",
      "\u73B0": "x",
      "\u53BF": "x",
      "\u9650": "x",
      "\u7EBF": "x",
      "\u5BAA": "x",
      "\u9677": "x",
      "\u732E": "x",
      "\u817A": "x",
      "\u4E61": "x",
      "\u76F8": "x",
      "\u9999": "x",
      "\u7BB1": "x",
      "\u8BE6": "x",
      "\u60F3": "x",
      "\u54CD": "x",
      "\u4EAB": "x",
      "\u9879": "x",
      "\u8C61": "x",
      "\u50CF": "x",
      "\u6A61": "x",
      "\u6D88": "x",
      "\u9500": "x",
      "\u5C0F": "x",
      "\u6653": "x",
      "\u5B5D": "x",
      "\u6821": "x",
      "\u7B11": "x",
      "\u6548": "x",
      "\u4E9B": "x",
      "\u6B47": "x",
      "\u534F": "x",
      "\u90AA": "x",
      "\u80C1": "x",
      "\u659C": "x",
      "\u8C10": "x",
      "\u643A": "x",
      "\u978B": "x",
      "\u5199": "x",
      "\u6CC4": "x",
      "\u6CFB": "x",
      "\u8C22": "x",
      "\u68B0": "x",
      "\u5378": "x",
      "\u5C51": "x",
      "\u5FC3": "x",
      "\u8F9B": "x",
      "\u6B23": "x",
      "\u65B0": "x",
      "\u85AA": "x",
      "\u4FE1": "x",
      "\u5174": "x",
      "\u661F": "x",
      "\u5211": "x",
      "\u5F62": "x",
      "\u578B": "x",
      "\u9192": "x",
      "\u59D3": "x",
      "\u5E78": "x",
      "\u6027": "x",
      "\u51F6": "x",
      "\u5144": "x",
      "\u80F8": "x",
      "\u96C4": "x",
      "\u718A": "x",
      "\u4F11": "x",
      "\u4FEE": "x",
      "\u7F9E": "x",
      "\u673D": "x",
      "\u79C0": "x",
      "\u7EE3": "x",
      "\u8896": "x",
      "\u9700": "x",
      "\u987B": "x",
      "\u5F90": "x",
      "\u8BB8": "x",
      "\u5E8F": "x",
      "\u53D9": "x",
      "\u755C": "x",
      "\u84C4": "x",
      "\u5BA3": "x",
      "\u60AC": "x",
      "\u65CB": "x",
      "\u9009": "x",
      "\u7A74": "x",
      "\u5B66": "x",
      "\u96EA": "x",
      "\u8840": "x",
      "\u5BFB": "x",
      "\u5DE1": "x",
      "\u8BE2": "x",
      "\u5FAA": "x",
      "\u8BAD": "x",
      "\u8FC5": "x",
      "\u900A": "x",
      "\u538B": "y",
      "\u5440": "y",
      "\u62BC": "y",
      "\u9E26": "y",
      "\u7259": "y",
      "\u82BD": "y",
      "\u5D16": "y",
      "\u54D1": "y",
      "\u4E9A": "y",
      "\u70DF": "y",
      "\u6DF9": "y",
      "\u4E25": "y",
      "\u8A00": "y",
      "\u5CA9": "y",
      "\u6CBF": "y",
      "\u708E": "y",
      "\u7814": "y",
      "\u76D0": "y",
      "\u989C": "y",
      "\u884D": "y",
      "\u63A9": "y",
      "\u773C": "y",
      "\u6F14": "y",
      "\u538C": "y",
      "\u5BB4": "y",
      "\u9A8C": "y",
      "\u96C1": "y",
      "\u7130": "y",
      "\u71D5": "y",
      "\u592E": "y",
      "\u626C": "y",
      "\u7F8A": "y",
      "\u9633": "y",
      "\u6768": "y",
      "\u6D0B": "y",
      "\u4EF0": "y",
      "\u517B": "y",
      "\u6837": "y",
      "\u6C27": "y",
      "\u75D2": "y",
      "\u6447": "y",
      "\u9065": "y",
      "\u54AC": "y",
      "\u836F": "y",
      "\u8981": "y",
      "\u8000": "y",
      "\u7237": "y",
      "\u4E5F": "y",
      "\u51B6": "y",
      "\u91CE": "y",
      "\u4E1A": "y",
      "\u53F6": "y",
      "\u9875": "y",
      "\u591C": "y",
      "\u6DB2": "y",
      "\u4E00": "y",
      "\u533B": "y",
      "\u4F9D": "y",
      "\u4EEA": "y",
      "\u5B9C": "y",
      "\u59E8": "y",
      "\u79FB": "y",
      "\u9057": "y",
      "\u7591": "y",
      "\u4E59": "y",
      "\u5DF2": "y",
      "\u4EE5": "y",
      "\u6905": "y",
      "\u4E49": "y",
      "\u5FC6": "y",
      "\u827A": "y",
      "\u8BAE": "y",
      "\u4EA6": "y",
      "\u5F02": "y",
      "\u5F79": "y",
      "\u6291": "y",
      "\u8BD1": "y",
      "\u6613": "y",
      "\u75AB": "y",
      "\u76CA": "y",
      "\u8C0A": "y",
      "\u610F": "y",
      "\u6EA2": "y",
      "\u6BC5": "y",
      "\u56E0": "y",
      "\u9634": "y",
      "\u97F3": "y",
      "\u94F6": "y",
      "\u5F15": "y",
      "\u996E": "y",
      "\u9690": "y",
      "\u5370": "y",
      "\u5E94": "y",
      "\u82F1": "y",
      "\u5A74": "y",
      "\u8FCE": "y",
      "\u76C8": "y",
      "\u8425": "y",
      "\u8747": "y",
      "\u8D62": "y",
      "\u5F71": "y",
      "\u6620": "y",
      "\u786C": "y",
      "\u54DF": "y",
      "\u62E5": "y",
      "\u6C38": "y",
      "\u6CF3": "y",
      "\u52C7": "y",
      "\u6D8C": "y",
      "\u7528": "y",
      "\u4F18": "y",
      "\u5FE7": "y",
      "\u5C24": "y",
      "\u7531": "y",
      "\u90AE": "y",
      "\u72B9": "y",
      "\u6CB9": "y",
      "\u6E38": "y",
      "\u53CB": "y",
      "\u6709": "y",
      "\u53C8": "y",
      "\u53F3": "y",
      "\u5E7C": "y",
      "\u8BF1": "y",
      "\u4E8E": "y",
      "\u4E88": "y",
      "\u4F59": "y",
      "\u9C7C": "y",
      "\u5A31": "y",
      "\u6E14": "y",
      "\u6109": "y",
      "\u8206": "y",
      "\u4E0E": "y",
      "\u5B87": "y",
      "\u7FBD": "y",
      "\u96E8": "y",
      "\u8BED": "y",
      "\u7389": "y",
      "\u80B2": "y",
      "\u90C1": "y",
      "\u6D74": "y",
      "\u9884": "y",
      "\u57DF": "y",
      "\u6B32": "y",
      "\u9047": "y",
      "\u55BB": "y",
      "\u5FA1": "y",
      "\u6108": "y",
      "\u8A89": "y",
      "\u8C6B": "y",
      "\u5143": "y",
      "\u56ED": "y",
      "\u5458": "y",
      "\u539F": "y",
      "\u5706": "y",
      "\u63F4": "y",
      "\u7F18": "y",
      "\u6E90": "y",
      "\u8FDC": "y",
      "\u6028": "y",
      "\u9662": "y",
      "\u613F": "y",
      "\u66F0": "y",
      "\u7EA6": "y",
      "\u6708": "y",
      "\u60A6": "y",
      "\u9605": "y",
      "\u8D8A": "y",
      "\u4E91": "y",
      "\u5300": "y",
      "\u5141": "y",
      "\u8FD0": "y",
      "\u5B55": "y",
      "\u6655": "y",
      "\u97F5": "y",
      "\u6742": "z",
      "\u707E": "z",
      "\u683D": "z",
      "\u5BB0": "z",
      "\u518D": "z",
      "\u5728": "z",
      "\u54B1": "z",
      "\u6512": "z",
      "\u6682": "z",
      "\u8D5E": "z",
      "\u810F": "z",
      "\u846C": "z",
      "\u906D": "z",
      "\u7CDF": "z",
      "\u65E9": "z",
      "\u67A3": "z",
      "\u6FA1": "z",
      "\u7076": "z",
      "\u9020": "z",
      "\u566A": "z",
      "\u71E5": "z",
      "\u8E81": "z",
      "\u8D23": "z",
      "\u62E9": "z",
      "\u5219": "z",
      "\u6CFD": "z",
      "\u8D3C": "z",
      "\u600E": "z",
      "\u589E": "z",
      "\u618E": "z",
      "\u8D60": "z",
      "\u624E": "z",
      "\u6E23": "z",
      "\u7728": "z",
      "\u70B8": "z",
      "\u6458": "z",
      "\u5B85": "z",
      "\u7A84": "z",
      "\u503A": "z",
      "\u5BE8": "z",
      "\u6CBE": "z",
      "\u7C98": "z",
      "\u5C55": "z",
      "\u5360": "z",
      "\u6218": "z",
      "\u7AD9": "z",
      "\u5F20": "z",
      "\u7AE0": "z",
      "\u6DA8": "z",
      "\u638C": "z",
      "\u4E08": "z",
      "\u5E10": "z",
      "\u8D26": "z",
      "\u80C0": "z",
      "\u969C": "z",
      "\u62DB": "z",
      "\u627E": "z",
      "\u53EC": "z",
      "\u5146": "z",
      "\u7167": "z",
      "\u7F69": "z",
      "\u906E": "z",
      "\u6298": "z",
      "\u54F2": "z",
      "\u8005": "z",
      "\u8FD9": "z",
      "\u6D59": "z",
      "\u9488": "z",
      "\u4FA6": "z",
      "\u73CD": "z",
      "\u771F": "z",
      "\u8BCA": "z",
      "\u9635": "z",
      "\u632F": "z",
      "\u9707": "z",
      "\u9547": "z",
      "\u4E89": "z",
      "\u5F81": "z",
      "\u6323": "z",
      "\u7741": "z",
      "\u84B8": "z",
      "\u6574": "z",
      "\u6B63": "z",
      "\u8BC1": "z",
      "\u653F": "z",
      "\u75C7": "z",
      "\u4E4B": "z",
      "\u652F": "z",
      "\u53EA": "z",
      "\u6C41": "z",
      "\u829D": "z",
      "\u679D": "z",
      "\u77E5": "z",
      "\u80A2": "z",
      "\u7EC7": "z",
      "\u8102": "z",
      "\u8718": "z",
      "\u6267": "z",
      "\u76F4": "z",
      "\u503C": "z",
      "\u804C": "z",
      "\u690D": "z",
      "\u6B96": "z",
      "\u6B62": "z",
      "\u65E8": "z",
      "\u5740": "z",
      "\u7EB8": "z",
      "\u6307": "z",
      "\u81F3": "z",
      "\u5FD7": "z",
      "\u5236": "z",
      "\u8D28": "z",
      "\u6CBB": "z",
      "\u81F4": "z",
      "\u79E9": "z",
      "\u667A": "z",
      "\u7F6E": "z",
      "\u4E2D": "z",
      "\u5FE0": "z",
      "\u7EC8": "z",
      "\u949F": "z",
      "\u80BF": "z",
      "\u79CD": "z",
      "\u4F17": "z",
      "\u91CD": "z",
      "\u5DDE": "z",
      "\u821F": "z",
      "\u5468": "z",
      "\u6D32": "z",
      "\u7CA5": "z",
      "\u8F74": "z",
      "\u8098": "z",
      "\u663C": "z",
      "\u76B1": "z",
      "\u5B99": "z",
      "\u6731": "z",
      "\u73E0": "z",
      "\u682A": "z",
      "\u8BF8": "z",
      "\u732A": "z",
      "\u7AF9": "z",
      "\u9010": "z",
      "\u4E3B": "z",
      "\u52A9": "z",
      "\u4F4F": "z",
      "\u6CE8": "z",
      "\u9A7B": "z",
      "\u67F1": "z",
      "\u795D": "z",
      "\u8457": "z",
      "\u7B51": "z",
      "\u6293": "z",
      "\u722A": "z",
      "\u4E13": "z",
      "\u7816": "z",
      "\u8F6C": "z",
      "\u5E84": "z",
      "\u88C5": "z",
      "\u58EE": "z",
      "\u72B6": "z",
      "\u649E": "z",
      "\u8FFD": "z",
      "\u51C6": "z",
      "\u6349": "z",
      "\u684C": "z",
      "\u8D44": "z",
      "\u59FF": "z",
      "\u5179": "z",
      "\u6ECB": "z",
      "\u5B50": "z",
      "\u4ED4": "z",
      "\u7D2B": "z",
      "\u5B57": "z",
      "\u81EA": "z",
      "\u5B97": "z",
      "\u7EFC": "z",
      "\u68D5": "z",
      "\u8E2A": "z",
      "\u603B": "z",
      "\u7EB5": "z",
      "\u8D70": "z",
      "\u594F": "z",
      "\u79DF": "z",
      "\u8DB3": "z",
      "\u65CF": "z",
      "\u963B": "z",
      "\u7EC4": "z",
      "\u94BB": "z",
      "\u5634": "z",
      "\u6700": "z",
      "\u7F6A": "z",
      "\u5C0A": "z",
      "\u9075": "z",
      "\u6628": "z",
      "\u5DE6": "z",
      "\u4F5C": "z",
      "\u5750": "z",
      "\u5EA7": "z",
      "\u505A": "z"
    };
    function toPinyin(s) {
      let out = "";
      for (const ch of String(s)) {
        if (PY[ch]) out += PY[ch];
        else if (/[a-zA-Z0-9]/.test(ch)) out += ch.toLowerCase();
        else out += " ";
      }
      return out;
    }
    function pyMatch(text, query) {
      if (!text || !query) return false;
      const q = String(query).toLowerCase();
      if (!/^[a-z]+$/.test(q)) return false;
      const py = toPinyin(text);
      if (py.indexOf(q) !== -1) return true;
      let i = 0, j = 0;
      while (i < py.length && j < q.length) {
        if (py[i] === q[j]) j++;
        i++;
      }
      return j === q.length;
    }
    module2.exports = { toPinyin, pyMatch, PY };
  }
});

// src/sources.js
var require_sources = __commonJS({
  "src/sources.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var config = require_config();
    var versionLib = require_version();
    var { readJson } = require_utils();
    var pinyin = require_pinyin();
    var URL_FILE = path2.join(config.ROOT, "url.json");
    function loadUrls() {
      return readJson(URL_FILE, {}) || {};
    }
    function tokenize(s) {
      return String(s || "").toLowerCase().replace(/[_\-\.\/\\]/g, " ").split(/\s+/).filter(Boolean);
    }
    function listPackages() {
      const urls = loadUrls();
      const releases = urls.releases || [];
      const map = /* @__PURE__ */ new Map();
      for (const rel of releases) {
        const nt = rel.nameTxt;
        if (!nt || !nt.entries) continue;
        for (const e of nt.entries) {
          if (!map.has(e.name)) {
            map.set(e.name, { name: e.name, type: e.type, company: e.company, platform: e.platform || "", versions: [] });
          }
          const pkg = map.get(e.name);
          const asset = (rel.assets || []).find(function(a) {
            return a.name === e.fileName;
          });
          pkg.versions.push({
            version: e.version,
            tag: rel.tag,
            fileName: e.fileName,
            type: e.type,
            company: e.company,
            platform: e.platform || "",
            url: asset ? asset.url : null,
            size: asset ? asset.size : 0,
            assetType: asset ? asset.type : "unknown",
            digest: asset ? asset.digest || null : null,
            publishedAt: rel.publishedAt,
            htmlUrl: rel.htmlUrl,
            repo: rel.repo || null
          });
        }
      }
      for (const pkg of map.values()) {
        pkg.versions.sort(function(a, b) {
          return versionLib.compareVer(a.version, b.version);
        });
        pkg.latest = pkg.versions[pkg.versions.length - 1];
      }
      return Array.from(map.values()).sort(function(a, b) {
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
    }
    function find(name) {
      if (!name) return null;
      for (const p of listPackages()) if (p.name === name) return p;
      for (const p of listPackages()) if (p.name.toLowerCase() === String(name).toLowerCase()) return p;
      return null;
    }
    function findFuzzy(name) {
      const all = listPackages();
      const lower = String(name || "").toLowerCase();
      for (const p of all) if (p.name.toLowerCase() === lower) return p;
      for (const p of all) if (p.name.toLowerCase().indexOf(lower) === 0) return p;
      for (const p of all) if (p.name.toLowerCase().indexOf(lower) !== -1) return p;
      return null;
    }
    function findByFile(name) {
      if (!name) return null;
      const lower = String(name).toLowerCase();
      const all = listPackages();
      for (const p of all) for (const f of p.versions) if (f.fileName.toLowerCase() === lower) return { pkg: p, file: f };
      for (const p of all) for (const f of p.versions) if (f.fileName.toLowerCase().indexOf(lower) !== -1) return { pkg: p, file: f };
      return null;
    }
    /*
     * The platform tokens for this machine, most specific first.
     *
     * Order is the whole point: win-arm64 also contains win, so a plain
     * substring test would let an ARM build answer on an Intel machine.
     * The list runs from the exact tag down to the family name, and the
     * earliest index wins, so the most specific match takes the slot.
     */
    function selfPlatformTokens() {
      const arch = process.arch;
      if (process.platform === "win32") {
        if (arch === "arm64") return ["win-arm64", "winarm64", "windows-arm64", "windows", "win32", "win"];
        if (arch === "ia32") return ["winx86", "win-x86", "win-ia32", "win32-x86", "windows", "win32", "win"];
        return ["win64", "win-x64", "win-amd64", "win32-x64", "windows", "win32", "win"];
      }
      if (process.platform === "darwin") {
        if (arch === "arm64") return ["mac-arm64", "macos-arm64", "darwin-arm64", "osx-arm64", "macos", "mac", "darwin", "osx"];
        return ["mac-x64", "macos-x64", "darwin-x64", "osx-x64", "mac-intel", "macos", "mac", "darwin", "osx"];
      }
      if (arch === "arm64") return ["linux-arm64", "linux-aarch64", "arm64", "linux", "gnu"];
      return ["linux-x64", "linux-amd64", "linux-x86_64", "linux", "gnu"];
    }

    /*
     * Choose the build for this machine.
     *
     * A name.txt entry may name the platform it targets in its sixth
     * column. When one does, that column decides and the file name is not
     * consulted - a publisher who wrote win64 there means win64, whatever
     * the file happens to be called.
     *
     * Entries published before the column existed carry an empty value,
     * and those fall back to matching the file name, which is what this
     * always did. An old catalogue keeps working; a new one gets sharper.
     */
    function pickForCurrentPlatform(pkg) {
      if (!pkg || !pkg.versions || !pkg.versions.length) return null;

      const tokens = selfPlatformTokens();
      const arch = process.arch;
      const isArm = arch === "arm64" || arch === "arm";

      /* A build naming an architecture this machine is not cannot be
       * right, however well its other words match. */
      function wrongArch(p) {
        if (!isArm && p.indexOf("arm") !== -1) return true;
        if (isArm && (p.indexOf("x64") !== -1 || p.indexOf("amd64") !== -1 ||
            p.indexOf("x86_64") !== -1 || p.indexOf("ia32") !== -1)) return true;
        return false;
      }

      let best = null;
      let bestRank = -1;
      for (const v of pkg.versions) {
        const p = String(v.platform || "").toLowerCase();
        if (!p || wrongArch(p)) continue;
        for (let i = 0; i < tokens.length; i++) {
          if (p.indexOf(tokens[i]) === -1) continue;
          if (bestRank === -1 || i < bestRank) { best = v; bestRank = i; }
          break;
        }
      }
      if (best) return best;

      try {
        const platform = require_platform();
        return platform.pickAsset(pkg.versions, pkg.name);
      } catch (_) {
        return pkg.latest;
      }
    }
    function stats() {
      const urls = loadUrls();
      const releases = urls.releases || [];
      const pkgs = listPackages();
      let fileCount = 0;
      for (const r of releases) fileCount += (r.assets || []).length;
      return {
        releaseCount: releases.length,
        pkgCount: pkgs.length,
        fileCount,
        updatedAt: urls.updatedAt || null
      };
    }
    function search(opts) {
      opts = opts || {};
      const text = String(opts.text || "").trim();
      const type = opts.type || null;
      const company = opts.company || null;
      const exclC = opts.excludeCompanies || [];
      const version = opts.version || null;
      const exclV = opts.excludeVersions || [];
      const fullWord = opts.fullWord;
      const allVersions = opts.allVersions;
      const tokens = tokenize(text);
      const lowerText = text.toLowerCase();
      const results = [];
      for (const pkg of listPackages()) {
        if (type && pkg.type !== type) continue;
        if (company && pkg.company.toLowerCase().indexOf(company.toLowerCase()) === -1) continue;
        if (exclC.length) {
          let ex = false;
          for (const c of exclC) if (pkg.company.toLowerCase() === c.toLowerCase()) {
            ex = true;
            break;
          }
          if (ex) continue;
        }
        if (text) {
          const pname = pkg.name.toLowerCase();
          const ptokens = tokenize(pkg.name);
          let match = false;
          if (fullWord) {
            match = pname === lowerText;
          } else if (tokens.length > 1) {
            match = tokens.every(function(t) {
              return pname.indexOf(t) !== -1 || ptokens.some(function(pt) {
                return pt.indexOf(t) === 0;
              }) || pinyin.pyMatch(pkg.name, t);
            });
          } else {
            match = pname.indexOf(lowerText) !== -1 || pinyin.pyMatch(pkg.name, lowerText);
          }
          if (!match) continue;
        }
        let mv = pkg.versions.slice();
        if (version) mv = mv.filter(function(v) {
          return v.version === version;
        });
        if (exclV.length) mv = mv.filter(function(v) {
          return exclV.indexOf(v.version) === -1;
        });
        if (!mv.length) continue;
        results.push(Object.assign({}, pkg, {
          versions: allVersions ? mv : [mv[mv.length - 1]],
          latest: mv[mv.length - 1]
        }));
      }
      return results;
    }
    function editDistance(a, b) {
      a = String(a).toLowerCase();
      b = String(b).toLowerCase();
      const alen = a.length, blen = b.length;
      if (alen === 0) return blen;
      if (blen === 0) return alen;
      const prev = new Array(blen + 1);
      const cur = new Array(blen + 1);
      for (let j = 0; j <= blen; j++) prev[j] = j;
      for (let i = 1; i <= alen; i++) {
        cur[0] = i;
        for (let j = 1; j <= blen; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        for (let j = 0; j <= blen; j++) prev[j] = cur[j];
      }
      return prev[blen];
    }
    function similarity(input, target, display) {
      const a = String(input).toLowerCase();
      const b = String(target).toLowerCase();
      const at = tokenize(a);
      const bt = tokenize(b);
      if (a === b) return 0;
      if (b.indexOf(a) === 0) return 0.5 - a.length * 0.05;
      if (b.indexOf(a) !== -1) return 1 - a.length * 0.1;
      if (a.indexOf(b) !== -1) return 1.5;
      if (at.length > 1) {
        const allMatch = at.every(function(t) {
          return b.indexOf(t) !== -1 || bt.some(function(x) {
            return x.indexOf(t) === 0;
          });
        });
        if (allMatch) return 1.5 + (10 - Math.min(at.length, 10)) * 0.1;
      }
      if (at.length === 1) {
        const t = at[0];
        if (bt.some(function(x) {
          return x.indexOf(t) === 0;
        })) {
          return 2 - t.length * 0.1;
        }
      }
      if (display && pinyin.pyMatch(display, a)) {
        return 2.5 - Math.min(a.length, 10) * 0.05;
      }
      const d = editDistance(a, b);
      const maxLen = Math.max(a.length, b.length) || 1;
      return 3 + d / maxLen * 5;
    }
    function suggest(name, limit) {
      if (!name) return [];
      limit = limit || 5;
      const all = listPackages();
      if (!all.length) return [];
      const scored = all.map(function(p) {
        return { name: p.name, score: similarity(name, p.name, p.name) };
      });
      scored.sort(function(a, b) {
        return a.score - b.score;
      });
      const best = scored[0].score;
      const TOLERANCE = 0.05;
      const top = scored.filter(function(s) {
        return s.score - best <= TOLERANCE;
      });
      if (best > 5) return top.slice(0, 3);
      return top.slice(0, limit);
    }
    module2.exports = {
      loadUrls,
      listPackages,
      find,
      findFuzzy,
      findByFile,
      pickForCurrentPlatform,
      stats,
      search,
      suggest,
      tokenize,
      URL_FILE
    };
  }
});

// src/dl.js
var require_dl = __commonJS({
  "src/dl.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var http = require("http");
    var https = require("https");
    var { spawn, execSync } = require("child_process");
    function humanSpeed(bps) {
      if (!isFinite(bps) || bps <= 0) return "0B/s";
      if (bps >= 1073741824) return (bps / 1073741824).toFixed(2) + "GB/s";
      if (bps >= 1048576) return (bps / 1048576).toFixed(2) + "MB/s";
      if (bps >= 1024) return (bps / 1024).toFixed(1) + "KB/s";
      return bps.toFixed(0) + "B/s";
    }
    function humanSize(n) {
      if (n == null || n === 0) return "0B";
      const u = ["B", "KB", "MB", "GB", "TB"];
      let v = Number(n), i = 0;
      while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i++;
      }
      return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 1 : 0)) + u[i];
    }
    function humanEta(sec) {
      if (!isFinite(sec) || sec < 0 || sec > 604800) return "--:--";
      const s = Math.floor(sec);
      const h = Math.floor(s / 3600);
      const m = Math.floor(s % 3600 / 60);
      const ss = s % 60;
      if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
      return m + ":" + String(ss).padStart(2, "0");
    }
    function createBar() {
      if (global.__ipm_shell) return null;
      if (!process.stdout.isTTY) return null;
      let startedAt = 0;
      let lastDraw = 0;
      const window = [];
      const WINDOW_MS = 3e3;
      function draw(recv, total) {
        const now = Date.now();
        if (now - lastDraw < 80) return;
        lastDraw = now;
        window.push({ t: now, b: recv });
        while (window.length && now - window[0].t > WINDOW_MS) window.shift();
        let speed = 0;
        if (window.length >= 2) {
          const first = window[0], last = window[window.length - 1];
          const dt = (last.t - first.t) / 1e3;
          if (dt > 0) speed = (last.b - first.b) / dt;
        } else if (startedAt > 0) {
          const dt = (now - startedAt) / 1e3;
          if (dt > 0) speed = recv / dt;
        }
        const done = total > 0 && recv >= total;
        const pct = total > 0 ? Math.min(recv / total, 1) : 0;
        const eta = done || total <= 0 || speed <= 0 ? 0 : (total - recv) / speed;
        const speedStr = done ? "\u5B8C\u6210\u4E2D" : humanSpeed(speed);
        const head = speedStr + "  Total:" + humanSize(total) + "  ETA:" + humanEta(eta) + "  " + Math.floor(pct * 100) + "%";
        process.stdout.write("\r\x1B[K" + head);
      }
      return {
        start: function() {
          startedAt = Date.now();
        },
        update: draw,
        done: function(recv, total) {
          draw(recv, total);
          process.stdout.write("\n");
        },
        abort: function() {
          process.stdout.write("\r\x1B[K");
        }
      };
    }
    function requestHead(url, redirect) {
      if (redirect === void 0) redirect = 0;
      return new Promise(function(resolve, reject) {
        if (redirect > 6) return reject(new Error("Too many redirects"));
        let u;
        try {
          u = new URL(url);
        } catch (e) {
          return reject(e);
        }
        const lib = u.protocol === "http:" ? http : https;
        const req = lib.request({
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || void 0,
          path: u.pathname + u.search,
          method: "HEAD",
          headers: { "user-agent": "InfinityPackageManager/1.0.0", "accept": "*/*" }
        }, function(res) {
          if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
            res.resume();
            return resolve(requestHead(new URL(res.headers.location, url).toString(), redirect + 1));
          }
          resolve({
            status: res.statusCode,
            size: parseInt(res.headers["content-length"] || "0", 10) || 0,
            acceptRanges: String(res.headers["accept-ranges"] || "").toLowerCase() === "bytes"
          });
        });
        req.on("error", reject);
        req.setTimeout(15e3, function() {
          req.destroy(new Error("HEAD timeout"));
        });
        req.end();
      });
    }
    function findAria2c() {
      const exeDir = path2.dirname(process.execPath);
      const candidates = [
        path2.join(exeDir, "aria2c.exe"),
        path2.join(exeDir, "bin", "aria2c.exe")
      ];
      try {
        const config = require_config();
        candidates.push(path2.join(config.ROOT, "aria2c.exe"));
        candidates.push(path2.join(config.ROOT, "bin", "aria2c.exe"));
      } catch (_) {
      }
      candidates.push(path2.resolve(__dirname, "..", "bin", "aria2c.exe"));
      for (const c of candidates) {
        try {
          if (fs.existsSync(c)) return c;
        } catch (_) {
        }
      }
      try {
        const out = execSync("where aria2c.exe", { encoding: "utf8", windowsHide: true, timeout: 2e3 });
        const first = out.split(/\r?\n/)[0].trim();
        if (first && fs.existsSync(first)) return first;
      } catch (_) {
      }
      return null;
    }
    async function downloadViaAria2(aria2Path, url, dest, task, bar, threads) {
      const dir = path2.dirname(dest);
      const file = path2.basename(dest);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {
      }
      let expected = 0;
      try {
        expected = (await requestHead(url)).size || 0;
      } catch (_) {
      }
      const N = Math.max(2, Math.min(threads || 16, 32));
      const args2 = [
        "-x",
        String(N),
        "-s",
        String(N),
        "-k",
        "1M",
        "--console-log-level=warn",
        "--summary-interval=0",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        "--max-tries=5",
        "--retry-wait=3",
        "-d",
        dir,
        "-o",
        file,
        url
      ];
      return new Promise(function(resolve, reject) {
        let child;
        try {
          child = spawn(aria2Path, args2, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
        } catch (e) {
          return reject(new Error("aria2c spawn failed: " + e.message));
        }
        let stderrBuf = "";
        child.on("error", function(err) {
          reject(new Error("aria2c launch failed: " + err.message));
        });
        if (child.stderr) {
          child.stderr.on("data", function(c) {
            stderrBuf += String(c);
            if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-2048);
          });
        }
        if (task) {
          task.abortFn = function() {
            try {
              child.kill("SIGKILL");
            } catch (_) {
            }
          };
        }
        bar && bar.start();
        const poll = setInterval(function() {
          try {
            if (!fs.existsSync(dest)) return;
            const size = fs.statSync(dest).size;
            if (task) task.bytes = size;
            bar && bar.update(size, expected);
          } catch (_) {
          }
        }, 300);
        child.on("exit", function(code) {
          clearInterval(poll);
          if (task) task.abortFn = null;
          if (code !== 0) {
            const msg = stderrBuf.trim().split(/\r?\n/).pop() || "exit code " + code;
            return reject(new Error("aria2c: " + msg));
          }
          let finalSize = 0;
          try {
            finalSize = fs.statSync(dest).size;
          } catch (_) {
          }
          if (expected > 0 && finalSize !== expected) {
            return reject(new Error("\u6587\u4EF6\u4E0D\u5B8C\u6574: " + finalSize + "/" + expected));
          }
          if (task) task.bytes = finalSize;
          bar && bar.done(finalSize, expected || finalSize);
          resolve(dest);
        });
      });
    }
    function downloadSegment(url, dest, startByte, endByte, redirect, onData) {
      if (redirect === void 0) redirect = 0;
      return new Promise(function(resolve, reject) {
        if (redirect > 6) return reject(new Error("Too many redirects"));
        let u;
        try {
          u = new URL(url);
        } catch (e) {
          return reject(e);
        }
        const lib = u.protocol === "http:" ? http : https;
        const headers = { "user-agent": "InfinityPackageManager/1.0.0", "accept": "*/*", "accept-encoding": "identity" };
        if (startByte != null) headers.range = "bytes=" + startByte + "-" + endByte;
        const req = lib.request({
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || void 0,
          path: u.pathname + u.search,
          method: "GET",
          headers
        }, function(res) {
          if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
            res.resume();
            return resolve(downloadSegment(url, dest, startByte, endByte, redirect + 1, onData));
          }
          if (res.statusCode >= 400) {
            res.resume();
            return reject(new Error("HTTP " + res.statusCode));
          }
          const ws = fs.createWriteStream(dest, startByte != null ? { flags: "a" } : {});
          res.on("data", function(chunk) {
            onData && onData(chunk.length);
          });
          res.pipe(ws);
          ws.on("finish", resolve);
          ws.on("error", reject);
          res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(6e5, function() {
          req.destroy(new Error("Timeout"));
        });
        req.end();
      });
    }
    async function downloadMultiThread(url, dest, task, bar, threads) {
      const head = await requestHead(url);
      if (head.status >= 400) throw new Error("HTTP " + head.status);
      const total = head.size || 0;
      if (task) task.total = total;
      bar && bar.start();
      if (!head.acceptRanges || !total || total < 4 * 1024 * 1024) {
        let recv = 0;
        await downloadSegment(url, dest, null, null, 0, function(n) {
          recv += n;
          if (task) task.bytes = recv;
          bar && bar.update(recv, total);
        });
        bar && bar.done(recv, total);
        return dest;
      }
      const activeReqs = [];
      if (task) {
        task.abortFn = function() {
          for (const r of activeReqs) {
            try {
              r.destroy(new Error("Aborted"));
            } catch (_) {
            }
          }
        };
      }
      const N = Math.max(2, Math.min(threads || 8, 16));
      const segSize = Math.ceil(total / N);
      const parts = [];
      for (let i = 0; i < N; i++) {
        const start = i * segSize;
        const end = Math.min(start + segSize - 1, total - 1);
        if (start >= total) break;
        parts.push({ start, end, tmp: dest + ".part" + i });
      }
      let doneBytes = 0;
      const progress = parts.map(function() {
        return 0;
      });
      await Promise.all(parts.map(function(p, i) {
        return downloadSegment(url, p.tmp, p.start, p.end, 0, function(n) {
          progress[i] += n;
          doneBytes = progress.reduce(function(a, b) {
            return a + b;
          }, 0);
          if (task) task.bytes = doneBytes;
          bar && bar.update(doneBytes, total);
        });
      }));
      const wfd = fs.createWriteStream(dest);
      for (const p of parts) {
        await new Promise(function(resolve, reject) {
          const rfd = fs.createReadStream(p.tmp);
          rfd.pipe(wfd, { end: false });
          rfd.on("end", resolve);
          rfd.on("error", reject);
        });
        try {
          fs.unlinkSync(p.tmp);
        } catch (_) {
        }
      }
      wfd.end();
      await new Promise(function(r) {
        wfd.on("finish", r);
      });
      bar && bar.done(total, total);
      return dest;
    }
    async function download(url, dest, options) {
      options = options || {};
      const task = options.task || null;
      const showBar = options.progress !== false;
      const threads = options.threads || 16;
      const expected = Number(options.expectedSize) || 0;
      try {
        fs.mkdirSync(path2.dirname(dest), { recursive: true });
      } catch (_) {
      }
      if (fs.existsSync(dest)) {
        const curSize = fs.statSync(dest).size;
        if (expected > 0 && curSize === expected) {
          if (task) {
            task.bytes = curSize;
            task.total = curSize;
          }
          return dest;
        }
        if (expected > 0 && curSize !== expected) {
          if (showBar && !global.__ipm_shell) console.log("  \u6B8B\u6587\u4EF6 " + humanSize(curSize) + " \u2260 " + humanSize(expected) + "\uFF0C\u5220\u9664\u91CD\u4E0B");
          try {
            fs.unlinkSync(dest);
          } catch (_) {
          }
        }
        if (expected === 0 && curSize > 0) {
          if (task) {
            task.bytes = curSize;
            task.total = curSize;
          }
          return dest;
        }
      }
      const bar = showBar ? createBar() : null;
      const aria2Path = findAria2c();
      if (aria2Path) {
        if (showBar && !global.__ipm_shell) console.log("  \u4F7F\u7528 aria2c (" + threads + " \u7EBF\u7A0B)");
        try {
          return await downloadViaAria2(aria2Path, url, dest, task, bar, threads);
        } catch (e) {
          if (showBar && !global.__ipm_shell) console.log("  aria2c \u5931\u8D25\uFF0C\u56DE\u9000\u591A\u7EBF\u7A0B: " + e.message);
          try {
            fs.unlinkSync(dest);
          } catch (_) {
          }
          try {
            fs.unlinkSync(dest + ".aria2");
          } catch (_) {
          }
        }
      } else if (showBar && !global.__ipm_shell) {
        console.log("  aria2c.exe \u672A\u627E\u5230\uFF0C\u4F7F\u7528\u5185\u7F6E\u591A\u7EBF\u7A0B");
      }
      const r = await downloadMultiThread(url, dest, task, bar, threads);
      if (expected > 0) {
        const finalSize = fs.statSync(dest).size;
        if (finalSize !== expected) {
          try {
            fs.unlinkSync(dest);
          } catch (_) {
          }
          throw new Error("\u4E0B\u8F7D\u6587\u4EF6\u4E0D\u5B8C\u6574: " + finalSize + "/" + expected);
        }
      }
      return r;
    }
    module2.exports = { download, findAria2c };
  }
});

// src/net.js
var require_net = __commonJS({
  "src/net.js"(exports2, module2) {
    "use strict";
    var http = require("http");
    var https = require("https");
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var { ensureDir } = require_utils();
    function t(key, fallback) {
      try {
        return require_i18n().t(key);
      } catch (_) {
        return fallback || key;
      }
    }
    function getRetries() {
      return Number(config.get("network.retries")) || 4;
    }
    function getRetryDelay() {
      return Number(config.get("network.retryDelayMs")) || 800;
    }
    function getTimeout() {
      return Number(config.get("network.timeoutMs")) || 3e4;
    }
    function sleep(ms) {
      return new Promise(function(r) {
        setTimeout(r, ms);
      });
    }
    function authHeaders(extra) {
      const h = Object.assign({
        "user-agent": "InfinityPackageManager/1.0.0",
        "accept": "*/*",
        "accept-encoding": "identity",
        "connection": "close"
      }, extra || {});
      const token = process.env['gittoken_zssx-2026_1'] || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || config.get("github.token");
      if (token) h.authorization = "Bearer " + token;
      return h;
    }
    function requestOnce(url, options) {
      options = options || {};
      return new Promise(function(resolve, reject) {
        let u;
        try {
          u = new URL(url);
        } catch (e) {
          return reject(new Error("Invalid URL: " + url));
        }
        const lib = u.protocol === "http:" ? http : https;
        const req = lib.request({
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || void 0,
          path: u.pathname + u.search,
          method: options.method || "GET",
          headers: Object.assign(authHeaders(), options.headers || {})
        }, function(res) {
          const chunks = [];
          res.on("data", function(c) {
            chunks.push(c);
          });
          res.on("end", function() {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
          });
          res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(getTimeout(), function() {
          req.destroy(new Error("Timeout"));
        });
        req.end();
      });
    }
    function retryLog(msg, attempt, total) {
      console.log("\x1B[33m!\x1B[0m " + msg + " (" + (attempt + 1) + "/" + total + ")");
    }
    async function httpGetWithRetry(url, options, redirect) {
      options = options || {};
      redirect = redirect || 0;
      if (redirect > 6) throw new Error("Too many redirects: " + url);
      const retries = getRetries();
      const baseDelay = getRetryDelay();
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await requestOnce(url, options);
          if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location) {
            return await httpGetWithRetry(new URL(res.headers.location, url).toString(), options, redirect + 1);
          }
          if (res.statusCode >= 500) {
            lastErr = new Error("HTTP " + res.statusCode + ": " + url);
            if (attempt < retries) {
              retryLog(t("logRetryHttp") + " HTTP " + res.statusCode, attempt, retries);
              await sleep(baseDelay * Math.pow(2, attempt));
              continue;
            }
            throw lastErr;
          }
          return res;
        } catch (err) {
          lastErr = err;
          if (attempt < retries) {
            retryLog(t("logRetryErr") + " " + err.message, attempt, retries);
            await sleep(baseDelay * Math.pow(2, attempt));
            continue;
          }
          throw err;
        }
      }
      throw lastErr || new Error("Request failed");
    }
    async function downloadWithRetry(url, dest, options) {
      options = options || {};
      const retries = getRetries();
      const baseDelay = getRetryDelay();
      let lastErr = null;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await require_dl().download(url, dest, options);
        } catch (err) {
          lastErr = err;
          try {
            fs.unlinkSync(dest);
          } catch (_) {
          }
          try {
            const dir = path2.dirname(dest);
            const base = path2.basename(dest);
            for (const f of fs.readdirSync(dir)) {
              if (f.indexOf(base + ".part") === 0) {
                try {
                  fs.unlinkSync(path2.join(dir, f));
                } catch (_) {
                }
              }
            }
          } catch (_) {
          }
          if (err && /Aborted/.test(err.message)) throw err;
          if (attempt < retries) {
            retryLog(t("logRetryErr") + " " + err.message, attempt, retries);
            await sleep(baseDelay * Math.pow(2, attempt));
            continue;
          }
          throw err;
        }
      }
      throw lastErr || new Error("Download failed");
    }
    module2.exports = {
      authHeaders,
      httpGetWithRetry,
      downloadWithRetry,
      sleep
    };
  }
});

// src/extractor.js
var require_extractor = __commonJS({
  "src/extractor.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var fs = require("fs");
    var path2 = require("path");
    var BLOCK = 512;
    function readString(buf, off, len) {
      const s = buf.subarray(off, off + len);
      const e = s.indexOf(0);
      return s.subarray(0, e === -1 ? s.length : e).toString("utf8");
    }
    function readOctal(buf, off, len) {
      const s = readString(buf, off, len).trim();
      return s ? parseInt(s, 8) || 0 : 0;
    }
    function isZero(buf, off) {
      for (let i = off; i < off + BLOCK; i++) if (buf[i] !== 0) return false;
      return true;
    }
    function parseTar(buffer) {
      const entries = [];
      let off = 0;
      while (off + BLOCK <= buffer.length) {
        if (isZero(buffer, off)) break;
        const h = buffer.subarray(off, off + BLOCK);
        const size = readOctal(h, 124, 12);
        const tb = h[156];
        const type = tb === 0 ? "0" : String.fromCharCode(tb);
        let name = readString(h, 0, 100);
        const prefix = readString(h, 345, 155);
        if (prefix) name = prefix + "/" + name;
        const dataStart = off + BLOCK;
        const dataEnd = dataStart + size;
        const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
        entries.push({ name, type, size, data: type === "0" ? buffer.subarray(dataStart, dataEnd) : null });
        off = next;
      }
      return entries;
    }
    function extractTarBuffer(tarBuffer, destDir, options) {
      options = options || {};
      const strip = options.strip == null ? 1 : Number(options.strip);
      const entries = parseTar(tarBuffer);
      const root = path2.resolve(destDir);
      let written = 0;
      for (const e of entries) {
        let rel = e.name.replace(/\\/g, "/").replace(/^\/+/, "");
        if (strip > 0) {
          const parts = rel.split("/").filter(Boolean);
          if (parts.length <= strip) continue;
          rel = parts.slice(strip).join("/");
        }
        if (!rel) continue;
        const target = path2.resolve(root, rel);
        if (target !== root && target.indexOf(root + path2.sep) !== 0) continue;
        if (e.type === "5") {
          fs.mkdirSync(target, { recursive: true });
          written++;
        } else if (e.data) {
          fs.mkdirSync(path2.dirname(target), { recursive: true });
          fs.writeFileSync(target, e.data);
          written++;
        }
      }
      return written;
    }
    function extractTarGz(buf, destDir, options) {
      return extractTarBuffer(zlib.gunzipSync(buf), destDir, options);
    }
    function extractTar(buf, destDir, options) {
      return extractTarBuffer(buf, destDir, options);
    }
    function findEOCD(buf) {
      const minLen = 22;
      const maxBack = Math.min(buf.length, 65536 + minLen);
      for (let i = buf.length - minLen; i >= buf.length - maxBack && i >= 0; i--) {
        if (buf.readUInt32LE(i) === 101010256) return i;
      }
      return -1;
    }
    function extractZip(buf, destDir, options) {
      options = options || {};
      const strip = options.strip == null ? 0 : Number(options.strip);
      const root = path2.resolve(destDir);
      const eocd = findEOCD(buf);
      if (eocd === -1) throw new Error("Not a valid ZIP");
      const totalEntries = buf.readUInt16LE(eocd + 10);
      let off = buf.readUInt32LE(eocd + 16);
      let written = 0;
      for (let n = 0; n < totalEntries; n++) {
        if (off + 46 > buf.length) break;
        if (buf.readUInt32LE(off) !== 33639248) break;
        const compression = buf.readUInt16LE(off + 10);
        const compSize = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const commentLen = buf.readUInt16LE(off + 32);
        const localOffset = buf.readUInt32LE(off + 42);
        const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
        off += 46 + nameLen + extraLen + commentLen;
        if (localOffset + 30 > buf.length) continue;
        if (buf.readUInt32LE(localOffset) !== 67324752) continue;
        const lNameLen = buf.readUInt16LE(localOffset + 26);
        const lExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        let fileData;
        try {
          if (compression === 0) fileData = buf.subarray(dataStart, dataStart + compSize);
          else if (compression === 8) fileData = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compSize));
          else continue;
        } catch (_) {
          continue;
        }
        let rel = name.replace(/\\/g, "/");
        const isDir = rel.endsWith("/");
        if (isDir) rel = rel.slice(0, -1);
        if (strip > 0) {
          const parts = rel.split("/").filter(Boolean);
          if (parts.length <= strip) continue;
          rel = parts.slice(strip).join("/");
        }
        if (!rel) continue;
        const target = path2.resolve(root, rel);
        if (target !== root && target.indexOf(root + path2.sep) !== 0) continue;
        if (isDir) fs.mkdirSync(target, { recursive: true });
        else {
          fs.mkdirSync(path2.dirname(target), { recursive: true });
          fs.writeFileSync(target, fileData);
        }
        written++;
      }
      return written;
    }
    module2.exports = {
      parseTar,
      extractTar,
      extractTarGz,
      extractZip
    };
  }
});

// src/runner.js
var require_runner = __commonJS({
  "src/runner.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var fs = require("fs");
    var { spawn } = require("child_process");
    var platform = require_platform();
    function isInstallerType(fileName) {
      return /\.(exe|msi|dmg|pkg|deb|rpm|appimage|bat|cmd|sh|run)$/i.test(fileName);
    }
    function isArchiveType(fileName) {
      return /\.(tar\.gz|tgz|tar|zip|gz|7z|rar|xz|bz2)$/i.test(fileName);
    }
    function unlockFile(filePath) {
      if (process.platform !== "win32") return;
      try {
        fs.unlinkSync(filePath + ":Zone.Identifier");
      } catch (_) {
      }
    }
    function spawnWait(cmd, args2, opts) {
      return new Promise(function(resolve, reject) {
        let child;
        try {
          child = spawn(cmd, args2 || [], Object.assign({
            stdio: "inherit",
            windowsHide: false
          }, opts || {}));
        } catch (err) {
          return reject(err);
        }
        child.on("error", reject);
        child.on("close", function(code) {
          resolve(code == null ? 0 : code);
        });
      });
    }
    async function runInstaller(filePath, fileName, flags) {
      flags = flags || {};
      const lower = (fileName || filePath).toLowerCase();
      const p = platform.platform;
      const abs = path2.resolve(filePath);
      if (!fs.existsSync(abs)) throw new Error("File not found: " + abs);
      unlockFile(abs);
      const cwd = path2.dirname(abs);
      if (p === "win32") {
        if (lower.endsWith(".msi")) return await spawnWait("msiexec", ["/i", abs], { cwd });
        if (lower.endsWith(".bat") || lower.endsWith(".cmd")) return await spawnWait("cmd", ["/c", abs], { cwd });
        if (lower.endsWith(".exe")) return await spawnWait("cmd", ["/c", abs], { cwd });
        return await spawnWait("cmd", ["/c", "start", '""', "/wait", abs]);
      }
      if (p === "darwin") {
        if (lower.endsWith(".dmg") || lower.endsWith(".pkg")) return await spawnWait("open", [abs]);
        if (lower.endsWith(".sh") || lower.endsWith(".run")) {
          try {
            fs.chmodSync(abs, 493);
          } catch (_) {
          }
          return await spawnWait("bash", [abs]);
        }
        return await spawnWait("open", [abs]);
      }
      if (p === "linux") {
        if (lower.endsWith(".deb")) {
          try {
            return await spawnWait("xdg-open", [abs]);
          } catch (_) {
          }
          return await spawnWait("dpkg", ["-i", abs]);
        }
        if (lower.endsWith(".rpm")) {
          try {
            return await spawnWait("xdg-open", [abs]);
          } catch (_) {
          }
          return await spawnWait("rpm", ["-i", abs]);
        }
        if (lower.endsWith(".appimage") || lower.endsWith(".sh") || lower.endsWith(".run")) {
          try {
            fs.chmodSync(abs, 493);
          } catch (_) {
          }
          return await spawnWait(abs, []);
        }
        return await spawnWait("xdg-open", [abs]);
      }
      try {
        fs.chmodSync(abs, 493);
      } catch (_) {
      }
      return await spawnWait(abs, []);
    }
    function askYesNo(question, defaultYes) {
      return new Promise(function(resolve) {
        const hint = defaultYes ? " [Y/n] " : " [y/N] ";
        const text = question + hint;
        if (global.__ipm_rl && global.__ipm_rl.question) {
          global.__ipm_rl.question(text, function(ans) {
            const a = String(ans || "").trim().toLowerCase();
            if (!a) return resolve(Boolean(defaultYes));
            resolve(a === "y" || a === "yes");
          });
          return;
        }
        process.stdout.write(text);
        let buf = "";
        let done = false;
        function onData(chunk) {
          if (done) return;
          buf += String(chunk);
          const idx = buf.indexOf("\n");
          if (idx === -1 && buf.indexOf("\r") === -1) return;
          done = true;
          process.stdin.removeListener("data", onData);
          process.stdin.removeListener("end", onEnd);
          const line = buf.split(/[\r\n]/)[0].trim().toLowerCase();
          if (!line) return resolve(Boolean(defaultYes));
          resolve(line === "y" || line === "yes");
        }
        function onEnd() {
          if (done) return;
          done = true;
          process.stdin.removeListener("data", onData);
          process.stdin.removeListener("end", onEnd);
          resolve(Boolean(defaultYes));
        }
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", onData);
        process.stdin.on("end", onEnd);
        process.stdin.resume();
      });
    }
    module2.exports = {
      isInstallerType,
      isArchiveType,
      runInstaller,
      unlockFile,
      askYesNo
    };
  }
});

// src/killer.js
var require_killer = __commonJS({
  "src/killer.js"(exports2, module2) {
    "use strict";
    var { execFileSync } = require("child_process");
    var platform = require_platform();
    var { log, color } = require_utils();
    function buildCandidates(pkg) {
      const set = /* @__PURE__ */ new Set();
      const add = function(s) {
        if (!s) return;
        s = String(s).trim();
        if (!s) return;
        set.add(s);
        if (platform.isWindows()) set.add(s + ".exe");
        else set.add(s.toLowerCase());
      };
      if (pkg.name) {
        add(pkg.name);
        add(pkg.name.toLowerCase());
      }
      if (pkg.fileName) {
        let base = String(pkg.fileName).replace(/\.(exe|msi|zip|tar\.gz|tgz|tar|7z|rar)$/i, "").replace(/[_.-](x64|x86|amd64|arm64|32|64)$/i, "").replace(/[_.-](setup|installer|install|portable|port|green|noinstall|standalone)$/i, "");
        add(base);
      }
      return Array.from(set);
    }
    function killByName(name) {
      try {
        if (platform.isWindows()) {
          execFileSync("taskkill", ["/F", "/IM", name], { stdio: "ignore" });
          return true;
        } else {
          execFileSync("pkill", ["-f", name], { stdio: "ignore" });
          return true;
        }
      } catch (_) {
        return false;
      }
    }
    function killPackage(pkg) {
      if (!pkg) return 0;
      const candidates = buildCandidates(pkg);
      let count = 0;
      for (const name of candidates) {
        if (killByName(name)) count++;
      }
      return count;
    }
    function sleep(ms) {
      return new Promise(function(r) {
        setTimeout(r, ms);
      });
    }
    async function killAndWait(pkg, ms) {
      const n = killPackage(pkg);
      if (n > 0) await sleep(ms == null ? 800 : ms);
      return n;
    }
    module2.exports = {
      buildCandidates,
      killPackage,
      killAndWait,
      killByName,
      sleep
    };
  }
});

// src/tasks.js
var require_tasks = __commonJS({
  "src/tasks.js"(exports2, module2) {
    "use strict";
    var tasks = [];
    var nextId = 1;
    var listeners = [];
    function emit() {
      for (const fn of listeners) {
        try {
          fn();
        } catch (_) {
        }
      }
    }
    function register(name, type) {
      const t = {
        id: nextId++,
        name: name || "unnamed",
        type: type || "task",
        status: "running",
        bytes: 0,
        total: 0,
        started: Date.now(),
        ended: null,
        error: null,
        aborted: false,
        abortFn: null
      };
      tasks.push(t);
      emit();
      return t;
    }
    function unregister(t) {
      if (!t) return;
      const i = tasks.indexOf(t);
      if (i >= 0) {
        tasks.splice(i, 1);
        emit();
      }
    }
    function list() {
      return tasks.slice();
    }
    function count() {
      return tasks.length;
    }
    function get(id) {
      const n = Number(id);
      return tasks.find(function(x) {
        return x.id === n;
      }) || null;
    }
    function abort(id) {
      const t = get(id);
      if (!t) return { ok: false, error: "notFound", id: Number(id) };
      t.aborted = true;
      if (typeof t.abortFn === "function") {
        try {
          t.abortFn();
        } catch (_) {
        }
      }
      return { ok: true, task: t };
    }
    function abortAll() {
      const ids = tasks.map(function(t) {
        return t.id;
      });
      const killed = [];
      for (const id of ids) {
        const r = abort(id);
        if (r.ok) killed.push(id);
      }
      return killed;
    }
    function on(fn) {
      if (typeof fn === "function") listeners.push(fn);
    }
    function off(fn) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    }
    module2.exports = {
      register,
      unregister,
      list,
      count,
      get,
      abort,
      abortAll,
      on,
      off
    };
  }
});

// src/shortcut.js
var require_shortcut = __commonJS({
  "src/shortcut.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var os = require("os");
    var { spawnSync, execFileSync } = require("child_process");
    function isWindows() {
      return process.platform === "win32";
    }
    function psQuote(s) {
      return "'" + String(s).replace(/'/g, "''") + "'";
    }
    function desktopDir() {
      if (!isWindows()) return null;
      try {
        const out = execFileSync("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          '[Environment]::GetFolderPath("Desktop")'
        ], { encoding: "utf8", windowsHide: true, timeout: 5e3 });
        const p = (out || "").trim();
        if (p && fs.existsSync(p)) return p;
      } catch (_) {
      }
      return path2.join(os.homedir(), "Desktop");
    }
    function startMenuDir() {
      if (!isWindows()) return null;
      const appdata = process.env.APPDATA;
      if (appdata) {
        const p = path2.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs");
        if (fs.existsSync(p)) return p;
      }
      return path2.join(
        os.homedir(),
        "AppData",
        "Roaming",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs"
      );
    }
    function startMenuAppDir() {
      const base = startMenuDir();
      if (!base) return null;
      const dir = path2.join(base, "InfinityPackageManager");
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {
      }
      return dir;
    }
    function safeName(name) {
      return String(name || "app").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "app";
    }
    function shortcutPath(pkgName, kind) {
      const safe = safeName(pkgName);
      if (kind === "desktop") {
        const d2 = desktopDir();
        return d2 ? path2.join(d2, safe + ".lnk") : null;
      }
      const d = startMenuAppDir();
      return d ? path2.join(d, safe + ".lnk") : null;
    }
    function exists(pkgName) {
      const d = shortcutPath(pkgName, "desktop");
      const s = shortcutPath(pkgName, "startmenu");
      return {
        desktop: !!(d && fs.existsSync(d)),
        startmenu: !!(s && fs.existsSync(s))
      };
    }
    function findMainExe(dir, pkgName) {
      if (!dir || !fs.existsSync(dir)) return null;
      const candidates = [];
      function walk(d, depth) {
        if (depth > 3) return;
        let entries;
        try {
          entries = fs.readdirSync(d, { withFileTypes: true });
        } catch (_) {
          return;
        }
        for (const e of entries) {
          const full = path2.join(d, e.name);
          if (e.isDirectory()) walk(full, depth + 1);
          else if (/\.exe$/i.test(e.name)) candidates.push(full);
        }
      }
      walk(dir, 0);
      if (!candidates.length) return null;
      const lower = String(pkgName || "").toLowerCase();
      const baseName = function(p) {
        return path2.basename(p, ".exe").toLowerCase();
      };
      const exact = candidates.filter(function(c) {
        return baseName(c) === lower;
      });
      if (exact.length) return exact[0];
      const containsPkg = candidates.filter(function(c) {
        return baseName(c).indexOf(lower) !== -1;
      });
      if (containsPkg.length) return containsPkg[0];
      const pkgContains = candidates.filter(function(c) {
        return lower.indexOf(baseName(c)) !== -1;
      });
      if (pkgContains.length) return pkgContains[0];
      return candidates[0];
    }
    function createShortcut(lnkPath, targetPath, workDir, iconPath, description) {
      const parts = [
        "$ws = New-Object -ComObject WScript.Shell;",
        "$s = $ws.CreateShortcut(" + psQuote(lnkPath) + ");",
        "$s.TargetPath = " + psQuote(targetPath) + ";",
        "$s.WorkingDirectory = " + psQuote(workDir || path2.dirname(targetPath)) + ";",
        iconPath ? "$s.IconLocation = " + psQuote(iconPath + ",0") + ";" : "",
        description ? "$s.Description = " + psQuote(description) + ";" : "",
        "$s.Save();"
      ].filter(Boolean).join(" ");
      const r = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        parts
      ], { encoding: "utf8", windowsHide: true, timeout: 15e3 });
      if (r.status !== 0) {
        const err = ((r.stderr || "") + (r.stdout || "")).trim();
        throw new Error(err || "powershell exit " + r.status);
      }
      return true;
    }
    function createAll(pkgName, targetDir, exePath) {
      if (!isWindows()) return { ok: false, error: "not windows" };
      const exe = exePath || findMainExe(targetDir, pkgName);
      if (!exe) return { ok: false, error: "no exe found in " + targetDir };
      if (!fs.existsSync(exe)) return { ok: false, error: "exe not found: " + exe };
      const created = [];
      const errors = [];
      for (const kind of ["desktop", "startmenu"]) {
        const lnk = shortcutPath(pkgName, kind);
        if (!lnk) {
          errors.push(kind + ": no dir");
          continue;
        }
        try {
          createShortcut(lnk, exe, targetDir, exe, pkgName);
          created.push(kind === "desktop" ? "\u684C\u9762" : "\u5F00\u59CB\u83DC\u5355");
        } catch (e) {
          errors.push(kind + ": " + e.message);
        }
      }
      if (created.length) return { ok: true, created, exe };
      return { ok: false, error: errors.join("; ") || "unknown" };
    }
    module2.exports = {
      isWindows,
      desktopDir,
      startMenuDir,
      startMenuAppDir,
      shortcutPath,
      findMainExe,
      createShortcut,
      createAll,
      exists
    };
  }
});

// src/installer.js
var require_installer = __commonJS({
  "src/installer.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var platform = require_platform();
    var registry = require_registry();
    var sources = require_sources();
    var net = require_net();
    var extractor = require_extractor();
    var runner = require_runner();
    var killer = require_killer();
    var tasks = require_tasks();
    var versionLib = require_version();
    var i18n = require_i18n();
    var { ensureDir, rmrf, log, formatBytes } = require_utils();
    function verifyFileHash(file, hashSpec) {
      const spec = String(hashSpec || "").trim();
      let algo = "sha256";
      let expected = spec;
      const idx = spec.indexOf(":");
      if (idx > 0) {
        algo = spec.slice(0, idx).toLowerCase();
        expected = spec.slice(idx + 1);
      }
      expected = expected.toLowerCase().replace(/[^0-9a-f]/g, "");
      if (!expected) throw new Error("hash \u503C\u65E0\u6548: " + hashSpec);
      const crypto = require("crypto");
      const h = crypto.createHash(algo);
      const fd = fs.openSync(file, "r");
      const buf = Buffer.allocUnsafe(1 << 20);
      try {
        while (true) {
          const n = fs.readSync(fd, buf, 0, buf.length, null);
          if (n <= 0) break;
          h.update(buf.slice(0, n));
        }
      } finally {
        fs.closeSync(fd);
      }
      const actual = h.digest("hex");
      if (actual !== expected) {
        throw new Error("\u54C8\u5E0C\u4E0D\u5339\u914D\n  \u7B97\u6CD5: " + algo + "\n  \u671F\u671B: " + expected + "\n  \u5B9E\u9645: " + actual);
      }
      log.success("\u54C8\u5E0C\u6821\u9A8C\u901A\u8FC7 (" + algo + ": " + actual.slice(0, 12) + "...)");
    }
    async function install(name, version, customPath, flags) {
      if (customPath && typeof customPath === "object" && flags === void 0) {
        flags = customPath;
        customPath = null;
      }
      flags = flags || {};
      if (!name) throw new Error(i18n.t("installUsage"));
      if (name.indexOf("..") !== -1 || /^[\\/]/.test(name)) {
        throw new Error("\u65E0\u6548\u7684\u5305\u540D: " + name);
      }
      const pkg = sources.find(name);
      if (!pkg) {
        const err = new Error(i18n.t("pkgNotFound") + ": " + name);
        try {
          err.suggest = sources.suggest(name, 5).map(function(s) {
            return s.name;
          });
        } catch (_) {
          err.suggest = [];
        }
        throw err;
      }
      let target;
      if (version) {
        target = pkg.versions.find(function(v) {
          return v.version === version;
        });
        if (!target) {
          throw new Error(i18n.t("versionNotFound") + ": " + name + "@" + version);
        }
      } else {
        target = sources.pickForCurrentPlatform ? sources.pickForCurrentPlatform(pkg) : pkg.latest;
        if (!target) target = pkg.latest;
        if (!target) throw new Error(name + " " + i18n.t("noFilesInPkg"));
      }
      if (!target.url) throw new Error(target.fileName + " " + i18n.t("pkgNoDownloadUrl"));
      let isInstaller;
      if (target.type === "setup") {
        isInstaller = true;
      } else if (target.type === "port") {
        isInstaller = false;
      } else {
        isInstaller = target.assetType === "installer" || runner.isInstallerType(target.fileName);
      }
      log.step(i18n.t("installingPkg") + " " + pkg.name + " v" + target.version + "  " + target.fileName);
      if (target.company && target.company !== "null") log.info("company: " + target.company);
      log.info(i18n.t("installingPlatform") + ": " + platform.platform + "/" + platform.arch);
      if (customPath && !isInstaller) log.info("\u5B89\u88C5\u8DEF\u5F84: " + path2.resolve(customPath));
      if (flags.kill !== false) {
        const n = await killer.killAndWait({ name: pkg.name, fileName: target.fileName }, 800);
        if (n > 0) log.info(i18n.t("killedProcess") + " " + pkg.name);
      }
      const tempdir = config.get("tempdir");
      ensureDir(tempdir);
      const dlDest = path2.join(tempdir, target.fileName);
      let needDownload = true;
      if (fs.existsSync(dlDest)) {
        const curSize = fs.statSync(dlDest).size;
        if (target.size && curSize === target.size) {
          log.info(i18n.t("fileExistsSkipDownload") + ": " + dlDest);
          needDownload = false;
        } else if (target.size && curSize !== target.size) {
          log.info("\u6B8B\u6587\u4EF6 " + formatBytes(curSize) + " \u2260 " + formatBytes(target.size) + "\uFF0C\u5220\u9664\u91CD\u4E0B");
          try {
            fs.unlinkSync(dlDest);
          } catch (_) {
          }
        }
      }
      if (needDownload) {
        log.info(i18n.t("installingDownload") + " " + target.url);
        const dlTask = tasks.register(pkg.name, "download");
        try {
          await net.downloadWithRetry(target.url, dlDest, {
            task: dlTask,
            progress: !flags.q,
            expectedSize: target.size
          });
        } finally {
          tasks.unregister(dlTask);
        }
      }
      if (flags.hash) {
        const expected = target.digest;
        if (!expected) {
          log.warn("GitHub \u672A\u8BB0\u5F55\u6B64 asset \u7684\u54C8\u5E0C\uFF0C\u8DF3\u8FC7\u6821\u9A8C");
        } else {
          try {
            verifyFileHash(dlDest, expected);
          } catch (e) {
            try {
              fs.unlinkSync(dlDest);
            } catch (_) {
            }
            throw e;
          }
        }
      }
      if (isInstaller) {
        if (flags["no-run"]) {
          log.success(i18n.t("downloadDone") + ": " + dlDest);
        } else {
          log.info(i18n.t("runningInstaller") + " " + target.fileName);
          const instTask = tasks.register(pkg.name, "install");
          try {
            const code = await runner.runInstaller(dlDest, target.fileName, flags);
            if (code === 0 || code === 3010) log.success(i18n.t("installerDone"));
            else log.warn(i18n.t("installerExitCode") + ": " + code);
          } catch (err) {
            log.error(i18n.t("installerFailed") + ": " + err.message);
          } finally {
            tasks.unregister(instTask);
          }
          if (!flags.k) {
            try {
              fs.unlinkSync(dlDest);
            } catch (_) {
            }
            log.info(i18n.t("installerRemoved"));
          }
        }
        registry.add(pkg.name, {
          name: pkg.name,
          version: target.version,
          company: target.company,
          type: target.type,
          fileName: target.fileName,
          source: target.htmlUrl || null,
          path: flags.k ? dlDest : "",
          installedAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        versionLib.setCurrent(pkg.name, target.version);
        return;
      }
      let finalDir;
      if (customPath) {
        const resolved = path2.resolve(customPath);
        const base = path2.basename(resolved).toLowerCase();
        finalDir = base === pkg.name.toLowerCase() ? resolved : path2.join(resolved, pkg.name);
      } else {
        finalDir = path2.join(config.get("installdir"), pkg.name);
      }
      rmrf(finalDir);
      ensureDir(finalDir);
      log.info(i18n.t("installingExtract") + " " + finalDir);
      if (runner.isArchiveType(target.fileName)) {
        try {
          const buf = fs.readFileSync(dlDest);
          const lower = target.fileName.toLowerCase();
          if (lower.endsWith(".zip")) extractor.extractZip(buf, finalDir, { strip: 0 });
          else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) extractor.extractTarGz(buf, finalDir, { strip: 1 });
          else if (lower.endsWith(".tar")) extractor.extractTar(buf, finalDir, { strip: 1 });
        } catch (err) {
          log.error("\u89E3\u538B\u5931\u8D25: " + err.message);
        }
      } else {
        const dst = path2.join(finalDir, target.fileName);
        fs.copyFileSync(dlDest, dst);
        try {
          platform.chmodExec(dst);
        } catch (_) {
        }
      }
      try {
        fs.unlinkSync(dlDest);
      } catch (_) {
      }
      registry.add(pkg.name, {
        name: pkg.name,
        version: target.version,
        company: target.company,
        type: target.type,
        fileName: target.fileName,
        source: target.htmlUrl || null,
        path: finalDir,
        installedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      versionLib.setCurrent(pkg.name, target.version);
      log.success(i18n.t("installingDone") + " " + pkg.name + " -> " + finalDir);
      await offerShortcuts(pkg.name, finalDir, flags);
    }
    async function offerShortcuts(pkgName, targetDir, flags) {
      if (flags && (flags.q || flags["no-shortcut"])) return;
      if (process.platform !== "win32") return;
      const shortcut = require_shortcut();
      const exe = shortcut.findMainExe(targetDir, pkgName);
      if (!exe) return;
      const created = [];
      const askDesktop = i18n.t("createDesktopShortcut") !== "createDesktopShortcut" ? i18n.t("createDesktopShortcut") : "\u521B\u5EFA\u684C\u9762\u5FEB\u6377\u65B9\u5F0F\uFF1F";
      const wantDesktop = await runner.askYesNo(askDesktop, true);
      if (wantDesktop) {
        try {
          const lnk = shortcut.shortcutPath(pkgName, "desktop");
          if (lnk) {
            shortcut.createShortcut(lnk, exe, targetDir, exe, pkgName);
            created.push("\u684C\u9762");
          }
        } catch (e) {
          log.warn("\u684C\u9762\u5FEB\u6377\u65B9\u5F0F\u521B\u5EFA\u5931\u8D25: " + e.message);
        }
      }
      const askStart = i18n.t("createStartMenuShortcut") !== "createStartMenuShortcut" ? i18n.t("createStartMenuShortcut") : "\u521B\u5EFA\u5F00\u59CB\u83DC\u5355\u5FEB\u6377\u65B9\u5F0F\uFF1F";
      const wantStart = await runner.askYesNo(askStart, true);
      if (wantStart) {
        try {
          const lnk = shortcut.shortcutPath(pkgName, "startmenu");
          if (lnk) {
            shortcut.createShortcut(lnk, exe, targetDir, exe, pkgName);
            created.push("\u5F00\u59CB\u83DC\u5355");
          }
        } catch (e) {
          log.warn("\u5F00\u59CB\u83DC\u5355\u5FEB\u6377\u65B9\u5F0F\u521B\u5EFA\u5931\u8D25: " + e.message);
        }
      }
      if (created.length) {
        log.success("\u5FEB\u6377\u65B9\u5F0F\u5DF2\u521B\u5EFA: " + created.join(" + "));
      }
    }
    async function uninstall(name) {
      if (!name) throw new Error(i18n.t("uninstallUsage"));
      const info = registry.get(name);
      if (!info) throw new Error(i18n.t("notInstalled") + ": " + name);
      await killer.killAndWait({ name, fileName: info.fileName }, 500);
      if (info.path && fs.existsSync(info.path)) {
        try {
          const stat = fs.statSync(info.path);
          if (stat.isDirectory()) rmrf(info.path);
          else fs.unlinkSync(info.path);
          log.info(i18n.t("deletedPath") + " " + info.path);
        } catch (_) {
        }
      }
      registry.remove(name);
      versionLib.removeCurrent(name);
      log.success(i18n.t("uninstalled") + " " + name);
    }
    async function updatePackage(name, flags) {
      flags = Object.assign({ q: true }, flags || {});
      flags.q = true;
      const installed = registry.list();
      if (!installed.length) {
        log.info(i18n.t("noInstalledPkgs"));
        return 0;
      }
      const targets = name ? installed.filter(function(p) {
        return p.name === name;
      }) : installed;
      if (name && !targets.length) throw new Error(i18n.t("notInstalled") + ": " + name);
      let count = 0;
      for (const inst of targets) {
        const pkg = sources.find(inst.name);
        if (!pkg || !pkg.latest) {
          log.warn(i18n.t("pkgNotFound") + ": " + inst.name);
          continue;
        }
        if (versionLib.compareVer(pkg.latest.version, inst.version) <= 0) {
          log.info("  " + inst.name + " v" + inst.version + "  " + i18n.t("updateAlreadyLatest"));
          continue;
        }
        log.info("  " + inst.name + " v" + inst.version + " -> v" + pkg.latest.version);
        const customPath = inst.path || null;
        const n = await killer.killAndWait({ name: inst.name, fileName: pkg.latest.fileName }, 800);
        if (n > 0) log.info("  " + i18n.t("killedProcess") + " " + inst.name);
        await install(pkg.name, pkg.latest.version, customPath, {
          q: true,
          k: false,
          "no-run": false,
          kill: false
        });
        count++;
      }
      return count;
    }
    async function addPackage(name, url, flags) {
      flags = flags || {};
      if (!name) throw new Error(i18n.t("addUsage"));
      if (!url) {
        log.warn(i18n.t("addNeedUrl"));
        return;
      }
      const tempdir = config.get("tempdir");
      ensureDir(tempdir);
      const urlPath = new URL(url).pathname;
      const fileName = path2.basename(urlPath) || name;
      const dest = path2.join(tempdir, fileName);
      log.step(i18n.t("addingPkg") + " " + name + " <- " + url);
      const dlTask = tasks.register(name, "download");
      try {
        await net.downloadWithRetry(url, dest, { task: dlTask, progress: !flags.q });
      } finally {
        tasks.unregister(dlTask);
      }
      const isInstaller = runner.isInstallerType(fileName);
      if (isInstaller && !flags["no-run"]) {
        const instTask = tasks.register(name, "install");
        try {
          const code = await runner.runInstaller(dest, fileName, flags);
          if (code === 0 || code === 3010) log.success(i18n.t("installerDone"));
          else log.warn(i18n.t("installerExitCode") + ": " + code);
        } catch (err) {
          log.error(i18n.t("installerFailed") + ": " + err.message);
        } finally {
          tasks.unregister(instTask);
        }
        if (!flags.k) {
          try {
            fs.unlinkSync(dest);
          } catch (_) {
          }
        }
      }
      registry.add(name, {
        name,
        version: null,
        source: url,
        path: dest,
        type: isInstaller ? "installer" : "added",
        installedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      log.success(i18n.t("addingDone") + " " + name);
    }
    async function registerDisk(name, diskPath) {
      if (!name || !diskPath) throw new Error(i18n.t("redaddUsage"));
      const fullPath = path2.resolve(diskPath);
      if (!fs.existsSync(fullPath)) throw new Error(i18n.t("pathNotExist") + ": " + fullPath);
      registry.add(name, {
        name,
        version: null,
        source: "disk",
        path: fullPath,
        type: "registered",
        registeredAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      log.success(i18n.t("registered") + " " + name + " -> " + fullPath);
    }
    async function unregister(name) {
      if (!name) throw new Error(i18n.t("redelUsage"));
      const info = registry.get(name);
      if (!info) throw new Error(i18n.t("notRegistered") + ": " + name);
      registry.remove(name);
      log.success(i18n.t("unregistered") + " " + name + " (" + i18n.t("diskKeep") + " " + info.path + ")");
    }
    module2.exports = {
      install,
      uninstall,
      updatePackage,
      addPackage,
      registerDisk,
      unregister
    };
  }
});

// src/downloader.js
var require_downloader = __commonJS({
  "src/downloader.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var sources = require_sources();
    var net = require_net();
    var i18n = require_i18n();
    var { ensureDir, log, formatBytes } = require_utils();
    async function download(name, version, flags) {
      flags = flags || {};
      if (!name) throw new Error(i18n.t("downloadUsage"));
      const pkg = sources.find(name);
      if (!pkg) throw new Error(i18n.t("pkgNotFound") + ": " + name);
      let target;
      if (version) {
        target = pkg.versions.find(function(v) {
          return v.version === version;
        });
        if (!target) throw new Error(i18n.t("versionNotFound") + ": " + name + "@" + version);
      } else {
        target = pkg.latest;
      }
      if (!target) throw new Error(name + " " + i18n.t("noFilesInPkg"));
      const outName = flags.n || target.fileName;
      const dest = path2.resolve(process.cwd(), outName);
      log.step(i18n.t("downloadStep") + " " + pkg.name + " v" + target.version);
      if (target.size) log.info(i18n.t("downloadSize") + ": " + formatBytes(target.size));
      ensureDir(path2.dirname(dest));
      await net.downloadWithRetry(target.url, dest, { expectedSize: target.size });
      log.success(i18n.t("downloadDone") + ": " + dest);
    }
    module2.exports = { download };
  }
});

// src/pak.js
var require_pak = __commonJS({
  "src/pak.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var PAK_FILE = path2.join(config.ROOT, "pak.json");
    var RESERVED = [
      "ipm",
      "pak",
      "help",
      "list",
      "install",
      "i",
      "add",
      "del",
      "delete",
      "update",
      "exit",
      "quit",
      "clear",
      "set",
      "lang",
      "get",
      "search",
      "download",
      "uninstall",
      "remove",
      "rm",
      "redadd",
      "redel",
      "temp",
      "run",
      "cli"
    ];
    function empty() {
      return { version: 1, updatedAt: null, packages: {} };
    }
    function load() {
      try {
        const d = JSON.parse(fs.readFileSync(PAK_FILE, "utf8"));
        if (!d.packages || typeof d.packages !== "object") d.packages = {};
        return d;
      } catch (_) {
        return empty();
      }
    }
    function save(d) {
      d.version = d.version || 1;
      d.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      try {
        fs.mkdirSync(path2.dirname(PAK_FILE), { recursive: true });
        fs.writeFileSync(PAK_FILE, JSON.stringify(d, null, 2) + "\n", "utf8");
      } catch (_) {
      }
      return d;
    }
    function list() {
      return Object.values(load().packages).sort(function(a, b) {
        return String(a.name).localeCompare(String(b.name));
      });
    }
    function get(name) {
      return load().packages[name] || null;
    }
    function has(name) {
      return Boolean(get(name));
    }
    function validateName(name) {
      if (!name || typeof name !== "string") return { ok: false, error: "nameEmpty" };
      name = name.trim();
      if (!name) return { ok: false, error: "nameEmpty" };
      if (name.length > 64) return { ok: false, error: "nameTooLong" };
      if (!/^[a-zA-Z]/.test(name)) return { ok: false, error: "nameMustStartWithLetter" };
      if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) return { ok: false, error: "nameInvalidChars" };
      if (/[._-]$/.test(name)) return { ok: false, error: "nameInvalidChars" };
      if (name.indexOf("..") !== -1) return { ok: false, error: "nameInvalidChars" };
      if (RESERVED.indexOf(name.toLowerCase()) !== -1) return { ok: false, error: "nameReserved" };
      return { ok: true, name };
    }
    function validateUrl(url) {
      if (!url || typeof url !== "string") return { ok: false, error: "urlEmpty" };
      url = url.trim();
      if (!url) return { ok: false, error: "urlEmpty" };
      try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "urlProtocol" };
        return { ok: true, url: u.toString() };
      } catch (_) {
        return { ok: false, error: "urlInvalid" };
      }
    }
    function add(name, url, flags) {
      flags = flags || {};
      const nc = validateName(name);
      if (!nc.ok) return { ok: false, error: nc.error, kind: "name" };
      name = nc.name;
      const uc = validateUrl(url);
      if (!uc.ok) return { ok: false, error: uc.error, kind: "url" };
      url = uc.url;
      const data = load();
      if (data.packages[name] && !flags.force) return { ok: false, error: "nameExists", kind: "name" };
      let fileName = "";
      try {
        fileName = path2.basename(new URL(url).pathname);
      } catch (_) {
      }
      if (!fileName) fileName = name;
      data.packages[name] = { name, url, file: fileName, addedAt: (/* @__PURE__ */ new Date()).toISOString() };
      save(data);
      return { ok: true, pkg: data.packages[name] };
    }
    function remove(name) {
      if (!name) return { ok: false, error: "notFound" };
      const data = load();
      if (!data.packages[name]) return { ok: false, error: "notFound" };
      const pkg = data.packages[name];
      delete data.packages[name];
      save(data);
      return { ok: true, pkg };
    }
    module2.exports = {
      PAK_FILE,
      empty,
      load,
      save,
      list,
      get,
      has,
      validateName,
      validateUrl,
      add,
      remove,
      RESERVED
    };
  }
});

// src/auth.js
var require_auth = __commonJS({
  "src/auth.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var os = require("os");
    var AUTH_FILE = path2.join(os.homedir(), ".ipm", "auth.json");
    function load() {
      try {
        return JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
      } catch (_) {
        return null;
      }
    }
    function save(d) {
      fs.mkdirSync(path2.dirname(AUTH_FILE), { recursive: true });
      fs.writeFileSync(AUTH_FILE, JSON.stringify(d, null, 2) + "\n", "utf8");
      try {
        fs.chmodSync(AUTH_FILE, 384);
      } catch (_) {
      }
    }
    function logout() {
      try {
        fs.unlinkSync(AUTH_FILE);
        return true;
      } catch (_) {
        return false;
      }
    }
    function getToken() {
      const a = load();
      return a && a.token || process.env['gittoken_zssx-2026_1'] || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    }
    module2.exports = { load, save, logout, getToken, AUTH_FILE };
  }
});

// src/login.js
var require_login = __commonJS({
  "src/login.js"(exports2, module2) {
    "use strict";
    var { spawn } = require("child_process");
    var net = require_net();
    var auth = require_auth();
    var i18n = require_i18n();
    var { color, log } = require_utils();
    var SCOPES = "repo,read:user,user:email";
    var APP_NAME = "InfinityPackageManager";
    var RED = "\x1B[31m";
    var YEL = "\x1B[33m";
    var CYA = "\x1B[36m";
    var GRN = "\x1B[32m";
    var DIM = "\x1B[90m";
    var RST = "\x1B[0m";
    var BLD = "\x1B[1m";
    function buildTokenUrl() {
      return "https://github.com/settings/tokens/new?scopes=" + encodeURIComponent(SCOPES) + "&description=" + encodeURIComponent(APP_NAME + " (" + (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) + ")");
    }
    function openBrowser(url) {
      return new Promise(function(resolve) {
        let cmd, args2;
        if (process.platform === "win32") {
          cmd = "cmd";
          args2 = ["/c", "start", '""', url];
        } else if (process.platform === "darwin") {
          cmd = "open";
          args2 = [url];
        } else {
          cmd = "xdg-open";
          args2 = [url];
        }
        try {
          const child = spawn(cmd, args2, { detached: true, stdio: "ignore", windowsHide: true });
          child.on("error", function() {
            resolve(false);
          });
          child.unref();
          resolve(true);
        } catch (_) {
          resolve(false);
        }
      });
    }
    function ask(question) {
      return new Promise(function(resolve) {
        const rl = global.__ipm_rl;
        if (rl && rl.question) {
          rl.question(question, function(a) {
            resolve(String(a || ""));
          });
          return;
        }
        process.stdout.write(question);
        let buf = "";
        function onData(c) {
          buf += String(c);
          const i = buf.indexOf("\n");
          if (i === -1 && buf.indexOf("\r") === -1) return;
          process.stdin.removeListener("data", onData);
          resolve(buf.split(/[\r\n]/)[0]);
        }
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", onData);
        process.stdin.resume();
      });
    }
    async function verifyToken(token) {
      const res = await net.httpGetWithRetry("https://api.github.com/user", {
        headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json" }
      });
      if (res.statusCode === 200) {
        try {
          return JSON.parse(res.body.toString("utf8"));
        } catch (_) {
          return {};
        }
      }
      return null;
    }
    function maskToken(t) {
      if (!t) return "(\u7A7A)";
      if (t.length <= 12) return t;
      return t.slice(0, 8) + "..." + t.slice(-4);
    }
    async function login() {
      const existing = auth.load();
      if (existing && existing.token) {
        console.log(CYA + "i" + RST + " \u5DF2\u767B\u5F55\u4E3A: " + BLD + (existing.username || "?") + RST);
        return;
      }
      const url = buildTokenUrl();
      console.log("");
      console.log("  " + CYA + "\u8BF7\u8BBF\u95EE\u4EE5\u4E0B\u94FE\u63A5\u521B\u5EFA GitHub Token" + RST);
      console.log("");
      console.log("  " + DIM + "1." + RST + " \u5728\u6253\u5F00\u7684\u9875\u9762\u70B9\u51FB " + YEL + "Generate new token (classic)" + RST);
      console.log("  " + DIM + "2." + RST + " \u786E\u8BA4\u6743\u9650: " + YEL + "repo, read:user, user:email" + RST);
      console.log("  " + DIM + "3." + RST + " \u70B9\u51FB\u751F\u6210\u5E76\u590D\u5236 token");
      console.log("");
      console.log("  URL: " + CYA + url + RST);
      console.log("");
      const opened = await openBrowser(url);
      if (opened) {
        console.log(GRN + "+" + RST + " \u5DF2\u6253\u5F00\u6D4F\u89C8\u5668");
      } else {
        console.log(YEL + "!" + RST + " \u65E0\u6CD5\u81EA\u52A8\u6253\u5F00\u6D4F\u89C8\u5668\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\u4E0A\u9762\u7684 URL");
      }
      console.log("");
      const token = (await ask(CYA + "\u7C98\u8D34 Token" + RST + ": ")).trim();
      if (!token) {
        console.log(RED + "x" + RST + " \u5DF2\u53D6\u6D88");
        return;
      }
      console.log("  " + DIM + "\u6536\u5230 Token: " + RST + maskToken(token));
      if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_)/.test(token)) {
        console.log(YEL + "!" + RST + " Token \u683C\u5F0F\u4E0D\u5E38\u89C1\uFF08\u901A\u5E38\u4EE5 ghp_ \u5F00\u5934\uFF09\uFF0C\u7EE7\u7EED\u9A8C\u8BC1...");
      }
      console.log(CYA + "i" + RST + " \u9A8C\u8BC1\u4E2D...");
      const user = await verifyToken(token);
      if (!user) {
        console.log(RED + "x" + RST + " Token \u65E0\u6548\u6216\u7F51\u7EDC\u5931\u8D25");
        console.log("  " + DIM + "\u4F7F\u7528\u7684 Token: " + RST + maskToken(token));
        console.log("  " + DIM + "\u8BF7\u68C0\u67E5:" + RST);
        console.log("    - Token \u662F\u5426\u5B8C\u6574\u590D\u5236");
        console.log("    - \u6743\u9650\u662F\u5426\u5305\u542B " + YEL + "repo" + RST);
        console.log("    - \u7F51\u7EDC\u662F\u5426\u80FD\u8BBF\u95EE api.github.com");
        return;
      }
      auth.save({
        token,
        username: user.login,
        email: user.email || "",
        scopes: SCOPES,
        loggedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      console.log(GRN + "+" + RST + " \u767B\u5F55\u6210\u529F: " + BLD + CYA + user.login + RST);
    }
    module2.exports = { login, ask, verifyToken, buildTokenUrl, openBrowser };
  }
});

// src/release.js
var require_release = __commonJS({
  "src/release.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var https = require("https");
    var auth = require_auth();
    var i18n = require_i18n();
    var { log, color, formatBytes } = require_utils();

    /*
     * Certificate verification, and why it is allowed to fail once.
     *
     * Where the hosts file sends github.com to 127.0.0.1 the peer on the other
     * end of the TLS handshake is a local relay presenting its own certificate
     * - FastGithub is the usual one. The public roots cannot verify it and the
     * handshake dies with "unable to verify the first certificate", which is a
     * statement about the relay rather than about GitHub.
     *
     * So the first attempt verifies, exactly as it should on a normal network.
     * Only a certificate error switches to an unverified retry, only for the
     * rest of the process, and only after saying so once.
     */
    var insecureTls = process.env.INFINITY_TLS_INSECURE === "1";
    var warnedAboutTls = false;
    function certError(e) {
      var m = String((e && e.message) || "") + " " + String((e && e.code) || "");
      return /unable to verify|certificate|CERT_|UNABLE_TO_VERIFY|self.signed|SELF_SIGNED|ERR_TLS/i.test(m);
    }
    function noteInsecure() {
      if (warnedAboutTls) return;
      warnedAboutTls = true;
      try {
        process.stderr.write("note: the local GitHub relay uses a certificate this machine cannot verify; continuing without verification for this session.\n");
      } catch (e) {
      }
    }
    function retryOnCertError(run, insecure) {
      return run(insecure).catch(function(e) {
        if (!certError(e) || insecure) throw e;
        insecureTls = true;
        noteInsecure();
        return run(true);
      });
    }
    var RELEASE_KEYS = ["type", "name", "tag", "mainurl", "assets", "namefile", "readme"];
    function parseReleaseArgs(rest) {
      const raw = (rest || []).join(" ");
      const out = {
        type: null,
        name: null,
        tag: null,
        mainurl: null,
        assets: [],
        namefile: null,
        readme: null
      };
      const positions = [];
      for (const k of RELEASE_KEYS) {
        const re = new RegExp("(?:^|\\s)" + k + "\\s*[=:]\\s*", "g");
        let m;
        while ((m = re.exec(raw)) !== null) {
          const keyStart = m.index + (m[0][0] === " " ? 1 : 0);
          positions.push({ key: k, start: keyStart, valueStart: m.index + m[0].length });
        }
      }
      positions.sort(function(a, b) {
        return a.valueStart - b.valueStart;
      });
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const end = i + 1 < positions.length ? positions[i + 1].start : raw.length;
        let val = raw.slice(p.valueStart, end).trim();
        val = val.replace(/,\s*$/, "");
        if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        if (p.key === "assets") {
          if (val.startsWith("[") && val.endsWith("]")) val = val.slice(1, -1);
          out.assets = val.split(",").map(function(s) {
            return s.trim().replace(/^["']|["']$/g, "");
          }).filter(Boolean);
        } else {
          out[p.key] = val || null;
        }
      }
      return out;
    }
    function validate(parsed) {
      const errors = [];
      if (!parsed.type) {
        errors.push("\u7F3A\u5C11 type\uFF08plugin \u6216 application\uFF09");
      } else if (parsed.type !== "plugin" && parsed.type !== "application") {
        errors.push("type \u5FC5\u987B\u662F plugin \u6216 application\uFF0C\u5F53\u524D: " + parsed.type);
      }
      if (!parsed.name) errors.push("\u7F3A\u5C11 name");
      if (!parsed.tag) errors.push("\u7F3A\u5C11 tag");
      if (!parsed.mainurl) errors.push("\u7F3A\u5C11 mainurl");
      if (!parsed.assets || !parsed.assets.length) errors.push("assets \u4E0D\u80FD\u4E3A\u7A7A");
      if (!parsed.namefile) errors.push("\u7F3A\u5C11 namefile");
      if (!parsed.readme) errors.push("\u7F3A\u5C11 readme");
      if (parsed.namefile && !path2.isAbsolute(parsed.namefile)) {
        errors.push("namefile \u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84: " + parsed.namefile);
      }
      if (parsed.readme && !path2.isAbsolute(parsed.readme)) {
        errors.push("readme \u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84: " + parsed.readme);
      }
      return errors;
    }
    function parseRepo(mainurl) {
      const s = String(mainurl || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
      let m = s.match(/github\.com[\/:]([^\/]+)\/([^\/\?#]+)/);
      if (m) return { owner: m[1], repo: m[2] };
      m = s.match(/^([^\/\s]+)\/([^\/\s]+)$/);
      if (m) return { owner: m[1], repo: m[2] };
      return null;
    }
    function apiOnce(method, url, body, insecure) {
      return new Promise(function(resolve, reject) {
        let u;
        try {
          u = new URL(url);
        } catch (e) {
          return reject(e);
        }
        const t = auth.getToken();
        const h = {
          authorization: "Bearer " + t,
          accept: "application/vnd.github+json",
          "user-agent": "InfinityPackageManager/1.0.0"
        };
        let d = null;
        if (body) {
          d = Buffer.from(JSON.stringify(body));
          h["content-type"] = "application/json";
          h["content-length"] = d.length;
        }
        const req = https.request({
          hostname: u.hostname,
          path: u.pathname + u.search,
          method,
          headers: h,
          rejectUnauthorized: !insecure
        }, function(r) {
          const c = [];
          r.on("data", function(x) {
            c.push(x);
          });
          r.on("end", function() {
            resolve({ status: r.statusCode, body: Buffer.concat(c) });
          });
        });
        req.on("error", reject);
        if (d) req.write(d);
        req.end();
      });
    }
    function api(method, url, body) {
      return retryOnCertError(function(insecure) {
        return apiOnce(method, url, body, insecure);
      }, insecureTls);
    }
    function uploadAssetOnce(owner, repo, releaseId, fp, fn, insecure) {
      return new Promise(function(resolve, reject) {
        const t = auth.getToken();
        const buf = fs.readFileSync(fp);
        const req = https.request({
          hostname: "uploads.github.com",
          path: "/repos/" + owner + "/" + repo + "/releases/" + releaseId + "/assets?name=" + encodeURIComponent(fn),
          method: "POST",
          headers: {
            authorization: "Bearer " + t,
            "content-type": "application/octet-stream",
            "content-length": buf.length,
            "user-agent": "InfinityPackageManager/1.0.0"
          },
          rejectUnauthorized: !insecure
        }, function(r) {
          const c = [];
          r.on("data", function(x) {
            c.push(x);
          });
          r.on("end", function() {
            resolve({ status: r.statusCode, body: Buffer.concat(c) });
          });
        });
        req.on("error", reject);
        req.write(buf);
        req.end();
      });
    }
    function uploadAsset(owner, repo, releaseId, fp, fn) {
      return retryOnCertError(function(insecure) {
        return uploadAssetOnce(owner, repo, releaseId, fp, fn, insecure);
      }, insecureTls);
    }
    async function run(rest) {
      const parsed = parseReleaseArgs(rest);
      const errors = validate(parsed);
      if (errors.length) {
        log.error("\u53C2\u6570\u9519\u8BEF:");
        for (const e of errors) console.log("  - " + e);
        console.log("");
        console.log("\u7528\u6CD5:");
        console.log("  ipm release type=<plugin|application> name=<name> tag=<tag>");
        console.log("              mainurl=<repo-url|owner/repo>");
        console.log("              assets=<path1,path2,...>");
        console.log("              namefile=<absolute path to name.txt>");
        console.log("              readme=<absolute path to README.md>");
        return { ok: false, reason: "usage" };
      }
      const repo = parseRepo(parsed.mainurl);
      if (!repo) {
        log.error("mainurl \u5FC5\u987B\u662F\u4ED3\u5E93 URL\uFF08https://github.com/user/repo \u6216 user/repo\uFF09");
        return { ok: false, reason: "bad-url" };
      }
      const a = auth.load();
      if (!a || !a.token) {
        const msg = i18n.t("releaseNoAuth") !== "releaseNoAuth" ? i18n.t("releaseNoAuth") : "\u8BF7\u5148\u8FD0\u884C ipm login \u767B\u5F55 GitHub";
        log.error(msg);
        return { ok: false, reason: "no-auth" };
      }
      const absAssets = [];
      for (const f of parsed.assets) {
        const abs = path2.resolve(f);
        if (!fs.existsSync(abs)) {
          log.error("assets \u6587\u4EF6\u4E0D\u5B58\u5728: " + f + "  (" + abs + ")");
          return { ok: false, reason: "asset-missing" };
        }
        absAssets.push(abs);
      }
      if (!fs.existsSync(parsed.namefile)) {
        log.error("namefile \u4E0D\u5B58\u5728: " + parsed.namefile);
        return { ok: false, reason: "namefile-missing" };
      }
      if (!fs.existsSync(parsed.readme)) {
        log.error("readme \u4E0D\u5B58\u5728: " + parsed.readme);
        return { ok: false, reason: "readme-missing" };
      }
      const owner = repo.owner;
      const repoName = repo.repo;
      const ver = parsed.tag.replace(/^v/i, "");
      const tagFull = "v" + ver;
      console.log("");
      console.log("  " + color.bold(color.brightCyan("InfinityPackageManager release")));
      console.log("  " + color.dim("\u7528\u6237:") + " " + color.cyan(a.username));
      console.log("  " + color.dim("\u4ED3\u5E93:") + " " + color.cyan(owner + "/" + repoName));
      console.log("  " + color.dim("\u7C7B\u578B:") + " " + color.cyan(parsed.type));
      console.log("  " + color.dim("\u540D\u79F0:") + " " + color.cyan(parsed.name));
      console.log("  " + color.dim("\u6807\u7B7E:") + " " + color.cyan(tagFull));
      console.log("  " + color.dim("assets:"));
      for (const f of absAssets) {
        console.log("    " + color.brightWhite(path2.basename(f)) + "  " + color.dim(formatBytes(fs.statSync(f).size)));
      }
      console.log("");
      log.step("\u68C0\u67E5 release " + tagFull + " ...");
      let relId = null;
      const getR = await api(
        "GET",
        "https://api.github.com/repos/" + owner + "/" + repoName + "/releases/tags/" + encodeURIComponent(tagFull)
      );
      if (getR.status === 200) {
        const rel = JSON.parse(getR.body.toString("utf8"));
        relId = rel.id;
        log.info("release \u5DF2\u5B58\u5728 (id " + relId + ")\uFF0C\u5C06\u8FFD\u52A0 assets");
      } else if (getR.status === 404) {
        log.step("\u521B\u5EFA release " + tagFull + " ...");
        const createR = await api(
          "POST",
          "https://api.github.com/repos/" + owner + "/" + repoName + "/releases",
          { tag_name: tagFull, name: tagFull, body: "release " + tagFull }
        );
        if (createR.status >= 400) {
          log.error("\u521B\u5EFA release \u5931\u8D25: HTTP " + createR.status);
          log.error(createR.body.toString("utf8").slice(0, 400));
          return { ok: false, reason: "create-release" };
        }
        relId = JSON.parse(createR.body.toString("utf8")).id;
        log.success("\u5DF2\u521B\u5EFA release (id " + relId + ")");
      } else {
        log.error("\u67E5\u8BE2 release \u5931\u8D25: HTTP " + getR.status);
        log.error(getR.body.toString("utf8").slice(0, 400));
        return { ok: false, reason: "query-release" };
      }
      let okN = 0, failN = 0;
      console.log("");
      for (const f of absAssets) {
        const fn = path2.basename(f);
        const sz = formatBytes(fs.statSync(f).size);
        log.step("\u4E0A\u4F20 " + fn + "  (" + sz + ")");
        try {
          const r = await uploadAsset(owner, repoName, relId, f, fn);
          if (r.status === 201 || r.status === 200) {
            log.success("  " + fn);
            okN++;
          } else if (r.status === 422) {
            log.warn("  " + fn + " \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7");
          } else {
            log.error("  " + fn + " HTTP " + r.status);
            failN++;
          }
        } catch (e) {
          log.error("  " + fn + ": " + e.message);
          failN++;
        }
      }
      log.step("\u4E0A\u4F20 name.txt");
      try {
        const r = await uploadAsset(owner, repoName, relId, parsed.namefile, "name.txt");
        if (r.status === 201 || r.status === 200) log.success("  name.txt");
        else if (r.status === 422) log.warn("  name.txt \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7");
        else log.warn("  name.txt HTTP " + r.status);
      } catch (e) {
        log.warn("  name.txt: " + e.message);
      }
      log.step("\u4E0A\u4F20 README.md");
      try {
        const r = await uploadAsset(owner, repoName, relId, parsed.readme, "README.md");
        if (r.status === 201 || r.status === 200) log.success("  README.md");
        else if (r.status === 422) log.warn("  README.md \u5DF2\u5B58\u5728\uFF0C\u8DF3\u8FC7");
        else log.warn("  README.md HTTP " + r.status);
      } catch (e) {
        log.warn("  README.md: " + e.message);
      }
      console.log("");
      log.success("\u53D1\u5E03\u5B8C\u6210: " + okN + " assets");
      console.log("  " + color.cyan("https://github.com/" + owner + "/" + repoName + "/releases/tag/" + tagFull));
      return { ok: true, owner, repo: repoName, tag: tagFull };
    }
    module2.exports = { run, parseReleaseArgs };
  }
});

// src/self-update.js
var require_self_update = __commonJS({
  "src/self-update.js"(exports2, module2) {
    "use strict";
    var net = require_net();
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var auth = require_auth();
    var i18n = require_i18n();
    var versionLib = require_version();
    var { color, log, formatBytes } = require_utils();
    async function fetchSelfReleases() {
      const headers = {
        "accept": "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "InfinityPackageManager/1.0.0"
      };
      const token = auth.getToken();
      if (token) headers.authorization = "Bearer " + token;
      const url = "https://api.github.com/repos/zssx-2026/applications/releases?per_page=100";
      const res = await net.httpGetWithRetry(url, { headers });
      if (res.statusCode === 404) throw new Error("repo not found");
      if (res.statusCode >= 400) throw new Error("HTTP " + res.statusCode);
      let arr;
      try {
        arr = JSON.parse(res.body.toString("utf8"));
      } catch (e) {
        throw new Error("parse error");
      }
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (const r of arr) {
        if (r.draft) continue;
        const tag = r.tag_name || "";
        if (!/^v\d+\.\d+(\.\d+)?$/i.test(tag)) continue;
        out.push({
          tag,
          version: tag.replace(/^v/i, ""),
          name: r.name || tag,
          htmlUrl: r.html_url,
          publishedAt: r.published_at,
          body: (r.body || "").slice(0, 500),
          assets: (r.assets || []).map(function(a) {
            return {
              name: a.name,
              size: a.size,
              url: a.browser_download_url
            };
          })
        });
      }
      out.sort(function(a, b) {
        return versionLib.compareVer(a.version, b.version);
      });
      return out;
    }
    async function updateSelf(flags) {
      flags = flags || {};
      const current = versionLib.getPkgVersion();
      log.step(i18n.t("selfUpdateFetching"));
      let rels;
      try {
        rels = await fetchSelfReleases();
      } catch (e) {
        log.error(i18n.t("fetchPkgsFail") + ": " + e.message);
        return;
      }
      if (!rels.length) {
        log.info(i18n.t("selfUpdateNone"));
        console.log("  " + i18n.t("selfUpdateCurrent") + ": v" + current);
        return;
      }
      const latest = rels[rels.length - 1];
      const latestVer = latest.version;
      console.log("  " + i18n.t("selfUpdateCurrent") + ": " + color.cyan("v" + current));
      console.log("  " + i18n.t("selfUpdateLatest") + ":  " + color.cyan("v" + latestVer));
      if (versionLib.compareVer(latestVer, current) <= 0) {
        console.log("");
        log.success(i18n.t("selfUpdateUpToDate"));
        return;
      }
      console.log("");
      log.warn(i18n.t("selfUpdateFound"));
      if (latest.publishedAt) {
        console.log("  " + color.gray(latest.publishedAt));
      }
      if (latest.htmlUrl) {
        console.log("  " + color.gray(latest.htmlUrl));
      }
      if (latest.assets && latest.assets.length) {
        console.log("");
        console.log("  " + i18n.t("selfUpdateAssets") + ":");
        for (const a of latest.assets) {
          console.log("    - " + a.name + "  " + color.gray("(" + formatBytes(a.size) + ")"));
        }
      }
      console.log("");
      if (flags.check) {
        log.info(i18n.t("selfUpdateCheckOnly"));
        return;
      }
      const setup = (latest.assets || []).find(function(a) {
        return /\.(exe|msi)$/i.test(a.name) && /setup|installer/i.test(a.name);
      }) || (latest.assets || []).find(function(a) {
        return /\.exe$/i.test(a.name);
      });
      if (!setup) {
        log.warn(i18n.t("selfUpdateNoInstaller"));
        console.log("  " + color.gray(latest.htmlUrl));
        return;
      }
      const tmpdir = config.get("tempdir");
      fs.mkdirSync(tmpdir, { recursive: true });
      const dest = path2.join(tmpdir, setup.name);
      log.step(i18n.t("selfUpdateDownloading") + " " + setup.name);
      try {
        await net.downloadWithRetry(setup.url, dest, {});
      } catch (e) {
        log.error(i18n.t("selfUpdateDownloadFailed") + ": " + e.message);
        return;
      }
      log.success(i18n.t("selfUpdateDownloaded") + ": " + dest);
      console.log("");
      log.info(i18n.t("selfUpdateRunHint") + ":");
      console.log("  " + color.cyan(dest));
    }
    module2.exports = { updateSelf, fetchSelfReleases };
  }
});

// src/names.js
var require_names = __commonJS({
  "src/names.js"(exports2, module2) {
    "use strict";
    function parse(text) {
      const out = [];
      const lines = String(text || "").split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line[0] === "#") continue;
        const parts = line.split(/\s+/);
        if (parts.length < 4) continue;
        const fileName = parts[0];
        let version = parts[1] || "";
        if (/^v/i.test(version)) version = version.slice(1);
        const name = parts[2];
        const type = (parts[3] || "").toLowerCase();
        const company = parts[4] || "null";
        /*
         * The sixth column names the operating system the file targets.
         * Files published before this column existed simply stop at the
         * company, so an absent value is kept as an empty string - meaning
         * any platform - rather than guessed at from the file name.
         */
        const platform = (parts[5] || "").toLowerCase();
        if (type !== "setup" && type !== "port") continue;
        out.push({ fileName, version, name, type, company, platform });
      }
      return out;
    }
    module2.exports = { parse };
  }
});

// src/classify.js
var require_classify = __commonJS({
  "src/classify.js"(exports2, module2) {
    "use strict";
    var INSTALLER_KEYWORDS = [
      "_setup",
      "-setup",
      ".setup",
      "_installer",
      "-installer",
      ".installer",
      "_install.",
      "-install.",
      ".install.",
      "-install-",
      "_install-",
      "setup_",
      "setup-",
      "setup.",
      "install_",
      "install-",
      ".msi"
    ];
    var PORTABLE_KEYWORDS = [
      "portable",
      "_portable",
      "-portable",
      ".portable",
      "noinstall",
      "no-install",
      "no_install",
      "green",
      "_green",
      "-green",
      "green_",
      "standalone"
    ];
    var ARCHIVE_EXTS = [
      ".zip",
      ".tar.gz",
      ".tgz",
      ".tar",
      ".7z",
      ".rar",
      ".xz",
      ".bz2",
      ".gz"
    ];
    function isInstaller(name) {
      const lower = String(name || "").toLowerCase();
      for (const k of INSTALLER_KEYWORDS) {
        if (lower.indexOf(k) !== -1) return true;
      }
      return false;
    }
    function isPortable(name) {
      const lower = String(name || "").toLowerCase();
      for (const k of PORTABLE_KEYWORDS) {
        if (lower.indexOf(k) !== -1) return true;
      }
      return false;
    }
    function isArchive(name) {
      const lower = String(name || "").toLowerCase();
      for (const e of ARCHIVE_EXTS) {
        if (lower.endsWith(e)) return true;
      }
      return false;
    }
    function isExe(name) {
      return /\.(exe|app|bin|run|appimage)$/i.test(String(name || ""));
    }
    function classify(fileName) {
      if (!fileName) return "unknown";
      if (isInstaller(fileName)) return "installer";
      if (isPortable(fileName)) return "portable";
      if (isArchive(fileName)) return "archive";
      if (isExe(fileName)) return "exe";
      return "unknown";
    }
    var TYPE_LABEL = {
      installer: "\u5B89\u88C5\u7248",
      portable: "\u4FBF\u643A\u7248",
      archive: "\u538B\u7F29\u5305",
      exe: "\u53EF\u6267\u884C",
      unknown: "\u672A\u77E5"
    };
    var TYPE_LABEL_EN = {
      installer: "installer",
      portable: "portable",
      archive: "archive",
      exe: "exe",
      unknown: "unknown"
    };
    module2.exports = {
      classify,
      isInstaller,
      isPortable,
      isArchive,
      isExe,
      TYPE_LABEL,
      TYPE_LABEL_EN
    };
  }
});

// src/update-lib.js
var require_update_lib = __commonJS({
  "src/update-lib.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var https = require("https");
    var http = require("http");
    var config = require_config();
    var names = require_names();
    var classify = require_classify();
    var auth = require_auth();
    var URL_FILE = path2.join(config.ROOT, "url.json");
    var SETTINGS_FILE = path2.join(config.ROOT, "settings.json");
    var MAX_PAGES = 100;
    var PER_PAGE = 100;
    function readJson(f, d) {
      try {
        return JSON.parse(fs.readFileSync(f, "utf8"));
      } catch (_) {
        return d;
      }
    }
    function writeJson(f, d) {
      fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n", "utf8");
    }
    function getNet() {
      const s = readJson(SETTINGS_FILE, {});
      const n = s.network || {};
      return {
        retries: n.retries == null ? 4 : n.retries,
        retryDelayMs: n.retryDelayMs == null ? 800 : n.retryDelayMs,
        timeoutMs: n.timeoutMs == null ? 3e4 : n.timeoutMs
      };
    }
    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }
    function requestOnce(url, t) {
      return new Promise(function(resolve, reject) {
        let u;
        try {
          u = new URL(url);
        } catch (e) {
          return reject(new Error("bad url"));
        }
        const h = {
          "user-agent": "InfinityPackageManager/1.0.0",
          "accept": "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "accept-encoding": "identity",
          "connection": "close"
        };
        const token = auth.getToken();
        if (token) h.authorization = "Bearer " + token;
        const lib = u.protocol === "http:" ? http : https;
        const req = lib.request({
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || void 0,
          path: u.pathname + u.search,
          method: "GET",
          headers: h
        }, function(res) {
          const c = [];
          res.on("data", (x) => c.push(x));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
          res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(t, () => req.destroy(new Error("Timeout")));
        req.end();
      });
    }
    async function retry(url, redirect) {
      if (redirect === void 0) redirect = 0;
      const net = getNet();
      let lastErr = null;
      for (let i = 0; i <= net.retries; i++) {
        try {
          const r = await requestOnce(url, net.timeoutMs);
          if ([301, 302, 303, 307, 308].indexOf(r.status) >= 0 && r.headers.location) {
            if (redirect > 6) throw new Error("too many redirects");
            return await retry(new URL(r.headers.location, url).toString(), redirect + 1);
          }
          if (r.status >= 500) {
            lastErr = new Error("HTTP " + r.status);
            if (i < net.retries) {
              await sleep(net.retryDelayMs * Math.pow(2, i));
              continue;
            }
            throw lastErr;
          }
          return r;
        } catch (e) {
          lastErr = e;
          if (i < net.retries) {
            await sleep(net.retryDelayMs * Math.pow(2, i));
            continue;
          }
          throw e;
        }
      }
      throw lastErr || new Error("failed");
    }
    function normalize(r, repo) {
      const tag = r.tag_name || r.name || "unknown";
      return {
        id: r.id,
        tag,
        name: r.name || tag,
        repo: repo || null,
        prerelease: !!r.prerelease,
        draft: !!r.draft,
        publishedAt: r.published_at,
        createdAt: r.created_at,
        htmlUrl: r.html_url,
        assets: (r.assets || []).map((a) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          contentType: a.content_type,
          downloadCount: a.download_count,
          createdAt: a.created_at,
          updatedAt: a.updated_at,
          type: classify.classify(a.name),
          url: a.browser_download_url,
          digest: a.digest || null
        }))
      };
    }
    function nextLink(h) {
      const l = h && (h.link || h.Link);
      if (!l) return null;
      for (const p of String(l).split(",")) {
        const m = p.match(/<([^>]+)>\s*;\s*rel="next"/);
        if (m) return m[1];
      }
      return null;
    }
    async function fetchRepo(owner, repo) {
      const all = [], seen = /* @__PURE__ */ new Set();
      let url = "https://api.github.com/repos/" + owner + "/" + repo + "/releases?per_page=" + PER_PAGE + "&page=1";
      let page = 1;
      while (url && page <= MAX_PAGES) {
        const r = await retry(url);
        if (r.status === 404) return [];
        if (r.status === 403 || r.status === 429) throw new Error("rate limited");
        if (r.status >= 400) throw new Error("HTTP " + r.status);
        let batch;
        try {
          batch = JSON.parse(r.body.toString("utf8"));
        } catch (e) {
          break;
        }
        if (!Array.isArray(batch) || !batch.length) break;
        for (const x of batch) {
          const k = String(x.id);
          if (seen.has(k)) continue;
          seen.add(k);
          all.push(normalize(x, owner + "/" + repo));
        }
        const n = nextLink(r.headers);
        if (!n) break;
        url = n;
        page++;
      }
      return all;
    }
    async function fetchNameTxt(rel) {
      const a = (rel.assets || []).find((x) => /^name\.txt$/i.test(x.name));
      if (!a) return null;
      try {
        const r = await retry(a.url);
        if (r.status >= 400) return null;
        const t = r.body.toString("utf8");
        return t && t.trim() ? t : null;
      } catch (_) {
        return null;
      }
    }
    function hasAppTag(rel) {
      return /application/i.test(String(rel && rel.tag || "") + " " + String(rel && rel.name || ""));
    }
    function hasPluginTag(rel) {
      return /plugin/i.test(String(rel && rel.tag || "") + " " + String(rel && rel.name || ""));
    }
    async function searchEasypkgmgrRepos() {
      const found = /* @__PURE__ */ new Set();
      try {
        const url = "https://api.github.com/search/repositories?q=topic:easypkgmgr&per_page=100";
        const r = await retry(url);
        if (r.status === 200) {
          const data = JSON.parse(r.body.toString("utf8"));
          for (const item of data.items || []) {
            found.add(item.full_name);
          }
        }
      } catch (_) {
      }
      return Array.from(found);
    }
    async function fetchAll() {
      const urlData = readJson(URL_FILE, {});
      const owner = urlData.source && urlData.source.owner || "zssx-2026";
      const mainRepo = owner + "/applications";
      console.log("[ipm] " + mainRepo + " ...");
      const mainReleases = await fetchRepo(owner, "applications").catch(function(e) {
        console.log("[ipm] " + e.message);
        return [];
      });
      console.log("[ipm] \u641C\u7D22 easypkgmgr \u4ED3\u5E93...");
      const extraRepos = await searchEasypkgmgrRepos();
      console.log("[ipm]   \u627E\u5230 " + extraRepos.length + " \u4E2A");
      const allReleases = [];
      for (const rel of mainReleases) {
        if (rel.draft) continue;
        if (hasAppTag(rel)) rel.kind = "app";
        else if (hasPluginTag(rel)) rel.kind = "plugin";
        else continue;
        const txt = await fetchNameTxt(rel);
        if (txt) {
          rel.nameTxt = { raw: txt, entries: names.parse(txt) };
        }
        allReleases.push(rel);
      }
      for (const full of extraRepos) {
        if (full === mainRepo) continue;
        const [o, r] = full.split("/");
        console.log("[ipm]   " + full + " ...");
        let rels;
        try {
          rels = await fetchRepo(o, r);
        } catch (e) {
          console.log("[ipm]     " + e.message);
          continue;
        }
        for (const rel of rels) {
          if (rel.draft) continue;
          if (hasAppTag(rel)) rel.kind = "app";
          else if (hasPluginTag(rel)) rel.kind = "plugin";
          else continue;
          const txt = await fetchNameTxt(rel);
          if (txt) {
            rel.nameTxt = { raw: txt, entries: names.parse(txt) };
          }
          allReleases.push(rel);
        }
      }
      const apps = allReleases.filter((r) => r.kind === "app");
      const plugins = allReleases.filter((r) => r.kind === "plugin");
      console.log("[ipm] \u5E94\u7528: " + apps.length + " / \u63D2\u4EF6: " + plugins.length);
      const next = {
        version: 1,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        source: {
          owner,
          repo: "applications",
          api: "https://api.github.com/repos/" + owner + "/applications/releases",
          releases: "https://github.com/" + owner + "/applications/releases"
        },
        releases: allReleases
      };
      writeJson(URL_FILE, next);
      return { releases: allReleases, apps: apps.length, plugins: plugins.length };
    }
    module2.exports = { fetchAll, fetchRepo };
  }
});

// src/applist.js
var require_applist = __commonJS({
  "src/applist.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var sources = require_sources();
    var APP_LIST_FILE = path2.join(config.ROOT, "applist.json");
    function build() {
      const pkgs = sources.listPackages();
      const st = sources.stats();
      return {
        version: 1,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        count: pkgs.length,
        stats: {
          pkgCount: st.pkgCount,
          releaseCount: st.releaseCount,
          fileCount: st.fileCount,
          updatedAt: st.updatedAt
        },
        packages: pkgs.map(function(p) {
          return {
            name: p.name,
            type: p.type,
            company: p.company,
            latest: p.latest ? {
              version: p.latest.version,
              tag: p.latest.tag,
              fileName: p.latest.fileName,
              size: p.latest.size,
              url: p.latest.url,
              publishedAt: p.latest.publishedAt
            } : null,
            versions: (p.versions || []).map(function(v) {
              return {
                version: v.version,
                tag: v.tag,
                fileName: v.fileName,
                size: v.size,
                url: v.url,
                publishedAt: v.publishedAt
              };
            })
          };
        })
      };
    }
    function save() {
      const data = build();
      try {
        fs.writeFileSync(APP_LIST_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
      } catch (_) {
      }
      return APP_LIST_FILE;
    }
    function load() {
      try {
        return JSON.parse(fs.readFileSync(APP_LIST_FILE, "utf8"));
      } catch (_) {
        return null;
      }
    }
    module2.exports = {
      APP_LIST_FILE,
      build,
      save,
      load
    };
  }
});

// src/web.js
var require_web = __commonJS({
  "src/web.js"(exports2, module2) {
    "use strict";
    var http = require("http");
    var fs = require("fs");
    var path2 = require("path");
    var { spawn, execFileSync, execSync } = require("child_process");
    var config = require_config();
    var sources = require_sources();
    var registry = require_registry();
    var i18n = require_i18n();
    var versionLib = require_version();
    var platform = require_platform();
    var auth = require_auth();
    var tasks = require_tasks();
    var installer = require_installer();
    var net = require_net();
    var server = null;
    var currentPort = null;
    var currentHost = "127.0.0.1";
    function dbg() {
      if (!process.env.IPM_DEBUG) return;
      const a = Array.from(arguments).map((x) => typeof x === "string" ? x : JSON.stringify(x));
      try {
        process.stderr.write("[ipm-web] " + a.join(" ") + "\n");
      } catch (_) {
      }
    }
    function pidFile() {
      const dir = config.DATA_DIR || config.get("tempdir");
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {
      }
      return path2.join(dir, ".ipm-web.pid");
    }
    function readPid() {
      try {
        return JSON.parse(fs.readFileSync(pidFile(), "utf8"));
      } catch (_) {
        return null;
      }
    }
    function writePid(info) {
      try {
        fs.mkdirSync(path2.dirname(pidFile()), { recursive: true });
        fs.writeFileSync(pidFile(), JSON.stringify(info), "utf8");
      } catch (_) {
      }
    }
    function clearPid() {
      try {
        fs.unlinkSync(pidFile());
      } catch (_) {
      }
    }
    function isAlive(pid) {
      if (!pid || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch (_) {
        return false;
      }
    }
    function json(res, code, data) {
      const b = JSON.stringify(data, null, 2);
      res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(b), "access-control-allow-origin": "*" });
      res.end(b);
    }
    function html(res, code, text2) {
      res.writeHead(code, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(text2) });
      res.end(text2);
    }
    function text(res, code, msg) {
      res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
      res.end(msg);
    }
    function readBody(req) {
      return new Promise((resolve) => {
        const c = [];
        req.on("data", (x) => c.push(x));
        req.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(c).toString("utf8") || "{}"));
          } catch (_) {
            resolve({});
          }
        });
      });
    }
    function esc(s) {
      return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function appHtml() {
      const ver = versionLib.getPkgVersion();
      const plat = platform.platform + "/" + platform.arch;
      const lang = i18n.current();
      const css = [
        ":root{--bg:#0b1220;--bg2:#111a2c;--card:#151f33;--line:#233149;--fg:#e6edf6;--muted:#8495ad;--acc:#38bdf8;--green:#34d399;--yellow:#fbbf24;--red:#f87171}",
        "*{box-sizing:border-box}",
        'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg);font-size:14px;line-height:1.5}',
        "header{padding:14px 24px;background:linear-gradient(180deg,#1a2740,#0b1220);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;flex-wrap:wrap}",
        "header h1{margin:0;font-size:16px;font-weight:600}",
        "header .meta{color:var(--muted);font-size:12px}",
        "header .right{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:13px}",
        "header .who{color:var(--green)}",
        "header .no{color:var(--muted)}",
        "nav{background:var(--bg2);border-bottom:1px solid var(--line);padding:0 24px;display:flex;gap:4px;overflow-x:auto}",
        "nav a{padding:12px 16px;color:var(--muted);cursor:pointer;font-size:13px;border-bottom:2px solid transparent;white-space:nowrap}",
        "nav a:hover{color:var(--fg)}",
        "nav a.on{color:var(--acc);border-bottom-color:var(--acc)}",
        "main{max-width:1280px;margin:0 auto;padding:20px 24px}",
        "button{background:var(--line);color:var(--fg);border:0;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;font-family:inherit}",
        "button:hover{background:#2d3f5e}",
        "button.primary{background:var(--acc);color:#0b1220;font-weight:600}",
        "button.primary:hover{background:#7dd3fc}",
        "button.danger{background:rgba(248,113,113,.15);color:var(--red)}",
        "button:disabled{opacity:.5;cursor:not-allowed}",
        "input,select{background:#0a1424;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px 12px;font-size:14px;outline:none;width:100%}",
        "input:focus,select:focus{border-color:var(--acc)}",
        ".toolbar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center}",
        ".toolbar input{flex:1;min-width:200px}",
        ".toolbar select{width:auto;min-width:120px}",
        ".stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}",
        ".stat{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 16px}",
        ".stat .k{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px}",
        ".stat .v{font-size:22px;font-weight:600;color:var(--acc);margin-top:2px}",
        "table{width:100%;border-collapse:collapse;background:var(--card);border-radius:8px;overflow:hidden;border:1px solid var(--line)}",
        "th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}",
        "th{background:#0f1728;color:var(--muted);font-weight:500;font-size:11px;text-transform:uppercase}",
        "tr:last-child td{border-bottom:0}",
        "tr:hover td{background:rgba(56,189,248,.04)}",
        ".name{font-weight:600}",
        ".badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}",
        ".badge.setup{background:rgba(251,191,36,.15);color:var(--yellow)}",
        ".badge.port{background:rgba(52,211,153,.15);color:var(--green)}",
        ".dim{color:var(--muted)}",
        ".mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--muted)}",
        ".empty{padding:60px 20px;text-align:center;color:var(--muted)}",
        ".loading{padding:40px;text-align:center;color:var(--muted)}",
        ".tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;background:var(--line);color:var(--muted);margin-right:4px}",
        ".bar{display:inline-block;width:120px;height:12px;background:#0a1424;border-radius:3px;overflow:hidden;vertical-align:middle}",
        ".bar span{display:block;height:100%;background:var(--acc);transition:width .3s}",
        ".modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:100}",
        ".modal{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;max-width:520px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)}",
        ".modal h2{margin:0 0 16px;font-size:16px}",
        ".modal .row{margin-bottom:12px}",
        ".modal label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}",
        ".modal .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}",
        ".modal .hint{font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6}",
        ".modal a{color:var(--acc)}",
        ".toast{position:fixed;bottom:24px;right:24px;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--acc);padding:12px 18px;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:400px;font-size:13px;z-index:200}",
        ".toast.err{border-left-color:var(--red)}",
        ".toast.ok{border-left-color:var(--green)}",
        "footer{padding:20px;text-align:center;color:var(--muted);font-size:12px;border-top:1px solid var(--line);margin-top:40px}",
        "a{color:var(--acc)}"
      ].join("\n");
      const js = [
        "var T = {",
        '  tabPackages:"\u5305\u5217\u8868", tabInstalled:"\u5DF2\u5B89\u88C5", tabSearch:"\u641C\u7D22", tabTasks:"\u4EFB\u52A1", tabSettings:"\u8BBE\u7F6E", tabAbout:"\u5173\u4E8E",',
        '  refresh:"\u5237\u65B0", pull:"\u62C9\u53D6\u5217\u8868", pulling:"\u62C9\u53D6\u4E2D...", pullOk:"\u62C9\u53D6\u5B8C\u6210", pullFail:"\u62C9\u53D6\u5931\u8D25",',
        '  login:"\u767B\u5F55", logout:"\u9000\u51FA\u767B\u5F55", loggedIn:"\u5DF2\u767B\u5F55", notLogged:"\u672A\u767B\u5F55",',
        '  colName:"\u540D\u79F0", colType:"\u7C7B\u578B", colCompany:"\u516C\u53F8", colVersion:"\u7248\u672C", colFile:"\u6587\u4EF6", colSize:"\u5927\u5C0F", colActions:"\u64CD\u4F5C",',
        '  install:"\u5B89\u88C5", uninstall:"\u5378\u8F7D", update:"\u66F4\u65B0", updateAll:"\u5168\u90E8\u66F4\u65B0", details:"\u8BE6\u60C5", latest:"\u6700\u65B0",',
        '  noPkgs:"\u6682\u65E0\u6570\u636E\uFF0C\u70B9\u51FB\u62C9\u53D6\u5217\u8868\u4ECE GitHub \u83B7\u53D6\u3002", noInstalled:"\u672A\u5B89\u88C5\u4EFB\u4F55\u5305\u3002",',
        '  searchPh:"\u8F93\u5165\u5305\u540D\u6216\u516C\u53F8\u540D...", filterAll:"\u5168\u90E8\u7C7B\u578B", filterSetup:"\u5B89\u88C5\u7248", filterPort:"\u4FBF\u643A\u7248", searchBtn:"\u641C\u7D22",',
        '  taskEmpty:"\u6CA1\u6709\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1\u3002", taskStop:"\u505C\u6B62", taskStopAll:"\u5168\u90E8\u505C\u6B62", taskDownload:"\u4E0B\u8F7D", taskInstall:"\u5B89\u88C5",',
        '  loading:"\u52A0\u8F7D\u4E2D...",',
        '  confirmUninstall:"\u786E\u8BA4\u5378\u8F7D ", confirmUpdate:"\u786E\u8BA4\u66F4\u65B0 ",',
        '  setKey:"\u8BBE\u7F6E\u9879", setValue:"\u503C", setSave:"\u4FDD\u5B58", setHint:"\u4FEE\u6539\u540E\u70B9\u51FB\u4FDD\u5B58\u7ACB\u5373\u751F\u6548\u3002",',
        '  aboutVer:"\u7248\u672C", aboutPlat:"\u5E73\u53F0", aboutLang:"\u8BED\u8A00",',
        '  aboutWeb:"Web \u63A7\u5236\u53F0\u652F\u6301\u7684\u529F\u80FD", aboutCli:"CLI \u72EC\u6709\u529F\u80FD",',
        '  webFeatures:["\u5217\u51FA\u53EF\u7528\u7684\u5305","\u5217\u51FA\u5DF2\u5B89\u88C5\u7684\u5305","\u641C\u7D22\u5305","\u4ECE GitHub \u62C9\u53D6\u5217\u8868","\u6309\u5305\u540D\u5B89\u88C5","\u66F4\u65B0\u5DF2\u5B89\u88C5\u7684\u5305","\u67E5\u770B\u7248\u672C","\u767B\u5F55/\u9000\u51FA GitHub","\u5378\u8F7D\u5305","\u4ECE URL \u6DFB\u52A0\u5305","\u67E5\u770B/\u4FEE\u6539\u8BBE\u7F6E","\u67E5\u770B/\u505C\u6B62\u4EFB\u52A1"],',
        '  cliFeatures:["\u53D1\u5E03\u5E94\u7528 (release)","\u6E05\u7A7A\u4E0B\u8F7D\u7F13\u5B58 (temp clear)","\u7EC8\u6B62\u6240\u6709\u8FDB\u7A0B (exit)","\u542F\u52A8/\u505C\u6B62 Web \u670D\u52A1 (web)","\u6307\u5B9A\u7AEF\u53E3/\u524D\u53F0\u8FD0\u884C","\u542F\u52A8\u4EA4\u4E92\u5F0F CLI","\u4ECE\u78C1\u76D8\u6CE8\u518C\u5305 (redadd/redel)","\u5217\u51FA\u672C\u5730\u5305 (pak)","\u67E5\u770B\u8BED\u8A00 (lang)"],',
        '  loginTitle:"\u767B\u5F55 GitHub", loginToken:"Token", loginTokenPh:"ghp_xxxxxxxxxxxxxxxxxxxx",',
        '  loginHint:"\u5728 GitHub \u521B\u5EFA Token \u540E\u7C98\u8D34\u5230\u4E0B\u65B9\u3002", loginCancel:"\u53D6\u6D88", loginSubmit:"\u767B\u5F55", loggingIn:"\u767B\u5F55\u4E2D...",',
        '  loginOk:"\u767B\u5F55\u6210\u529F", loginFail:"\u767B\u5F55\u5931\u8D25", logoutOk:"\u5DF2\u9000\u51FA\u767B\u5F55",',
        '  installOk:"\u5B89\u88C5\u5DF2\u5F00\u59CB", uninstallOk:"\u5378\u8F7D\u4E2D", updateOk:"\u66F4\u65B0\u4E2D", setSaved:"\u5DF2\u4FDD\u5B58",',
        '  unknown:"\u672A\u77E5\u9519\u8BEF"',
        "};",
        "",
        'var state = { tab:"packages", pkgs:[], taskTimer:null };',
        "",
        "function esc(s){",
        `  return String(s==null?"":s).replace(/[&<>"']/g,function(c){`,
        `    return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c];`,
        "  });",
        "}",
        "",
        "function toast(msg, kind){",
        '  var el = document.getElementById("toast"); if(el) el.remove();',
        '  var d = document.createElement("div"); d.id="toast";',
        '  d.className = "toast" + (kind==="err"?" err":kind==="ok"?" ok":"");',
        "  d.textContent = msg; document.body.appendChild(d);",
        "  setTimeout(function(){ d.remove(); }, 3500);",
        "}",
        'function toastErr(e){ toast((e&&e.message)||String(e),"err"); }',
        'function toastOk(m){ toast(m,"ok"); }',
        "",
        "function api(method,url,body){",
        "  var opt = { method:method, headers:{} };",
        '  if(body){ opt.headers["content-type"]="application/json"; opt.body = JSON.stringify(body); }',
        "  return fetch(url,opt).then(function(r){",
        '    var ct = r.headers.get("content-type")||"";',
        '    if(ct.indexOf("json")!==-1) return r.json();',
        "    return r.text();",
        "  });",
        "}",
        "",
        "function fmtSize(n){",
        '  if(n==null||n===0) return "-";',
        '  var u=["B","KB","MB","GB","TB"], v=Number(n), i=0;',
        "  while(v>=1024&&i<u.length-1){ v/=1024; i++; }",
        '  return v.toFixed(i===0?0:1)+" "+u[i];',
        "}",
        "",
        "function renderUser(){",
        '  var el = document.getElementById("user");',
        '  api("GET","/api/user").then(function(d){',
        "    if(d.logged){",
        `      el.innerHTML = '<span class="who">'+esc(d.username)+'</span> <button onclick="doLogout()">'+T.logout+'</button>';`,
        "    } else {",
        `      el.innerHTML = '<span class="no">'+T.notLogged+'</span> <button class="primary" onclick="showLogin()">'+T.login+'</button>';`,
        "    }",
        `  }).catch(function(){ el.innerHTML = '<span class="no">'+T.notLogged+'</span>'; });`,
        "}",
        "",
        "function renderNav(){",
        '  var tabs = [["packages",T.tabPackages],["installed",T.tabInstalled],["search",T.tabSearch],["tasks",T.tabTasks],["settings",T.tabSettings],["about",T.tabAbout]];',
        '  document.getElementById("nav").innerHTML = tabs.map(function(x){',
        `    return '<a class="'+(state.tab===x[0]?"on":"")+'" onclick="tab(\\''+x[0]+'\\')">'+x[1]+'</a>';`,
        '  }).join("");',
        "}",
        "",
        "function tab(name){",
        "  state.tab = name;",
        "  if(state.taskTimer){ clearInterval(state.taskTimer); state.taskTimer=null; }",
        "  renderNav();",
        "  var fns = { packages:renderPackages, installed:renderInstalled, search:renderSearch, tasks:renderTasks, settings:renderSettings, about:renderAbout };",
        "  (fns[name]||renderPackages)();",
        "}",
        "",
        "function renderPackages(){",
        '  var main = document.getElementById("main");',
        `  main.innerHTML = '<div class="loading">'+T.loading+'</div>';`,
        '  api("GET","/api/packages").then(function(d){',
        "    state.pkgs = d.packages||[];",
        "    var s = d.stats||{};",
        `    var h = '<div class="stats">';`,
        `    h += '<div class="stat"><div class="k">'+T.tabPackages+'</div><div class="v">'+(d.count||0)+'</div></div>';`,
        `    h += '<div class="stat"><div class="k">Releases</div><div class="v">'+(s.releaseCount||0)+'</div></div>';`,
        `    h += '<div class="stat"><div class="k">Files</div><div class="v">'+(s.fileCount||0)+'</div></div>';`,
        "    h += '</div>';",
        `    h += '<div class="toolbar"><input id="pkgFilter" placeholder="'+esc(T.searchPh)+'" oninput="filterPkgs()"><button class="primary" onclick="doGet()">'+T.pull+'</button><button onclick="renderPackages()">'+T.refresh+'</button></div>';`,
        `    h += '<div id="pkgList"></div>';`,
        "    main.innerHTML = h;",
        "    filterPkgs();",
        `  }).catch(function(e){ main.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; });`,
        "}",
        "",
        "function filterPkgs(){",
        '  var q = (document.getElementById("pkgFilter").value||"").toLowerCase();',
        "  var list = state.pkgs.filter(function(p){ return !q||p.name.toLowerCase().indexOf(q)!==-1||(p.company&&p.company.toLowerCase().indexOf(q)!==-1); });",
        '  var box = document.getElementById("pkgList");',
        `  if(!list.length){ box.innerHTML = '<div class="empty">'+T.noPkgs+'</div>'; return; }`,
        "  var h = '<table><thead><tr><th>'+T.colName+'</th><th>'+T.colType+'</th><th>'+T.colCompany+'</th><th>'+T.colVersion+'</th><th>'+T.colFile+'</th><th>'+T.colSize+'</th><th>'+T.colActions+'</th></tr></thead><tbody>';",
        "  list.forEach(function(p){",
        "    var lat = p.latest||{};",
        `    var badge = p.type==="setup"?'<span class="badge setup">setup</span>':p.type==="port"?'<span class="badge port">port</span>':"";`,
        `    var co = (p.company&&p.company!=="null")?esc(p.company):'<span class="dim">null</span>';`,
        `    var vc = (p.versions&&p.versions.length>1)?' <span class="dim">('+p.versions.length+')</span>':"";`,
        `    h += '<tr><td class="name">'+esc(p.name)+'</td><td>'+badge+'</td><td>'+co+'</td><td>v'+esc(lat.version||"")+vc+'</td><td class="mono">'+esc(lat.fileName||"")+'</td><td class="mono">'+fmtSize(lat.size)+'</td><td><button class="primary" onclick="doInstall(\\''+esc(p.name)+'\\')">'+T.install+'</button>';`,
        `    if(p.versions&&p.versions.length>1) h += ' <button onclick="showVersions(\\''+esc(p.name)+'\\')">'+T.details+'</button>';`,
        "    h += '</td></tr>';",
        "  });",
        "  h += '</tbody></table>';",
        "  box.innerHTML = h;",
        "}",
        "",
        "function renderInstalled(){",
        '  var main = document.getElementById("main");',
        `  main.innerHTML = '<div class="loading">'+T.loading+'</div>';`,
        '  api("GET","/api/installed").then(function(d){',
        `    if(!d.count){ main.innerHTML = '<div class="empty">'+T.noInstalled+'</div>'; return; }`,
        `    var h = '<div class="toolbar"><button onclick="renderInstalled()">'+T.refresh+'</button><button class="primary" onclick="doUpdateAll()">'+T.updateAll+'</button></div>';`,
        "    h += '<table><thead><tr><th>'+T.colName+'</th><th>'+T.colType+'</th><th>'+T.colVersion+'</th><th>'+T.colFile+'</th><th>'+T.colActions+'</th></tr></thead><tbody>';",
        "    d.packages.forEach(function(p){",
        `      var badge = p.type==="setup"?'<span class="badge setup">setup</span>':p.type==="port"?'<span class="badge port">port</span>':"";`,
        `      h += '<tr><td class="name">'+esc(p.name)+'</td><td>'+badge+'</td><td>v'+esc(p.version||"?")+'</td><td class="mono">'+esc(p.fileName||"")+'</td><td><button onclick="doUpdate(\\''+esc(p.name)+'\\')">'+T.update+'</button> <button class="danger" onclick="doUninstall(\\''+esc(p.name)+'\\')">'+T.uninstall+'</button></td></tr>';`,
        "    });",
        "    h += '</tbody></table>';",
        "    main.innerHTML = h;",
        `  }).catch(function(e){ main.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; });`,
        "}",
        "",
        "function renderSearch(){",
        '  var main = document.getElementById("main");',
        `  main.innerHTML = '<div class="toolbar"><input id="sq" placeholder="'+esc(T.searchPh)+'" onkeydown="if(event.key===\\'Enter\\')doSearch()"><select id="stype"><option value="">'+T.filterAll+'</option><option value="setup">'+T.filterSetup+'</option><option value="port">'+T.filterPort+'</option></select><button class="primary" onclick="doSearch()">'+T.searchBtn+'</button></div><div id="sres"></div>';`,
        "}",
        "",
        "function doSearch(){",
        '  var q = document.getElementById("sq").value||"";',
        '  var ty = document.getElementById("stype").value||"";',
        '  var box = document.getElementById("sres");',
        `  box.innerHTML = '<div class="loading">'+T.loading+'</div>';`,
        "  var ps = new URLSearchParams();",
        '  if(q) ps.set("q",q);',
        '  if(ty) ps.set("t",ty);',
        '  ps.set("av","1");',
        '  api("GET","/api/packages?"+ps.toString()).then(function(d){',
        `    if(!d.count){ box.innerHTML = '<div class="empty">'+T.noPkgs+'</div>'; return; }`,
        "    var h = '<table><thead><tr><th>'+T.colName+'</th><th>'+T.colType+'</th><th>'+T.colCompany+'</th><th>'+T.colVersion+'</th><th>'+T.colFile+'</th><th>'+T.colSize+'</th><th>'+T.colActions+'</th></tr></thead><tbody>';",
        "    d.packages.forEach(function(p){",
        `      var badge = p.type==="setup"?'<span class="badge setup">setup</span>':p.type==="port"?'<span class="badge port">port</span>':"";`,
        `      var co = (p.company&&p.company!=="null")?esc(p.company):'<span class="dim">null</span>';`,
        "      p.versions.forEach(function(v,i){",
        "        h += '<tr>';",
        "        if(i===0){",
        `          h += '<td class="name" rowspan="'+p.versions.length+'">'+esc(p.name)+'</td>';`,
        `          h += '<td rowspan="'+p.versions.length+'">'+badge+'</td>';`,
        `          h += '<td rowspan="'+p.versions.length+'">'+co+'</td>';`,
        "        }",
        `        h += '<td>v'+esc(v.version)+(v.version===p.latest.version?' <span class="tag">'+T.latest+'</span>:"")+'</td>';`,
        `        h += '<td class="mono">'+esc(v.fileName)+'</td><td class="mono">'+fmtSize(v.size)+'</td>';`,
        `        h += '<td><button class="primary" onclick="doInstall(\\''+esc(p.name)+'\\',\\''+esc(v.version)+'\\')">'+T.install+'</button></td></tr>';`,
        "      });",
        "    });",
        "    h += '</tbody></table>';",
        "    box.innerHTML = h;",
        `  }).catch(function(e){ box.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; });`,
        "}",
        "",
        "function renderTasks(){ refreshTasks(); state.taskTimer = setInterval(refreshTasks,1000); }",
        "",
        "function refreshTasks(){",
        '  var main = document.getElementById("main");',
        '  api("GET","/api/tasks").then(function(d){',
        "    var list = d.tasks||[];",
        `    var h = '<div class="toolbar"><button onclick="refreshTasks()">'+T.refresh+'</button>';`,
        `    if(list.length) h += '<button class="danger" onclick="doTaskStop(\\'all\\')">'+T.taskStopAll+'</button>';`,
        "    h += '</div>';",
        `    if(!list.length){ h += '<div class="empty">'+T.taskEmpty+'</div>'; }`,
        "    else {",
        "      h += '<table><thead><tr><th>ID</th><th>'+T.colName+'</th><th>'+T.colType+'</th><th>\u8FDB\u5EA6</th><th>'+T.colActions+'</th></tr></thead><tbody>';",
        "      list.forEach(function(tk){",
        "        var pct = tk.total>0?Math.min(tk.bytes/tk.total,1):0;",
        '        var label = tk.type==="download"?T.taskDownload:T.taskInstall;',
        `        h += '<tr><td>'+tk.id+'</td><td class="name">'+esc(tk.name)+'</td><td>'+label+'</td><td>';`,
        '        if(tk.type==="download"){',
        `          h += '<div class="bar"><span style="width:'+(pct*100).toFixed(1)+'%"></span></div> <span class="dim">'+(pct*100).toFixed(1)+'% '+fmtSize(tk.bytes)+' / '+fmtSize(tk.total)+'</span>';`,
        `        } else { h += '<span class="dim">...</span>'; }`,
        `        h += '</td><td><button class="danger" onclick="doTaskStop('+tk.id+')">'+T.taskStop+'</button></td></tr>';`,
        "      });",
        "      h += '</tbody></table>';",
        "    }",
        "    main.innerHTML = h;",
        "  }).catch(function(){});",
        "}",
        "",
        "function renderSettings(){",
        '  var main = document.getElementById("main");',
        `  main.innerHTML = '<div class="loading">'+T.loading+'</div>';`,
        '  api("GET","/api/settings").then(function(d){',
        "    var h = '<table><thead><tr><th>'+T.setKey+'</th><th>'+T.setValue+'</th><th>'+T.colActions+'</th></tr></thead><tbody>';",
        "    Object.keys(d).forEach(function(k){",
        '      var id = "set_"+k.replace(/[^a-zA-Z0-9_]/g,"_");',
        `      h += '<tr><td class="mono">'+esc(k)+'</td><td><input id="'+id+'" value="'+esc(d[k])+'"></td><td><button class="primary" onclick="doSet(\\''+esc(k)+'\\')">'+T.setSave+'</button></td></tr>';`,
        "    });",
        `    h += '</tbody></table><p style="color:var(--muted);font-size:12px;margin-top:12px">'+T.setHint+'</p>';`,
        "    main.innerHTML = h;",
        `  }).catch(function(e){ main.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; });`,
        "}",
        "",
        "function doSet(key){",
        '  var id = "set_"+key.replace(/[^a-zA-Z0-9_]/g,"_");',
        "  var el = document.getElementById(id); if(!el) return;",
        '  api("POST","/api/set",{key:key,value:el.value}).then(function(r){',
        '    if(r.ok) toastOk(T.setSaved+": "+key); else toastErr(r.error||T.unknown);',
        "  }).catch(toastErr);",
        "}",
        "",
        "function renderAbout(){",
        '  var main = document.getElementById("main");',
        '  api("GET","/api/version").then(function(d){',
        `    var h = '<div class="stats">';`,
        `    h += '<div class="stat"><div class="k">'+T.aboutVer+'</div><div class="v">v'+esc(d.ipm)+'</div></div>';`,
        `    h += '<div class="stat"><div class="k">'+T.aboutPlat+'</div><div class="v" style="font-size:14px">'+esc(d.platform+"/"+d.arch)+'</div></div>';`,
        `    h += '<div class="stat"><div class="k">'+T.aboutLang+'</div><div class="v" style="font-size:14px">'+esc(d.lang)+'</div></div></div>';`,
        `    h += '<h2 style="font-size:15px;margin:24px 0 12px">'+T.aboutWeb+'</h2><ul style="line-height:1.8;padding-left:20px">';`,
        "    T.webFeatures.forEach(function(f){ h += '<li>'+f+'</li>'; }); h += '</ul>';",
        `    h += '<h2 style="font-size:15px;margin:24px 0 12px">'+T.aboutCli+'</h2><ul style="line-height:1.8;color:var(--muted);padding-left:20px">';`,
        "    T.cliFeatures.forEach(function(f){ h += '<li>'+f+'</li>'; }); h += '</ul>';",
        `    h += '<h2 style="font-size:15px;margin:24px 0 12px">API</h2><p class="dim">\u5B8C\u6574 API \u7D22\u5F15: <a href="/api" target="_blank">/api</a></p>';`,
        "    main.innerHTML = h;",
        `  }).catch(function(e){ main.innerHTML = '<div class="empty">'+esc(e.message)+'</div>'; });`,
        "}",
        "",
        "function modal(html){",
        '  var el = document.createElement("div"); el.className="modal-bg"; el.id="modal-bg";',
        `  el.innerHTML = '<div class="modal">'+html+'</div>';`,
        "  el.onclick = function(e){ if(e.target===el) closeModal(); };",
        "  document.body.appendChild(el);",
        "}",
        'function closeModal(){ var el = document.getElementById("modal-bg"); if(el) el.remove(); }',
        "",
        "function showLogin(){",
        `  modal('<h2>'+T.loginTitle+'</h2><div class="row"><label>'+T.loginToken+'</label><input id="loginToken" type="password" placeholder="'+T.loginTokenPh+'"></div><div class="hint">'+T.loginHint+' <a href="https://github.com/settings/tokens/new?scopes=repo,read:user,user:email&description=InfinityPackageManager" target="_blank">\u70B9\u6B64\u521B\u5EFA Token</a></div><div class="actions"><button onclick="closeModal()">'+T.loginCancel+'</button><button class="primary" onclick="doLogin()">'+T.loginSubmit+'</button></div>');`,
        '  setTimeout(function(){ var el = document.getElementById("loginToken"); if(el) el.focus(); },100);',
        "}",
        "function doLogin(){",
        '  var token = (document.getElementById("loginToken").value||"").trim(); if(!token) return;',
        "  toast(T.loggingIn);",
        '  api("POST","/api/login",{token:token}).then(function(r){',
        '    if(r.ok){ toastOk(T.loginOk+": "+r.username); closeModal(); renderUser(); }',
        '    else toastErr(T.loginFail+": "+(r.error||T.unknown));',
        "  }).catch(toastErr);",
        "}",
        'function doLogout(){ api("POST","/api/logout").then(function(){ toastOk(T.logoutOk); renderUser(); }).catch(toastErr); }',
        "",
        "function showVersions(name){",
        "  var p = state.pkgs.filter(function(x){ return x.name===name; })[0];",
        "  if(!p) return;",
        "  var h = '<h2>'+esc(name)+'</h2><table><thead><tr><th>'+T.colVersion+'</th><th>'+T.colFile+'</th><th>'+T.colSize+'</th><th></th></tr></thead><tbody>';",
        "  p.versions.forEach(function(v){",
        `    h += '<tr><td>v'+esc(v.version)+(v.version===p.latest.version?' <span class="tag">'+T.latest+'</span>:"")+'</td><td class="mono">'+esc(v.fileName)+'</td><td class="mono">'+fmtSize(v.size)+'</td><td><button class="primary" onclick="doInstall(\\''+esc(name)+'\\',\\''+esc(v.version)+'\\');closeModal()">'+T.install+'</button></td></tr>';`,
        "  });",
        `  h += '</tbody></table><div class="actions"><button onclick="closeModal()">'+T.loginCancel+'</button></div>';`,
        "  modal(h);",
        "}",
        "",
        "function doGet(){",
        "  toast(T.pulling);",
        '  api("POST","/api/get").then(function(r){',
        "    if(r.ok){ toastOk(T.pullOk); renderPackages(); } else toastErr(r.error||T.unknown);",
        "  }).catch(toastErr);",
        "}",
        "function doInstall(name,version){",
        '  api("POST","/api/install",{name:name,version:version||null}).then(function(r){',
        '    if(r.ok) toastOk(T.installOk+": "+name); else toastErr(r.error||T.unknown);',
        "  }).catch(toastErr);",
        "}",
        "function doUninstall(name){",
        '  if(!confirm(T.confirmUninstall+name+" ?")) return;',
        '  api("POST","/api/uninstall",{name:name}).then(function(r){',
        '    if(r.ok){ toastOk(T.uninstallOk+": "+name); renderInstalled(); } else toastErr(r.error||T.unknown);',
        "  }).catch(toastErr);",
        "}",
        "function doUpdate(name){",
        '  if(!confirm(T.confirmUpdate+name+" ?")) return;',
        '  api("POST","/api/update",{name:name}).then(function(r){',
        '    if(r.ok) toastOk(T.updateOk+": "+name); else toastErr(r.error||T.unknown);',
        "  }).catch(toastErr);",
        "}",
        "function doUpdateAll(){",
        '  api("POST","/api/update",{}).then(function(r){',
        "    if(r.ok) toastOk(T.updateOk); else toastErr(r.error||T.unknown);",
        "  }).catch(toastErr);",
        "}",
        'function doTaskStop(id){ api("POST","/api/task/stop",{id:id}).then(function(){ refreshTasks(); }).catch(toastErr); }',
        "",
        'window.addEventListener("DOMContentLoaded", function(){',
        '  renderNav(); renderUser(); tab("packages");',
        "});"
      ].join("\n");
      return '<!doctype html>\n<html lang="' + (lang === "cn" ? "zh-CN" : "en") + '">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>InfinityPackageManager</title>\n<style>\n' + css + '\n</style>\n</head>\n<body>\n<header>\n  <h1>InfinityPackageManager</h1>\n  <span class="meta">v' + esc(ver) + " \xB7 " + esc(plat) + " \xB7 " + esc(lang) + '</span>\n  <div class="right" id="user"></div>\n</header>\n<nav id="nav"></nav>\n<main id="main"><div class="loading">\u52A0\u8F7D\u4E2D...</div></main>\n<footer>InfinityPackageManager \xB7 <a href="/api" target="_blank">/api</a></footer>\n<script>\n' + js + "\n</script>\n</body>\n</html>";
    }
    async function handle(req, res) {
      let u;
      try {
        u = new URL(req.url, "http://" + (req.headers.host || "localhost"));
      } catch (_) {
        return text(res, 400, "Bad Request");
      }
      const p = u.pathname;
      const q = u.searchParams;
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "*"
        });
        return res.end();
      }
      if (p === "/" || p === "/index.html") {
        return html(res, 200, appHtml());
      }
      if (p === "/api" || p === "/api/") {
        const st = sources.stats();
        return json(res, 200, {
          name: "InfinityPackageManager API",
          version: versionLib.getPkgVersion(),
          platform: platform.platform,
          arch: platform.arch,
          lang: i18n.current(),
          stats: {
            pkgCount: st.pkgCount,
            releaseCount: st.releaseCount,
            fileCount: st.fileCount,
            installedCount: registry.list().length
          },
          endpoints: {
            "GET /api/version": "IPM \u7248\u672C",
            "GET /api/user": "\u767B\u5F55\u72B6\u6001",
            "GET /api/packages?q=&t=&av=1": "\u5305\u5217\u8868",
            "GET /api/package/<name>": "\u5355\u4E2A\u5305\u8BE6\u60C5",
            "GET /api/installed": "\u5DF2\u5B89\u88C5",
            "GET /api/tasks": "\u4EFB\u52A1\u5217\u8868",
            "GET /api/settings": "\u8BBE\u7F6E",
            "POST /api/get": "\u4ECE GitHub \u62C9\u53D6",
            "POST /api/install": "{ name, version? }",
            "POST /api/uninstall": "{ name }",
            "POST /api/update": "{ name? }",
            "POST /api/add": "{ name, url }",
            "POST /api/set": "{ key, value }",
            "POST /api/task/stop": "{ id }",
            "POST /api/login": "{ token }",
            "POST /api/logout": ""
          }
        });
      }
      if (req.method === "GET") {
        if (p === "/api/version") {
          return json(res, 200, {
            ipm: versionLib.getPkgVersion(),
            platform: platform.platform,
            arch: platform.arch,
            lang: i18n.current(),
            installed: registry.list()
          });
        }
        if (p === "/api/user") {
          const a = auth.load();
          return json(res, 200, {
            logged: !!(a && a.token),
            username: a && a.username || null,
            email: a && a.email || null
          });
        }
        if (p === "/api/packages") {
          const qq = q.get("q") || "";
          const tt = q.get("t") || null;
          const ii = q.get("i") || null;
          const av = q.get("av") === "1";
          const hits = sources.search({ text: qq, type: tt, company: ii, allVersions: av });
          const st = sources.stats();
          return json(res, 200, {
            count: hits.length,
            stats: {
              pkgCount: st.pkgCount,
              releaseCount: st.releaseCount,
              fileCount: st.fileCount,
              installedCount: registry.list().length
            },
            packages: hits.map(function(x) {
              return {
                name: x.name,
                type: x.type,
                company: x.company,
                latest: x.latest ? {
                  version: x.latest.version,
                  fileName: x.latest.fileName,
                  size: x.latest.size,
                  url: x.latest.url
                } : null,
                versions: (x.versions || []).map(function(v) {
                  return { version: v.version, fileName: v.fileName, size: v.size, url: v.url };
                })
              };
            })
          });
        }
        if (p.indexOf("/api/package/") === 0) {
          const name = decodeURIComponent(p.slice("/api/package/".length));
          const pkg = sources.find(name);
          if (!pkg) return json(res, 404, { error: "not found", name });
          return json(res, 200, {
            package: {
              name: pkg.name,
              type: pkg.type,
              company: pkg.company,
              latest: pkg.latest,
              versions: pkg.versions
            },
            installed: registry.get(pkg.name) || null
          });
        }
        if (p === "/api/installed") {
          const list = registry.list();
          return json(res, 200, { count: list.length, packages: list });
        }
        if (p === "/api/tasks") {
          const list = tasks.list();
          return json(res, 200, {
            count: list.length,
            tasks: list.map(function(tk) {
              return { id: tk.id, name: tk.name, type: tk.type, status: tk.status, bytes: tk.bytes, total: tk.total, started: tk.started };
            })
          });
        }
        if (p === "/api/settings") {
          return json(res, 200, config.list());
        }
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (p === "/api/get") {
          try {
            const { fetchAll } = require_update_lib();
            const r = await fetchAll({});
            try {
              require_applist().save();
            } catch (_) {
            }
            return json(res, 200, { ok: true, releases: r.releases.length });
          } catch (e) {
            return json(res, 500, { ok: false, error: e.message });
          }
        }
        if (p === "/api/install") {
          if (!body.name) return json(res, 400, { ok: false, error: "name required" });
          installer.install(body.name, body.version || null, {}).catch(function() {
          });
          return json(res, 200, { ok: true });
        }
        if (p === "/api/uninstall") {
          if (!body.name) return json(res, 400, { ok: false, error: "name required" });
          installer.uninstall(body.name).catch(function() {
          });
          return json(res, 200, { ok: true });
        }
        if (p === "/api/update") {
          (async function() {
            try {
              const { fetchAll } = require_update_lib();
              await fetchAll({});
            } catch (_) {
            }
            try {
              await installer.updatePackage(body.name || null, { q: true });
            } catch (_) {
            }
          })();
          return json(res, 200, { ok: true });
        }
        if (p === "/api/add") {
          if (!body.name || !body.url) return json(res, 400, { ok: false, error: "name and url required" });
          installer.addPackage(body.name, body.url, {}).catch(function() {
          });
          return json(res, 200, { ok: true });
        }
        if (p === "/api/set") {
          if (!body.key) return json(res, 400, { ok: false, error: "key required" });
          try {
            config.set(body.key, String(body.value == null ? "" : body.value));
            if (body.key === "lang") i18n.reload();
            return json(res, 200, { ok: true });
          } catch (e) {
            return json(res, 500, { ok: false, error: e.message });
          }
        }
        if (p === "/api/task/stop") {
          const id = body.id;
          if (id === "all" || id == null) {
            const k = tasks.abortAll();
            return json(res, 200, { ok: true, killed: k });
          }
          const r = tasks.abort(id);
          return json(res, r.ok ? 200 : 404, r);
        }
        if (p === "/api/login") {
          if (!body.token) return json(res, 400, { ok: false, error: "token required" });
          try {
            const res2 = await net.httpGetWithRetry("https://api.github.com/user", {
              headers: { authorization: "Bearer " + body.token, accept: "application/vnd.github+json" }
            });
            if (res2.statusCode !== 200) return json(res, 401, { ok: false, error: "invalid token" });
            const user = JSON.parse(res2.body.toString("utf8"));
            auth.save({ token: body.token, username: user.login, email: user.email || "", loggedAt: (/* @__PURE__ */ new Date()).toISOString() });
            return json(res, 200, { ok: true, username: user.login });
          } catch (e) {
            return json(res, 500, { ok: false, error: e.message });
          }
        }
        if (p === "/api/logout") {
          auth.logout();
          return json(res, 200, { ok: true });
        }
      }
      return text(res, 404, "Page not found");
    }
    function killPortHolder(port) {
      try {
        if (process.platform === "win32") {
          const out = execSync("netstat -ano | findstr :" + port, { encoding: "utf8", windowsHide: true });
          const pids = /* @__PURE__ */ new Set();
          for (const line of out.split(/\r?\n/)) {
            if (line.indexOf("LISTENING") === -1) continue;
            const m = line.trim().match(/(\d+)\s*$/);
            if (m) pids.add(m[1]);
          }
          for (const pid of pids) {
            if (String(pid) === String(process.pid)) continue;
            try {
              execFileSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore", timeout: 3e3 });
              dbg("killed PID " + pid + " holding port " + port);
            } catch (e) {
              dbg("kill PID " + pid + " failed: " + e.message);
            }
          }
        } else {
          const out = execSync("lsof -ti :" + port, { encoding: "utf8" });
          for (const pid of out.trim().split(/\s+/)) {
            if (!pid || String(pid) === String(process.pid)) continue;
            try {
              process.kill(Number(pid), "SIGKILL");
            } catch (_) {
            }
          }
        }
      } catch (e) {
        dbg("killPortHolder failed: " + e.message);
      }
    }
    function start(opts) {
      opts = opts || {};
      if (server) return Promise.resolve({ ok: false, error: "alreadyRunning", port: currentPort });
      const port = parseInt(opts.port || 7632, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) return Promise.resolve({ ok: false, error: "invalidPort" });
      const host = opts.host || "127.0.0.1";
      return new Promise(function(resolve) {
        const s = http.createServer(handle);
        s.on("error", function(err) {
          server = null;
          currentPort = null;
          if (err.code === "EADDRINUSE") {
            try {
              killPortHolder(port);
            } catch (_) {
            }
          }
          resolve({ ok: false, error: err.code || "listenError", message: err.message });
        });
        s.listen(port, host, function() {
          server = s;
          currentPort = port;
          currentHost = host;
          resolve({ ok: true, port, host });
        });
      });
    }
    function startBackground(opts) {
      opts = opts || {};
      const port = parseInt(opts.port || 7632, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) return Promise.resolve({ ok: false, error: "invalidPort" });
      const ex = readPid();
      if (ex && isAlive(ex.pid)) return Promise.resolve({ ok: false, error: "alreadyRunning", port: ex.port, pid: ex.pid });
      clearPid();
      const isNodeExe = /(^|[\\/])node(\.exe)?$/i.test(process.execPath);
      const args2 = isNodeExe ? [process.argv[1], "web", "--daemon", "--port", String(port)] : ["web", "--daemon", "--port", String(port)];
      const tmpdir = config.get("tempdir");
      try {
        fs.mkdirSync(tmpdir, { recursive: true });
      } catch (_) {
      }
      const logFile = path2.join(tmpdir, ".ipm-web.log");
      let logFd = null;
      try {
        logFd = fs.openSync(logFile, "w");
      } catch (_) {
      }
      let child;
      try {
        child = spawn(process.execPath, args2, {
          detached: true,
          stdio: ["ignore", logFd != null ? logFd : "ignore", logFd != null ? logFd : "ignore"],
          windowsHide: true,
          env: Object.assign({}, process.env, { IPM_DAEMON: "1", IPM_ROOT: config.ROOT })
        });
      } catch (e) {
        return Promise.resolve({ ok: false, error: "spawnError", message: e.message });
      }
      child.unref();
      return new Promise(function(resolve) {
        const t0 = Date.now();
        const iv = setInterval(function() {
          const info = readPid();
          if (info && info.pid && isAlive(info.pid)) {
            clearInterval(iv);
            try {
              if (logFd != null) fs.closeSync(logFd);
            } catch (_) {
            }
            resolve({ ok: true, port: info.port, pid: info.pid });
          } else if (Date.now() - t0 > 15e3) {
            clearInterval(iv);
            try {
              if (logFd != null) fs.closeSync(logFd);
            } catch (_) {
            }
            let logContent = "";
            try {
              logContent = fs.readFileSync(logFile, "utf8");
            } catch (_) {
            }
            const isBusy = logContent.indexOf("EADDRINUSE") !== -1;
            resolve({
              ok: false,
              error: isBusy ? "portBusy" : "timeout",
              message: isBusy ? "\u7AEF\u53E3 " + port + " \u5DF2\u88AB\u5360\u7528" : logContent.slice(-500) || "timeout"
            });
          }
        }, 100);
      });
    }
    function stop() {
      return new Promise(function(resolve) {
        const info = readPid();
        if (!info || !info.pid) return resolve({ ok: false, error: "notRunning" });
        try {
          if (process.platform === "win32") {
            execFileSync("taskkill", ["/PID", String(info.pid), "/F", "/T"], { stdio: "ignore", timeout: 3e3 });
          } else {
            try {
              process.kill(info.pid, "SIGTERM");
            } catch (_) {
              process.kill(info.pid, "SIGKILL");
            }
          }
        } catch (_) {
        }
        clearPid();
        resolve({ ok: true, pid: info.pid, port: info.port });
      });
    }
    function status() {
      const info = readPid();
      if (!info || !info.pid) return { running: false };
      if (!isAlive(info.pid)) {
        clearPid();
        return { running: false };
      }
      return { running: true, pid: info.pid, port: info.port, host: info.host || "127.0.0.1" };
    }
    module2.exports = { start, startBackground, stop, status, writePid, readPid, clearPid };
  }
});

// node_modules/fzstd/lib/index.js
var require_lib = __commonJS({
  "node_modules/fzstd/lib/index.js"(exports2) {
    "use strict";
    var ab = ArrayBuffer;
    var u8 = Uint8Array;
    var u16 = Uint16Array;
    var i16 = Int16Array;
    var i32 = Int32Array;
    var slc = function(v, s, e) {
      if (u8.prototype.slice)
        return u8.prototype.slice.call(v, s, e);
      if (s == null || s < 0)
        s = 0;
      if (e == null || e > v.length)
        e = v.length;
      var n = new u8(e - s);
      n.set(v.subarray(s, e));
      return n;
    };
    var fill = function(v, n, s, e) {
      if (u8.prototype.fill)
        return u8.prototype.fill.call(v, n, s, e);
      if (s == null || s < 0)
        s = 0;
      if (e == null || e > v.length)
        e = v.length;
      for (; s < e; ++s)
        v[s] = n;
      return v;
    };
    var cpw = function(v, t, s, e) {
      if (u8.prototype.copyWithin)
        return u8.prototype.copyWithin.call(v, t, s, e);
      if (s == null || s < 0)
        s = 0;
      if (e == null || e > v.length)
        e = v.length;
      while (s < e) {
        v[t++] = v[s++];
      }
    };
    exports2.ZstdErrorCode = {
      InvalidData: 0,
      WindowSizeTooLarge: 1,
      InvalidBlockType: 2,
      FSEAccuracyTooHigh: 3,
      DistanceTooFarBack: 4,
      UnexpectedEOF: 5
    };
    var ec = [
      "invalid zstd data",
      "window size too large (>2046MB)",
      "invalid block type",
      "FSE accuracy too high",
      "match distance too far back",
      "unexpected EOF"
    ];
    var err = function(ind, msg, nt) {
      var e = new Error(msg || ec[ind]);
      e.code = ind;
      if (Error.captureStackTrace)
        Error.captureStackTrace(e, err);
      if (!nt)
        throw e;
      return e;
    };
    var rb = function(d, b, n) {
      var i = 0, o = 0;
      for (; i < n; ++i)
        o |= d[b++] << (i << 3);
      return o;
    };
    var b4 = function(d, b) {
      return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
    };
    var rzfh = function(dat, w) {
      var n3 = dat[0] | dat[1] << 8 | dat[2] << 16;
      if (n3 == 3126568 && dat[3] == 253) {
        var flg = dat[4];
        var ss = flg >> 5 & 1, cc = flg >> 2 & 1, df = flg & 3, fcf = flg >> 6;
        if (flg & 8)
          err(0);
        var bt = 6 - ss;
        var db = df == 3 ? 4 : df;
        var di = rb(dat, bt, db);
        bt += db;
        var fsb = fcf ? 1 << fcf : ss;
        var fss = rb(dat, bt, fsb) + (fcf == 1 && 256);
        var ws = fss;
        if (!ss) {
          var wb = 1 << 10 + (dat[5] >> 3);
          ws = wb + (wb >> 3) * (dat[5] & 7);
        }
        if (ws > 2145386496)
          err(1);
        var buf = new u8((w == 1 ? fss || ws : w ? 0 : ws) + 12);
        buf[0] = 1, buf[4] = 4, buf[8] = 8;
        return {
          b: bt + fsb,
          y: 0,
          l: 0,
          d: di,
          w: w && w != 1 ? w : buf.subarray(12),
          e: ws,
          o: new i32(buf.buffer, 0, 3),
          u: fss,
          c: cc,
          m: Math.min(131072, ws)
        };
      } else if ((n3 >> 4 | dat[3] << 20) == 25481893) {
        return b4(dat, 4) + 8;
      }
      err(0);
    };
    var msb = function(val) {
      var bits = 0;
      for (; 1 << bits <= val; ++bits)
        ;
      return bits - 1;
    };
    var rfse = function(dat, bt, mal) {
      var tpos = (bt << 3) + 4;
      var al = (dat[bt] & 15) + 5;
      if (al > mal)
        err(3);
      var sz = 1 << al;
      var probs = sz, sym = -1, re = -1, i = -1, ht = sz;
      var buf = new ab(512 + (sz << 2));
      var freq = new i16(buf, 0, 256);
      var dstate = new u16(buf, 0, 256);
      var nstate = new u16(buf, 512, sz);
      var bb1 = 512 + (sz << 1);
      var syms = new u8(buf, bb1, sz);
      var nbits = new u8(buf, bb1 + sz);
      while (sym < 255 && probs > 0) {
        var bits = msb(probs + 1);
        var cbt = tpos >> 3;
        var msk = (1 << bits + 1) - 1;
        var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (tpos & 7) & msk;
        var msk1fb = (1 << bits) - 1;
        var msv = msk - probs - 1;
        var sval = val & msk1fb;
        if (sval < msv)
          tpos += bits, val = sval;
        else {
          tpos += bits + 1;
          if (val > msk1fb)
            val -= msv;
        }
        freq[++sym] = --val;
        if (val == -1) {
          probs += val;
          syms[--ht] = sym;
        } else
          probs -= val;
        if (!val) {
          do {
            var rbt = tpos >> 3;
            re = (dat[rbt] | dat[rbt + 1] << 8) >> (tpos & 7) & 3;
            tpos += 2;
            sym += re;
          } while (re == 3);
        }
      }
      if (sym > 255 || probs)
        err(0);
      var sympos = 0;
      var sstep = (sz >> 1) + (sz >> 3) + 3;
      var smask = sz - 1;
      for (var s = 0; s <= sym; ++s) {
        var sf = freq[s];
        if (sf < 1) {
          dstate[s] = -sf;
          continue;
        }
        for (i = 0; i < sf; ++i) {
          syms[sympos] = s;
          do {
            sympos = sympos + sstep & smask;
          } while (sympos >= ht);
        }
      }
      if (sympos)
        err(0);
      for (i = 0; i < sz; ++i) {
        var ns = dstate[syms[i]]++;
        var nb = nbits[i] = al - msb(ns);
        nstate[i] = (ns << nb) - sz;
      }
      return [tpos + 7 >> 3, {
        b: al,
        s: syms,
        n: nbits,
        t: nstate
      }];
    };
    var rhu = function(dat, bt) {
      var i = 0, wc = -1;
      var buf = new u8(292), hb = dat[bt];
      var hw = buf.subarray(0, 256);
      var rc = buf.subarray(256, 268);
      var ri = new u16(buf.buffer, 268);
      if (hb < 128) {
        var _a = rfse(dat, bt + 1, 6), ebt = _a[0], fdt = _a[1];
        bt += hb;
        var epos = ebt << 3;
        var lb = dat[bt];
        if (!lb)
          err(0);
        var st1 = 0, st2 = 0, btr1 = fdt.b, btr2 = btr1;
        var fpos = (++bt << 3) - 8 + msb(lb);
        for (; ; ) {
          fpos -= btr1;
          if (fpos < epos)
            break;
          var cbt = fpos >> 3;
          st1 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr1) - 1;
          hw[++wc] = fdt.s[st1];
          fpos -= btr2;
          if (fpos < epos)
            break;
          cbt = fpos >> 3;
          st2 += (dat[cbt] | dat[cbt + 1] << 8) >> (fpos & 7) & (1 << btr2) - 1;
          hw[++wc] = fdt.s[st2];
          btr1 = fdt.n[st1];
          st1 = fdt.t[st1];
          btr2 = fdt.n[st2];
          st2 = fdt.t[st2];
        }
        if (++wc > 255)
          err(0);
      } else {
        wc = hb - 127;
        for (; i < wc; i += 2) {
          var byte = dat[++bt];
          hw[i] = byte >> 4;
          hw[i + 1] = byte & 15;
        }
        ++bt;
      }
      var wes = 0;
      for (i = 0; i < wc; ++i) {
        var wt = hw[i];
        if (wt > 11)
          err(0);
        wes += wt && 1 << wt - 1;
      }
      var mb = msb(wes) + 1;
      var ts = 1 << mb;
      var rem = ts - wes;
      if (rem & rem - 1)
        err(0);
      hw[wc++] = msb(rem) + 1;
      for (i = 0; i < wc; ++i) {
        var wt = hw[i];
        ++rc[hw[i] = wt && mb + 1 - wt];
      }
      var hbuf = new u8(ts << 1);
      var syms = hbuf.subarray(0, ts), nb = hbuf.subarray(ts);
      ri[mb] = 0;
      for (i = mb; i > 0; --i) {
        var pv = ri[i];
        fill(nb, i, pv, ri[i - 1] = pv + rc[i] * (1 << mb - i));
      }
      if (ri[0] != ts)
        err(0);
      for (i = 0; i < wc; ++i) {
        var bits = hw[i];
        if (bits) {
          var code = ri[bits];
          fill(syms, i, code, ri[bits] = code + (1 << mb - bits));
        }
      }
      return [bt, {
        n: nb,
        b: mb,
        s: syms
      }];
    };
    var dllt = rfse(/* @__PURE__ */ new u8([
      81,
      16,
      99,
      140,
      49,
      198,
      24,
      99,
      12,
      33,
      196,
      24,
      99,
      102,
      102,
      134,
      70,
      146,
      4
    ]), 0, 6)[1];
    var dmlt = rfse(/* @__PURE__ */ new u8([
      33,
      20,
      196,
      24,
      99,
      140,
      33,
      132,
      16,
      66,
      8,
      33,
      132,
      16,
      66,
      8,
      33,
      68,
      68,
      68,
      68,
      68,
      68,
      68,
      68,
      36,
      9
    ]), 0, 6)[1];
    var doct = rfse(/* @__PURE__ */ new u8([
      32,
      132,
      16,
      66,
      102,
      70,
      68,
      68,
      68,
      68,
      36,
      73,
      2
    ]), 0, 5)[1];
    var b2bl = function(b, s) {
      var len = b.length, bl = new i32(len);
      for (var i = 0; i < len; ++i) {
        bl[i] = s;
        s += 1 << b[i];
      }
      return bl;
    };
    var llb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
      0,
      0,
      0,
      0,
      16843009,
      50528770,
      134678020,
      202050057,
      269422093
    ])).buffer, 0, 36);
    var llbl = /* @__PURE__ */ b2bl(llb, 0);
    var mlb = /* @__PURE__ */ new u8((/* @__PURE__ */ new i32([
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      16843009,
      50528770,
      117769220,
      185207048,
      252579084,
      16
    ])).buffer, 0, 53);
    var mlbl = /* @__PURE__ */ b2bl(mlb, 3);
    var dhu = function(dat, out, hu) {
      var len = dat.length, ss = out.length, lb = dat[len - 1], msk = (1 << hu.b) - 1, eb = -hu.b;
      if (!lb)
        err(0);
      var st = 0, btr = hu.b, pos = (len << 3) - 8 + msb(lb) - btr, i = -1;
      for (; pos > eb && i < ss; ) {
        var cbt = pos >> 3;
        var val = (dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (pos & 7);
        st = (st << btr | val) & msk;
        out[++i] = hu.s[st];
        pos -= btr = hu.n[st];
      }
      if (pos != eb || i + 1 != ss)
        err(0);
    };
    var dhu4 = function(dat, out, hu) {
      var bt = 6;
      var ss = out.length, sz1 = ss + 3 >> 2, sz2 = sz1 << 1, sz3 = sz1 + sz2;
      dhu(dat.subarray(bt, bt += dat[0] | dat[1] << 8), out.subarray(0, sz1), hu);
      dhu(dat.subarray(bt, bt += dat[2] | dat[3] << 8), out.subarray(sz1, sz2), hu);
      dhu(dat.subarray(bt, bt += dat[4] | dat[5] << 8), out.subarray(sz2, sz3), hu);
      dhu(dat.subarray(bt), out.subarray(sz3), hu);
    };
    var rzb = function(dat, st, out) {
      var _a;
      var bt = st.b;
      var b0 = dat[bt], btype = b0 >> 1 & 3;
      st.l = b0 & 1;
      var sz = b0 >> 3 | dat[bt + 1] << 5 | dat[bt + 2] << 13;
      var ebt = (bt += 3) + sz;
      if (btype == 1) {
        if (bt >= dat.length)
          return;
        st.b = bt + 1;
        if (out) {
          fill(out, dat[bt], st.y, st.y += sz);
          return out;
        }
        return fill(new u8(sz), dat[bt]);
      }
      if (ebt > dat.length)
        return;
      if (btype == 0) {
        st.b = ebt;
        if (out) {
          out.set(dat.subarray(bt, ebt), st.y);
          st.y += sz;
          return out;
        }
        return slc(dat, bt, ebt);
      }
      if (btype == 2) {
        var b3 = dat[bt], lbt = b3 & 3, sf = b3 >> 2 & 3;
        var lss = b3 >> 4, lcs = 0, s4 = 0;
        if (lbt < 2) {
          if (sf & 1)
            lss |= dat[++bt] << 4 | (sf & 2 && dat[++bt] << 12);
          else
            lss = b3 >> 3;
        } else {
          s4 = sf;
          if (sf < 2)
            lss |= (dat[++bt] & 63) << 4, lcs = dat[bt] >> 6 | dat[++bt] << 2;
          else if (sf == 2)
            lss |= dat[++bt] << 4 | (dat[++bt] & 3) << 12, lcs = dat[bt] >> 2 | dat[++bt] << 6;
          else
            lss |= dat[++bt] << 4 | (dat[++bt] & 63) << 12, lcs = dat[bt] >> 6 | dat[++bt] << 2 | dat[++bt] << 10;
        }
        ++bt;
        var buf = out ? out.subarray(st.y, st.y + st.m) : new u8(st.m);
        var spl = buf.length - lss;
        if (lbt == 0)
          buf.set(dat.subarray(bt, bt += lss), spl);
        else if (lbt == 1)
          fill(buf, dat[bt++], spl);
        else {
          var hu = st.h;
          if (lbt == 2) {
            var hud = rhu(dat, bt);
            lcs += bt - (bt = hud[0]);
            st.h = hu = hud[1];
          } else if (!hu)
            err(0);
          (s4 ? dhu4 : dhu)(dat.subarray(bt, bt += lcs), buf.subarray(spl), hu);
        }
        var ns = dat[bt++];
        if (ns) {
          if (ns == 255)
            ns = (dat[bt++] | dat[bt++] << 8) + 32512;
          else if (ns > 127)
            ns = ns - 128 << 8 | dat[bt++];
          var scm = dat[bt++];
          if (scm & 3)
            err(0);
          var dts = [dmlt, doct, dllt];
          for (var i = 2; i > -1; --i) {
            var md = scm >> (i << 1) + 2 & 3;
            if (md == 1) {
              var rbuf = new u8([0, 0, dat[bt++]]);
              dts[i] = {
                s: rbuf.subarray(2, 3),
                n: rbuf.subarray(0, 1),
                t: new u16(rbuf.buffer, 0, 1),
                b: 0
              };
            } else if (md == 2) {
              _a = rfse(dat, bt, 9 - (i & 1)), bt = _a[0], dts[i] = _a[1];
            } else if (md == 3) {
              if (!st.t)
                err(0);
              dts[i] = st.t[i];
            }
          }
          var _b = st.t = dts, mlt = _b[0], oct = _b[1], llt = _b[2];
          var lb = dat[ebt - 1];
          if (!lb)
            err(0);
          var spos = (ebt << 3) - 8 + msb(lb) - llt.b, cbt = spos >> 3, oubt = 0;
          var lst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << llt.b) - 1;
          cbt = (spos -= oct.b) >> 3;
          var ost = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << oct.b) - 1;
          cbt = (spos -= mlt.b) >> 3;
          var mst = (dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mlt.b) - 1;
          for (++ns; --ns; ) {
            var llc = llt.s[lst];
            var lbtr = llt.n[lst];
            var mlc = mlt.s[mst];
            var mbtr = mlt.n[mst];
            var ofc = oct.s[ost];
            var obtr = oct.n[ost];
            cbt = (spos -= ofc) >> 3;
            var ofp = 1 << ofc;
            var off = ofp + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16 | dat[cbt + 3] << 24) >>> (spos & 7) & ofp - 1);
            cbt = (spos -= mlb[mlc]) >> 3;
            var ml = mlbl[mlc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << mlb[mlc]) - 1);
            cbt = (spos -= llb[llc]) >> 3;
            var ll = llbl[llc] + ((dat[cbt] | dat[cbt + 1] << 8 | dat[cbt + 2] << 16) >> (spos & 7) & (1 << llb[llc]) - 1);
            cbt = (spos -= lbtr) >> 3;
            lst = llt.t[lst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << lbtr) - 1);
            cbt = (spos -= mbtr) >> 3;
            mst = mlt.t[mst] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << mbtr) - 1);
            cbt = (spos -= obtr) >> 3;
            ost = oct.t[ost] + ((dat[cbt] | dat[cbt + 1] << 8) >> (spos & 7) & (1 << obtr) - 1);
            if (off > 3) {
              st.o[2] = st.o[1];
              st.o[1] = st.o[0];
              st.o[0] = off -= 3;
            } else {
              var idx = off - (ll != 0);
              if (idx) {
                off = idx == 3 ? st.o[0] - 1 : st.o[idx];
                if (idx > 1)
                  st.o[2] = st.o[1];
                st.o[1] = st.o[0];
                st.o[0] = off;
              } else
                off = st.o[0];
            }
            for (var i = 0; i < ll; ++i) {
              buf[oubt + i] = buf[spl + i];
            }
            oubt += ll, spl += ll;
            var stin = oubt - off;
            if (stin < 0) {
              var len = -stin;
              var bs = st.e + stin;
              if (len > ml)
                len = ml;
              for (var i = 0; i < len; ++i) {
                buf[oubt + i] = st.w[bs + i];
              }
              oubt += len, ml -= len, stin = 0;
            }
            for (var i = 0; i < ml; ++i) {
              buf[oubt + i] = buf[stin + i];
            }
            oubt += ml;
          }
          if (oubt != spl) {
            while (spl < buf.length) {
              buf[oubt++] = buf[spl++];
            }
          } else
            oubt = buf.length;
          if (out)
            st.y += oubt;
          else
            buf = slc(buf, 0, oubt);
        } else if (out) {
          st.y += lss;
          if (spl) {
            for (var i = 0; i < lss; ++i) {
              buf[i] = buf[spl + i];
            }
          }
        } else if (spl)
          buf = slc(buf, spl);
        st.b = ebt;
        return buf;
      }
      err(2);
    };
    var cct = function(bufs, ol) {
      if (bufs.length == 1)
        return bufs[0];
      var buf = new u8(ol);
      for (var i = 0, b = 0; i < bufs.length; ++i) {
        var chk = bufs[i];
        buf.set(chk, b);
        b += chk.length;
      }
      return buf;
    };
    function decompress(dat, buf) {
      var bufs = [], nb = +!buf;
      var bt = 0, ol = 0;
      for (; dat.length; ) {
        var st = rzfh(dat, nb || buf);
        if (typeof st == "object") {
          if (nb) {
            buf = null;
            if (st.w.length == st.u) {
              bufs.push(buf = st.w);
              ol += st.u;
            }
          } else {
            bufs.push(buf);
            st.e = 0;
          }
          for (; !st.l; ) {
            var blk = rzb(dat, st, buf);
            if (!blk)
              err(5);
            if (buf)
              st.e = st.y;
            else {
              bufs.push(blk);
              ol += blk.length;
              cpw(st.w, 0, blk.length);
              st.w.set(blk, st.w.length - blk.length);
            }
          }
          bt = st.b + st.c * 4;
        } else
          bt = st;
        dat = dat.subarray(bt);
      }
      return cct(bufs, ol);
    }
    exports2.decompress = decompress;
    var Decompress = /* @__PURE__ */ (function() {
      function Decompress2(ondata) {
        this.ondata = ondata;
        this.c = [];
        this.l = 0;
        this.z = 0;
      }
      Decompress2.prototype.push = function(chunk, final) {
        if (typeof this.s == "number") {
          var sub = Math.min(chunk.length, this.s);
          chunk = chunk.subarray(sub);
          this.s -= sub;
        }
        var sl = chunk.length;
        var ncs = sl + this.l;
        if (!this.s) {
          if (final) {
            if (!ncs) {
              this.ondata(new u8(0), true);
              return;
            }
            if (ncs < 5)
              err(5);
          } else if (ncs < 18) {
            this.c.push(chunk);
            this.l = ncs;
            return;
          }
          if (this.l) {
            this.c.push(chunk);
            chunk = cct(this.c, ncs);
            this.c = [];
            this.l = 0;
          }
          if (typeof (this.s = rzfh(chunk)) == "number")
            return this.push(chunk, final);
        }
        if (typeof this.s != "number") {
          if (ncs < (this.z || 3)) {
            if (final)
              err(5);
            this.c.push(chunk);
            this.l = ncs;
            return;
          }
          if (this.l) {
            this.c.push(chunk);
            chunk = cct(this.c, ncs);
            this.c = [];
            this.l = 0;
          }
          if (!this.z && ncs < (this.z = chunk[this.s.b] & 2 ? 4 : 3 + (chunk[this.s.b] >> 3 | chunk[this.s.b + 1] << 5 | chunk[this.s.b + 2] << 13))) {
            if (final)
              err(5);
            this.c.push(chunk);
            this.l = ncs;
            return;
          } else
            this.z = 0;
          for (; ; ) {
            var blk = rzb(chunk, this.s);
            if (!blk) {
              if (final)
                err(5);
              var adc = chunk.subarray(this.s.b);
              this.s.b = 0;
              this.c.push(adc), this.l += adc.length;
              return;
            } else {
              this.ondata(blk, false);
              cpw(this.s.w, 0, blk.length);
              this.s.w.set(blk, this.s.w.length - blk.length);
            }
            if (this.s.l) {
              var rest = chunk.subarray(this.s.b);
              this.s = this.s.c * 4;
              this.push(rest, final);
              return;
            }
          }
        } else if (final)
          err(5);
      };
      return Decompress2;
    })();
    exports2.Decompress = Decompress;
  }
});

// src/zstd.js
var require_zstd = __commonJS({
  "src/zstd.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var zlib = require("zlib");
    var _fzstd = null;
    var _fzstdTried = false;
    function getFzstd() {
      if (_fzstdTried) return _fzstd;
      _fzstdTried = true;
      try {
        _fzstd = require_lib();
      } catch (_) {
        _fzstd = null;
      }
      return _fzstd;
    }
    function decompressZstd(buf) {
      const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      if (typeof zlib.zstdDecompressSync === "function") {
        try {
          return zlib.zstdDecompressSync(input);
        } catch (_) {
        }
      }
      const fz = getFzstd();
      if (fz && typeof fz.decompress === "function") {
        const out = fz.decompress(new Uint8Array(input));
        return Buffer.from(out);
      }
      throw new Error("zstd \u89E3\u7801\u4E0D\u53EF\u7528\uFF08Node \u7248\u672C\u8FC7\u4F4E\u4E14 fzstd \u672A\u5B89\u88C5\uFF09");
    }
    function compressZstd(buf, level) {
      const input = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      if (typeof zlib.zstdCompressSync !== "function") {
        throw new Error("\u9700\u8981 Node 22.15+ \u624D\u652F\u6301 zstd \u538B\u7F29\uFF08\u5F53\u524D " + process.version + "\uFF09");
      }
      return zlib.zstdCompressSync(input, { level: level || 3 });
    }
    function extractZstd(zstFile, destDir) {
      const { ensureDir } = require_utils();
      ensureDir(destDir);
      const data = fs.readFileSync(zstFile);
      const out = decompressZstd(data);
      try {
        const extractor = require_extractor();
        const n = extractor.extractTar(out, destDir, { strip: 0 });
        if (n > 0) return n;
      } catch (_) {
      }
      if (out.length >= 4 && out[0] === 80 && out[1] === 75) {
        try {
          const extractor = require_extractor();
          const n = extractor.extractZip(out, destDir, { strip: 0 });
          if (n > 0) return n;
        } catch (_) {
        }
      }
      let outName = "content.bin";
      const base = path2.basename(zstFile).replace(/\.(zst|zstd|tzst)$/i, "").replace(/\.(zip|tar|gz)$/i, "");
      if (base) outName = base;
      fs.writeFileSync(path2.join(destDir, outName), out);
      return 1;
    }
    module2.exports = { decompressZstd, compressZstd, extractZstd, getFzstd };
  }
});

// src/plugin.js
var require_plugin = __commonJS({
  "src/plugin.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var config = require_config();
    var net = require_net();
    var sources = require_sources();
    var i18n = require_i18n();
    var zstd = require_zstd();
    var { log, ensureDir, rmrf, formatBytes } = require_utils();
    var PLUGIN_DIR = path2.join(config.DATA_DIR, "plugins");
    var PLUGIN_REG = path2.join(config.DATA_DIR, "plugins.json");
    var FORMATS = {
      ".tar.zst": "zstd",
      ".tzst": "zstd",
      ".zstd": "zstd",
      ".zst": "zstd",
      ".tar.gz": "targz",
      ".tgz": "targz",
      ".zip": "zip",
      ".tar": "tar",
      ".gz": "gzip"
    };
    function detectFormat(fileName) {
      const lower = String(fileName || "").toLowerCase();
      const exts = Object.keys(FORMATS).sort((a, b) => b.length - a.length);
      for (const ext of exts) {
        if (lower.endsWith(ext)) return FORMATS[ext];
      }
      return null;
    }
    function loadReg() {
      try {
        return JSON.parse(fs.readFileSync(PLUGIN_REG, "utf8"));
      } catch (_) {
        return { version: 1, plugins: {} };
      }
    }
    function saveReg(d) {
      ensureDir(path2.dirname(PLUGIN_REG));
      fs.writeFileSync(PLUGIN_REG, JSON.stringify(d, null, 2) + "\n", "utf8");
    }
    function listInstalled() {
      return Object.values(loadReg().plugins || {}).sort((a, b) => a.name.localeCompare(b.name));
    }
    function getInstalled(name) {
      return (loadReg().plugins || {})[name] || null;
    }
    function setInstalled(name, info) {
      const reg = loadReg();
      reg.plugins[name] = Object.assign({}, reg.plugins[name], info, { name });
      saveReg(reg);
    }
    function removeInstalled(name) {
      const reg = loadReg();
      const existed = Boolean(reg.plugins[name]);
      delete reg.plugins[name];
      saveReg(reg);
      return existed;
    }
    function listAvailable() {
      const urls = sources.loadUrls();
      const releases = urls.releases || [];
      const map = /* @__PURE__ */ new Map();
      for (const rel of releases) {
        if (rel.kind !== "plugin") continue;
        const nt = rel.nameTxt;
        if (!nt || !nt.entries) continue;
        for (const e of nt.entries) {
          if (!map.has(e.name)) {
            map.set(e.name, { name: e.name, type: e.type, company: e.company, platform: e.platform || "", versions: [] });
          }
          const pkg = map.get(e.name);
          const asset = (rel.assets || []).find((a) => a.name === e.fileName);
          pkg.versions.push({
            version: e.version,
            tag: rel.tag,
            fileName: e.fileName,
            size: asset ? asset.size : 0,
            url: asset ? asset.url : null,
            htmlUrl: rel.htmlUrl,
            publishedAt: rel.publishedAt,
            repo: rel.repo,
            format: detectFormat(e.fileName)
          });
        }
      }
      for (const p of map.values()) {
        p.versions.sort((a, b) => {
          const va = String(a.version).split(".").map((n) => parseInt(n, 10) || 0);
          const vb = String(b.version).split(".").map((n) => parseInt(n, 10) || 0);
          const len = Math.max(va.length, vb.length);
          for (let i = 0; i < len; i++) {
            const x = va[i] || 0, y = vb[i] || 0;
            if (x !== y) return x - y;
          }
          return 0;
        });
        p.latest = p.versions[p.versions.length - 1];
      }
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    }
    function findAvailable(name) {
      if (!name) return null;
      const all = listAvailable();
      for (const p of all) if (p.name === name) return p;
      for (const p of all) if (p.name.toLowerCase() === name.toLowerCase()) return p;
      return null;
    }
    function extractAny(filePath, fileName, destDir) {
      const fmt = detectFormat(fileName);
      ensureDir(destDir);
      if (fmt === "zstd") return zstd.extractZstd(filePath, destDir);
      const extractor = require_extractor();
      const buf = fs.readFileSync(filePath);
      if (fmt === "zip") return extractor.extractZip(buf, destDir, { strip: 0 });
      if (fmt === "targz") return extractor.extractTarGz(buf, destDir, { strip: 0 });
      if (fmt === "tar") return extractor.extractTar(buf, destDir, { strip: 0 });
      if (fmt === "gzip") {
        const zlib = require("zlib");
        const out = zlib.gunzipSync(buf);
        fs.writeFileSync(path2.join(destDir, path2.basename(fileName, ".gz")), out);
        return 1;
      }
      fs.copyFileSync(filePath, path2.join(destDir, path2.basename(fileName)));
      return 1;
    }
    async function add(names, flags) {
      flags = flags || {};
      if (!names || !names.length) {
        log.error("\u7528\u6CD5: ipm plugin add <name1,name2,...>");
        return;
      }
      ensureDir(PLUGIN_DIR);
      let okN = 0, failN = 0;
      for (const name of names) {
        try {
          const pkg = findAvailable(name);
          if (!pkg) {
            log.error("\u63D2\u4EF6\u672A\u627E\u5230: " + name);
            failN++;
            continue;
          }
          const target = pkg.latest;
          if (!target || !target.url) {
            log.error("\u63D2\u4EF6\u65E0\u4E0B\u8F7D: " + name);
            failN++;
            continue;
          }
          const fmt = target.format || detectFormat(target.fileName) || "raw";
          log.step("\u5B89\u88C5\u63D2\u4EF6 " + pkg.name + " v" + target.version + "  [" + fmt + "]");
          const tmpdir = config.get("tempdir");
          ensureDir(tmpdir);
          const tmp = path2.join(tmpdir, target.fileName);
          const tasks = require_tasks();
          const dlTask = tasks.register("plugin:" + pkg.name, "download");
          try {
            await net.downloadWithRetry(target.url, tmp, {
              task: dlTask,
              progress: !flags.q,
              expectedSize: target.size
            });
          } finally {
            tasks.unregister(dlTask);
          }
          const dest = path2.join(PLUGIN_DIR, pkg.name);
          rmrf(dest);
          ensureDir(dest);
          const n = extractAny(tmp, target.fileName, dest);
          try {
            fs.unlinkSync(tmp);
          } catch (_) {
          }
          setInstalled(pkg.name, {
            name: pkg.name,
            version: target.version,
            repo: target.repo,
            fileName: target.fileName,
            format: fmt,
            path: dest,
            installedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
          log.success("\u5DF2\u5B89\u88C5 " + pkg.name + " -> " + dest + "  (" + n + " \u6587\u4EF6)");
          okN++;
        } catch (e) {
          failN++;
          log.error(name + ": " + (e && e.message || String(e)));
        }
      }
      if (names.length > 1) {
        log.info("\u5B8C\u6210: " + okN + " ok" + (failN ? " / " + failN + " fail" : ""));
      }
    }
    async function del(names) {
      if (!names || !names.length) {
        log.error("\u7528\u6CD5: ipm plugin del <name1,...>");
        return;
      }
      for (const name of names) {
        const info = getInstalled(name);
        if (!info) {
          log.warn("\u672A\u5B89\u88C5: " + name);
          continue;
        }
        if (info.path && fs.existsSync(info.path)) {
          try {
            rmrf(info.path);
          } catch (_) {
          }
        }
        removeInstalled(name);
        log.success("\u5DF2\u5220\u9664\u63D2\u4EF6 " + name);
      }
    }
    async function update(names) {
      ensureDir(PLUGIN_DIR);
      const installed = listInstalled();
      if (!installed.length) {
        log.info("\u672A\u5B89\u88C5\u4EFB\u4F55\u63D2\u4EF6");
        return;
      }
      const targets = names && names.length ? installed.filter((p) => names.indexOf(p.name) !== -1) : installed;
      if (names && names.length && !targets.length) {
        log.warn("\u6CA1\u6709\u5339\u914D\u7684\u63D2\u4EF6");
        return;
      }
      try {
        const { fetchAll } = require_update_lib();
        await fetchAll({});
      } catch (_) {
      }
      let okN = 0, skipN = 0;
      for (const inst of targets) {
        const pkg = findAvailable(inst.name);
        if (!pkg || !pkg.latest) {
          log.warn("  \u672A\u627E\u5230 " + inst.name);
          skipN++;
          continue;
        }
        if (pkg.latest.version === inst.version) {
          log.info("  " + inst.name + " v" + inst.version + "  \u5DF2\u662F\u6700\u65B0");
          skipN++;
          continue;
        }
        log.info("  " + inst.name + " v" + inst.version + " -> v" + pkg.latest.version);
        await add([inst.name], { q: true });
        okN++;
      }
      log.success("\u66F4\u65B0\u5B8C\u6210: " + okN + " \u66F4\u65B0" + (skipN ? " / " + skipN + " \u8DF3\u8FC7" : ""));
    }
    function search(keyword) {
      const all = listAvailable();
      const installedMap = {};
      for (const p of listInstalled()) installedMap[p.name] = p;
      const withInst = (p) => Object.assign({}, p, { installed: installedMap[p.name] || null });
      if (!keyword) return all.map(withInst);
      const lower = String(keyword).toLowerCase();
      return all.filter(
        (p) => p.name.toLowerCase().indexOf(lower) !== -1 || p.company && p.company.toLowerCase().indexOf(lower) !== -1
      ).map(withInst);
    }
    function pack(zipPath, name, version, company, outDir) {
      if (!zipPath || !fs.existsSync(zipPath)) throw new Error("ZIP \u6587\u4EF6\u4E0D\u5B58\u5728: " + zipPath);
      if (!name) throw new Error("\u63D2\u4EF6\u540D\u4E0D\u80FD\u4E3A\u7A7A");
      if (!version) throw new Error("\u7248\u672C\u4E0D\u80FD\u4E3A\u7A7A");
      const fullZip = path2.resolve(zipPath);
      const stat = fs.statSync(fullZip);
      if (!stat.isFile()) throw new Error("\u5FC5\u987B\u662F\u6587\u4EF6");
      const fd = fs.openSync(fullZip, "r");
      const head = Buffer.alloc(4);
      fs.readSync(fd, head, 0, 4, 0);
      fs.closeSync(fd);
      if (!(head[0] === 80 && head[1] === 75)) {
        throw new Error("\u4E0D\u662F\u6709\u6548\u7684 ZIP \u6587\u4EF6\uFF08\u5E94\u4EE5 PK \u5F00\u5934\uFF09");
      }
      const ver = String(version).replace(/^v/i, "");
      const outName = name + "-" + ver + ".zst";
      const target = path2.join(outDir || process.cwd(), outName);
      const zipBuf = fs.readFileSync(fullZip);
      const zstBuf = zstd.compressZstd(zipBuf, 3);
      fs.writeFileSync(target, zstBuf);
      return {
        file: target,
        name,
        version: ver,
        company: company || "null",
        sizeIn: stat.size,
        sizeOut: zstBuf.length,
        nameTxt: path2.basename(fullZip) + " v" + ver + " " + name + " plugin " + (company || "null") + "\n"
      };
    }
    function pluginPath(name) {
      if (!name) return PLUGIN_DIR;
      return path2.join(PLUGIN_DIR, name);
    }
    module2.exports = {
      PLUGIN_DIR,
      PLUGIN_REG,
      listInstalled,
      getInstalled,
      listAvailable,
      findAvailable,
      add,
      del,
      update,
      search,
      pack,
      pluginPath,
      detectFormat
    };
  }
});

// src/langfetch.js
var require_langfetch = __commonJS({
  "src/langfetch.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var net = require_net();
    var sources = require_sources();
    var i18n = require_i18n();
    var { ensureDir, log } = require_utils();
    var KEYWORD = "ipm lang";
    function isLangRelease(rel) {
      const text = String((rel && rel.name || "") + " " + (rel && rel.version || "")).toLowerCase();
      return text.indexOf(KEYWORD) !== -1;
    }
    function findLangAssets(rel) {
      return (rel.files || []).filter(function(f) {
        return f.name && f.name.toLowerCase().endsWith(".lang");
      });
    }
    async function fetchLangs(flags) {
      flags = flags || {};
      const pkgs = sources.listAvailable();
      const hits = pkgs.filter(isLangRelease);
      if (!hits.length) {
        log.warn(i18n.t("langGetNone"));
        return 0;
      }
      ensureDir(i18n.LANG_DIR);
      let count = 0;
      const seen = /* @__PURE__ */ new Set();
      for (const rel of hits) {
        for (const f of findLangAssets(rel)) {
          const fileName = path2.basename(f.name);
          if (seen.has(fileName)) continue;
          seen.add(fileName);
          const dest = path2.join(i18n.LANG_DIR, fileName);
          if (!flags.q) log.info("  " + f.name + "  (" + rel.version + ")");
          try {
            await net.downloadWithRetry(f.url, dest);
            count++;
          } catch (err) {
            log.error(f.name + ": " + err.message);
          }
        }
      }
      i18n.reload();
      if (count > 0) log.success(i18n.t("langGetOK") + " (" + count + ")");
      else log.warn(i18n.t("langGetNone"));
      return count;
    }
    module2.exports = { fetchLangs, KEYWORD };
  }
});

// src/cli.js
var require_cli = __commonJS({
  "src/cli.js"(exports2, module2) {
    "use strict";
    var path2 = require("path");
    var fs = require("fs");
    var config = require_config();
    var platform = require_platform();
    var registry = require_registry();
    var sources = require_sources();
    var installer = require_installer();
    var downloader = require_downloader();
    var pak = require_pak();
    var proc2 = require_process();
    var tasks = require_tasks();
    var i18n = require_i18n();
    var versionLib = require_version();
    var { log, color, rmrf, clearScreen, formatBytes, link } = require_utils();
    function typeBadge(type) {
      if (type === "setup") return color.brightMagenta("[setup]");
      if (type === "port") return color.brightGreen("[port]");
      return color.dim("[" + (type || "?") + "]");
    }
    var PC = {
      reset: "\x1B[0m",
      red: "\x1B[31m",
      cyan: "\x1B[36m",
      blue: "\x1B[34m",
      brightYellow: "\x1B[93m",
      white: "\x1B[97m",
      gray: "\x1B[90m",
      bold: "\x1B[1m"
    };
    function paintCmd(kind, text) {
      const map = {
        error: PC.red,
        download: PC.cyan,
        list: PC.blue,
        update: PC.brightYellow,
        arg: PC.white
      };
      const color2 = map[kind] || PC.white;
      return color2 + text + PC.reset;
    }
    function highlightCmd(line) {
      const parts = String(line).split(/\s+/);
      if (!parts.length) return line;
      const cmd = parts[0];
      const cmdColors = {
        install: PC.cyan,
        i: PC.cyan,
        list: PC.blue,
        ls: PC.blue,
        update: PC.brightYellow,
        get: PC.cyan,
        search: PC.blue,
        download: PC.cyan,
        version: PC.brightYellow,
        v: PC.brightYellow,
        task: PC.brightYellow,
        help: PC.white,
        exit: PC.white,
        remove: PC.red,
        uninstall: PC.red,
        rm: PC.red
      };
      const c = cmdColors[cmd] || PC.white;
      let out = PC.bold + c + cmd + PC.reset;
      for (let i = 1; i < parts.length; i++) {
        const a = parts[i];
        if (a.startsWith("-")) {
          out += " " + PC.gray + a + PC.reset;
        } else {
          out += " " + PC.white + a + PC.reset;
        }
      }
      return out;
    }
    function buildHelpText() {
      const t = i18n.t;
      return [
        t("helpTitle"),
        t("helpPlatform") + ": " + platform.platform + "/" + platform.arch,
        "",
        t("helpUsage") + ":",
        "  ipm cli                              " + t("helpCmdCli"),
        "  ipm list                             " + t("helpCmdList"),
        "  ipm list install                     " + t("helpCmdListInstall"),
        "  ipm search <keyword> [opts]          " + t("helpCmdSearch"),
        "  ipm get                              " + t("helpCmdGet"),
        "  ipm install <name> [version] [path]  " + t("helpCmdInstall"),
        "      \u4FBF\u643A\u7248\u53EF\u6307\u5B9A\u5B89\u88C5\u8DEF\u5F84              " + t("helpInstallPath"),
        "      -q / -k / --no-run / -d <dir>    install options",
        "  ipm package update [name]            " + t("helpCmdPackageUpdate"),
        "      --check                          " + t("helpUpdateCheck"),
        "  ipm update [--check]                 " + t("helpCmdUpdate"),
        "  ipm version [name]                   " + t("helpCmdVersion"),
        "  ipm plugin path                    " + t("helpCmdPluginPath"),
        "  ipm plugin search [kw]              " + t("helpCmdPluginSearch"),
        "  ipm plugin add <name1,name2,...>    " + t("helpCmdPluginAdd"),
        "  ipm plugin del <name1,name2,...>    " + t("helpCmdPluginDel"),
        "  ipm plugin update [names]           " + t("helpCmdPluginUpdate"),
        "  ipm plugin pack <zip> <name> <ver>  " + t("helpCmdPluginPack"),
        "  ipm plugin list                     " + t("helpCmdPluginList"),
        "  ipm task list                        " + t("helpCmdTaskList"),
        "  ipm task stop <id|all>               " + t("helpCmdTaskStop"),
        "  ipm web [start|stop|status]          " + t("helpCmdWeb"),
        "      -p <port>                        " + t("helpWebPort"),
        "      --fg                             \u524D\u53F0\u8FD0\u884C\uFF08\u9ED8\u8BA4\u540E\u53F0\uFF09",
        "  ipm login                            " + t("helpCmdLogin"),
        "  ipm logout                           " + t("helpCmdLogout"),
        "  ipm release type= name= tag= mainurl= assets= namefile= readme=" + t("helpCmdRelease"),
        "  ipm download <name>[@file]           " + t("helpCmdDownload"),
        "  ipm uninstall <name>                 " + t("helpCmdUninstall"),
        "  ipm repair <name> | repair *all     " + (t("helpCmdRepair") !== "helpCmdRepair" ? t("helpCmdRepair") : "\u4FEE\u590D\u5FEB\u6377\u65B9\u5F0F"),
        "  ipm add <name> <url>                 " + t("helpCmdAdd"),
        "  ipm redadd <name> <path>             " + t("helpCmdRedadd"),
        "  ipm redel <name>                     " + t("helpCmdRedel"),
        "  ipm pak list|add|del                 " + t("helpCmdPakList"),
        "  ipm temp clear                       " + t("helpCmdTempClear"),
        "  ipm set <name> [value]               " + t("helpCmdSet"),
        "  ipm set list                         " + t("helpCmdSetList"),
        "  ipm lang [list|get|set]              " + t("helpCmdLang"),
        "  ipm clear                            " + t("helpCmdClear"),
        "  ipm exit                             " + t("helpCmdExit"),
        "  ipm help                             " + t("helpCmdHelp"),
        "",
        t("helpShellHeader") + ":",
        "  {}                                   \u591A\u884C\u547D\u4EE4\uFF0C\u4F8B: { list; install FreeArc }",
        "  exit / quit                          \u9000\u51FA"
      ].join("\n");
    }
    function unknownCommand(cmd) {
      console.log(
        i18n.t("unknownCommand") + color.red('"' + cmd + '"') + color.yellow(i18n.t("inputIpmHelp"))
      );
    }
    var NO_VALUE_FLAGS = ["q", "k", "a", "na", "av", "hash"];
    var MULTI_VALUE_FLAGS = ["i", "ni", "v", "nv"];
    var SINGLE_VALUE_FLAGS = ["p", "n", "f", "d", "t", "port"];
    function parseArgs2(argv) {
      const args2 = { _: [], flags: {}, multi: {} };
      for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--force") {
          args2.flags.force = true;
          continue;
        }
        if (a === "--no-run") {
          args2.flags["no-run"] = true;
          continue;
        }
        if (a === "--check") {
          args2.flags.check = true;
          continue;
        }
        if (a === "--daemon") {
          args2.flags.daemon = true;
          continue;
        }
        if (a === "--fg" || a === "--foreground") {
          args2.flags.fg = true;
          continue;
        }
        if (a.length >= 3 && a[0] === "-" && a[1] !== "-" && a.indexOf("=") !== -1) {
          const eq = a.indexOf("=");
          const key = a.slice(1, eq);
          const value = a.slice(eq + 1);
          if (SINGLE_VALUE_FLAGS.indexOf(key) !== -1) {
            args2.flags[key] = value;
            continue;
          }
        }
        if (a.length >= 2 && a[0] === "-" && a[1] !== "-") {
          const key = a.slice(1);
          if (NO_VALUE_FLAGS.indexOf(key) !== -1) {
            args2.flags[key] = true;
            continue;
          }
          if (MULTI_VALUE_FLAGS.indexOf(key) !== -1) {
            const next = argv[i + 1];
            if (next !== void 0 && !(next[0] === "-" && next.length > 1)) {
              i++;
              if (!args2.multi[key]) args2.multi[key] = [];
              for (const v of next.split(",")) {
                const tt = v.trim();
                if (tt) args2.multi[key].push(tt);
              }
            }
            continue;
          }
          if (SINGLE_VALUE_FLAGS.indexOf(key) !== -1) {
            const next = argv[i + 1];
            if (next !== void 0 && !(next[0] === "-" && next.length > 1)) {
              args2.flags[key] = next;
              i++;
            } else args2.flags[key] = true;
            continue;
          }
        }
        if (a.length > 2 && a.slice(0, 2) === "--") {
          const key = a.slice(2);
          const eq = key.indexOf("=");
          if (eq !== -1) args2.flags[key.slice(0, eq)] = key.slice(eq + 1);
          else {
            const next = argv[i + 1];
            if (next !== void 0 && !(next[0] === "-" && next.length > 1)) {
              args2.flags[key] = next;
              i++;
            } else args2.flags[key] = true;
          }
          continue;
        }
        args2._.push(a);
      }
      return args2;
    }
    var KNOWN_COMMANDS = [
      "cli",
      "list",
      "get",
      "search",
      "add",
      "install",
      "i",
      "download",
      "uninstall",
      "remove",
      "rm",
      "redadd",
      "redel",
      "temp",
      "set",
      "lang",
      "pak",
      "clear",
      "cls",
      "update",
      "package",
      "version",
      "v",
      "web",
      "task",
      "plugin",
      "login",
      "signup",
      "logout",
      "release",
      "repair",
      "exit",
      "quit",
      "help"
    ];
    async function dispatch(argv) {
      const args2 = parseArgs2(argv);
      if (!args2._.length) {
        console.log(buildHelpText());
        return;
      }
      const cmd = args2._[0];
      const sub = args2._[1];
      if (KNOWN_COMMANDS.indexOf(cmd) === -1) {
        unknownCommand(cmd);
        return;
      }
      switch (cmd) {
        case "cli":
          return require_shell().run();
        case "list":
          if (sub === "install" || sub === "installed") return listInstalled();
          return listAvailable();
        case "search":
          return searchPackages(args2);
        case "get":
          return getFromGithub();
        case "add":
          return installer.addPackage(args2._[1], args2._[2], args2.flags);
        case "install":
        case "i":
          return runInstall(args2);
        case "download":
          return runDownload(args2);
        case "uninstall":
        case "remove":
        case "rm":
          return installer.uninstall(args2._[1]);
        case "redadd":
          return installer.registerDisk(args2._[1], args2._[2]);
        case "redel":
          return installer.unregister(args2._[1]);
        case "pak":
          return pakCommand(args2._.slice(1), args2.flags);
        case "model":
          return modelCommand(args2._.slice(1));
        case "plugin":
          return pluginCommand(args2._.slice(1), args2.flags);
        case "task":
          return taskCommand(args2._.slice(1));
        case "login":
          return require_login().login();
        case "logout": {
          const auth = require_auth();
          const r = auth.logout();
          log[r ? "success" : "warn"](r ? i18n.t("logoutOK") : i18n.t("logoutNone"));
          return;
        }
        case "release":
          return require_release().run(args2._.slice(1));
        case "repair":
          return repairCommand(args2._.slice(1));
        case "temp":
          if (sub === "clear") return clearTemp();
          log.error(i18n.t("tempUsage"));
          return;
        case "set":
          return settings(args2._.slice(1));
        case "lang":
          return lang(args2._.slice(1));
        case "web":
          return webCommand(args2._.slice(1), args2.flags);
        case "clear":
        case "cls":
          clearScreen();
          return;
        case "package":
          if (sub === "update") {
            return packageUpdate(args2._.slice(2), args2.flags);
          }
          log.error("\u7528\u6CD5: ipm package update [name] [--check]");
          return;
        case "update":
          return selfUpdate(args2);
        case "version":
        case "v":
          return versionCommand(args2._.slice(1));
        case "exit":
        case "quit":
          return proc2.exitAll(0);
        case "help":
          console.log(buildHelpText());
          return;
      }
    }
    async function selfUpdate(args2) {
      return require_self_update().updateSelf(args2.flags);
    }
    async function packageUpdate(rest, flags) {
      const name = rest[0] || null;
      log.step(i18n.t("updateFetching"));
      try {
        const { fetchAll } = require_update_lib();
        await fetchAll({});
      } catch (err) {
        log.error(i18n.t("fetchPkgsFail") + ": " + err.message);
        return;
      }
      if (flags.check) return updateCheck(name);
      flags.q = true;
      log.step(i18n.t("updateStart"));
      const n = await installer.updatePackage(name, flags);
      if (n === 0) log.success(i18n.t("updateAlreadyLatest"));
      else log.success(i18n.t("updateDone") + "  " + n + " " + i18n.t("updateUpdated"));
    }
    async function updateCheck(name) {
      const inst = registry.list();
      const targets = name ? inst.filter(function(p) {
        return p.name === name;
      }) : inst;
      if (!targets.length) {
        log.info(i18n.t("noInstalledPkgs"));
        return;
      }
      let count = 0;
      for (const t of targets) {
        const pkg = sources.find(t.name);
        if (!pkg || !pkg.latest) continue;
        if (versionLib.compareVer(pkg.latest.version, t.version) > 0) {
          console.log("  " + color.cyan(t.name) + "  v" + t.version + " -> v" + pkg.latest.version);
          count++;
        }
      }
      if (count === 0) log.success(i18n.t("updateAlreadyLatest"));
      else console.log("  " + i18n.t("updatePlan") + ": " + count);
    }
    async function webCommand(rest, flags) {
      const web = require_web();
      const sub = rest[0] || "start";
      if (sub === "stop") {
        const r2 = await web.stop();
        if (r2.ok) log.success(i18n.t("webStopped") + " (PID " + r2.pid + ")");
        else log.warn(i18n.t("webNotRunning"));
        return;
      }
      if (sub === "status") {
        const s = web.status();
        if (s.running) {
          log.info(i18n.t("webRunning") + "  " + i18n.t("webPortLabel") + " " + s.port + "  PID " + s.pid);
          console.log("  " + color.cyan("http://localhost:" + s.port + "/"));
        } else {
          log.info(i18n.t("webNotRunning"));
        }
        return;
      }
      const port = flags.p || flags.port || 7632;
      if (flags.daemon) {
        const r2 = await web.start({ port });
        if (r2.ok) {
          web.writePid({ pid: process.pid, port: r2.port, host: r2.host || "127.0.0.1" });
          global.__ipm_keepAlive = true;
        } else if (r2.error === "alreadyRunning") {
        }
        return;
      }
      if (flags.fg) {
        log.step(i18n.t("webStarting"));
        const r2 = await web.start({ port });
        if (r2.ok) {
          web.writePid({ pid: process.pid, port: r2.port, host: r2.host || "127.0.0.1" });
          log.success(i18n.t("webStarted") + "  " + i18n.t("webPortLabel") + " " + r2.port);
          console.log("  " + color.cyan("http://localhost:" + r2.port + "/"));
          console.log("  " + color.gray(i18n.t("webStopHint")));
        } else if (r2.error === "alreadyRunning") {
          log.warn(i18n.t("webAlreadyRunning") + " " + i18n.t("webPortLabel") + " " + r2.port);
        } else {
          log.error(i18n.t("webStartFailed") + ": " + (r2.message || r2.error));
        }
        return;
      }
      log.step(i18n.t("webStartingBg"));
      const r = await web.startBackground({ port });
      if (r.ok) {
        log.success(i18n.t("webStartedBg") + "  " + i18n.t("webPortLabel") + " " + r.port + "  PID " + r.pid);
        console.log("  " + color.cyan("http://localhost:" + r.port + "/"));
        console.log("  " + color.gray(i18n.t("webStopHint")));
      } else if (r.error === "alreadyRunning") {
        log.warn(i18n.t("webAlreadyRunning") + "  " + i18n.t("webPortLabel") + " " + r.port);
      } else if (r.error === "invalidPort") {
        log.error(i18n.t("webInvalidPort") + ": " + port);
      } else if (r.error === "timeout") {
        log.error(i18n.t("webStartFailed") + ": timeout");
        log.info("\u53EF\u80FD\u539F\u56E0\uFF1A");
        console.log("  1. \u7AEF\u53E3 " + port + " \u88AB\u5176\u5B83\u8FDB\u7A0B\u5360\u7528");
        console.log("     \u8FD0\u884C: netstat -ano | findstr :" + port);
        console.log("  2. \u4E0A\u6B21 Web \u8FDB\u7A0B\u6CA1\u9000\u5E72\u51C0");
        console.log("     \u8FD0\u884C: taskkill /F /IM ipm.exe");
        console.log("  3. \u67E5\u770B\u5B50\u8FDB\u7A0B\u65E5\u5FD7:");
        console.log('     type "%USERPROFILE%\\.ipm\\temp\\.ipm-web.log"');
      } else {
        log.error(i18n.t("webStartFailed") + ": " + (r.message || r.error));
      }
    }
    async function taskCommand(rest) {
      const sub = rest[0] || "list";
      if (sub === "list" || sub === "ls") {
        const list = tasks.list();
        if (!list.length) {
          log.info(i18n.t("taskListEmpty"));
          return;
        }
        console.log(i18n.t("taskHeader") + ":  (" + list.length + ")");
        for (const t of list) {
          const label = t.type === "download" ? i18n.t("taskDownload") : i18n.t("taskInstall");
          let line = "  #" + t.id + "  [" + label + "]  " + t.name;
          if (t.type === "download" && t.total > 0) {
            const pct = (t.bytes / t.total * 100).toFixed(1);
            line += "  " + pct + "%  " + formatBytes(t.bytes) + " / " + formatBytes(t.total);
          }
          console.log(line);
        }
        return;
      }
      if (sub === "stop" || sub === "kill") {
        const id = rest[1];
        if (!id || id === "all") {
          const killed = tasks.abortAll();
          log.success(i18n.t("taskStopAll") + "  (" + killed.length + ")");
          return;
        }
        const r = tasks.abort(id);
        if (!r.ok) {
          log.error(i18n.t("taskNotFound") + ": #" + id);
          return;
        }
        log.success(i18n.t("taskStopped") + ": #" + r.task.id + "  " + r.task.name);
        return;
      }
      log.error(i18n.t("taskUsage"));
    }
    function splitNames(raw) {
      return String(raw || "").split(",").map(function(s) {
        return s.trim();
      }).filter(Boolean);
    }
    function showInstallError(err) {
      const msg = err && err.message || String(err);
      log.error(msg);
      const sug = err && err.suggest || [];
      if (!sug.length) return;
      console.log("");
      console.log("  " + (i18n.t("suggestHeader") !== "suggestHeader" ? i18n.t("suggestHeader") : "\u4F60\u662F\u4E0D\u662F\u60F3\u88C5:"));
      const historyCmds = [];
      for (let i = 0; i < sug.length; i++) {
        const n = sug[i];
        const cmd = "install " + n;
        historyCmds.push(cmd);
        const num = color.gray("  " + (i + 1) + ") ");
        const nameText = link(n, "ipm " + cmd);
        console.log(num + nameText);
      }
      if (global.__ipm_addHistory) {
        for (const c of historyCmds) {
          try {
            global.__ipm_addHistory(c);
          } catch (_) {
          }
        }
        console.log("");
        console.log("  " + color.gray(i18n.t("suggestHint") !== "suggestHint" ? i18n.t("suggestHint") : "\u6309 \u2191 \u9009\u62E9\u547D\u4EE4\u6267\u884C"));
      }
    }
    async function runInstall(args2) {
      const raw = args2._[1];
      if (!raw) throw new Error(i18n.t("installUsage"));
      if (raw.indexOf("..") !== -1 || /^[\\/]/.test(raw)) {
        throw new Error("\u65E0\u6548\u7684\u5305\u540D: " + raw);
      }
      let version = null;
      let installPath = null;
      const a2 = args2._[2] || null;
      const a3 = args2._[3] || null;
      function isPathLike(s) {
        if (!s) return false;
        if (/[\\/]/.test(s)) return true;
        if (/^[A-Za-z]:/.test(s)) return true;
        if (s === "~" || s.indexOf("~/") === 0 || s.indexOf("~\\") === 0) return true;
        if (s === "." || s === ".." || s.indexOf("./") === 0 || s.indexOf(".\\") === 0) return true;
        return false;
      }
      if (a2) {
        if (isPathLike(a2)) {
          installPath = a2;
        } else {
          version = a2;
          if (a3) installPath = a3;
        }
      }
      if (args2.flags && args2.flags.d && !installPath) {
        installPath = String(args2.flags.d);
      }
      const names = splitNames(raw);
      if (names.length <= 1) {
        try {
          return await installer.install(names[0] || raw, version, installPath, args2.flags);
        } catch (err) {
          showInstallError(err);
          return;
        }
      }
      const total = names.length;
      console.log(i18n.t("installMultiple") + ":  " + total);
      console.log("");
      let okN = 0, failN = 0;
      for (let i = 0; i < total; i++) {
        const n = names[i];
        console.log(color.cyan("[" + (i + 1) + "/" + total + "] ") + color.bold(n));
        try {
          await installer.install(n, version, installPath, args2.flags);
          okN++;
        } catch (err) {
          failN++;
          showInstallError(err);
        }
        console.log("");
      }
      log.success(i18n.t("installBatchDone") + "  " + okN + " ok" + (failN ? " / " + failN + " fail" : ""));
    }
    async function runDownload(args2) {
      const raw = args2._[1];
      if (!raw) throw new Error(i18n.t("downloadUsage"));
      if (raw.indexOf("..") !== -1 || /^[\\/]/.test(raw)) {
        throw new Error("\u65E0\u6548\u7684\u5305\u540D: " + raw);
      }
      const version = args2._[2] || null;
      const names = splitNames(raw);
      if (names.length <= 1) {
        return downloader.download(names[0] || raw, version, args2.flags);
      }
      const total = names.length;
      console.log(i18n.t("downloadMultiple") + ":  " + total);
      console.log("");
      let okN = 0, failN = 0;
      for (let i = 0; i < total; i++) {
        const n = names[i];
        console.log(color.cyan("[" + (i + 1) + "/" + total + "] ") + color.bold(n));
        try {
          await downloader.download(n, version, args2.flags);
          okN++;
        } catch (err) {
          failN++;
          log.error(n + ": " + err.message);
        }
        console.log("");
      }
      log.success(i18n.t("downloadBatchDone") + "  " + okN + " ok" + (failN ? " / " + failN + " fail" : ""));
    }
    function listAvailable() {
      const pkgs = sources.listPackages();
      const st = sources.stats();
      if (!pkgs.length) {
        log.info(i18n.t("noAvailablePkgs"));
        log.info(i18n.t("runGetHint"));
        return;
      }
      console.log(i18n.t("availablePkgs") + ":  " + st.pkgCount + " " + i18n.t("unitPackages") + ", " + st.releaseCount + " " + i18n.t("unitReleases") + ", " + st.fileCount + " " + i18n.t("unitFiles"));
      console.log("");
      for (let i = 0; i < pkgs.length; i++) {
        const pkg = pkgs[i];
        const isLast = i === pkgs.length - 1;
        const branch = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
        const co = pkg.company && pkg.company !== "null" ? color.gray("  " + pkg.company) : "";
        console.log(branch + color.bold(color.brightCyan(pkg.name)) + "  " + typeBadge(pkg.type) + co);
        const vs = pkg.versions;
        const pad = isLast ? "   " : "\u2502  ";
        for (let j = 0; j < vs.length; j++) {
          const v = vs[j];
          const vLast = j === vs.length - 1;
          const vb = vLast ? "\u2514\u2500 " : "\u251C\u2500 ";
          const ver = color.brightYellow("v" + v.version);
          const fn = color.brightWhite(v.fileName);
          const size = v.size ? color.dim(" (" + formatBytes(v.size) + ")") : "";
          const tag = v === pkg.latest ? "  " + color.brightGreen("\u2605") : "";
          console.log(pad + vb + ver + "  " + fn + size + tag);
        }
      }
    }
    function listInstalled() {
      const pkgs = registry.list();
      if (!pkgs.length) {
        log.info(i18n.t("noInstalledPkgs"));
        return;
      }
      console.log(color.bold(color.brightCyan(i18n.t("installedPkgs") + ":")));
      for (const p of pkgs) {
        const ver = p.version ? color.brightYellow(" v" + p.version) : "";
        const type = p.type ? typeBadge(p.type) : "";
        const file = p.fileName ? color.dim(" (" + p.fileName + ")") : "";
        console.log("  " + color.bold(color.brightCyan(p.name)) + ver + "  " + type + file);
        if (p.path) console.log("    " + color.dim("\u21B3 " + p.path));
      }
    }
    function searchPackages(args2) {
      const all = sources.listPackages();
      const text = args2._.slice(1).join(" ");
      const lowerText = text.toLowerCase();
      const fullWord = Boolean(args2.flags.a);
      const companies = args2.multi.i || [];
      const exclCompanies = args2.multi.ni || [];
      const versions = args2.multi.v || [];
      const exclVersions = args2.multi.nv || [];
      const type = args2.flags.t || null;
      const allVersions = Boolean(args2.flags.av);
      const hits = [];
      for (const pkg of all) {
        if (type && pkg.type !== type) continue;
        if (companies.length) {
          let m = false;
          for (const c of companies) {
            if (pkg.company.toLowerCase().indexOf(c.toLowerCase()) !== -1) {
              m = true;
              break;
            }
          }
          if (!m) continue;
        }
        if (exclCompanies.length) {
          let ex = false;
          for (const c of exclCompanies) {
            if (pkg.company.toLowerCase() === c.toLowerCase()) {
              ex = true;
              break;
            }
          }
          if (ex) continue;
        }
        if (text) {
          const m = fullWord ? pkg.name.toLowerCase() === lowerText : pkg.name.toLowerCase().indexOf(lowerText) !== -1;
          if (!m) continue;
        }
        let mv = pkg.versions.slice();
        if (versions.length) mv = mv.filter(function(v) {
          return versions.indexOf(v.version) !== -1;
        });
        if (exclVersions.length) mv = mv.filter(function(v) {
          return exclVersions.indexOf(v.version) === -1;
        });
        if (!mv.length) continue;
        hits.push(Object.assign({}, pkg, {
          versions: allVersions ? mv : [mv[mv.length - 1]],
          latest: mv[mv.length - 1]
        }));
      }
      if (!hits.length) {
        log.info(i18n.t("noAvailablePkgs"));
        return;
      }
      const head = text ? i18n.t("searchHeader") + ' "' + text + '"' : i18n.t("filterHeader");
      console.log(head + ":  " + hits.length + " " + i18n.t("unitPackages"));
      for (const p of hits) {
        const co = p.company && p.company !== "null" ? color.gray("  company=" + p.company) : "";
        console.log("");
        console.log("  " + color.cyan(p.name) + "  " + typeBadge(p.type) + co);
        for (const v of p.versions) {
          const size = v.size ? color.gray(" (" + formatBytes(v.size) + ")") : "";
          console.log("      v" + v.version + "  " + v.fileName + size);
        }
      }
    }
    async function getFromGithub() {
      log.step(i18n.t("fetchingPkgs"));
      try {
        const { fetchAll } = require_update_lib();
        const r = await fetchAll({});
        if (!r.releases.length) {
          log.warn(i18n.t("noReleasesGot"));
          return;
        }
        log.success(i18n.t("fetchPkgsOK") + " " + r.releases.length + " " + i18n.t("unitReleases"));
        try {
          const f = require_applist().save();
          console.log(color.gray("  " + i18n.t("applistSaved") + ": " + f));
        } catch (_) {
        }
      } catch (err) {
        log.error(i18n.t("fetchPkgsFail") + ": " + err.message);
      }
    }
    async function versionCommand(rest) {
      if (!rest.length) {
        console.log(color.bold(color.brightCyan("InfinityPackageManager")) + "  " + color.dim("Infinity.Inc") + "  " + color.brightGreen("v" + versionLib.getPkgVersion()));
        const inst = registry.list();
        if (inst.length) {
          console.log(i18n.t("installedPkgs") + ":");
          for (const p of inst) {
            console.log("  " + color.cyan(p.name) + "  v" + (p.version || "?"));
          }
        }
        return;
      }
      const name = rest[0];
      const pkg = sources.find(name);
      const reg = registry.get(name);
      if (reg) console.log(color.cyan(name) + "  " + i18n.t("versionInstalled") + " v" + reg.version);
      if (pkg) {
        console.log(color.cyan(pkg.name) + "  " + i18n.t("versionLatest") + " v" + pkg.latest.version + "  (" + pkg.versions.length + ")");
        console.log(i18n.t("versionAll"));
        for (const v of pkg.versions) {
          const mark = reg && reg.version === v.version ? color.green(" *") : "";
          console.log("  v" + v.version + "  " + v.fileName + mark);
        }
      } else if (!reg) {
        log.error(i18n.t("pkgNotFound") + ": " + name);
      }
    }
    async function pluginCommand(rest, flags) {
      flags = flags || {};
      const sub = rest[0] || "search";
      const plugin = require_plugin();
      if (sub === "path") {
        const name = rest[1];
        if (name) {
          console.log(plugin.pluginPath(name));
        } else {
          console.log(plugin.PLUGIN_DIR);
        }
        return;
      }
      if (sub === "search") {
        const kw = rest.slice(1).join(" ");
        const hits = plugin.search(kw);
        if (!hits.length) {
          if (!kw) {
            log.info("\u6CA1\u6709\u53EF\u7528\u7684\u63D2\u4EF6");
            log.info('\u8FD0\u884C "ipm get" \u62C9\u53D6\u63D2\u4EF6\u5217\u8868');
          } else {
            log.info("\u6CA1\u6709\u5339\u914D\u7684\u63D2\u4EF6: " + kw);
          }
          return;
        }
        return printPluginList(hits);
      }
      if (sub === "add") {
        const arg = rest.slice(1).join(",");
        const names = arg.split(",").map((s) => s.trim()).filter(Boolean);
        if (!names.length) {
          log.error("\u7528\u6CD5: ipm plugin add <name1,name2,...>");
          return;
        }
        if (!plugin.findAvailable(names[0])) {
          try {
            const { fetchAll } = require_update_lib();
            log.step("\u62C9\u53D6\u63D2\u4EF6\u5217\u8868...");
            await fetchAll({});
          } catch (_) {
          }
        }
        return plugin.add(names, {});
      }
      if (sub === "del" || sub === "remove") {
        const arg = rest.slice(1).join(",");
        const names = arg.split(",").map((s) => s.trim()).filter(Boolean);
        if (!names.length) {
          log.error("\u7528\u6CD5: ipm plugin del <name1,name2,...>");
          return;
        }
        return plugin.del(names);
      }
      if (sub === "update") {
        const arg = rest.slice(1).join(",");
        const names = arg ? arg.split(",").map((s) => s.trim()).filter(Boolean) : null;
        return plugin.update(names);
      }
      if (sub === "pack") {
        const zipPath = rest[1];
        const pname = rest[2];
        const pver = rest[3];
        const pco = rest[4] || "null";
        const outDir = flags && flags.d ? flags.d : null;
        if (!zipPath || !pname || !pver) {
          log.error("\u7528\u6CD5: ipm plugin pack <zip> <name> <version> [company] [-d <outdir>]");
          return;
        }
        try {
          const r = plugin.pack(zipPath, pname, pver, pco, outDir);
          log.success("\u5DF2\u751F\u6210 " + r.file);
          console.log("  \u8F93\u5165: " + formatBytes(r.sizeIn));
          console.log("  \u8F93\u51FA: " + formatBytes(r.sizeOut) + "  (" + (r.sizeOut / r.sizeIn * 100).toFixed(1) + "%)");
          console.log("");
          console.log("  name.txt \u5185\u5BB9:");
          console.log("    " + r.nameTxt.trim());
        } catch (e) {
          log.error("\u6253\u5305\u5931\u8D25: " + e.message);
        }
        return;
      }
      if (sub === "list") {
        const inst = plugin.listInstalled();
        if (!inst.length) {
          log.info("\u672A\u5B89\u88C5\u4EFB\u4F55\u63D2\u4EF6");
          return;
        }
        console.log("\u5DF2\u5B89\u88C5\u63D2\u4EF6:");
        for (const p of inst) {
          console.log("  " + PC.cyan + p.name + PC.reset + "  v" + p.version + "  " + PC.gray + p.path + PC.reset);
        }
        return;
      }
      log.error("\u7528\u6CD5: ipm plugin [path|search|add|del|update|list]");
    }
    function printPluginList(list) {
      if (!list.length) {
        log.info("\u6CA1\u6709\u53EF\u7528\u7684\u63D2\u4EF6");
        return;
      }
      console.log("\u53EF\u7528\u7684\u63D2\u4EF6:  " + list.length);
      console.log("");
      for (const p of list) {
        const co = p.company && p.company !== "null" ? PC.gray + "  " + p.company + PC.reset : "";
        const inst = p.installed ? PC.green + "  [\u5DF2\u5B89\u88C5 v" + p.installed.version + "]" + PC.reset : "";
        console.log("  " + PC.cyan + p.name + PC.reset + co + inst);
        if (p.latest) {
          console.log("      v" + p.latest.version + "  " + p.latest.fileName + "  " + PC.gray + (p.latest.size ? formatBytes(p.latest.size) : "") + PC.reset);
        }
      }
    }
    async function pakCommand(rest, flags) {
      if (!rest.length || rest[0] === "list") return pakList();
      const sub = rest[0];
      if (sub === "add") {
        const name = rest[1], url = rest[2];
        if (!name || !url) {
          log.error(i18n.t("pakAddUsage"));
          return;
        }
        const r = pak.add(name, url, flags);
        if (!r.ok) {
          const key = r.error;
          const msg = i18n.t(key) !== key ? i18n.t(key) : key;
          log.error(msg);
          if (key === "nameExists") log.warn(i18n.t("pakForceHint"));
          return;
        }
        log.success(i18n.t("pakAdded") + ": " + r.pkg.name);
        return;
      }
      if (sub === "del" || sub === "delete" || sub === "remove" || sub === "rm") {
        const name = rest[1];
        if (!name) {
          log.error(i18n.t("pakDelUsage"));
          return;
        }
        const r = pak.remove(name);
        if (!r.ok) {
          log.error(i18n.t("pakNotFound") + ": " + name);
          return;
        }
        log.success(i18n.t("pakRemoved") + ": " + name);
        return;
      }
      log.error(i18n.t("pakListUsage"));
    }
    function pakList() {
      const all = pak.list();
      console.log(i18n.t("pakHeader") + ":  (" + all.length + ")");
      if (!all.length) {
        log.info(i18n.t("pakEmpty"));
        return;
      }
      console.log("");
      for (const p of all) {
        console.log("  " + color.cyan(p.name));
        if (p.file) console.log("    " + color.gray(i18n.t("pakFile") + ": " + p.file));
        console.log("    " + color.gray(i18n.t("pakUrl") + ": " + p.url));
        console.log("");
      }
    }
    function clearTemp() {
      const tempdir = config.get("tempdir");
      if (!fs.existsSync(tempdir)) {
        log.info(i18n.t("tempDirNotExist") + ": " + tempdir);
        return;
      }
      const entries = fs.readdirSync(tempdir).filter(function(n) {
        return n !== ".gitkeep" && n.indexOf(".ipm.pids") !== 0 && n.indexOf(".ipm-web") !== 0;
      });
      for (const e of entries) rmrf(path2.join(tempdir, e));
      log.success(i18n.t("tempCleared") + " " + tempdir + "  (" + entries.length + ")");
    }
    async function settings(rest) {
      if (!rest.length || rest[0] === "list") {
        const all = config.list();
        console.log(i18n.t("settingsHeader") + ":");
        for (const k of Object.keys(all)) console.log("  " + color.cyan(k) + " = " + all[k]);
        return;
      }
      const key = rest[0];
      if (rest.length === 1) {
        console.log(key + " = " + config.get(key));
        return;
      }
      const value = rest.slice(1).join(" ");
      config.set(key, value);
      if (key === "lang") i18n.reload();
      log.success(i18n.t("settingUpdated") + " " + key + " = " + value);
    }
    async function lang(rest) {
      if (!rest.length || rest[0] === "list") return langList();
      const sub = rest[0];
      if (sub === "get") {
        log.step(i18n.t("langGetting"));
        const { fetchLangs } = require_langfetch();
        await fetchLangs({});
        return;
      }
      if (sub === "set") {
        const name = rest[1];
        if (!name) {
          console.log(i18n.t("langUsage"));
          return;
        }
        const file = path2.join(i18n.LANG_DIR, name + ".lang");
        if (!fs.existsSync(file)) {
          log.error(i18n.t("langNotFound") + ": " + name);
          return;
        }
        config.set("lang", name);
        i18n.reload();
        log.success(i18n.t("langSetOK") + ": " + name);
        return;
      }
      log.error(i18n.t("langUsage"));
    }
    function langList() {
      const cur = i18n.current();
      const all = i18n.listLangs();
      console.log(i18n.t("langCurrent") + ": " + color.cyan(cur));
      if (!all.length) {
        log.warn(i18n.t("noAvailablePkgs"));
        return;
      }
      console.log(i18n.t("langAvailable") + ":");
      for (const name of all) {
        const meta = i18n.info(name);
        const display = meta && meta.displayName ? meta.displayName : name;
        const mark = name === cur ? color.green(" *") : "";
        console.log("  " + color.cyan(name) + "  " + color.gray(display) + mark);
      }
    }
    async function repairCommand(rest) {
      const shortcut = require_shortcut();
      const arg = rest[0];
      if (!arg) {
        log.error("\u7528\u6CD5: ipm repair <name>  |  ipm repair *all");
        return;
      }
      if (process.platform !== "win32") {
        log.warn("repair \u4EC5\u652F\u6301 Windows");
        return;
      }
      let targets;
      if (arg === "*all") {
        targets = registry.list().filter(function(p) {
          if (!p.path) return false;
          try {
            return fs.existsSync(p.path) && fs.statSync(p.path).isDirectory();
          } catch (_) {
            return false;
          }
        });
      } else {
        const info = registry.get(arg);
        if (!info) {
          log.error("\u672A\u5B89\u88C5: " + arg);
          return;
        }
        targets = [info];
      }
      if (!targets.length) {
        log.info("\u6CA1\u6709\u53EF\u4FEE\u590D\u7684\u5305");
        return;
      }
      let okN = 0, failN = 0;
      for (const p of targets) {
        if (!p.path || !fs.existsSync(p.path)) {
          log.warn("  " + p.name + ": \u8DEF\u5F84\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7");
          failN++;
          continue;
        }
        let isDir = false;
        try {
          isDir = fs.statSync(p.path).isDirectory();
        } catch (_) {
        }
        if (!isDir) {
          log.info("  " + p.name + ": \u975E\u4FBF\u643A\u7248\uFF0C\u8DF3\u8FC7");
          continue;
        }
        const r = shortcut.createAll(p.name, p.path);
        if (r.ok) {
          log.success("  " + p.name + ": \u5FEB\u6377\u65B9\u5F0F\u5DF2\u4FEE\u590D (" + r.created.join(" + ") + ")");
          okN++;
        } else {
          log.error("  " + p.name + ": " + r.error);
          failN++;
        }
      }
      log.success("\u4FEE\u590D\u5B8C\u6210: " + okN + " ok" + (failN ? " / " + failN + " fail" : ""));
    }
    module2.exports = {
      dispatch,
      parseArgs: parseArgs2,
      buildHelpText,
      unknownCommand,
      highlightCmd,
      paintCmd,
      listAvailable,
      listInstalled,
      searchPackages,
      pakCommand,
      taskCommand,
      clearTemp,
      settings,
      lang,
      versionCommand,
      selfUpdate,
      packageUpdate,
      webCommand
    };
  }
});

// src/model.js
var require_model = __commonJS({
  "src/model.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path2 = require("path");
    var os = require("os");
    var VOCAB = 256;
    var EMBED_DIM = 512;
    var H1 = 4608;
    var H2 = 4608;
    var H3 = 1024;
    var LORA_R = 128;
    function dataDir() {
      const dir = path2.join(os.homedir(), ".ipm");
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {
      }
      return dir;
    }
    function weightsFile() {
      return path2.join(dataDir(), ".completion.cache");
    }
    function randu(n, scale) {
      const a = new Float32Array(n);
      const s2 = scale * 2;
      for (let i = 0; i < n; i++) a[i] = (Math.random() - 0.5) * s2;
      return a;
    }
    function matmulRelu(input, W, bias, out) {
      const inLen = input.length;
      const outLen = out.length;
      if (bias) out.set(bias);
      else out.fill(0);
      for (let j = 0; j < inLen; j++) {
        const x = input[j];
        if (x === 0) continue;
        const base = j * outLen;
        for (let i = 0; i < outLen; i++) out[i] += x * W[base + i];
      }
      for (let i = 0; i < outLen; i++) if (out[i] < 0) out[i] = 0;
    }
    function matmul(input, W, bias, out) {
      const inLen = input.length;
      const outLen = out.length;
      if (bias) out.set(bias);
      else out.fill(0);
      for (let j = 0; j < inLen; j++) {
        const x = input[j];
        if (x === 0) continue;
        const base = j * outLen;
        for (let i = 0; i < outLen; i++) out[i] += x * W[base + i];
      }
    }
    var CompletionModel = class {
      constructor() {
        this.embed = new Float32Array(VOCAB * EMBED_DIM);
        this.W1 = new Float32Array(EMBED_DIM * H1);
        this.b1 = new Float32Array(H1);
        this.W2 = new Float32Array(H1 * H2);
        this.b2 = new Float32Array(H2);
        this.W3 = new Float32Array(H2 * H3);
        this.b3 = new Float32Array(H3);
        this.W4 = new Float32Array(H3 * VOCAB);
        this.b4 = new Float32Array(VOCAB);
        this.loraA = new Float32Array(H3 * LORA_R);
        this.loraB = new Float32Array(LORA_R * VOCAB);
        this._pool = new Float32Array(EMBED_DIM);
        this._h1 = new Float32Array(H1);
        this._h2 = new Float32Array(H2);
        this._h3 = new Float32Array(H3);
        this._mid = new Float32Array(LORA_R);
        this._logits = new Float32Array(VOCAB);
        this._probs = new Float32Array(VOCAB);
        this._gradOut = new Float32Array(VOCAB);
        this._gradMid = new Float32Array(LORA_R);
        this.step = 0;
        this._dirty = false;
        this._lastSaveAt = void 0;
      }
      _init() {
        this.embed.set(randu(this.embed.length, 0.08));
        this.W1.set(randu(this.W1.length, Math.sqrt(2 / EMBED_DIM)));
        this.W2.set(randu(this.W2.length, Math.sqrt(2 / H1)));
        this.W3.set(randu(this.W3.length, Math.sqrt(2 / H2)));
        this.W4.set(randu(this.W4.length, Math.sqrt(2 / H3)));
        this.loraA.set(randu(this.loraA.length, 0.01));
        this._dirty = true;
      }
      forward(ids) {
        const pool = this._pool;
        pool.fill(0);
        const n = ids.length;
        if (n === 0) return this._logits;
        for (let i = 0; i < n; i++) {
          const c = ids[i] % VOCAB;
          const base = c * EMBED_DIM;
          for (let j = 0; j < EMBED_DIM; j++) pool[j] += this.embed[base + j];
        }
        const inv = 1 / n;
        for (let j = 0; j < EMBED_DIM; j++) pool[j] *= inv;
        matmulRelu(pool, this.W1, this.b1, this._h1);
        matmulRelu(this._h1, this.W2, this.b2, this._h2);
        matmulRelu(this._h2, this.W3, this.b3, this._h3);
        matmul(this._h3, this.W4, this.b4, this._logits);
        const mid = this._mid;
        for (let i = 0; i < LORA_R; i++) {
          let s = 0;
          for (let j = 0; j < H3; j++) s += this._h3[j] * this.loraA[j * LORA_R + i];
          mid[i] = s;
        }
        for (let i = 0; i < VOCAB; i++) {
          let s = 0;
          for (let j = 0; j < LORA_R; j++) s += mid[j] * this.loraB[j * VOCAB + i];
          this._logits[i] += s;
        }
        return this._logits;
      }
      softmax(logits) {
        const p = this._probs;
        let max = -Infinity;
        for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
        let sum = 0;
        for (let i = 0; i < logits.length; i++) {
          const e = Math.exp(logits[i] - max);
          p[i] = e;
          sum += e;
        }
        const inv = 1 / sum;
        for (let i = 0; i < logits.length; i++) p[i] *= inv;
        return p;
      }
      backwardTrain(ids, targetId, lr) {
        const h3 = this._h3;
        const mid = this._mid;
        const logits = this.forward(ids);
        const probs = this.softmax(logits);
        const gradOut = this._gradOut;
        for (let i = 0; i < VOCAB; i++) gradOut[i] = probs[i];
        gradOut[targetId] -= 1;
        const gradMid = this._gradMid;
        for (let k = 0; k < LORA_R; k++) {
          let s = 0;
          for (let i = 0; i < VOCAB; i++) s += gradOut[i] * this.loraB[k * VOCAB + i];
          gradMid[k] = s;
        }
        for (let k = 0; k < LORA_R; k++) {
          const mk = mid[k];
          const base = k * VOCAB;
          for (let i = 0; i < VOCAB; i++) {
            this.loraB[base + i] -= lr * mk * gradOut[i];
          }
        }
        for (let j = 0; j < H3; j++) {
          const hj = h3[j];
          const base = j * LORA_R;
          for (let k = 0; k < LORA_R; k++) {
            this.loraA[base + k] -= lr * hj * gradMid[k];
          }
        }
        this._dirty = true;
        return -Math.log(Math.max(probs[targetId], 1e-9));
      }
      encode(str) {
        const ids = [];
        for (const ch of String(str)) ids.push(ch.charCodeAt(0) % VOCAB);
        return ids;
      }
      predictNext(prefix) {
        const ids = this.encode(prefix);
        if (ids.length === 0) return null;
        const slice = ids.slice(-32);
        const logits = this.forward(slice);
        const probs = this.softmax(logits);
        let best = 0, bestP = 0;
        for (let i = 0; i < probs.length; i++) {
          if (probs[i] > bestP) {
            bestP = probs[i];
            best = i;
          }
        }
        if (bestP < 0.05) return null;
        return { char: String.fromCharCode(best), prob: bestP };
      }
      // 只训练最后 8 个位置，避免 128M 模型太慢
      trainOnString(str, lr) {
        const s = String(str);
        if (s.length < 2) return 0;
        lr = lr || 0.03;
        const maxPos = Math.min(s.length, 8);
        let n = 0;
        for (let i = 0; i < maxPos; i++) {
          const pos = s.length - maxPos + i;
          if (pos < 1) continue;
          const prefix = s.slice(0, pos);
          const target = s.charCodeAt(pos) % VOCAB;
          const ids = this.encode(prefix);
          this.backwardTrain(ids, target, lr);
          n++;
        }
        this.step += n;
        return n;
      }
      save(force) {
        if (!force && !this._dirty) return true;
        if (!force && this._lastSaveAt !== void 0 && this.step - this._lastSaveAt < 50) {
          return true;
        }
        this._lastSaveAt = this.step;
        const arrays = [
          this.embed,
          this.W1,
          this.b1,
          this.W2,
          this.b2,
          this.W3,
          this.b3,
          this.W4,
          this.b4,
          this.loraA,
          this.loraB
        ];
        let total = 0;
        for (const a of arrays) total += a.byteLength;
        const buf = Buffer.allocUnsafe(total);
        let off = 0;
        for (const a of arrays) {
          Buffer.from(a.buffer, a.byteOffset, a.byteLength).copy(buf, off);
          off += a.byteLength;
        }
        try {
          fs.writeFileSync(weightsFile(), buf);
          this._dirty = false;
          return true;
        } catch (_) {
          return false;
        }
      }
      load() {
        const f = weightsFile();
        if (!fs.existsSync(f)) return false;
        try {
          const arrays = [
            this.embed,
            this.W1,
            this.b1,
            this.W2,
            this.b2,
            this.W3,
            this.b3,
            this.W4,
            this.b4,
            this.loraA,
            this.loraB
          ];
          let expected = 0;
          for (const a of arrays) expected += a.byteLength;
          const st = fs.statSync(f);
          if (st.size !== expected) return false;
          const buf = fs.readFileSync(f);
          let off = 0;
          for (const a of arrays) {
            const len = a.byteLength;
            new Uint8Array(a.buffer, a.byteOffset, len).set(
              new Uint8Array(buf.buffer, buf.byteOffset + off, len)
            );
            off += len;
          }
          return true;
        } catch (_) {
          return false;
        }
      }
    };
    var _inst = null;
    function get() {
      if (!_inst) {
        _inst = new CompletionModel();
        if (!_inst.load()) {
          _inst._init();
          _inst.save(true);
        }
      }
      return _inst;
    }
    function train(cmd) {
      try {
        const m = get();
        m.trainOnString(cmd, 0.03);
        if (m._dirty) m.save(false);
      } catch (_) {
      }
    }
    function complete(prefix) {
      try {
        const m = get();
        let cur = String(prefix);
        let added = "";
        for (let i = 0; i < 8; i++) {
          const p = m.predictNext(cur);
          if (!p || !p.char) break;
          const c = p.char;
          if (!/[a-zA-Z0-9_\-\. ]/.test(c)) break;
          cur += c;
          added += c;
          if (c === " ") break;
        }
        return added;
      } catch (_) {
        return "";
      }
    }
    process.on("exit", function() {
      try {
        if (_inst && _inst._dirty) _inst.save(true);
      } catch (_) {
      }
    });
    module2.exports = { get, train, complete, weightsFile };
  }
});

// src/shell.js
var require_shell = __commonJS({
  "src/shell.js"(exports2, module2) {
    "use strict";
    var { dispatch } = require_cli();
    var proc2 = require_process();
    var tasks = require_tasks();
    var i18n = require_i18n();
    var config = require_config();
    var versionLib = require_version();
    var C = {
      reset: "\x1B[0m",
      bold: "\x1B[1m",
      dim: "\x1B[2m",
      red: "\x1B[31m",
      green: "\x1B[32m",
      yellow: "\x1B[33m",
      blue: "\x1B[34m",
      magenta: "\x1B[35m",
      cyan: "\x1B[36m",
      gray: "\x1B[90m",
      brightCyan: "\x1B[96m",
      brightWhite: "\x1B[97m",
      brightGreen: "\x1B[92m",
      brightYellow: "\x1B[93m",
      brightBlue: "\x1B[94m",
      brightRed: "\x1B[91m",
      brightMagenta: "\x1B[95m"
    };
    var MAX_HISTORY = 200;
    var PROMPT = "ipm> ";
    var PROMPT_COL = 5;
    var inputBuf = "";
    var cursorPos = 0;
    var history = [];
    var historyIdx = -1;
    var stdinHandler = null;
    var exiting2 = false;
    var scrollRegionOn = false;
    var scrollBottom = 0;
    var tickTimer = null;
    var origLog;
    var origErr;
    var origWarn;
    function fmtSpeed(bps) {
      if (!isFinite(bps) || bps <= 0) return "0B/s";
      if (bps >= 1073741824) return (bps / 1073741824).toFixed(2) + "GB/s";
      if (bps >= 1048576) return (bps / 1048576).toFixed(2) + "MB/s";
      if (bps >= 1024) return (bps / 1024).toFixed(1) + "KB/s";
      return bps.toFixed(0) + "B/s";
    }
    function fmtSize(n) {
      if (n == null || n === 0) return "0B";
      const u = ["B", "KB", "MB", "GB", "TB"];
      let v = n, i = 0;
      while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i++;
      }
      return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 1 : 0)) + u[i];
    }
    function fmtEta(sec) {
      if (!isFinite(sec) || sec < 0 || sec > 86400) return "--:--";
      const s = Math.floor(sec);
      const h = Math.floor(s / 3600);
      const m = Math.floor(s % 3600 / 60);
      const ss = s % 60;
      if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
      return m + ":" + String(ss).padStart(2, "0");
    }
    function setupScrollRegion() {
      if (!process.stdout.isTTY) return;
      const H = process.stdout.rows || 24;
      if (H < 6) {
        scrollRegionOn = false;
        return;
      }
      scrollBottom = H - 2;
      process.stdout.write("\x1B[1;" + scrollBottom + "r");
      process.stdout.write("\x1B[" + scrollBottom + ";1H");
      scrollRegionOn = true;
    }
    function scrollOutput(text) {
      if (!scrollRegionOn) {
        process.stdout.write(String(text) + "\n");
        return;
      }
      const lines = String(text).split("\n");
      for (const line of lines) {
        process.stdout.write("\x1B[" + scrollBottom + ";1H");
        process.stdout.write("\r\x1B[K");
        process.stdout.write(line);
        process.stdout.write("\n");
      }
    }
    function buildStatusLine() {
      const list = tasks.list();
      if (!list.length) return "";
      const W = process.stdout.columns || 80;
      if (list.length > 1) {
        const maxShow = 3;
        const showList = list.slice(0, maxShow);
        const extra = list.length > maxShow ? C.dim + " (+" + (list.length - maxShow) + ")" + C.reset : "";
        const parts = [];
        for (const t2 of showList) {
          const name = t2.name.length > 10 ? t2.name.slice(0, 8) + ".." : t2.name;
          if (t2.type === "download") {
            const pct = t2.total > 0 ? Math.min(t2.bytes / t2.total, 1) : 0;
            parts.push(C.brightCyan + "\u25BC" + C.reset + " " + C.brightWhite + name + C.reset + " " + C.brightGreen + Math.floor(pct * 100) + "%" + C.reset);
          } else {
            parts.push(C.brightMagenta + "\u25A0" + C.reset + " " + C.brightWhite + name + C.reset + " " + C.brightYellow + "\u5B89\u88C5" + C.reset);
          }
        }
        return parts.join(C.dim + "  \xB7  " + C.reset) + extra;
      }
      const t = list[0];
      if (t.type === "download") {
        const pct = t.total > 0 ? Math.min(t.bytes / t.total, 1) : 0;
        const done = t.total > 0 && t.bytes >= t.total;
        const elapsed = Math.max(0.1, (Date.now() - t.started) / 1e3);
        const speed = elapsed > 0 ? t.bytes / elapsed : 0;
        const speedStr = done ? "\u5B8C\u6210\u4E2D" : fmtSpeed(speed);
        const totalStr = fmtSize(t.total);
        const etaStr = done || speed <= 0 ? "--:--" : fmtEta((t.total - t.bytes) / speed);
        const pctStr = Math.floor(pct * 100) + "%";
        const head = C.brightCyan + "\u25BC" + C.reset + " " + C.bold + C.brightWhite + t.name + C.reset + "  " + C.brightGreen + speedStr + C.reset + "  " + C.dim + "Total:" + C.reset + C.brightWhite + totalStr + C.reset + "  " + C.dim + "ETA:" + C.reset + C.brightYellow + etaStr + C.reset + "  " + C.brightMagenta + pctStr + C.reset;
        return head;
      }
      return C.brightMagenta + "\u25A0" + C.reset + " " + C.bold + C.brightWhite + t.name + C.reset + "  " + C.brightYellow + "[\u5B89\u88C5\u4E2D...]" + C.reset;
    }
    function drawBottom() {
      if (!process.stdout.isTTY || !scrollRegionOn) return;
      const H = process.stdout.rows || 24;
      process.stdout.write("\x1B[" + (H - 1) + ";1H\x1B[K");
      const status = buildStatusLine();
      if (status) process.stdout.write(status);
      process.stdout.write("\x1B[" + H + ";1H\x1B[K");
      process.stdout.write(C.brightCyan + PROMPT + C.reset);
      process.stdout.write(C.brightWhite + inputBuf + C.reset);
      const col = PROMPT_COL + cursorPos + 1;
      process.stdout.write("\x1B[" + H + ";" + col + "H");
      process.stdout.write("\x1B[?25h");
    }
    function paintCmd(line) {
      const parts = String(line).split(/\s+/);
      if (!parts.length) return line;
      const cmd = parts[0];
      const cmdColors = {
        install: C.cyan,
        i: C.cyan,
        list: C.blue,
        ls: C.blue,
        update: C.brightYellow,
        get: C.cyan,
        search: C.blue,
        download: C.cyan,
        version: C.brightYellow,
        v: C.brightYellow,
        task: C.brightYellow,
        help: C.brightWhite,
        exit: C.brightWhite,
        quit: C.brightWhite,
        remove: C.red,
        uninstall: C.red,
        rm: C.red
      };
      const c = cmdColors[cmd] || C.brightWhite;
      let out = C.bold + c + cmd + C.reset;
      for (let i = 1; i < parts.length; i++) {
        const a = parts[i];
        if (a.startsWith("-")) {
          out += " " + C.gray + a + C.reset;
        } else {
          out += " " + C.brightWhite + a + C.reset;
        }
      }
      return out;
    }
    var HOTKEY_DEFS = {
      "ctrl+x": { type: "byte", value: 24 },
      "ctrl+q": { type: "byte", value: 17 },
      "ctrl+b": { type: "byte", value: 2 },
      "ctrl+alt+c": { type: "combo", mods: [6, 7], keys: [99, 67] },
      "ctrl+alt+x": { type: "combo", mods: [6, 7], keys: [120, 88] },
      "ctrl+shift+x": { type: "combo", mods: [5, 7], keys: [120, 88] },
      "ctrl+shift+c": { type: "combo", mods: [5, 7], keys: [99, 67] }
    };
    function getHotkey() {
      let raw = "";
      try {
        raw = config.get("hotkey") || "";
      } catch (_) {
      }
      return String(raw).toLowerCase().trim() || "ctrl+x";
    }
    function matchHotkey(str, i, key) {
      const def = HOTKEY_DEFS[key];
      if (!def) return -1;
      if (def.type === "byte") {
        if (str.charCodeAt(i) === def.value) return 1;
        return -1;
      }
      if (str[i] !== "\x1B" || str[i + 1] !== "[") return -1;
      const rest = str.slice(i + 2, i + 30);
      let km = rest.match(/^(\d+);(\d+)u/);
      if (km) {
        const k = parseInt(km[1], 10), m = parseInt(km[2], 10);
        if (def.keys.indexOf(k) !== -1 && def.mods.indexOf(m) !== -1) return 2 + km[0].length;
      }
      let xm = rest.match(/^27;(\d+);(\d+)~/);
      if (xm) {
        const m = parseInt(xm[1], 10), k = parseInt(xm[2], 10);
        if (def.mods.indexOf(m) !== -1 && def.keys.indexOf(k) !== -1) return 2 + xm[0].length;
      }
      return -1;
    }
    function insertStr(s) {
      inputBuf = inputBuf.slice(0, cursorPos) + s + inputBuf.slice(cursorPos);
      cursorPos += s.length;
    }
    function backspace() {
      if (cursorPos > 0) {
        const before = Array.from(inputBuf.slice(0, cursorPos));
        const after = inputBuf.slice(cursorPos);
        before.pop();
        const b = before.join("");
        inputBuf = b + after;
        cursorPos = b.length;
      }
    }
    function deleteChar() {
      if (cursorPos < inputBuf.length) {
        const before = inputBuf.slice(0, cursorPos);
        const after = Array.from(inputBuf.slice(cursorPos));
        after.shift();
        inputBuf = before + after.join("");
      }
    }
    function move(d) {
      cursorPos = Math.max(0, Math.min(inputBuf.length, cursorPos + d));
    }
    function histUp() {
      if (!history.length) return;
      if (historyIdx < history.length - 1) {
        historyIdx++;
        inputBuf = history[history.length - 1 - historyIdx];
        cursorPos = inputBuf.length;
      }
    }
    function histDown() {
      if (historyIdx <= 0) {
        historyIdx = -1;
        inputBuf = "";
        cursorPos = 0;
        return;
      }
      historyIdx--;
      inputBuf = history[history.length - 1 - historyIdx];
      cursorPos = inputBuf.length;
    }
    function killAllTasks() {
      if (tasks.count() === 0) return 0;
      return tasks.abortAll().length;
    }
    async function handleCommand(cmd) {
      let cmds;
      if (cmd[0] === "{" && cmd[cmd.length - 1] === "}") {
        cmds = cmd.slice(1, -1).split(";").map(function(s) {
          return s.trim();
        }).filter(Boolean);
      } else {
        cmds = [cmd];
      }
      for (const c of cmds) {
        try {
          const argv = c.split(/\s+/);
          if (argv[0] === "ipm") argv.shift();
          await dispatch(argv);
        } catch (e) {
          scrollOutput(C.red + "x" + C.reset + " " + (e && e.message || String(e)));
        }
      }
    }
    function attachInput() {
      process.stdin.setEncoding("utf8");
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
        } catch (_) {
        }
      }
      process.stdin.resume();
      stdinHandler = function(data) {
        const str = String(data);
        const hotkey = getHotkey();
        let i = 0;
        while (i < str.length) {
          const code = str.charCodeAt(i);
          if (code === 27) {
            const hkLen = matchHotkey(str, i, hotkey);
            if (hkLen > 0) {
              const n = killAllTasks();
              scrollOutput(C.brightYellow + "\u2328 " + hotkey.toUpperCase() + C.reset + (n > 0 ? "  " + C.green + "\u4E2D\u65AD " + n + " \u4E2A\u4EFB\u52A1" + C.reset : "  " + C.gray + "\u65E0\u8FD0\u884C\u4E2D\u7684\u4EFB\u52A1" + C.reset));
              i += hkLen;
              continue;
            }
            if (str[i + 1] === "[") {
              const k = str[i + 2];
              if (k === "A") {
                histUp();
                i += 3;
                continue;
              }
              if (k === "B") {
                histDown();
                i += 3;
                continue;
              }
              if (k === "C") {
                move(1);
                i += 3;
                continue;
              }
              if (k === "D") {
                move(-1);
                i += 3;
                continue;
              }
              if (k === "H") {
                cursorPos = 0;
                i += 3;
                continue;
              }
              if (k === "F") {
                cursorPos = inputBuf.length;
                i += 3;
                continue;
              }
              if (k === "3" && str[i + 3] === "~") {
                deleteChar();
                i += 4;
                continue;
              }
              i += 3;
              continue;
            }
            i++;
            continue;
          }
          if (code === 13 || code === 10) {
            i++;
            const cmd = inputBuf.trim();
            inputBuf = "";
            cursorPos = 0;
            if (!cmd) {
              drawBottom();
              continue;
            }
            history.push(cmd);
            if (history.length > MAX_HISTORY) history.shift();
            historyIdx = -1;
            setImmediate(function() {
              try {
                const model = require_model();
                const m = model.get();
                const n = m.trainOnString(cmd, 0.03);
                if (m.step % 5 === 0) m.save();
              } catch (_) {
              }
            });
            scrollOutput(C.brightCyan + PROMPT + C.reset + paintCmd(cmd));
            if (cmd === "exit" || cmd === "quit") {
              exiting2 = true;
              try {
                const H = process.stdout.rows || 24;
                process.stdout.write("\x1B[r");
                process.stdout.write("\x1B[" + (H - 1) + ";1H");
                process.stdout.write("\x1B[J");
                process.stdout.write("\x1B[?25h");
              } catch (_) {
              }
              if (global.__ipm_exitNow) global.__ipm_exitNow(0);
              return;
            }
            handleCommand(cmd).catch(function(e) {
              scrollOutput(C.red + "x" + C.reset + " " + (e && e.message || String(e)));
            });
            drawBottom();
            continue;
          }
          if (code === 9) {
            i++;
            try {
              const parts = inputBuf.split(/\s+/);
              const partial = parts[parts.length - 1] || "";
              if (parts.length === 1) {
                const cmds = [
                  "install",
                  "list",
                  "search",
                  "get",
                  "update",
                  "download",
                  "uninstall",
                  "version",
                  "web",
                  "lang",
                  "set",
                  "task",
                  "help",
                  "exit",
                  "package",
                  "login",
                  "logout",
                  "release"
                ];
                const hits = cmds.filter(function(c) {
                  return c.indexOf(partial) === 0;
                });
                if (hits.length === 1 && partial.length > 0) {
                  insertStr(hits[0].slice(partial.length));
                  continue;
                }
              }
              if (parts.length >= 2 && partial.length > 0) {
                const sources = require_sources();
                const pkgs = sources.listPackages();
                const hits = pkgs.filter(function(p) {
                  return p.name.toLowerCase().indexOf(partial.toLowerCase()) === 0;
                });
                if (hits.length === 1) {
                  insertStr(hits[0].name.slice(partial.length));
                  continue;
                }
                if (hits.length > 1) {
                  let common = hits[0].name;
                  for (let k = 1; k < hits.length; k++) {
                    let j = 0;
                    while (j < common.length && j < hits[k].name.length && common[j].toLowerCase() === hits[k].name[j].toLowerCase()) j++;
                    common = common.slice(0, j);
                  }
                  if (common.length > partial.length) {
                    insertStr(common.slice(partial.length));
                    continue;
                  }
                }
              }
              const model = require_model();
              const added = model.complete(inputBuf);
              if (added) insertStr(added);
            } catch (_) {
            }
            continue;
          }
          if (code === 127 || code === 8) {
            i++;
            backspace();
            continue;
          }
          if (code < 32) {
            const hk = HOTKEY_DEFS[hotkey];
            if (hk && hk.type === "byte" && code === hk.value) {
              const n = killAllTasks();
              scrollOutput(C.brightYellow + "\u2328 " + hotkey.toUpperCase() + C.reset + (n > 0 ? "  " + C.green + "\u4E2D\u65AD " + n + " \u4E2A\u4EFB\u52A1" + C.reset : "  " + C.gray + "\u65E0\u8FD0\u884C\u4E2D\u7684\u4EFB\u52A1" + C.reset));
              i++;
              continue;
            }
            i++;
            if (code === 3) {
              if (inputBuf.length > 0) {
                inputBuf = "";
                cursorPos = 0;
                scrollOutput(C.gray + "^C  \u5DF2\u6E05\u7A7A\u8F93\u5165\uFF0C\u4E0B\u8F7D\u7EE7\u7EED" + C.reset);
              } else {
                scrollOutput(C.gray + "^C  (" + hotkey.toUpperCase() + " \u4E2D\u65AD\u4EFB\u52A1)" + C.reset);
              }
            } else if (code === 4) {
              if (inputBuf.length === 0) scrollOutput(C.gray + "^D" + C.reset);
              else deleteChar();
            } else if (code === 21) {
              inputBuf = "";
              cursorPos = 0;
            } else if (code === 23) {
              const b = inputBuf.slice(0, cursorPos);
              const a = inputBuf.slice(cursorPos);
              const t = b.replace(/\S+\s*$/, "");
              inputBuf = t + a;
              cursorPos = t.length;
            } else if (code === 1) cursorPos = 0;
            else if (code === 5) cursorPos = inputBuf.length;
            else if (code === 11) inputBuf = inputBuf.slice(0, cursorPos);
            else if (code === 12) {
              process.stdout.write("\x1B[2J");
              setupScrollRegion();
            }
            continue;
          }
          const cp = str.codePointAt(i);
          const len = cp > 65535 ? 2 : 1;
          insertStr(str.slice(i, i + len));
          i += len;
        }
        drawBottom();
      };
      process.stdin.on("data", stdinHandler);
    }
    function run() {
      return new Promise(function(resolve) {
        origLog = console.log;
        origErr = console.error;
        origWarn = console.warn;
        global.__ipm_shell = true;
        function wrap() {
          const text = Array.from(arguments).map(function(a) {
            return typeof a === "string" ? a : String(a);
          }).join(" ");
          scrollOutput(text);
        }
        console.log = wrap;
        console.error = wrap;
        console.warn = wrap;
        const _ver = versionLib.getPkgVersion();
        scrollOutput("");
        scrollOutput(
          C.brightCyan + "  \u258D " + C.reset + C.bold + C.brightWhite + "InfinityPackageManager" + C.reset + "  " + C.brightGreen + "v" + _ver + C.reset
        );
        scrollOutput(
          C.brightCyan + "  \u258D " + C.reset + C.brightYellow + i18n.current() + C.reset + C.dim + "  \xB7  " + C.reset + C.brightBlue + "help" + C.reset + C.dim + " \u67E5\u770B\u5E2E\u52A9" + C.reset
        );
        scrollOutput("");
        const hk = getHotkey().toUpperCase();
        scrollOutput(C.dim + "  " + C.brightYellow + "Ctrl+C" + C.reset + C.dim + " \u6E05\u7A7A\u8F93\u5165 \xB7 " + C.reset + C.brightYellow + hk + C.reset + C.dim + " \u4E2D\u65AD\u4EFB\u52A1 \xB7 " + C.reset + C.brightYellow + "Tab" + C.reset + C.dim + " \u8865\u5168" + C.reset);
        scrollOutput("");
        setupScrollRegion();
        attachInput();
        drawBottom();
        let lastTaskCount = 0;
        tickTimer = setInterval(function() {
          if (exiting2) return;
          const n = tasks.count();
          if (n > 0) {
            drawBottom();
          } else if (lastTaskCount > 0) {
            drawBottom();
          }
          lastTaskCount = n;
        }, 300);
        process.stdout.on("resize", function() {
          setupScrollRegion();
          drawBottom();
        });
        global.__ipm_addHistory = function(cmd) {
          if (!cmd) return;
          const s = String(cmd).trim();
          if (!s) return;
          history.push(s);
          if (history.length > MAX_HISTORY) history.shift();
          historyIdx = -1;
        };
        global.__ipm_cleanup = function() {
          if (tickTimer) clearInterval(tickTimer);
          if (stdinHandler) {
            try {
              process.stdin.removeListener("data", stdinHandler);
            } catch (_) {
            }
            stdinHandler = null;
          }
          try {
            process.stdin.setRawMode(false);
          } catch (_) {
          }
          try {
            process.stdin.pause();
          } catch (_) {
          }
          try {
            const H = process.stdout.rows || 24;
            process.stdout.write("\x1B[r");
            process.stdout.write("\x1B[" + (H - 1) + ";1H");
            process.stdout.write("\x1B[J");
            process.stdout.write("\x1B[?25h\x1B[0m");
          } catch (_) {
          }
          console.log = origLog;
          console.error = origErr;
          console.warn = origWarn;
          global.__ipm_shell = false;
          resolve();
        };
      });
    }
    module2.exports = { run };
  }
});

// bin/ipm.js
var path = require("path");
var proc = require_process();
proc.register();
["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK", "SIGQUIT"].forEach(function(s) {
  try {
    process.on(s, function() {
    });
  } catch (_) {
  }
});
var exiting = false;
global.__ipm_exitNow = function(c) {
  if (exiting) return;
  exiting = true;
  try {
    proc.unregister();
  } catch (_) {
  }
  process.exit(typeof c === "number" ? c : 0);
};
process.on("exit", function() {
  try {
    proc.unregister();
  } catch (_) {
  }
});
function parseArgs() {
  const isNodeExe = /(^|[\\/])node(\.exe)?$/i.test(process.execPath);
  if (isNodeExe) return process.argv.slice(2);
  let args2 = process.argv.slice(1);
  const execBase = path.basename(process.execPath).toLowerCase();
  while (args2.length > 0) {
    const a = String(args2[0]);
    if (!a) break;
    const base = path.basename(a).toLowerCase();
    if (base === execBase) {
      args2.shift();
      continue;
    }
    break;
  }
  return args2;
}
var args = parseArgs();
if (process.env.IPM_DEBUG) {
  console.error("[ipm-debug] execPath=" + process.execPath);
  console.error("[ipm-debug] argv=" + JSON.stringify(process.argv));
  console.error("[ipm-debug] args=" + JSON.stringify(args));
}
/*
 * Infinity.Inc - one build, several executables.
 *
 * The shipped names are
 *   ipm_cli  ipm_tui  ipm_gui  ipm_launcher      (user)
 *   ipmx_cli ipmx_tui ipmx_gui ipmx_launcher     (administrator)
 * and the name the program was started under decides what it does. That is
 * why the binaries are identical and only the file name carries meaning.
 */
var MODE_PREFIX = { ipm: false, ipmx: true };
var MODE_LIST = ["cli", "tui", "gui", "launcher"];
function detectMode() {
  const base = path.basename(process.execPath).replace(/\.exe$/i, "").toLowerCase();
  const i = base.indexOf("_");
  if (i < 0) return { mode: null, admin: false, prefix: null };
  const pre = base.slice(0, i);
  const mode = base.slice(i + 1);
  if (!Object.prototype.hasOwnProperty.call(MODE_PREFIX, pre)) return { mode: null, admin: false, prefix: null };
  if (MODE_LIST.indexOf(mode) < 0) return { mode: null, admin: false, prefix: null };
  return { mode, admin: MODE_PREFIX[pre], prefix: pre };
}
function openBrowser(url) {
  try {
    const cp = require("child_process");
    if (process.platform === "win32") cp.execFile("cmd", ["/c", "start", "", url], { windowsHide: true });
    else if (process.platform === "darwin") cp.execFile("open", [url]);
    else cp.execFile("xdg-open", [url]);
  } catch (_) {
  }
}
function runLauncher() {
  const readline = require("readline");
  const cp = require("child_process");
  const dir = path.dirname(process.execPath);
  const base = path.basename(process.execPath).replace(/\.exe$/i, "");
  const cut = base.indexOf("_");
  const pre = cut < 0 ? "ipm" : base.slice(0, cut);
  const ext = process.platform === "win32" ? ".exe" : "";
  const items = [
    { k: "1", label: "CLI       - \u547D\u4EE4\u884C", file: pre + "_cli" + ext },
    { k: "2", label: "TUI       - \u7EC8\u7AEF\u754C\u9762", file: pre + "_tui" + ext },
    { k: "3", label: "GUI       - \u56FE\u5F62\u754C\u9762", file: pre + "_gui" + ext }
  ];
  process.stdout.write("InfinityPackageManager [" + (pre.indexOf("x") >= 0 ? "\u7BA1\u7406\u5458" : "\u7528\u6237") + "]\n\n");
  for (const it of items) process.stdout.write("  " + it.k + ") " + it.label + "\n");
  process.stdout.write("\n  q) \u9000\u51FA\n\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(function (resolve) {
    rl.question("> ", function (ans) {
      rl.close();
      const a = String(ans || "").trim().toLowerCase();
      if (a === "q" || a === "") { resolve(); return; }
      const it = items.find(function (x) { return x.k === a; });
      if (!it) { resolve(); return; }
      const target = path.join(dir, it.file);
      if (!fs.existsSync(target)) {
        process.stdout.write("\u7F3A\u5C11\u7A0B\u5E8F: " + target + "\n");
        resolve();
        return;
      }
      try {
        cp.spawn(target, [], { detached: true, stdio: "inherit" }).unref();
      } catch (e) {
        process.stdout.write(String(e && e.message ? e.message : e) + "\n");
      }
      resolve();
    });
  });
}
var fs = require("fs");
async function main() {
  /* --serve-ui is what the Electron shell asks for: the interface server and
   * nothing else, whatever the executable is called. */
  if (args.length && String(args[0]).toLowerCase() === "--serve-ui") {
    const web = require_web();
    const s = await web.start({});
    if (!s || !s.ok) {
      console.error("cannot start the UI: " + ((s && (s.error || s.message)) || "unknown"));
      global.__ipm_exitNow(1);
      return;
    }
    console.log("InfinityPackageManager UI  http://localhost:" + s.port + "/");
    return;
  }
  const M = detectMode();
  if (M.admin) process.env.IPM_ADMIN = "1";
  if (M.mode === "launcher") {
    await runLauncher();
    global.__ipm_exitNow(0);
    return;
  }
  if (M.mode === "gui") {
    const web = require_web();
    const s = await web.start({});
    if (!s || !s.ok) {
      console.error("cannot start the local UI: " + ((s && (s.error || s.message)) || "unknown"));
      global.__ipm_exitNow(1);
      return;
    }
    const url = "http://localhost:" + s.port + "/";
    console.log("InfinityPackageManager UI  " + url);
    openBrowser(url);
    return;
  }
  if (M.mode === "tui") {
    await require_shell().run();
    global.__ipm_exitNow(0);
    return;
  }
  if (M.mode === "cli") {
    await require_cli().dispatch(args);
    if (global.__ipm_keepAlive) return;
    global.__ipm_exitNow(0);
    return;
  }
  if (args.length === 0) {
    await require_shell().run();
    global.__ipm_exitNow(0);
    return;
  }
  await require_cli().dispatch(args);
  if (global.__ipm_keepAlive) return;
  global.__ipm_exitNow(0);
}
main().catch(function(e) {
  const RED = "\x1B[31m";
  const RST = "\x1B[0m";
  const msg = e && e.message ? e.message : String(e);
  console.error(RED + "x" + RST + " " + msg);
  if (global.__ipm_keepAlive) return;
  global.__ipm_exitNow(1);
});
