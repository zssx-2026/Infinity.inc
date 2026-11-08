/*
 * Infinity.Inc - the shared layer behind every page.
 *
 * The site is static: GitHub Pages serves files, and there is no server of
 * ours anywhere in the picture. That decides almost everything here. There is
 * no session to keep on a server, so "signed in" means "this browser holds a
 * GitHub token"; there is no API to call, so the pages talk to api.github.com
 * directly; and there is no build step, so the navigation, the release
 * reader and the markdown renderer all live in this one file that every page
 * loads.
 *
 * Two rules run through it.
 *
 * Nothing from the network is ever inserted as markup. Release names, asset
 * names, file paths and user names all come from outside, and every one of
 * them is written with textContent or setAttribute. There is no innerHTML in
 * this file that takes a variable - a package called <img onerror=...> is a
 * package name, not an image tag.
 *
 * Nothing is claimed that was not fetched. If a repository has no releases
 * the page says so; it does not show a download button that leads to a 404.
 */

(function () {
  'use strict';

  var I = window.INFINITY = window.INFINITY || {};

  // The script finds its own base so the same files work from a local
  // directory and from https://zssx-2026.github.io/ without a
  // constant to keep in step with the deployment.
  var SELF = document.currentScript ? document.currentScript.src : '';
  var MARK = '/assets/site.js';
  var BASE = SELF.indexOf(MARK) >= 0 ? SELF.slice(0, SELF.indexOf(MARK)) : '';

  // The same base, as a path. Once the browser has resolved
  // document.currentScript.src, BASE is an absolute URL, so it can never be a
  // prefix of location.pathname - comparing the two is what made the English
  // "中文" switch point back at the page it was already on.
  var BASE_PATH = '';
  try {
    BASE_PATH = new URL(BASE, location.href).pathname.replace(/\/+$/, '') || '';
  } catch (e) { /* keep the fallback */ }

  /*
   * The content source: which host the releases, documents and downloads a
   * page shows come from. assets/sources.js owns the rule (English reads
   * GitHub, Chinese reads Gitee); this is the same four facts for any page
   * that does not load that file, so nothing here has to guess. The English
   * answer is exactly the GitHub host this file used before.
   */
  function buildFallback(lang) {
    var b = (lang === 'zh') ? {
      key: 'gitee', label: 'Gitee', lang: 'zh', owner: 'zssx2026',
      api: 'https://gitee.com/api/v5/repos/zssx2026/',
      apiRoot: 'https://gitee.com/api/v5',
      web: 'https://gitee.com/zssx2026',
      raw: 'https://gitee.com/zssx2026/<repo>/raw/main/'
    } : {
      key: 'github', label: 'GitHub', lang: 'en', owner: 'zssx-2026',
      api: 'https://api.github.com/repos/zssx-2026/',
      apiRoot: 'https://api.github.com',
      web: 'https://github.com/zssx-2026',
      raw: 'https://raw.githubusercontent.com/zssx-2026/'
    };
    return {
      key: b.key, label: b.label, lang: b.lang, owner: b.owner,
      api: b.api, apiRoot: b.apiRoot, web: b.web, raw: b.raw,
      repoWeb: function (repo) { return b.web + '/' + repo; },
      repoApi: function (repo) { return b.api + repo; },
      releasesApi: function (repo, perPage) {
        return b.api + repo + '/releases?per_page=' + (perPage || 30);
      },
      releasePage: function (repo, tag) { return b.web + '/' + repo + '/releases/tag/' + tag; },
      assetUrl: function (repo, tag, name) {
        return b.web + '/' + repo + '/releases/download/' + tag + '/' + name;
      },
      contentsApi: function (repo, path, ref) {
        return b.api + repo + '/contents/' + String(path).replace(/^\/+/, '') +
          '?ref=' + (ref || (b.key === 'gitee' ? 'master' : 'main'));
      },
      rawUrl: function (repo, path, ref) {
        ref = ref || (b.key === 'gitee' ? 'master' : 'main');
        path = String(path).replace(/^\/+/, '');
        if (b.key === 'gitee') {
          return 'https://gitee.com/' + b.owner + '/' + repo + '/raw/' + ref + '/' + path;
        }
        return 'https://raw.githubusercontent.com/' + b.owner + '/' + repo + '/' + ref + '/' + path;
      }
    };
  }
  function fallbackSource() {
    var path = '';
    try { path = String(location.pathname || ''); } catch (e2) { path = ''; }
    var zh = /(^|\/)cn(\/|$)/.test(path);
    if (!zh) {
      zh = String((document.documentElement && document.documentElement.lang) || '')
        .toLowerCase().indexOf('zh') === 0;
    }
    return buildFallback(zh ? 'zh' : 'en');
  }
  function source() {
    if (I.sources && typeof I.sources.source === 'function') return I.sources.source();
    return fallbackSource();
  }
  /* The same URL migration assets/sources.js performs, for a page that did not
   * load that file: an owner page, a REST base and a raw file, both ways. */
  function fallbackMirror(url, lang) {
    if (!url) return url;
    var zh = (lang === 'zh' || lang === 'gitee') ||
      ((lang === undefined || lang === null) && source().key === 'gitee');
    var s = String(url);
    if (zh) {
      s = s.replace(/^https:\/\/api\.github\.com\/repos\/zssx-2026/,
        'https://gitee.com/api/v5/repos/zssx2026');
      s = s.replace(/^https:\/\/raw\.githubusercontent\.com\/zssx-2026\/([^/]+)\/([^/]+)\/(.*)$/,
        'https://gitee.com/zssx2026/$1/raw/$2/$3');
      s = s.replace(/^https:\/\/github\.com\/zssx-2026/, 'https://gitee.com/zssx2026');
    } else {
      s = s.replace(/^https:\/\/gitee\.com\/api\/v5\/repos\/zssx2026/,
        'https://api.github.com/repos/zssx-2026');
      s = s.replace(/^https:\/\/gitee\.com\/zssx2026\/([^/]+)\/raw\/([^/]+)\/(.*)$/,
        'https://raw.githubusercontent.com/zssx-2026/$1/$2/$3');
      s = s.replace(/^https:\/\/gitee\.com\/zssx2026/, 'https://github.com/zssx-2026');
    }
    return s;
  }
  function fallbackNormalize(list, repo, lang) {
    if (!Array.isArray(list)) return [];
    var v = source();
    return list.map(function (r) {
      if (!r) return r;
      var tag = r.tag_name || r.tag || '';
      var raw = r.assets || r.attach_files || [];
      return Object.assign({}, r, {
        tag_name: tag,
        name: r.name || tag,
        prerelease: !!r.prerelease,
        draft: !!r.draft,
        published_at: r.published_at || r.created_at || r.updated_at || '',
        created_at: r.created_at || r.published_at || '',
        html_url: fallbackMirror(r.html_url || r.url || v.releasePage(repo, tag), lang),
        assets: (Array.isArray(raw) ? raw : []).map(function (a) {
          return Object.assign({}, a, {
            name: a.name || a.file_name || '',
            size: a.size || a.size_bytes || 0,
            created_at: a.created_at || a.updated_at || r.created_at || '',
            browser_download_url: fallbackMirror(
              a.browser_download_url || a.download_url || a.url || '', lang)
          });
        })
      });
    });
  }

  /*
   * The release the download cards point at, in one place.
   *
   * The suite's C++ builds are published as pre-releases, and GitHub's
   * /releases/latest skips those: on the older application repositories it
   * resolves to the Node-era stable v1.0pre1, which is not what the cards
   * should hand anybody. The tag is therefore named explicitly.
   *
   * Keep in step with cpp/release/v1.0pre5/release-assets.json ("tag") - the
   * directory name carries the same version. Both language versions read it
   * from here, so there is nothing else to update when it moves.
   */
  var RELEASE_TAG = 'v1.0.0-pre5';

  var TOKEN_KEY = 'infinity.token';
  var SETTINGS_KEY = 'infinity.settings';

  var PRODUCTS = [
    {
      slug: 'infinitycloud', short: 'inc', name: 'Infinity Cloud', repo: 'Infinity-Cloud',
      tagline: 'A cloud drive whose storage is GitHub releases. A file tree kept in a manifest, split across release assets, with a recycle bin.',
      taglineZh: '把 GitHub release 当存储的云盘：文件树写在清单里，按分片存进 release 资产，并带回收站。'
    },

    {
      slug: 'infinitypackagemanager', short: 'ipm', name: 'InfinityPackageManager', repo: 'InfinityPackageManager',
      tagline: 'A package catalogue and installer. Every package is a release asset in one repository; nothing is installed without a matching SHA-256.',
      taglineZh: '软件包目录与安装器：每个包都是同一仓库里的 release 资产，SHA-256 不匹配就不会安装。'
    },

    {
      slug: 'infinityserver', short: 'isv', name: 'Infinity Server', repo: 'InfinityServer',
      /* A product of its own, released separately: it has no installer in this
       * release set, so its card must not pretend to have a download page. */
      standalone: true,
      tagline: 'A rack-scale compute console: a six tier cache with a latency and capacity per tier, a hash ring that routes by key, and a billing chain whose every entry is checkable.',
      taglineZh: '机架级计算控制台：六级缓存各有延迟与容量，哈希环按键路由，计费链每一笔都可核验。'
    }

  ];

  /*
   * The two languages, in one table.
   *
   * The site is served in English at / and in Chinese at /cn/.
   * Every string lives here rather than in the pages, because a copy of each
   * page carrying its own translated prose is a pair that drifts the first time
   * somebody edits one of them - which is how a site ends up saying two things.
   * The pages read their language from <html lang>, so no page needs to know
   * which directory it sits in.
   */
  var T = {
    en: {
      suiteTitle: 'The Infinity suite',
      suiteLede: 'Four Windows applications. Each one ships as a folder with its own copy of Node.js and a small launcher for every face, so there is no runtime to hunt for and no DLL to install beside it; the installer only unpacks that folder.',
      products: 'Products',
      latest: 'Latest releases',
      howItFits: 'How it fits together',
      whereToStart: 'Where to start',
      product: 'Product', version: 'Version', published: 'Published', assets: 'Assets',
      size: 'Size', noReleases: 'no releases', unavailable: 'unavailable', nothingYet: 'nothing published yet',
      releaseNotes: 'release notes',
      reading: 'Reading releases…',
      liveNote: 'Read live from GitHub. A product with no releases is shown as such rather than offered.',
      twoFaces: 'Two faces, one executable',
      twoFacesText: 'Every product has a command line (<code>&lt;p&gt;_cli.exe</code>) and a window (<code>&lt;p&gt;_gui.exe</code>). The window is Electron rendering a page served by the same executable, so the executable is still the whole program. The terminal interface was removed: it duplicated the window without being better at anything.',
      oneCatalogue: 'One catalogue',
      oneCatalogueText: 'Products, plugins and resource packs all come from one index — a GitHub repository where each release is a catalogue page. InfinityPackageManager is the single entry point that reads it.',
      unverified: 'Nothing runs unverified',
      unverifiedText: 'A package is only installed if the SHA-256 of the bytes on disk matches the digest GitHub reports for that asset. A build with no digest is refused rather than trusted.',
      wantEverything: 'If you want everything',
      wantEverythingText: 'Install <a href="./download/infinitypackagemanager/">InfinityPackageManager</a>. It is the single entry point: one catalogue covering the products, the plugins they drive and the resource packs they load.',
      wantOne: 'If you want one thing',
      wantOneText: 'Every product installs on its own. Pick it from <a href="./download/">the download page</a> and ignore the rest.',
      wantRead: 'If you want to read first',
      wantReadText: 'The <a href="https://github.com/zssx-2026">documentation</a> is the project’s own files, rendered as they are — what is written there is what the code says.',
      downloadTitle: 'Download',
      downloadLede: 'Three installers, one per product. Pick one — the card opens its latest release.',
      platform: 'Platform', requirements: 'Requirements',
      requirementsText: 'Windows 10 or later. That is the whole list. The executables import only DLLs that ship with Windows — <code>kernel32</code>, <code>user32</code>, <code>gdi32</code>, <code>winhttp</code> and the UCRT forwarders — so there is no runtime to install, no framework to download and nothing to keep updated beside the program itself.',
      requirementsNote: 'You will need a GitHub account and a personal access token: the suite stores its data in GitHub releases. See <a href="https://github.com/zssx-2026">the documentation</a> for how to create one.',
      downloadAction: 'Download',
      noBuild: 'no build for',
      contents: 'Contents',
      unknownProduct: 'Unknown product',
      noProductNamed: 'There is no product called',
      latestFor: 'Latest —',
      allAssets: 'All assets in this release',
      notesTitle: 'Release notes',
      earlier: 'Earlier releases',
      noManifest: 'This repository has no readable manifest.',
      emptyDrive: 'The drive is empty.',
      entries: 'entries',
      recycleBin: 'Recycle bin',
      restoreNote: 'Restoring and purging are done from the desktop program, which can rewrite the manifest. This page is read-only by design.',
      noStorage: 'No storage repository was found in this account.',
      storage: 'Storage',
      signIn: 'Sign in', signUp: 'Sign up', token: 'GitHub personal access token',
      account: 'Account', settings: 'Settings', cloud: 'Cloud', docs: 'Documentation',
      overview: 'Overview', profile: 'Account', linkProduct: 'Link a product',
      sourceNote: 'The repository list comes from your GitHub account - the account and token endpoints exist only on GitHub. Repository content (releases and files) is read from Gitee on a Chinese page.',
      giteePendingNote: 'Note: the Chinese site reads Gitee, but the Gitee mirror is not published yet, so live data may be empty and links may not work; the page falls back to the local snapshot built into this site. As a manual exit, the matching GitHub page can be opened by hand - this page never requests GitHub automatically:',
      giteePendingLink: 'Open on GitHub'
    },
    zh: {
      suiteTitle: 'Infinity 套件',
      suiteLede: '四款只需要 Windows 的 Windows 应用。每个产品都是一个自带 Node.js 的文件夹，每个面孔配一个很小的启动器 —— 不用另找运行时，也没有要一并安装的 DLL；安装包只是把这个文件夹解开。',
      products: '产品',
      latest: '最新发布',
      howItFits: '它们是怎么配合的',
      whereToStart: '从哪里开始',
      product: '产品', version: '版本', published: '发布时间', assets: '资产',
      size: '大小', noReleases: '暂无发布', unavailable: '无法获取', nothingYet: '尚未发布',
      releaseNotes: '发布说明',
      reading: '正在读取发布…',
      liveNote: '实时读取自 Gitee。没有发布的产品会如实显示，而不是给一个点不开的链接。',
      twoFaces: '两种形态，一个可执行文件',
      twoFacesText: '每个产品都有命令行（<code>&lt;p&gt;_cli.exe</code>）和窗口（<code>&lt;p&gt;_gui.exe</code>）。窗口是 Electron 渲染同一个可执行文件提供的页面，所以那个可执行文件仍然是整个程序。终端界面已移除：它只是把窗口重做了一遍，并没有更好。',
      oneCatalogue: '一份目录',
      oneCatalogueText: '产品、插件和资源包都来自同一份索引 —— 一个 GitHub 仓库，其中每个 release 就是一个目录页。InfinityPackageManager 是读取它的统一入口。',
      unverified: '未校验的东西不会运行',
      unverifiedText: '只有在磁盘上算出的 SHA-256 与内容源报告的摘要一致时，包才会被安装。没有摘要的构建会被拒绝，而不是被信任。',
      wantEverything: '如果你全都想要',
      wantEverythingText: '安装 <a href="./download/infinitypackagemanager/">InfinityPackageManager</a>。它是统一入口：一份目录覆盖产品、产品所驱动的插件以及资源包。',
      wantOne: '如果你只要一个',
      wantOneText: '每个产品都能单独安装。从<a href="./download/">下载页</a>挑一个，其余的不用管。',
      wantRead: '如果你想先读一读',
      wantReadText: '<a href="https://github.com/zssx-2026">文档</a>是项目自己的文件，原样渲染 —— 写在那里的就是代码里说的。',
      downloadTitle: '下载',
      downloadLede: '三个安装包，一个产品一个。选一个 —— 卡片会打开它在 Gitee 上的最新发布。',
      platform: '平台', requirements: '系统要求',
      requirementsText: 'Windows 10 或更高版本。这就是全部要求。这些可执行文件只导入 Windows 自带的 DLL —— <code>kernel32</code>、<code>user32</code>、<code>gdi32</code>、<code>winhttp</code> 以及 UCRT 转发器 —— 所以没有运行时要安装，没有框架要下载，除了程序本身也没有别的东西需要保持更新。',
      requirementsNote: '你需要一个 GitHub 账号和个人访问令牌：套件的数据仍存在 GitHub release，登录与令牌校验也仍走 GitHub API —— 官网内容读取自 Gitee。如何创建，见<a href="https://github.com/zssx-2026">文档</a>。',
      downloadAction: '下载',
      noBuild: '没有适用于',
      contents: '目录',
      unknownProduct: '未知产品',
      noProductNamed: '没有名为',
      latestFor: '最新 ——',
      allAssets: '本版本的全部资产',
      notesTitle: '发布说明',
      earlier: '更早的发布',
      noManifest: '该仓库没有可读的清单。',
      emptyDrive: '云盘是空的。',
      entries: '项',
      recycleBin: '回收站',
      restoreNote: '还原与彻底删除由桌面程序完成，它能重写清单。本页按设计为只读。',
      noStorage: '该账户下没有找到存储仓库。',
      storage: '存储',
      signIn: '登录', signUp: '注册', token: 'GitHub 个人访问令牌',
      account: '账户', settings: '设置', cloud: '云盘', docs: '文档',
      overview: '概览', profile: '账户', linkProduct: '关联产品',
      sourceNote: '仓库列表来自你的 GitHub 账户 —— 账户与令牌接口只有 GitHub 提供；仓库内容（release 与文件）在中文站按规则读取 Gitee。',
      giteePendingNote: '注意：中文站的内容源为 Gitee，但 Gitee 镜像目前尚未就绪，实时数据可能为空、链接可能不可用；页面已回退到本站内置的本地快照。作为人工出口，可以手动打开 GitHub 上的对应页面 —— 本页不会自动请求 GitHub：',
      giteePendingLink: '在 GitHub 上查看'
    }
  };

  Object.assign(T.en, {
    docsTitle: 'Documentation',
    docsLede: 'Read straight out of the project’s own files, so what is written here is what the code says.',
    sourceAt: 'Source:',
    notReadable: 'This document could not be read:',
    publishedIn: 'It is published in the source repository:',
    notPushedNote: 'A 404 here usually means the document has not been pushed yet rather than that it is missing from the project.',
    loginTitle: 'Sign in',
    loginLede: 'This site has no accounts of its own. Signing in means handing it a GitHub personal access token, which it keeps in this browser and uses to read the repositories the suite stores its data in.',
    tokenHint: 'Kept in this browser’s local storage. It is sent only to api.github.com, never to this site — there is no server here to send it to.',
    doSignIn: 'Sign in',
    createToken: 'Create a token',
    tokenNeeds: 'What the token needs',
    tokenNeedsText: 'A classic token with the <code>repo</code> scope, or a fine-grained token with read and write access to <em>Contents</em> for the repositories you want the suite to use. Read access alone is enough to browse; uploading needs write.',
    tokenWarning: 'The token is a password. Treat it like one — the <a href="./link/">link a product</a> page explains how to hand it to a desktop program without pasting it into a chat window.',
    checking: ' Checking the token…',
    pasteFirst: 'Paste a token first.',
    rejected: 'GitHub rejected that token. Check it was copied whole and has not expired.',
    cloudTitle: 'Cloud',
    cloudLede: 'The same drive Infinity Cloud shows on the desktop, read out of the same releases. A storage repository holds a manifest named <code>file.json</code>; the manifest names the files, and each file’s parts name the release assets that hold its bytes.',
    storageLabel: 'Storage',
    refresh: 'Refresh',
    driveEmpty: 'The drive is empty.',
    deleteColumn: 'Deleted',
    pathColumn: 'Path',
    typeColumn: 'Type',
    modifiedColumn: 'Modified',
    noParts: 'no parts',
    myselfTitle: 'Account',
    myselfLede: 'There is no Infinity account to manage. This page shows the GitHub account the suite is acting as, and what it can reach.',
    repositories: 'Repositories',
    storageRepos: 'Storage repositories',
    tokenInUse: 'Token in use',
    memberSince: 'Member since',
    yesBrowser: 'yes, in this browser only',
    signOutTitle: 'Sign out',
    signOutText: 'Signing out removes the token from this browser. It does not revoke it — revoke it on GitHub if you think it has been seen by somebody else.',
    settingsTitle: 'Settings',
    settingsLede: 'These are the preferences of this website in this browser. The desktop programs keep their own, and they are not shared — there is no account for them to be stored against.',
    downloadsSection: 'Downloads',
    platformFirst: 'Platform to offer first',
    showPre: 'Show pre-releases',
    appearance: 'Appearance',
    themeLabel: 'Theme',
    credential: 'Credential',
    savedRequests: 'Saved requests',
    resetTitle: 'Reset',
    noTokenBrowser: 'No token in this browser.',
    runTitle: 'Run a program',
    runLede: 'A desktop program opened this page with a request. A web page cannot start a program on your machine, so this page does the two things it actually can: it shows you exactly what is being asked for, and it hands the request to a copy of the suite you already have.',
    linkTitle: 'Link a product',
    linkLede: 'A desktop program opens this page to hand over a request: it puts a small payload in the address, this page shows it back, and once you are signed in it passes you to the matching run page.'
  });

  Object.assign(T.zh, {
    docsTitle: '文档',
    docsLede: '直接从项目自己的文件读取，所以这里写的就是代码里说的。',
    sourceAt: '来源：',
    notReadable: '该文档无法读取：',
    publishedIn: '它发布在源码仓库中：',
    notPushedNote: '这里的 404 通常表示文档还没推送，而不是项目里没有它。',
    loginTitle: '登录',
    loginLede: '本站点没有自己的账户。登录就是把一个 GitHub 个人访问令牌交给它，它把这个令牌保存在这个浏览器里，用来读取套件存放数据的那些仓库。',
    tokenHint: '保存在本浏览器的本地存储中。内容请求发给 Gitee；登录与令牌校验仍发给 api.github.com（Gitee 没有等价的账户接口，这是唯一例外）。两者都不会发给本站 —— 这里没有服务器可以接收它。',
    doSignIn: '登录',
    createToken: '创建令牌',
    tokenNeeds: '令牌需要什么权限',
    tokenNeedsText: '经典令牌需要 <code>repo</code> 作用域；细粒度令牌需要对要使用的仓库拥有 <em>Contents</em> 的读写权限。只读足以浏览，上传需要写权限。',
    tokenWarning: '令牌就是密码。请当密码对待 —— <a href="./link/">关联产品</a>页说明如何把它交给桌面程序，而不必贴进聊天窗口。',
    checking: ' 正在校验令牌…',
    pasteFirst: '请先粘贴令牌。',
    rejected: 'GitHub 拒绝了该令牌。请检查是否完整复制，以及是否过期。',
    cloudTitle: '云盘',
    cloudLede: '与桌面端 Infinity Cloud 相同的云盘，从相同的 release 读取。存储仓库里有一份名为 <code>file.json</code> 的清单；清单列出文件，而每个文件的分片指向保存其字节的 release 资产。',
    storageLabel: '存储',
    refresh: '刷新',
    driveEmpty: '云盘是空的。',
    deleteColumn: '删除时间',
    pathColumn: '路径',
    typeColumn: '类型',
    modifiedColumn: '修改时间',
    noParts: '无分片',
    myselfTitle: '账户',
    myselfLede: '没有什么“Infinity 账户”需要管理。本页显示套件正在以其身份行事的那个 GitHub 账户，以及它能访问的范围。',
    repositories: '仓库',
    storageRepos: '存储仓库',
    tokenInUse: '正在使用的令牌',
    memberSince: '注册于',
    yesBrowser: '是，仅在本浏览器',
    signOutTitle: '退出登录',
    signOutText: '退出会从这个浏览器移除令牌，但不会吊销它 —— 如果你认为令牌被别人看到过，请到 GitHub 上吊销。',
    settingsTitle: '设置',
    settingsLede: '这些是本网站在这个浏览器里的偏好。桌面程序有自己的一套，两者并不共享 —— 没有账户可以用来存放它们。',
    downloadsSection: '下载',
    platformFirst: '优先提供的平台',
    showPre: '显示预发布版本',
    appearance: '外观',
    themeLabel: '主题',
    credential: '凭据',
    savedRequests: '已保存的请求',
    resetTitle: '重置',
    noTokenBrowser: '本浏览器中没有令牌。',
    runTitle: '运行程序',
    runLede: '一个桌面程序带着请求打开了本页。网页无法启动你机器上的程序，所以本页只做它真正能做的两件事：把请求内容如实显示出来，并把请求交给你已经安装的那份套件。',
    linkTitle: '关联产品',
    linkLede: '桌面程序打开本页来递交一个请求：它把一小段载荷放进地址里，本页把它显示回来，一旦你登录就转到对应的运行页。'
  });

  // The product pages: the strings shared by all six of them, including the
  // names cn-mirror needs.
  Object.assign(T.en, {
    latestFor: 'Latest —',
    allAssets: 'All assets in this release',
    releasesNotes: 'release notes',
    notes: 'Release notes',
    earlierReleases: 'Earlier releases',
    noInstallerFor: 'no installer for',
    noBuildFor: 'no build for',
    noAssets: 'This release has no assets.',
    preRelease: 'pre-release',
    source: 'source',
    kind: 'Kind',
    digest: 'Digest',
    winX64: 'Windows x64',
    selfContained: 'self-contained'
  });

  Object.assign(T.zh, {
    latestFor: '最新 ——',
    allAssets: '本版本的全部资产',
    releasesNotes: '发布说明',
    notes: '发布说明',
    earlierReleases: '更早的发布',
    noInstallerFor: '没有适用于',
    noBuildFor: '没有适用于',
    noAssets: '本版本没有资产。',
    preRelease: '预发布',
    source: '源码',
    kind: '类型',
    digest: '摘要',
    winX64: 'Windows x64',
    selfContained: '自包含，无运行时'
  });

  /*
   * The strings the Chinese pages read by key: settings, account, cloud,
   * docs, the run pages and the pages' shared labels. They live here for the
   * same reason as every other string on the site - one table, two languages,
   * and a page that never has to know which copy of itself it is.
   */
  Object.assign(T.en, {
    footerSuite: 'Infinity.Inc \u2014 the Infinity suite.',
    loadingDefault: 'Loading\u2026',
    errTokenRejected: 'The token was rejected. Sign in again.',
    errGithubRefused: 'GitHub refused the request: ',
    errGithubRefusedNote: ' (a rate limit or a missing scope, not a bad token)',
    errNotFound: 'Not found: ',
    accountFailed: 'The account could not be read: ',
    appearanceGroup: 'Appearance',
    charactersOf: 'characters of',
    charactersWord: 'characters',
    checkIt: 'Check it',
    checkingWord: 'checking\u2026',
    cloudStorage: 'Cloud storage',
    continueToRun: 'Continue to the run page',
    credentialGroup: 'Credential',
    darkWord: 'Dark',
    deletedWord: 'Deleted',
    docCatalogue: 'Catalogue format',
    docCatalogueNote: 'How a catalogue page is written.',
    docDecodeFailed: 'The document could not be decoded.',
    docEmpty: 'The document is empty.',
    docMissing404: 'A 404 usually means the file has not been pushed yet rather than that it is missing.',
    docPreview: 'Streaming preview',
    docPreviewNote: 'How the preview opens huge files without reading them whole.',
    docSuite: 'The suite',
    docSuiteNote: 'The C++ README, which describes the suite as a whole.',
    docUnreadable: 'The document could not be read: ',
    docUsing: 'Using it',
    docUsingNote: 'The top-level README, which says what each product is for.',
    downloadsGroup: 'Downloads',
    driveFailed: 'The drive could not be read: ',
    fileWord: 'File',
    findingStores: 'Finding storage repositories\u2026',
    folderWord: 'Folder',
    forgetWord: 'Forget',
    getInfinityCloud: 'Get Infinity Cloud',
    lightWord: 'Light',
    linkIdLabel: 'Link id',
    manageTokens: 'Manage tokens on GitHub',
    manifestNotJson: 'The manifest is not readable JSON.',
    modifiedWord: 'Modified',
    noAccountReturned: 'no account returned',
    noRequestHere: 'No request was found in this address.',
    noStableOnly: 'No, only stable releases',
    noStoreYet: 'No storage repository found yet.',
    noTokenHere: 'No token in this browser.',
    noneWord: 'none',
    nothingSaved: 'Nothing saved.',
    openWord: 'Open',
    partsWord: 'parts',
    pathWord: 'Path',
    payloadLabel: 'Payload',
    payloadUndecodable: 'the payload could not be decoded',
    platformArm: 'Windows on ARM',
    platformWin64: 'Windows x64',
    platformX86: 'Windows x86',
    privateWord: 'private',
    publicWord: 'public',
    publishedInRepo: 'It is published in the repository: ',
    readingAccount: 'Reading the account\u2026',
    readingFile: 'Reading',
    readingManifest: 'Reading the manifest\u2026',
    rejectedWord: 'rejected: ',
    repoItself: 'the repository itself',
    reposFailed: 'The repositories could not be listed: ',
    repositoryWord: 'Repository',
    requestTitle: 'Request',
    resetButton: "Clear this browser's data",
    resetDone: 'Cleared. The token was left alone \u2014 sign out from the account page if you want it gone.',
    resetGroup: 'Reset',
    resetText: 'Clears every preference and every saved request in this browser. It does not touch your GitHub account or any repository.',
    runExplains: 'The run page hands the request to the copy of the suite you already have.',
    runIdLabel: 'Run id',
    savedRequestsText: 'Run requests this browser has been handed, newest last. A desktop program collects them when it starts.',
    savedWord: 'Saved',
    showPrereleaseLabel: 'Show pre-releases',
    showingFirst: 'Showing the first',
    signInAndContinue: 'Sign in and continue',
    signInToContinue: 'Sign in to continue.',
    signOutButton: 'Sign out',
    signedInAs: 'Signed in as',
    sourceLabel: 'Source: ',
    storeWarning: 'A storage repository is a GitHub repository the desktop program writes to; this page only reads it.',
    themeNote: 'The choice applies immediately and is remembered in this browser.',
    themeToggle: 'Switch theme',
    thisBrowser: 'this browser',
    tokenStoredNote: 'A token is stored in this browser and sent only to api.github.com.',
    typeWord: 'Type',
    updatedWord: 'Updated',
    validAs: 'valid, signed in as',
    visibilityWord: 'Visibility',
    volumeWord: 'Volume',
    whatHappensNext: 'What happens next',
    yesBrowserOnly: 'yes, in this browser only',
    yesWord: 'Yes'
  });

  Object.assign(T.zh, {
    footerSuite: 'Infinity.Inc \u2014\u2014 Infinity \u5957\u4ef6\u3002',
    loadingDefault: '\u6b63\u5728\u52a0\u8f7d\u2026',
    errTokenRejected: '\u4ee4\u724c\u88ab\u62d2\u7edd\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u3002',
    errGithubRefused: '\u5185\u5bb9\u6e90\u62d2\u7edd\u4e86\u8be5\u8bf7\u6c42\uff1a',
    errGithubRefusedNote: '\uff08\u9650\u6d41\u6216\u6743\u9650\u4e0d\u8db3\uff0c\u4e0d\u662f\u4ee4\u724c\u672c\u8eab\u7684\u95ee\u9898\uff09',
    errNotFound: '\u672a\u627e\u5230\uff1a',
    accountFailed: '\u65e0\u6cd5\u8bfb\u53d6\u8d26\u6237\uff1a',
    appearanceGroup: '\u5916\u89c2',
    charactersOf: '\u4e2a\u5b57\u7b26\uff0c\u5171',
    charactersWord: '\u4e2a\u5b57\u7b26',
    checkIt: '\u6821\u9a8c\u4e00\u4e0b',
    checkingWord: '\u6b63\u5728\u6821\u9a8c\u2026',
    cloudStorage: '\u4e91\u76d8\u5b58\u50a8',
    continueToRun: '\u7ee7\u7eed\u524d\u5f80\u8fd0\u884c\u9875',
    credentialGroup: '\u51ed\u636e',
    darkWord: '\u6df1\u8272',
    deletedWord: '\u5220\u9664\u65f6\u95f4',
    docCatalogue: '\u76ee\u5f55\u683c\u5f0f',
    docCatalogueNote: '\u76ee\u5f55\u9875\u662f\u600e\u4e48\u5199\u7684\u3002',
    docDecodeFailed: '\u65e0\u6cd5\u89e3\u7801\u8be5\u6587\u6863\u3002',
    docEmpty: '\u8be5\u6587\u6863\u662f\u7a7a\u7684\u3002',
    docMissing404: '404 \u901a\u5e38\u8868\u793a\u6587\u4ef6\u8fd8\u6ca1\u6709\u63a8\u9001\uff0c\u800c\u4e0d\u662f\u9879\u76ee\u91cc\u6ca1\u6709\u5b83\u3002',
    docPreview: '流式预览',
    docPreviewNote: '预览如何在不整份读入的前提下打开超大文件。',
    docSuite: '\u5957\u4ef6\u603b\u89c8',
    docSuiteNote: 'C++ \u7684 README\uff0c\u8bb2\u6574\u4e2a\u5957\u4ef6\u3002',
    docUnreadable: '\u65e0\u6cd5\u8bfb\u53d6\u8be5\u6587\u6863\uff1a',
    docUsing: '\u4f7f\u7528\u8bf4\u660e',
    docUsingNote: '\u9876\u5c42 README\uff0c\u8bb2\u6bcf\u4e2a\u4ea7\u54c1\u7684\u7528\u9014\u3002',
    downloadsGroup: '\u4e0b\u8f7d',
    driveFailed: '\u65e0\u6cd5\u8bfb\u53d6\u4e91\u76d8\uff1a',
    fileWord: '\u6587\u4ef6',
    findingStores: '\u6b63\u5728\u67e5\u627e\u5b58\u50a8\u4ed3\u5e93\u2026',
    folderWord: '\u6587\u4ef6\u5939',
    forgetWord: '\u5fd8\u8bb0',
    getInfinityCloud: '\u83b7\u53d6 Infinity Cloud',
    lightWord: '\u6d45\u8272',
    linkIdLabel: '\u5173\u8054 ID',
    manageTokens: '\u5728 GitHub \u4e0a\u7ba1\u7406\u4ee4\u724c',
    manifestNotJson: '\u6e05\u5355\u4e0d\u662f\u53ef\u8bfb\u7684 JSON\u3002',
    modifiedWord: '\u4fee\u6539\u65f6\u95f4',
    noAccountReturned: '\u6ca1\u6709\u8fd4\u56de\u8d26\u6237',
    noRequestHere: '\u8be5\u5730\u5740\u91cc\u6ca1\u6709\u627e\u5230\u8bf7\u6c42\u3002',
    noStableOnly: '\u5426\uff0c\u53ea\u663e\u793a\u7a33\u5b9a\u7248',
    noStoreYet: '\u8fd8\u6ca1\u6709\u627e\u5230\u5b58\u50a8\u4ed3\u5e93\u3002',
    noTokenHere: '\u672c\u6d4f\u89c8\u5668\u4e2d\u6ca1\u6709\u4ee4\u724c\u3002',
    noneWord: '\u65e0',
    nothingSaved: '\u6ca1\u6709\u5df2\u4fdd\u5b58\u7684\u5185\u5bb9\u3002',
    openWord: '\u6253\u5f00',
    partsWord: '\u4e2a\u5206\u7247',
    pathWord: '\u8def\u5f84',
    payloadLabel: '\u8f7d\u8377',
    payloadUndecodable: '\u8f7d\u8377\u65e0\u6cd5\u89e3\u7801',
    platformArm: 'Windows ARM',
    platformWin64: 'Windows x64',
    platformX86: 'Windows x86',
    privateWord: '\u79c1\u6709',
    publicWord: '\u516c\u5f00',
    publishedInRepo: '\u5b83\u53d1\u5e03\u5728\u4ed3\u5e93\u4e2d\uff1a',
    readingAccount: '\u6b63\u5728\u8bfb\u53d6\u8d26\u6237\u2026',
    readingFile: '\u6b63\u5728\u8bfb\u53d6',
    readingManifest: '\u6b63\u5728\u8bfb\u53d6\u6e05\u5355\u2026',
    rejectedWord: '\u88ab\u62d2\u7edd\uff1a',
    repoItself: '\u4ed3\u5e93\u672c\u8eab',
    reposFailed: '\u65e0\u6cd5\u5217\u51fa\u4ed3\u5e93\uff1a',
    repositoryWord: '\u4ed3\u5e93',
    requestTitle: '\u8bf7\u6c42',
    resetButton: '\u6e05\u9664\u672c\u6d4f\u89c8\u5668\u7684\u6570\u636e',
    resetDone: '\u5df2\u6e05\u9664\u3002\u4ee4\u724c\u672a\u88ab\u6539\u52a8 \u2014\u2014 \u5982\u679c\u60f3\u53bb\u6389\u5b83\uff0c\u8bf7\u5230\u8d26\u6237\u9875\u9000\u51fa\u767b\u5f55\u3002',
    resetGroup: '\u91cd\u7f6e',
    resetText: '\u6e05\u9664\u672c\u6d4f\u89c8\u5668\u4e2d\u7684\u6240\u6709\u504f\u597d\u4e0e\u5df2\u4fdd\u5b58\u8bf7\u6c42\uff0c\u4e0d\u4f1a\u5f71\u54cd\u4f60\u7684 GitHub \u8d26\u6237\u6216\u4efb\u4f55\u4ed3\u5e93\u3002',
    runExplains: '\u8fd0\u884c\u9875\u4f1a\u628a\u8bf7\u6c42\u4ea4\u7ed9\u4f60\u5df2\u7ecf\u5b89\u88c5\u7684\u90a3\u4efd\u5957\u4ef6\u3002',
    runIdLabel: '\u8fd0\u884c ID',
    savedRequestsText: '\u672c\u6d4f\u89c8\u5668\u6536\u5230\u7684\u8fd0\u884c\u8bf7\u6c42\uff0c\u6700\u65b0\u7684\u6392\u5728\u6700\u540e\u3002\u684c\u9762\u7a0b\u5e8f\u542f\u52a8\u65f6\u4f1a\u53d6\u8d70\u5b83\u4eec\u3002',
    savedWord: '\u4fdd\u5b58\u65f6\u95f4',
    showPrereleaseLabel: '\u663e\u793a\u9884\u53d1\u5e03\u7248\u672c',
    showingFirst: '\u53ea\u663e\u793a\u524d',
    signInAndContinue: '\u767b\u5f55\u5e76\u7ee7\u7eed',
    signInToContinue: '\u8bf7\u767b\u5f55\u540e\u7ee7\u7eed\u3002',
    signOutButton: '\u9000\u51fa\u767b\u5f55',
    signedInAs: '\u5df2\u767b\u5f55\u4e3a',
    sourceLabel: '\u6765\u6e90\uff1a',
    storeWarning: '\u5b58\u50a8\u4ed3\u5e93\u662f\u684c\u9762\u7a0b\u5e8f\u5199\u5165\u7684 GitHub \u4ed3\u5e93\uff1b\u672c\u9875\u53ea\u8bfb\u53d6\u5b83\u3002',
    themeNote: '\u9009\u597d\u5c31\u7acb\u5373\u751f\u6548\uff0c\u5e76\u8bb0\u5728\u8fd9\u4e2a\u6d4f\u89c8\u5668\u91cc\u3002',
    themeToggle: '\u5207\u6362\u4e3b\u9898',
    thisBrowser: '\u672c\u6d4f\u89c8\u5668',
    tokenStoredNote: '\u4ee4\u724c\u4fdd\u5b58\u5728\u672c\u6d4f\u89c8\u5668\u4e2d\uff1b\u5185\u5bb9\u8bfb\u53d6\u53d1\u7ed9 Gitee\uff0c\u767b\u5f55\u6821\u9a8c\u4ecd\u53d1\u7ed9 api.github.com\u3002',
    typeWord: '\u7c7b\u578b',
    updatedWord: '\u66f4\u65b0\u65f6\u95f4',
    validAs: '\u6709\u6548\uff0c\u5df2\u767b\u5f55\u4e3a',
    visibilityWord: '\u53ef\u89c1\u6027',
    volumeWord: '\u5206\u5377',
    whatHappensNext: '\u63a5\u4e0b\u6765\u4f1a\u600e\u6837',
    yesBrowserOnly: '\u662f\uff0c\u4ec5\u5728\u672c\u6d4f\u89c8\u5668',
    yesWord: '\u662f'
  });

  // The language is the directory first (/cn/ is Chinese) and the
  // declared <html lang> second, so a page never has to be told which copy of
  // itself it is. assets/i18n.js holds the same rule; when that module is on
  // the page this reads it, so there is one decided language everywhere.
  function lang() {
    if (window.INFINITY && window.INFINITY.i18n && window.INFINITY.i18n.lang) return window.INFINITY.i18n.lang();
    var path = '';
    try { path = String(location.pathname || ''); } catch (e) { path = ''; }
    if (/(^|\/)cn(\/|$)/.test(path)) return 'zh';
    var declared = (document.documentElement && document.documentElement.lang) ? document.documentElement.lang : '';
    if (declared && declared.toLowerCase().indexOf('zh') === 0) return 'zh';
    return 'en';
  }

  /*
   * Translate. An unknown key returns the key itself rather than an empty
   * string - a missing translation that shows up as "downloadsTitle" on the
   * page is obvious, whereas one that shows up as nothing is invisible.
   */
  function t(key) {
    var table = T[lang()] || T.en;
    if (key in table) return table[key];
    return (key in T.en) ? T.en[key] : key;
  }

  // When assets/i18n.js is on the page it holds the same table, and the other
  // asset scripts ask it for strings. Registering keeps one dictionary.
  if (window.INFINITY && window.INFINITY.i18n && window.INFINITY.i18n.register) {
    window.INFINITY.i18n.register(T);
  }

  var DEFAULT_SETTINGS = {
    theme: 'dark',
    downloadPlatform: 'win64',
    perPage: '10',
    showPrerelease: true
  };

  // ------------------------------------------------------------ storage

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function drop(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  }

  var token = read(TOKEN_KEY) || '';
  var user = null;

  function settings() {
    var stored = {};
    try { stored = JSON.parse(read(SETTINGS_KEY) || '{}') || {}; } catch (e) { stored = {}; }
    var out = {};
    for (var k in DEFAULT_SETTINGS) out[k] = (k in stored) ? stored[k] : DEFAULT_SETTINGS[k];
    return out;
  }
  function saveSettings(next) {
    var merged = settings();
    for (var k in next) merged[k] = next[k];
    write(SETTINGS_KEY, JSON.stringify(merged));

    return merged;
  }

  /*
   * The theme is an attribute on <html>, not a class on <body>, because
   * assets/theme.js has to set it from <head> before the first paint and it
   * can only reach the root element. Everything visual hangs off the CSS
   * variables that attribute selects, so switching is one attribute write and
   * no element has to be re-rendered.
   */
  function applyTheme(theme) {
    var value = (theme === 'light') ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', value);
    document.documentElement.style.colorScheme = value;
    var button = document.querySelector('header.site .theme');
    if (button) {
      var next = (value === 'light') ? 'dark' : 'light';
      button.setAttribute('data-next', next);
      button.setAttribute('aria-label', t('themeToggle'));
      button.setAttribute('title', t('themeToggle'));
      button.textContent = (value === 'light') ? t('darkWord') : t('lightWord');
    }
    return value;
  }
  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var next = (current === 'light') ? 'dark' : 'light';
    saveSettings({ theme: next });
    return applyTheme(next);
  }

  // ------------------------------------------------------------ network

  /*
   * One GitHub call. The token is sent as a bearer header and never in a URL,
   * so it cannot end up in a referrer, a browser history entry or a server
   * log. A 401 and a 403 mean different things and are reported differently:
   * one is a bad credential, the other is a rate limit or a missing scope,
   * and telling somebody to re-enter a token that is fine wastes their time.
   */
  function gh(path, options) {
    var opts = options || {};
    var headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Infinity.Inc-site' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    /*
     * Repository content - releases, contents, repository metadata - is read
     * from the reader's own content source. Everything else (/user,
     * /user/repos, /gists and the rest of the account conversation) stays on
     * api.github.com in both languages: the suite's data lives in GitHub
     * releases and a GitHub token is the only credential those endpoints
     * accept. That exception is stated on the pages, not hidden here.
     */
    var url = 'https://api.github.com' + path;
    if (/^\/repos\//.test(String(path || ''))) {
      var s = source();
      url = s.apiRoot + String(path).replace(/^\/repos\/zssx-2026\//, '/repos/' + s.owner + '/');
    }
    return fetch(url, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var message = (data && data.message) || ('HTTP ' + res.status);
          if (res.status === 401) message = t('errTokenRejected');
          else if (res.status === 403) message = t('errGithubRefused') + message + t('errGithubRefusedNote');
          else if (res.status === 404) message = t('errNotFound') + path;
          var err = new Error(message);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function releases(repo) {
    var s = source();
    return gh('/repos/' + s.owner + '/' + repo + '/releases?per_page=30').then(function (list) {
      /* Gitee describes a release slightly differently; sources.js folds it
       * into the shape the pages already read. */
      if (s.key !== 'github' && I.sources && I.sources.normalizeReleases) {
        return I.sources.normalizeReleases(list, repo, s.lang);
      }
      return list;
    }).catch(function (e) {
      if (e.status === 404) return [];
      throw e;
    });
  }

  function repoInfo(repo) {
    var s = source();
    return gh('/repos/' + s.owner + '/' + repo).catch(function (e) {
      if (e.status === 404) return null;
      throw e;
    });
  }

  // ------------------------------------------------------------ formatting

  function fmtSize(bytes) {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return '';
    var n = Number(bytes);
    if (n < 1024) return n + ' B';
    var units = ['KB', 'MB', 'GB', 'TB'];
    var i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + ' ' + units[i];
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function fmtCount(n) {
    return String(n === null || n === undefined ? 0 : n);
  }

  // ------------------------------------------------------------ dom

  /*
   * Build an element. Everything that came from outside is passed as text or
   * as an attribute value, and neither of those can become markup. This is
   * the only way this file creates nodes - there is deliberately no helper
   * that takes an HTML string.
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') throw new Error('refusing to set markup');
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c === null || c === undefined || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /*
   * One link helper, and it decides where the link opens.
   *
   * Anything that is not this site opens in a new tab, because following a link
   * to github.com and losing the page you were reading is worse than an extra
   * tab. `rel="noopener"` goes with every one of them: without it the page that
   * opens gets a handle back on this one.
   */
  function isExternal(href) {
    if (!href) return false;
    if (href.charAt(0) === '#' || href.charAt(0) === '.') return false;
    if (href.indexOf(BASE + '/') === 0 || href.indexOf(BASE) === 0) return false;
    return /^https?:/i.test(href);
  }

  function link(href, text, className) {
    href = mirror(href);
    var node = el('a', { href: href, class: className || null, text: text });
    if (isExternal(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener');
    }
    return node;
  }

  /*
   * A route inside the site, in whichever language this page is in.
   *
   * The Chinese copy lives at /cn/ and is otherwise identical, so
   * every link has to come back to the language the reader is already in -
   * nav, breadcrumbs, the sign-in redirect and the product pages all go
   * through here. A page therefore never needs to know which directory it
   * sits in.
   */
  function page(route) {
    return (inChinese() ? BASE + '/cn' : BASE) + route;
  }

  // ------------------------------------------------------------ chrome

  var NAV = [
    { route: '/', key: 'overview' },
    { route: '/download/', key: 'downloadTitle' },
    { route: '/docs/', key: 'docs' },
    { route: '/cloud/', key: 'cloud' },
    { route: '/settings/', key: 'settings' }
  ];

  /*
   * The other language is the same route with /cn/ added or removed. Working
   * it out from the path means a new page needs no entry anywhere: it is
   * bilingual as soon as both copies exist.
   */
  function inChinese() { return location.pathname.indexOf('/cn/') >= 0; }

  /*
   * Chinese pages hand the reader to the same repositories and the same release
   * assets, on the host that is reachable from there. It is a plain URL swap in
   * one place: nothing on the page names the mirror, and calls made for signing
   * in (api.github.com) are deliberately left alone because they are an API
   * conversation, not a link the reader follows.
   */
  var MIRROR_FROM = 'https://github.com/zssx-2026';
  var MIRROR_TO = 'https://gitee.com/zssx2026';

  function mirror(href) {
    if (!href || !inChinese()) return href;
    /* sources.js rewrites the owner page, the REST base and raw files;
     * the two constants are the plain URL-swap fallback for a page that did
     * not load it. */
    if (I.sources && typeof I.sources.mirror === 'function') {
      return I.sources.mirror(href, 'zh');
    }
    if (href.indexOf(MIRROR_FROM) !== 0) return href;
    return MIRROR_TO + href.slice(MIRROR_FROM.length);
  }

  /*
   * Links built by the download and archive modules go straight into the DOM,
   * so after every render the anchors already on the page are swapped too.
   */
  function applyMirror(root) {
    if (!inChinese()) return;
    var nodes = (root || document).querySelectorAll('a[href],img[src],[data-href]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.hasAttribute('href')) n.setAttribute('href', mirror(n.getAttribute('href')));
      if (n.hasAttribute('data-href')) n.setAttribute('data-href', mirror(n.getAttribute('data-href')));
      if (n.hasAttribute('src')) n.setAttribute('src', mirror(n.getAttribute('src')));
    }
  }

  function otherLanguageHref() {
    var path = location.pathname;
    var suffix = location.search || '';
    if (inChinese()) return path.replace('/cn/', '/') + suffix;
    // Insert /cn/ right after the site base: /download/ becomes
    // /cn/download/, and so on for every route.
    if (path.indexOf(BASE_PATH) === 0) {
      var rest = path.slice(BASE_PATH.length);
      return BASE_PATH + '/cn' + (rest === '' || rest === '/' ? '/' : rest) + suffix;
    }
    // The Pages root page is outside the suite's directory and has no Chinese
    // copy of its own; its switch goes to the Chinese suite.
    return BASE_PATH + '/cn/' + suffix;
  }

  function labelForOtherLanguage() { return lang() === 'zh' ? 'English' : '中文'; }

  function nav(active) {
    var bar = el('div', { class: 'inner' });
    var brand = el('a', { class: 'brand', href: page('/') }, [
      el('span', { class: 'dot' }), 'Infinity.Inc'
    ]);
    var list = el('nav');
    NAV.forEach(function (item) {
      var current = active === item.route;
      list.appendChild(link(page(item.route), t(item.key), current ? 'current' : null))
        .setAttribute('aria-current', current ? 'page' : 'false');
    });
    var who = el('div', { class: 'who' });
    bar.appendChild(brand);
    bar.appendChild(list);
    // The other language, one click. The Chinese copy lives under /cn/ and
    // everything else is identical, so the switch is a path rewrite: take the
    // current route and move it in or out of /cn/.
    // The theme switch sits in the header so the choice is reachable from
    // every page, not only from the settings page. Two states, one button.
    var themeBtn = el('button', {
      class: 'theme', type: 'button',
      'aria-label': t('themeToggle'), title: t('themeToggle')
    });
    themeBtn.addEventListener('click', function () { toggleTheme(); });
    bar.appendChild(themeBtn);
    var other = el('a', { class: 'lang', href: otherLanguageHref(), title: labelForOtherLanguage() },
      [labelForOtherLanguage()]);
    bar.appendChild(other);
    bar.appendChild(who);
    var header = el('header', { class: 'site' }, [bar]);
    document.body.insertBefore(header, document.body.firstChild);
    applyTheme(settings().theme);
    renderWho(who);
  }

  function renderWho(host) {
    clear(host);
    if (!token) {
      host.appendChild(link(page('/login/'), t('signIn')));
      host.appendChild(link(page('/signup/'), t('signUp')));
      return;
    }
    if (user) {
      host.appendChild(el('img', { src: user.avatar_url, alt: '' }));
      host.appendChild(link(page('/myself/'), user.login));
    } else {
      host.appendChild(link(page('/myself/'), t('account')));
    }
    host.appendChild(link(page('/login/link/'), t('linkProduct')));
  }

  function footer() {
    var inner = el('div', { class: 'inner' }, [
      el('span', { text: t('footerSuite') }),
      el('span', {}, [
        link(source().web, source().label),
        ' · ',
        link(page('/docs/'), t('docs')),
        ' · ',
        link(page('/settings/'), t('settings'))
      ])
    ]);
    document.body.appendChild(el('footer', { class: 'site' }, [inner]));
  }

  // ------------------------------------------------------------ auth

  function setToken(value) {
    token = (value || '').trim();
    if (token) write(TOKEN_KEY, token); else drop(TOKEN_KEY);
    return token;
  }

  function signOut() {
    token = '';
    user = null;
    drop(TOKEN_KEY);
  }

  function verify() {
    if (!token) return Promise.resolve(null);
    return gh('/user').then(function (u) { user = u; return u; });
  }

  function requireAuth(nextRoute) {
    if (token) return true;
    var next = nextRoute || (location.pathname + location.search);
    location.replace(page('/login/') + '?next=' + encodeURIComponent(next));
    return false;
  }

  /*
   * The sign-in link a product asks for: /login/link/<id>?="<base64>". The
   * payload is opaque to the site - it is whatever the desktop program put
   * there - so it is carried through untouched and shown back for
   * confirmation rather than being decoded and trusted.
   */
  function decodePayload(raw) {
    if (!raw) return '';
    var value = raw;
    try { value = decodeURIComponent(raw); } catch (e) { /* leave as-is */ }
    value = value.replace(/^"|"$/g, '');
    try {
      var bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      return '';
    }
  }

  // ------------------------------------------------------------ markdown

  /*
   * A small renderer, not a library. It handles what the project's own
   * documents use - headings, lists, tables, fenced code, inline code,
   * links, bold and italic - and it escapes first, so the only markup in the
   * output is the markup this function produced.
   */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    var out = esc(s);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, href) {
      if (!/^(https?:|\/|#|\.)/i.test(href)) return m;
      return '<a href="' + href + '">' + text + '</a>';
    });
    return out;
  }

  function markdown(source) {
    var lines = String(source).replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var i = 0;
    var list = null;

    function closeList() { if (list) { html.push('</' + list + '>'); list = null; } }

    while (i < lines.length) {
      var line = lines[i];

      if (/^```/.test(line)) {
        closeList();
        var lang = line.slice(3).trim();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html.push('<pre><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' +
          esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      if (/^\s*$/.test(line)) { closeList(); i++; continue; }

      if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|/.test(lines[i + 1])) {
        closeList();
        var cells = line.split('|').slice(1, -1);
        var head = '<tr>' + cells.map(function (c) { return '<th>' + inline(c.trim()) + '</th>'; }).join('') + '</tr>';
        i += 2;
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) {
          var r = lines[i].split('|').slice(1, -1);
          rows.push('<tr>' + r.map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>');
          i++;
        }
        html.push('<table><thead>' + head + '</thead><tbody>' + rows.join('') + '</tbody></table>');
        continue;
      }

      var heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        var level = heading[1].length;
        html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        closeList();
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
        html.push('<blockquote>' + inline(quote.join(' ')) + '</blockquote>');
        continue;
      }

      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { closeList(); html.push('<hr>'); i++; continue; }

      /*
       * A four-space indent is a code block. Without this the indented
       * examples in the project's own documents fall through to the
       * paragraph rule below and lose every line break.
       */
      var indented = line.match(/^ {4}(.*)$/);
      if (indented) {
        closeList();
        var block = [indented[1]];
        i++;
        while (i < lines.length && (/^ {4}/.test(lines[i]) || /^\s*$/.test(lines[i]))) {
          block.push(lines[i].replace(/^ {4}/, ''));
          i++;
        }
        html.push('<pre><code>' + esc(block.join('\n').replace(/\n+$/, '')) + '</code></pre>');
        continue;
      }

      var bullet = line.match(/^\s*[-*]\s+(.*)$/);
      var ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || ordered) {
        var want = bullet ? 'ul' : 'ol';
        if (list !== want) { closeList(); html.push('<' + want + '>'); list = want; }
        var item = [(bullet || ordered)[1]];
        i++;
        /*
         * A wrapped item keeps its continuation lines: the indentation a
         * writer uses is what CommonMark calls the block's content column,
         * and a line indented to that column belongs to the item above it.
         */
        while (i < lines.length && !/^\s*$/.test(lines[i]) &&
               !/^(#{1,6}\s|>|\s*```|\||\s*\d+[.)]\s|\s*[-*]\s)/.test(lines[i]) &&
               /^ {2,}/.test(lines[i])) {
          item.push(lines[i].trim());
          i++;
        }
        html.push('<li>' + inline(item.join(' ')) + '</li>');
        continue;
      }

      closeList();
      var para = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#|>|```|\||\s*[-*]\s|\s*\d+[.)]\s| {4}\S)/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      html.push('<p>' + inline(para.join(' ')) + '</p>');
    }
    closeList();
    return html.join('\n');
  }

  function renderMarkdown(host, source) { host.innerHTML = markdown(source); }

  // ------------------------------------------------------------ page helpers

  function crumbs(host, items) {
    var box = el('div', { class: 'crumbs' });
    items.forEach(function (item, index) {
      if (index) box.appendChild(document.createTextNode(' / '));
      if (item.route) box.appendChild(link(page(item.route), item.label));
      else box.appendChild(document.createTextNode(item.label));
    });
    host.appendChild(box);
  }

  function loading(host, what) {
    clear(host);
    host.appendChild(el('div', { class: 'empty' }, [el('span', { class: 'spinner' }), ' ' + (what || t('loadingDefault'))]));
  }

  function failure(host, message) {
    clear(host);
    host.appendChild(el('div', { class: 'note bad', text: message }));
  }

  function productBySlug(slug) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].slug === slug) return PRODUCTS[i];
    return null;
  }

  /*
   * Pick the asset for a platform. The installers are named
   * <Product>_<version>_<platform>_setup.exe, so the platform is read out of
   * the name rather than guessed from the release.
   */
  function assetsFor(release, platform) {
    var wanted = platform || settings().downloadPlatform;
    var out = [];
    (release.assets || []).forEach(function (asset) {
      var name = asset.name || '';
      if (!/\.(exe|msi|zip|7z)$/i.test(name)) return;
      var lower = name.toLowerCase();
      var matches = lower.indexOf(wanted.toLowerCase()) >= 0;
      if (!matches && wanted === 'win64') matches = /win64|windows-x64|x64/.test(lower);
      if (matches) out.push(asset);
    });
    if (!out.length) {
      (release.assets || []).forEach(function (asset) {
        if (/\.(exe|msi)$/i.test(asset.name || '')) out.push(asset);
      });
    }
    return out;
  }

  /*
   * Fill in every element carrying data-t="key".
   *
   * This is the one place markup is written from a string. It is allowed
   * because the strings come from the table above, which is part of this site -
   * not from GitHub, not from a package name, not from anything a user typed.
   * Anything that did come from outside is still written with textContent.
   */
  function applyTranslations() {
    var nodes = document.querySelectorAll('[data-t]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var key = node.getAttribute('data-t');
      if (key) node.innerHTML = t(key);
    }
  }

  // ------------------------------------------------------------ product cards

  /*
   * One product, one card, and the whole card is the link. It points at the
   * product's own repository rather than at a file kept here, because the
   * release that is current today is not the one that will be current
   * tomorrow, and a link baked into this page would be wrong the first time
   * that changes.
   */
  function productHref(p) {
    /*
     * On the download index the card opens the product's own download page,
     * which lists every version and platform. Anywhere else it opens the
     * release itself, the one link that cannot go stale.
     */
    var here = location.pathname.replace(/\/+$/, '');
    if (p.standalone) {
      /* No installer ships for this product, so there is no download page to
       * open: the card goes to the repository, which always exists. */
      return mirror('https://github.com/zssx-2026/' + p.repo);
    }
    if (/(^|\/)download$/.test(here) || /(^|\/)download\/index\.html$/.test(here)) {
      return page('/download/' + p.slug + '/');
    }
    return source().releasePage
      ? source().releasePage(p.repo, RELEASE_TAG)
      : mirror('https://github.com/zssx-2026/' + p.repo + '/releases/tag/' + RELEASE_TAG);
  }

  function tagline(p) {
    return (lang() === 'zh' && p.taglineZh) ? p.taglineZh : p.tagline;
  }

  function productCard(p) {
    var card = el('a', { class: 'product pcard', href: productHref(p), title: p.name });
    card.appendChild(el('img', {
      class: 'icon', src: BASE + '/assets/icons/' + p.short + '.svg',
      alt: '', width: '48', height: '48', loading: 'lazy'
    }));
    card.appendChild(el('div', { class: 'tag', text: p.short }));
    card.appendChild(el('h3', { text: p.name }));
    card.appendChild(el('p', { class: 'tagline', text: tagline(p) }));
    card.appendChild(el('div', { class: 'row platforms' }, [
      el('span', { class: 'pill', text: t('winX64') }),
      el('span', { class: 'pill', text: t('selfContained') })
    ]));
    return card;
  }

  function cards(host) {
    clear(host);
    PRODUCTS.forEach(function (p) { host.appendChild(productCard(p)); });
  }

  /* assets/sources.js is the canonical resolver; a page that did not load it
   * still gets the same contract here, so a content URL can never silently
   * stay on the wrong host. */
  if (!I.sources) {
    I.sources = {
      github: buildFallback('en'),
      gitee: buildFallback('zh'),
      source: fallbackSource,
      other: function (lang) { return buildFallback(lang === 'zh' ? 'en' : 'zh'); },
      mirror: fallbackMirror,
      normalizeReleases: fallbackNormalize
    };
  }

  window.INFINITY = Object.assign(window.INFINITY || {}, {
    BASE: BASE,
    source: source,
    BASE_PATH: BASE_PATH,
    RELEASE_TAG: RELEASE_TAG,
    PRODUCTS: PRODUCTS,
    productHref: productHref,
    productCard: productCard,
    cards: cards,
    tagline: tagline,
    applyTranslations: applyTranslations,
    page: page,
    el: el,
    clear: clear,
    link: link,
    nav: nav,
    footer: footer,
    crumbs: crumbs,
    loading: loading,
    failure: failure,
    gh: gh,
    releases: releases,
    repoInfo: repoInfo,
    t: t,
    lang: lang,
    inChinese: inChinese,
    mirror: mirror,
    applyMirror: applyMirror,
    otherLanguageHref: otherLanguageHref,
    fmtSize: fmtSize,
    fmtDate: fmtDate,
    fmtCount: fmtCount,
    esc: esc,
    markdown: markdown,
    renderMarkdown: renderMarkdown,
    productBySlug: productBySlug,
    assetsFor: assetsFor,
    settings: settings,
    saveSettings: saveSettings,
    applyTheme: applyTheme,
    toggleTheme: toggleTheme,
    token: function () { return token; },
    setToken: setToken,
    signOut: signOut,
    verify: verify,
    requireAuth: requireAuth,
    user: function () { return user; },
    decodePayload: decodePayload
  });

  /*
   * Renders happen after load as well (the download table fills in when its
   * data arrives), so keep re-applying on new nodes instead of only once.
   */
  (function watch() {
    var run = function () { applyMirror(document); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
    if (window.MutationObserver) {
      new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
    }
  })();
})();
