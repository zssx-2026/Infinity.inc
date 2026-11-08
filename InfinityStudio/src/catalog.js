/*
 * catalog.js - the workloads, and what each one actually installs.
 *
 * A Visual Studio installer is a list of workloads you tick. The interesting
 * part is never the list itself - it is that ticking one box has to name the
 * exact files it wants, know what they weigh, and be able to prove afterwards
 * that every one of them arrived. So a workload here is a list of artefacts,
 * and the whole installer is arithmetic over that list.
 *
 * Every artefact is a fact about this workspace: a real path, a real size,
 * measured at scan time. Nothing is assumed to exist because a manifest says
 * it should.
 */

import path from 'node:path';

export const PRODUCTS = [
  { id: 'inc', name: 'Infinity Cloud',             tagline: '云端存储与同步',       port: 7621, required: true },
  { id: 'ipm', name: 'Infinity Package Manager',   tagline: '跨平台软件包管理',     port: 7632, required: false },
  { id: 'int', name: 'Infinity Toolbox',           tagline: '系统工具箱',           port: 7653, required: false },
  { id: 'isv', name: 'Infinity Server',            tagline: '机架级计算控制台',     port: 7711, required: false, standalone: true }
];

/*
 * The workloads. A workload groups artefacts across products - "桌面全套"
 * is the obvious one, "开发者" adds the command line faces. The same artefact
 * appears in more than one workload; the planner de-duplicates by path, so
 * ticking two boxes that want the same file installs it once.
 */
export const WORKLOADS = [
  {
    id: 'core',
    name: '核心运行时',
    desc: 'Infinity Cloud 的窗口与命令行面：其余工作负载都建立在它之上。',
    recommended: true,
    parts: [{ product: 'inc', faces: ['gui', 'cli'] }]
  },
  {
    id: 'desktop',
    name: '桌面全套',
    desc: '把其余产品的窗口面一次装齐，适合日常使用。',
    recommended: true,
    parts: PRODUCTS.filter((p) => !p.standalone).map((p) => ({ product: p.id, faces: ['gui'] }))
  },
  {
    id: 'developer',
    name: '开发者',
    desc: '命令行与终端界面，含管理员面（inx/ipmx/intx）。',
    recommended: false,
    parts: [
      { product: 'inc', faces: ['cli', 'tui'] },
      { product: 'ipm', faces: ['cli', 'tui'] },
      { product: 'int', faces: ['cli'] }
    ]
  },
  {
    id: 'server',
    name: 'Server 客户端',
    desc: '不安装服务器本体，只在 Studio 里连接到已在运行的 Infinity Server。',
    recommended: false,
    client: true,
    parts: []
  },
  {
    id: 'minimal',
    name: '最小安装',
    desc: '只有 Infinity Cloud 窗口面，占用最低。',
    recommended: false,
    parts: [{ product: 'inc', faces: ['gui'] }]
  }
];

/* Where each product's built artefacts live, per platform. Command line faces
 * come from the multi-file layout (a 49 KiB launcher plus one shared runtime);
 * window faces come from the Electron shells. Both are optional: a product
 * with neither is reported as unavailable rather than silently skipped. */
export function sourceLayout(product, target) {
  const archDir = { 'win-x64': 'win-x64', 'win-ia32': 'win-ia32', 'win-arm64': 'win-arm64' }[target] || 'win-x64';
  if (product === 'inc') {
    return {
      layout: path.join('Infinity Cloud', 'sourcecode', 'build', 'layout', archDir),
      shell: path.join('shell', 'build', 'inc_gui-win32-' + shortArch(target)),
      cpp: path.join('cpp', 'out', 'inc'),
      guiName: 'inc_gui'
    };
  }
  if (product === 'ipm') {
    return {
      layout: path.join('InfinityPackageManager', 'build', 'layout', archDir),
      shell: path.join('shell', 'build', 'ipm_gui-win32-' + shortArch(target)),
      cpp: path.join('cpp', 'out', 'ipm'),
      guiName: 'ipm_gui'
    };
  }
  if (product === 'isv') return { shell: path.join('InfinityServer', 'build', archDir), cpp: undefined, guiName: 'infinityserver_gui' };
  if (product === 'int') return { cpp: path.join('cpp', 'out', 'int'), guiName: 'int_gui' };
  return {};
}

export function shortArch(target) {
  return { 'win-x64': 'x64', 'win-ia32': 'ia32', 'win-arm64': 'arm64' }[target] || 'x64';
}

/* The command line face names a product exposes. Admin faces are the 'x'
 * variants; 'launcher' is the picker that forwards to the others.
 *
 * The Infinity Server is a product of its own; what Studio ships from it is the
 * client, which is an Electron shell pointing at whatever server the user names. */
export const FACES = {
  inc: ['cli', 'tui', 'gui', 'launcher'],
  ipm: ['cli', 'tui', 'gui', 'launcher'],
  isv: ['gui'],
  int: ['cli', 'gui']
};

export const ADMIN_PREFIX = { inc: 'inx', ipm: 'ipmx', int: 'intx' };

export function faceNames(product, face) {
  const base = product + '_' + face;
  const admin = ADMIN_PREFIX[product] + '_' + face;
  return [base, admin];
}

/* Everything a workload needs, expanded into concrete named executables.
 * Duplicates are removed here so the byte total is honest. */
export function expand(workloadIds, target) {
  const wanted = WORKLOADS.filter((w) => workloadIds.includes(w.id));
  const seen = new Map();
  for (const w of wanted) {
    for (const part of w.parts) {
      for (const face of part.faces) {
        for (const name of faceNames(part.product, face)) {
          const key = part.product + '/' + name;
          if (!seen.has(key)) {
            seen.set(key, { product: part.product, name: name, face: face, exe: name + '.exe' });
          }
        }
      }
    }
  }
  return Array.from(seen.values());
}
