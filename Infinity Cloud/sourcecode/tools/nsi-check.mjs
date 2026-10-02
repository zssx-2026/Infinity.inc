/* Compile the installer and print whatever makensis says. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const N = String.fromCharCode(10);
const NSI = 'D:/dev/DeepSeekHarnessWorkspace/Infinity.inc/Infinity Cloud/installer.nsi';
const OUT = 'D:/temp/nsi-check.exe';
try { fs.rmSync(OUT, { force: true }); } catch (e) { }
let out = "", err = "", code = 0;
try {
  out = String(execFileSync('C:/Program Files (x86)/NSIS/makensis.exe', ['/V4', '/O' + OUT, NSI], { encoding: 'utf8', maxBuffer: 33554432 }));
} catch (e) {
  code = e.status === undefined ? -1 : e.status;
  out = String(e.stdout || "");
  err = String(e.stderr || "");
}
process.stdout.write("exit=" + code + N);
process.stdout.write("exe: " + (fs.existsSync(OUT) ? fs.statSync(OUT).size + " B" : "not produced") + N);
for (const l of out.split(/\r?\n/)) if (l.trim()) process.stdout.write("OUT " + l.slice(0, 170) + N);
for (const l of err.split(/\r?\n/)) if (l.trim()) process.stdout.write("ERR " + l.slice(0, 170) + N);
