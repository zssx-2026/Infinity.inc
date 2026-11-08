/*
 * suite.js - the component tree the studio installs from.
 *
 * The installer is a tree, not a list. Eight branches, each owning the
 * components that belong to it, and every component naming three things the
 * rest of the studio reads back: the host it leans on (rea), the project
 * formats it writes (codecs, each with the release that introduced it) and
 * the parts it is built from (parts, each a from/to path pair).
 *
 * All of it is data. Nothing here touches the disk or the network: the
 * catalogue is a fact about this release, so it is a constant, and probing
 * what is actually installed on the machine is hosts.js's job.
 *
 * Paths carry no backslashes. A "from" is relative to the workspace root and
 * a "to" is relative to the install directory; the consumer joins them with
 * path.join, which settles the separator per platform.
 *
 * The catalogue is frozen. Callers that need to annotate it - an install
 * badge, a tick state - spread the record first:
 *
 *   const view = { ...component, installed: true };
 */

export const SUITE_VERSION = '1.0.0-pre5';

/* The workspace container the studio saves and loads. Declared here because
 * every component's formats sit alongside it, and the association planner
 * needs one place to read it from. */
export const WORKSPACE_EXT = '.is-ws';

/*
 * Every component, flat. Field by field:
 *
 *   id       stable dotted id; the install endpoints take these
 *   name     display name
 *   branch   one of the eight branch ids below
 *   version  the release that ships this component
 *   summary  one line the tree shows under the name
 *   rea      the host it needs from the machine (see hosts.js), or null
 *   codecs   the project formats it owns: {ext, since}
 *   parts    what a tick actually installs: {from, to, optional}
 *
 * A codec's "since" is a version floor: a build older than that floor cannot
 * open the format. "optional" marks a part that may legitimately be absent
 * (a product that has not been built yet); a missing optional part is not a
 * blocking failure, a missing required part is.
 *
 * The frozen shape is what the server, the page and the file-association
 * planner all read, so the field list here is a contract: adding a field is
 * fine, renaming one is not.
 */
export const COMPONENTS = [
  /* ---- studio ------------------------------------------------------- */
  {
    id: 'studio.shell',
    name: 'Studio 工作台',
    branch: 'studio',
    version: '1.0.0-pre5',
    summary: '窗口、命令面板、视图布局与扩展宿主。整套 Studio 的地基。',
    rea: null,
    codecs: [{ ext: '.isui', since: '1.0.0-pre3' }],
    parts: [
      { from: 'shell/main.js', to: 'Studio/shell/main.js' },
      { from: 'shell/preload.js', to: 'Studio/shell/preload.js' },
      { from: 'shell/build/inc_gui-win32-x64', to: 'Studio/shell/bin' },
      { from: 'InfinityStudio/src/main.js', to: 'Studio/app/main.js' }
    ]
  },
  {
    id: 'studio.editor',
    name: '代码编辑器',
    branch: 'studio',
    version: '1.0.0-pre5',
    summary: '多光标文本编辑、语法高亮、折叠与差异视图。自身不定义格式，编辑各 Craft 的工程文件。',
    rea: null,
    codecs: [],
    parts: [
      { from: 'InfinityStudio/src/page.js', to: 'Studio/app/page.js' },
      { from: 'InfinityStudio/src/i18n.js', to: 'Studio/app/i18n.js' }
    ]
  },
  {
    id: 'studio.terminal',
    name: '集成终端',
    branch: 'studio',
    version: '1.0.0-pre5',
    summary: '伪终端、Shell 配置与任务运行器，命令在 Studio 内就地跑完。',
    rea: null,
    codecs: [],
    parts: [
      { from: 'InfinityStudio/src/server.js', to: 'Studio/app/server.js' },
      { from: 'InfinityStudio/src/cli.js', to: 'Studio/app/cli.js' }
    ]
  },
  {
    id: 'studio.languages',
    name: '语言包',
    branch: 'studio',
    version: '1.0.0-pre5',
    summary: '界面语言资源，随包提供 51 个语言与地区选项，其中 12 个为完整译文。',
    rea: null,
    codecs: [{ ext: '.is-lap', since: '1.0.0-pre2' }],
    parts: [
      { from: 'InfinityStudio/src/i18n.js', to: 'Studio/lang/i18n.js' },
      { from: 'dist/lang', to: 'Studio/lang/packs', optional: true }
    ]
  },
  {
    id: 'studio.themes',
    name: '主题包',
    branch: 'studio',
    version: '1.0.0-pre5',
    summary: '配色令牌、图标主题与编辑器主题，深色为默认。',
    rea: null,
    codecs: [{ ext: '.is-thp', since: '1.0.0-pre2' }],
    parts: [
      { from: 'icons/src', to: 'Studio/assets/icons', optional: true },
      { from: 'icons/inc.ico', to: 'Studio/assets/inc.ico' }
    ]
  },

  /* ---- craft -------------------------------------------------------- */
  {
    id: 'craft.code',
    name: 'CodeCraft',
    branch: 'craft',
    version: '1.0.0-pre5',
    summary: '代码工程宿主：调试器、静态检查、格式化与测试运行器。可与本机 VS Code 双向打开。',
    rea: 'vscode',
    codecs: [{ ext: '.is-ccp', since: '0.42.31' }, { ext: '.is-ccpx', since: '0.42.31' }],
    parts: [
      { from: 'craft/code/build/win-x64/CodeCraft.exe', to: 'Craft/CodeCraft/CodeCraft.exe', optional: true },
      { from: 'craft/code/build/win-x64/resources', to: 'Craft/CodeCraft/resources', optional: true }
    ]
  },
  {
    id: 'craft.video',
    name: 'VideoCraft',
    branch: 'craft',
    version: '1.0.0-pre5',
    summary: '时间线剪辑、转码、字幕与渲染。预览与解码交给本机 VLC，不自带解码器。',
    rea: 'vlc',
    codecs: [{ ext: '.is-vcp', since: '0.30.124' }, { ext: '.is-vcpx', since: '0.30.124' }],
    parts: [
      { from: 'craft/video/build/win-x64/VideoCraft.exe', to: 'Craft/VideoCraft/VideoCraft.exe', optional: true },
      { from: 'craft/video/build/win-x64/resources', to: 'Craft/VideoCraft/resources', optional: true }
    ]
  },
  {
    id: 'craft.picture',
    name: 'PictureCraft',
    branch: 'craft',
    version: '1.0.0-pre4',
    summary: '位图编辑：图层、蒙版、滤镜与批量导出。纯本地渲染，无外部宿主。',
    rea: null,
    codecs: [{ ext: '.is-picp', since: '0.29.2' }, { ext: '.is-picpx', since: '0.29.2' }],
    parts: [
      { from: 'craft/picture/build/win-x64/PictureCraft.exe', to: 'Craft/PictureCraft/PictureCraft.exe', optional: true },
      { from: 'craft/picture/build/win-x64/resources', to: 'Craft/PictureCraft/resources', optional: true }
    ]
  },
  {
    id: 'craft.3d',
    name: '3DCraft',
    branch: 'craft',
    version: '1.0.0-pre5',
    summary: '场景搭建、材质、骨骼与烘焙。重计算交给本机 Blender 批处理。',
    rea: 'blender',
    codecs: [{ ext: '.is-3dcp', since: '0.30.0' }, { ext: '.is-3dcpx', since: '0.30.0' }],
    parts: [
      { from: 'craft/3d/build/win-x64/3DCraft.exe', to: 'Craft/3DCraft/3DCraft.exe', optional: true },
      { from: 'craft/3d/build/win-x64/resources', to: 'Craft/3DCraft/resources', optional: true },
      { from: 'craft/3d/bridge/blender', to: 'Craft/3DCraft/bridge/blender', optional: true }
    ]
  },
  {
    id: 'craft.paint',
    name: 'PaintCraft',
    branch: 'craft',
    version: '1.0.0-pre4',
    summary: '绘画与笔刷：压感、调色板、画布与无限撤销。',
    rea: null,
    codecs: [{ ext: '.is-pcp', since: '0.23.95' }, { ext: '.is-pcpx', since: '0.23.95' }],
    parts: [
      { from: 'craft/paint/build/win-x64/PaintCraft.exe', to: 'Craft/PaintCraft/PaintCraft.exe', optional: true },
      { from: 'craft/paint/build/win-x64/resources', to: 'Craft/PaintCraft/resources', optional: true }
    ]
  },
  {
    id: 'craft.animation',
    name: 'AnimationCraft',
    branch: 'craft',
    version: '1.0.0-pre5',
    summary: '关键帧、曲线、绑定与预览。渲染与绑定求解复用本机 Blender。',
    rea: 'blender',
    codecs: [{ ext: '.is-acp', since: '0.19.413' }, { ext: '.is-acpx', since: '0.19.413' }],
    parts: [
      { from: 'craft/animation/build/win-x64/AnimationCraft.exe', to: 'Craft/AnimationCraft/AnimationCraft.exe', optional: true },
      { from: 'craft/animation/build/win-x64/resources', to: 'Craft/AnimationCraft/resources', optional: true }
    ]
  },
  {
    id: 'craft.game',
    name: 'GameCraft',
    branch: 'craft',
    version: '1.0.0-pre5',
    summary: '2D/3D 场景、物理与构建。本机装 Godot 时可直接运行，另可导出 Unity 与 Unreal 工程。',
    rea: 'godot',
    codecs: [{ ext: '.is-gcp', since: '0.25.4' }, { ext: '.is-gcpx', since: '0.25.4' }],
    parts: [
      { from: 'craft/game/build/win-x64/GameCraft.exe', to: 'Craft/GameCraft/GameCraft.exe', optional: true },
      { from: 'craft/game/build/win-x64/resources', to: 'Craft/GameCraft/resources', optional: true },
      { from: 'craft/game/exporters', to: 'Craft/GameCraft/exporters', optional: true }
    ]
  },
  {
    id: 'craft.audio',
    name: 'AudioCraft',
    branch: 'craft',
    version: '1.0.0-pre4',
    summary: '波形编辑、混音、效果链与导出。精细处理可交给本机 Audacity。',
    rea: 'audacity',
    codecs: [{ ext: '.is-aucp', since: '0.21.193' }, { ext: '.is-aucpx', since: '0.21.193' }],
    parts: [
      { from: 'craft/audio/build/win-x64/AudioCraft.exe', to: 'Craft/AudioCraft/AudioCraft.exe', optional: true },
      { from: 'craft/audio/build/win-x64/resources', to: 'Craft/AudioCraft/resources', optional: true }
    ]
  },
  {
    id: 'craft.ai',
    name: 'AICraft',
    branch: 'craft',
    version: '1.0.0-pre5',
    summary: '提示词工程、本地模型注册表、推理流水线与评测。默认连本机 Ollama，不外发数据。',
    rea: 'ollama',
    codecs: [{ ext: '.is-aicp', since: '0.32.277' }, { ext: '.is-aicpx', since: '0.32.277' }],
    parts: [
      { from: 'craft/ai/build/win-x64/AICraft.exe', to: 'Craft/AICraft/AICraft.exe', optional: true },
      { from: 'craft/ai/build/win-x64/resources', to: 'Craft/AICraft/resources', optional: true }
    ]
  },

  /* ---- webviewer ---------------------------------------------------- */
  {
    id: 'webviewer.core',
    name: 'WebViewer 核心',
    branch: 'webviewer',
    version: '1.0.0-pre4',
    summary: '内嵌浏览器内核、会话、配置目录与缓存。其余四项都建立在它之上。',
    rea: null,
    codecs: [{ ext: '.iswv', since: '1.0.0-pre4' }],
    parts: [
      { from: 'InfinityStudio/src/server.js', to: 'WebViewer/core/server.js' },
      { from: 'InfinityStudio/src/page.js', to: 'WebViewer/core/page.js' },
      { from: 'web/infinity', to: 'WebViewer/core/web', optional: true }
    ]
  },
  {
    id: 'webviewer.devtools',
    name: '开发者工具',
    branch: 'webviewer',
    version: '1.0.0-pre5',
    summary: '元素检查、网络面板、控制台与性能剖析。',
    rea: null,
    codecs: [],
    parts: [
      { from: 'webviewer/devtools', to: 'WebViewer/devtools', optional: true }
    ]
  },
  {
    id: 'webviewer.preview',
    name: '实时预览',
    branch: 'webviewer',
    version: '1.0.0-pre5',
    summary: '热重载、设备尺寸框与一键截图，改完即见。',
    rea: null,
    codecs: [],
    parts: [
      { from: 'webviewer/preview', to: 'WebViewer/preview', optional: true }
    ]
  },
  {
    id: 'webviewer.capture',
    name: '抓取与导出',
    branch: 'webviewer',
    version: '1.0.0-pre5',
    summary: '把一次会话的网络、DOM 与脚本原样归档，离线可复查。',
    rea: null,
    codecs: [{ ext: '.iswvc', since: '1.0.0-pre5' }],
    parts: [
      { from: 'webviewer/capture', to: 'WebViewer/capture', optional: true }
    ]
  },
  {
    id: 'webviewer.compat',
    name: '兼容检测',
    branch: 'webviewer',
    version: '1.0.0-pre5',
    summary: '内核能力矩阵、特性探测与一份可读的兼容报告。',
    rea: null,
    codecs: [],
    parts: [
      { from: 'webviewer/compat', to: 'WebViewer/compat', optional: true }
    ]
  },

  /* ---- office ------------------------------------------------------- */
  {
    id: 'office.writer',
    name: '文字',
    branch: 'office',
    version: '1.0.0-pre5',
    summary: '分页排版、样式、表格与 PDF 导出。',
    rea: null,
    codecs: [{ ext: '.isodt', since: '1.0.0-pre5' }],
    parts: [
      { from: 'office/writer/build/win-x64', to: 'Office/Writer', optional: true }
    ]
  },
  {
    id: 'office.sheet',
    name: '表格',
    branch: 'office',
    version: '1.0.0-pre5',
    summary: '单元格、公式求值、图表与数据透视。',
    rea: null,
    codecs: [{ ext: '.isods', since: '1.0.0-pre5' }],
    parts: [
      { from: 'office/sheet/build/win-x64', to: 'Office/Sheet', optional: true }
    ]
  },
  {
    id: 'office.slide',
    name: '演示',
    branch: 'office',
    version: '1.0.0-pre5',
    summary: '幻灯片、切换动画、备注与演讲者视图。',
    rea: null,
    codecs: [{ ext: '.isodp', since: '1.0.0-pre5' }],
    parts: [
      { from: 'office/slide/build/win-x64', to: 'Office/Slide', optional: true }
    ]
  },
  {
    id: 'office.pdf',
    name: 'PDF',
    branch: 'office',
    version: '1.0.0-pre4',
    summary: '渲染、批注、签名与合并。只读打开不落盘，批注另存为独立文件。',
    rea: null,
    codecs: [{ ext: '.isodf', since: '1.0.0-pre4' }],
    parts: [
      { from: 'office/pdf/build/win-x64', to: 'Office/PDF', optional: true }
    ]
  },

  /* ---- cloud (deferred) --------------------------------------------- */
  {
    id: 'cloud.desktop',
    name: 'Infinity Cloud 桌面',
    branch: 'cloud',
    version: '0.9.0-pre1',
    summary: '云盘客户端外壳：窗口、托盘与自更新。本版暂缓交付。',
    rea: null,
    codecs: [{ ext: '.iscl', since: '0.9.0-pre1' }],
    parts: [
      { from: 'Infinity Cloud/sourcecode/build/layout/win-x64', to: 'Cloud/bin', optional: true }
    ]
  },
  {
    id: 'cloud.sync',
    name: '同步引擎',
    branch: 'cloud',
    version: '0.9.0-pre1',
    summary: '增量同步、冲突留痕与断点续传。本版暂缓交付。',
    rea: null,
    codecs: [{ ext: '.isync', since: '0.9.0-pre1' }],
    parts: [
      { from: 'Infinity Cloud/sourcecode/bin', to: 'Cloud/bin/sync', optional: true }
    ]
  },
  {
    id: 'cloud.drive',
    name: '云盘挂载',
    branch: 'cloud',
    version: '0.9.0-pre1',
    summary: '把云端目录挂成本地盘符，配额与离线缓存可查。本版暂缓交付。',
    rea: null,
    codecs: [],
    parts: [
      { from: 'Infinity Cloud/sourcecode/program', to: 'Cloud/program', optional: true }
    ]
  },
  {
    id: 'cloud.share',
    name: '分享与协作',
    branch: 'cloud',
    version: '0.9.0-pre1',
    summary: '分享链接、权限与在线状态。本版暂缓交付。',
    rea: null,
    codecs: [{ ext: '.islink', since: '0.9.0-pre1' }],
    parts: [
      { from: 'Infinity Cloud/sourcecode/assets', to: 'Cloud/assets', optional: true }
    ]
  },

  /* ---- packages ----------------------------------------------------- */
  {
    id: 'packages.manager',
    name: 'Infinity Package Manager',
    branch: 'packages',
    version: '1.0.0-pre5',
    summary: '依赖求解、安装、逐文件校验与锁文件。包源索引与运行时宿主挂在它下面。',
    rea: null,
    codecs: [{ ext: '.ispkg', since: '1.0.0-pre5' }],
    parts: [
      { from: 'dist/ipm.exe', to: 'PackageManager/ipm.exe' },
      { from: 'dist/bundle.js', to: 'PackageManager/bundle.js' },
      { from: 'dist/pak.json', to: 'PackageManager/pak.json' }
    ]
  },
  {
    id: 'packages.registry',
    name: '包源与索引',
    branch: 'packages',
    version: '1.0.0-pre4',
    summary: '镜像源、签名校验与包搜索。',
    rea: null,
    codecs: [{ ext: '.isreg', since: '1.0.0-pre4' }],
    parts: [
      { from: 'dist/registry.json', to: 'PackageManager/registry.json' },
      { from: 'dist/applist.json', to: 'PackageManager/applist.json', optional: true }
    ]
  },
  {
    id: 'packages.runtime',
    name: '运行时宿主',
    branch: 'packages',
    version: '1.0.0-pre5',
    summary: '沙箱、命令垫片与环境注入，让装好的包能被直接调用。',
    rea: 'node',
    codecs: [{ ext: '.isrt', since: '1.0.0-pre5' }],
    parts: [
      { from: 'dist/aria2c.exe', to: 'PackageManager/aria2c.exe', optional: true },
      { from: 'dist/update.js', to: 'PackageManager/update.js' }
    ]
  },

  /* ---- integrations ------------------------------------------------- */
  {
    id: 'integrations.copilot',
    name: 'GitHub Copilot',
    branch: 'integrations',
    version: '1.0.0-pre5',
    summary: '补全与对话接入。授权走 VS Code 扩展宿主，Studio 不保存任何令牌。',
    rea: 'vscode',
    codecs: [],
    parts: [
      { from: 'integrations/copilot', to: 'Integrations/Copilot', optional: true }
    ]
  },
  {
    id: 'integrations.cloudflare',
    name: 'Cloudflare',
    branch: 'integrations',
    version: '1.0.0-pre5',
    summary: 'Workers、Pages 与 R2 的部署配置与发布。',
    rea: null,
    codecs: [{ ext: '.iscf', since: '1.0.0-pre5' }],
    parts: [
      { from: 'integrations/cloudflare', to: 'Integrations/Cloudflare', optional: true }
    ]
  },
  {
    id: 'integrations.gitee',
    name: 'Gitee',
    branch: 'integrations',
    version: '1.0.0-pre5',
    summary: '仓库浏览、发行版上传与镜像同步。',
    rea: 'git',
    codecs: [],
    parts: [
      { from: 'integrations/gitee', to: 'Integrations/Gitee', optional: true }
    ]
  },
  {
    id: 'integrations.piik',
    name: '远程工作 Piik',
    branch: 'integrations',
    version: '1.0.0-pre5',
    summary: '远程会话、远端终端与配对。连接即用，不留后台常驻进程。',
    rea: null,
    codecs: [{ ext: '.ispiik', since: '1.0.0-pre5' }],
    parts: [
      { from: 'integrations/piik', to: 'Integrations/Piik', optional: true }
    ]
  },

  /* ---- server ------------------------------------------------------- */
  {
    id: 'server.runtime',
    name: 'Infinity Server 运行时',
    branch: 'server',
    version: '1.0.0-pre5',
    summary: '守护进程、HTTP 面、指标与鉴权。服务器是独立产品，Studio 只装客户端面与脚本环境。',
    rea: null,
    codecs: [{ ext: '.isisv', since: '1.0.0-pre5' }],
    parts: [
      { from: 'InfinityServer/src/server.js', to: 'Server/src/server.js' },
      { from: 'InfinityServer/src/main.js', to: 'Server/src/main.js' },
      { from: 'InfinityServer/src/cli.js', to: 'Server/src/cli.js' },
      { from: 'InfinityServer/src/core', to: 'Server/src/core', optional: true }
    ]
  },
  {
    id: 'server.script',
    name: 'Infinity Script 环境',
    branch: 'server',
    version: '1.0.0-pre5',
    summary: '词法、编译、虚拟机、标准库与调试器。服务器上的自动化脚本跑在这里。',
    rea: null,
    codecs: [{ ext: '.isx', since: '1.0.0-pre5' }],
    parts: [
      { from: 'InfinityServer/script', to: 'Server/script', optional: true }
    ]
  },
  {
    id: 'server.languages',
    name: '服务端语言支持',
    branch: 'server',
    version: '1.0.0-pre5',
    summary: '服务端界面与日志的语言资源，缺项回落英语。',
    rea: null,
    codecs: [{ ext: '.isisl', since: '1.0.0-pre5' }],
    parts: [
      { from: 'InfinityServer/src/i18n.js', to: 'Server/src/i18n.js' }
    ]
  },
  {
    id: 'server.plugins',
    name: '插件宿主',
    branch: 'server',
    version: '1.0.0-pre4',
    summary: '插件清单、沙箱与生命周期管理。',
    rea: null,
    codecs: [{ ext: '.isplg', since: '1.0.0-pre4' }],
    parts: [
      { from: 'InfinityServer/src/plugins-catalog', to: 'Server/src/plugins-catalog', optional: true }
    ]
  }
];

/* ---- the eight branches -------------------------------------------- */

/* Branch order is tree order. "deferred" is inherited by the branch when all
 * of its components are deferred - the page greys the whole branch out. */
const BRANCH_SEEDS = [
  { id: 'studio', name: 'Studio 工作台' },
  { id: 'craft', name: 'Craft 创作套件' },
  { id: 'webviewer', name: 'WebViewer' },
  { id: 'office', name: 'Office 编辑器' },
  { id: 'cloud', name: 'Infinity Cloud', deferred: true },
  { id: 'packages', name: '包管理器' },
  { id: 'integrations', name: '集成' },
  { id: 'server', name: 'Infinity Server' }
];

export const BRANCHES = BRANCH_SEEDS.map((seed) => {
  const members = COMPONENTS.filter((c) => c.branch === seed.id);
  return {
    id: seed.id,
    name: seed.name,
    deferred: Boolean(seed.deferred),
    components: members
  };
});

/* ---- version arithmetic -------------------------------------------- */

/*
 * Versions here are semver-shaped: MAJOR.MINOR.PATCH with an optional
 * prerelease tail, which this project uses heavily (1.0.0-pre5). Prerelease
 * ordering follows semver: 1.0.0-pre2 < 1.0.0-pre10 < 1.0.0. The numeric
 * comparison matters - pre10 is newer than pre2, not older.
 */
const VERSION_RE = /^v?([0-9]+)[.]([0-9]+)[.]([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:[+]([0-9A-Za-z.-]+))?$/;

export function parseVersion(raw) {
  if (raw && typeof raw === 'object' && raw.major !== undefined) return raw;
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  const m = VERSION_RE.exec(text);
  if (!m) return null;
  return {
    raw: text,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
    build: m[5] || null
  };
}

export function isPrerelease(raw) {
  const v = parseVersion(raw);
  return Boolean(v && v.prerelease.length);
}

function compareIdentifier(a, b) {
  const an = /^[0-9]+$/.test(a);
  const bn = /^[0-9]+$/.test(b);
  if (an && bn) {
    const x = Number(a);
    const y = Number(b);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (an) return -1;            /* numeric identifiers sort before alphanumeric */
  if (bn) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/* Returns -1, 0 or 1. Throws on a string that is not a version, because a
 * silent 0 would let an unparseable floor wave a format through. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x) throw new RangeError('not a version: ' + String(a));
  if (!y) throw new RangeError('not a version: ' + String(b));
  if (x.major !== y.major) return x.major < y.major ? -1 : 1;
  if (x.minor !== y.minor) return x.minor < y.minor ? -1 : 1;
  if (x.patch !== y.patch) return x.patch < y.patch ? -1 : 1;
  const xp = x.prerelease;
  const yp = y.prerelease;
  if (!xp.length && !yp.length) return 0;
  if (!xp.length) return 1;     /* a release outranks its own prereleases */
  if (!yp.length) return -1;
  const n = Math.min(xp.length, yp.length);
  for (let i = 0; i < n; i += 1) {
    const c = compareIdentifier(xp[i], yp[i]);
    if (c !== 0) return c;
  }
  if (xp.length === yp.length) return 0;
  return xp.length < yp.length ? -1 : 1;
}

/* True when a build at "version" is new enough to read a format introduced
 * at "since". Anything unparseable is false: fail closed, never guess. */
export function satisfiesVersion(version, since) {
  try {
    return compareVersions(version, since) >= 0;
  } catch {
    return false;
  }
}

/* ---- lookups -------------------------------------------------------- */

const COMPONENT_INDEX = new Map(COMPONENTS.map((c) => [c.id, c]));
const BRANCH_INDEX = new Map(BRANCHES.map((b) => [b.id, b]));

export function findComponent(id) {
  return COMPONENT_INDEX.get(String(id)) || null;
}

export function findBranch(id) {
  return BRANCH_INDEX.get(String(id)) || null;
}

export function componentsOfBranch(branchId) {
  const b = BRANCH_INDEX.get(String(branchId));
  return b ? b.components.slice() : [];
}

/* The tree the page draws: the branches, deep-copied, each carrying its
 * component count. Copying means a caller can annotate (installed: true)
 * without the catalogue itself drifting. */
export function suiteTree() {
  return BRANCHES.map((b) => ({
    id: b.id,
    name: b.name,
    deferred: b.deferred,
    componentCount: b.components.length,
    components: b.components.map((c) => ({
      id: c.id,
      name: c.name,
      branch: c.branch,
      version: c.version,
      summary: c.summary,
      rea: c.rea,
      codecs: c.codecs.map((k) => ({ ext: k.ext, since: k.since })),
      parts: c.parts.map((p) => (p.optional ? { from: p.from, to: p.to, optional: true } : { from: p.from, to: p.to }))
    }))
  }));
}

/* Every declared format, flattened, with the component that owns it. This is
 * what the file-association planner walks. */
export function codecs() {
  const out = [];
  for (const c of COMPONENTS) {
    for (const k of c.codecs) {
      out.push({
        component: c.id,
        componentName: c.name,
        branch: c.branch,
        deferred: Boolean(BRANCH_INDEX.get(c.branch) && BRANCH_INDEX.get(c.branch).deferred),
        version: c.version,
        ext: k.ext,
        since: k.since
      });
    }
  }
  return out;
}

let CODEC_INDEX = null;

export function codecIndex() {
  if (!CODEC_INDEX) {
    CODEC_INDEX = new Map();
    for (const k of codecs()) CODEC_INDEX.set(k.ext, k);
  }
  return CODEC_INDEX;
}

export function codecForExt(ext) {
  const key = String(ext || '').trim().toLowerCase();
  return codecIndex().get(key) || null;
}

/* Can a component open a file of this extension at this build? The answer is
 * an object rather than a boolean so the caller can say why not. */
export function componentSupportsCodec(componentId, ext, version) {
  const component = findComponent(componentId);
  if (!component) return { ok: false, code: 'COMPONENT_UNKNOWN', component: String(componentId) };
  const wanted = String(ext || '').trim().toLowerCase();
  const codec = component.codecs.find((k) => k.ext === wanted) || null;
  if (!codec) return { ok: false, code: 'CODEC_NOT_DECLARED', component: component.id, ext: wanted };
  const actual = version === undefined ? component.version : version;
  if (!satisfiesVersion(actual, codec.since)) {
    return { ok: false, code: 'CODEC_TOO_OLD', component: component.id, ext: wanted, required: codec.since, actual: String(actual) };
  }
  return { ok: true, code: 'OK', component: component.id, ext: wanted, since: codec.since };
}

/*
 * Turn a mixed selection of branch ids and component ids into the concrete
 * component list an install would touch. Branch ids expand to their
 * components; deferred components are reported separately rather than
 * silently dropped, and anything unrecognised is named.
 */
export function resolveSelection(ids) {
  const wanted = Array.isArray(ids) ? ids.map((x) => String(x)) : [];
  const chosen = new Set();
  const deferred = new Set();
  const unknown = [];
  for (const id of wanted) {
    const branch = BRANCH_INDEX.get(id);
    if (branch) {
      for (const c of branch.components) {
        if (branch.deferred) deferred.add(c.id);
        else chosen.add(c.id);
      }
      continue;
    }
    const component = COMPONENT_INDEX.get(id);
    if (!component) {
      unknown.push(id);
      continue;
    }
    if (BRANCH_INDEX.get(component.branch).deferred) deferred.add(component.id);
    else chosen.add(component.id);
  }
  return {
    ids: COMPONENTS.filter((c) => chosen.has(c.id)).map((c) => c.id),
    deferred: COMPONENTS.filter((c) => deferred.has(c.id)).map((c) => c.id),
    unknown
  };
}

export function stats() {
  const byBranch = {};
  let parts = 0;
  let optionalParts = 0;
  let deferred = 0;
  const hosts = new Set();
  for (const b of BRANCHES) byBranch[b.id] = b.components.length;
  for (const c of COMPONENTS) {
    parts += c.parts.length;
    optionalParts += c.parts.filter((p) => p.optional).length;
    if (BRANCH_INDEX.get(c.branch).deferred) deferred += 1;
    if (c.rea) hosts.add(c.rea);
  }
  return {
    suiteVersion: SUITE_VERSION,
    branches: BRANCHES.length,
    components: COMPONENTS.length,
    installable: COMPONENTS.length - deferred,
    deferred,
    codecs: codecs().length,
    parts,
    optionalParts,
    hostsRequired: [...hosts].sort(),
    byBranch
  };
}
