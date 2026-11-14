import fs from "node:fs";
const ui = "work/webview2/ui/";
const shell = fs.readFileSync(ui + "assets/js/shell.js", "utf8");
const html = fs.readFileSync(ui + "index.html", "utf8");
const i18n = fs.readFileSync(ui + "assets/js/i18n.js", "utf8");
function section(name) {
  const start = i18n.indexOf('"' + name + '"');
  if (start < 0) { throw new Error("no section " + name); }
  const brace = i18n.indexOf("{", start);
  let depth = 0, end = brace;
  for (let i = brace; i < i18n.length; i++) {
    if (i18n[i] === "{") { depth++; }
    else if (i18n[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  return i18n.slice(brace, end + 1);
}
const used = new Set();
for (const m of shell.matchAll(/\bt\(\s*["']([^"']+)["']/g)) { used.add(m[1]); }
for (const m of html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) { used.add(m[1]); }
/* prefixes built by concatenation, e.g. t("ext." + kind) */
const prefixes = [];
for (const m of shell.matchAll(/t\(\s*["']([^"']*\.)["']\s*\+/g)) { prefixes.push(m[1]); }
const out = [];
for (const lang of ["zh-CN", "en-US"]) {
  const body = section(lang);
  const keys = [...body.matchAll(/"([A-Za-z][A-Za-z0-9_.]*)"\s*:/g)].map((m) => m[1]);
  const dead = keys.filter((k) => {
    if (used.has(k)) { return false; }
    for (const p of prefixes) { if (k.startsWith(p)) { return false; } }
    return true;
  });
  out.push(lang + " keys=" + keys.length + " unused=" + dead.length + " " + dead.join(","));
}
console.log("used=" + used.size + " prefixes=" + prefixes.join("|"));
console.log(out.join("\n"));
