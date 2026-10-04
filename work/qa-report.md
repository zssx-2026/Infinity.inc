# Infinity.Inc v1.0.0-pre4 独立 QA 验证报告

- 角色：独立 QA（只读验证；除本报告与 work/_qacheck/ 下的下载件外未改动仓库内容）
- 工作目录：D:/dev/DeepSeekHarnessWorkspace/Infinity.inc
- 验证时间：2026-10-04 15:14–15:36 (Asia/Shanghai)
- 事实源：cpp/release/v1.0pre4/release-assets.json
- 下载目录：work/_qacheck/（pre4 6 个）与 work/_qacheck/pre3/（pre3 4 个，附加验证）
- 环境：Windows / PowerShell 5.1 / curl.exe 8.21.0 / node v24.19.0；出口 HTTP 代理 127.0.0.1:38457，curl 需 --ssl-no-revoke
- 令牌：EV_GH_TOKEN 经 [Environment]::GetEnvironmentVariable('EV_GH_TOKEN','User') 读取，仅用于 api.github.com 请求，未在输出中打印。

## 总览

| # | 检查项 | 结论 |
|---|--------|------|
| 1 | curl -L 下载 6 个 pre4 资产 | **PASS** |
| 2 | 本地 SHA-256 / FNV-1a 与 release-assets.json 记录一致 | **PASS** |
| 3 | 本地 SHA-256 = 记录 = GitHub release API digest（三方一致） | **PASS** |
| 4 | 各 repo v1.0.0-pre4 的 tag_name / prerelease / asset 数 / 大小 | **PASS** |
| 5 | v1.0.0-pre3 未被改动（存在者逐字节一致；Toolbox/Games 本就不存在 pre3） | **PASS** |
| 6 | 首页与 6 个 download/<slug>/ 页面可访问、目标产品对应正确 | **PASS** |
| 7 | 下载页整卡超链接指向对应产品自己的 Release 页 | **PASS**（附 NOTE-1 / NOTE-2） |
| 8 | /infinity/nope-xyz/ 响应体含跳转 https://zssx-2026.github.io/404 的脚本 | **PASS** |

**FAIL 项：无。** 以下为逐项证据；观察与限制见第 7 节。

## 1. 资产下载（任务 1）

命令（对记录中 6 个资产各执行一次，URL 取自记录 `url` 字段）：

```powershell
curl.exe -s -L --ssl-no-revoke --max-time 120 -w "HTTPCODE=%{http_code};SIZE=%{size_download}" -o work/_qacheck/<name> <url>
```

原始输出：

```text
InfinityCloud_1.0.0-pre4_win64_setup.exe | HTTPCODE=200;SIZE=477846 | local=477846
InfinityFileManager_1.0.0-pre4_win64_setup.exe | HTTPCODE=200;SIZE=235017 | local=235017
InfinityPackageManager_1.0.0-pre4_win64_setup.exe | HTTPCODE=200;SIZE=278021 | local=278021
InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | HTTPCODE=200;SIZE=302978 | local=302978
InfinityToolbox_1.0.0-pre4_win64_setup.exe | HTTPCODE=200;SIZE=262473 | local=262473
InfinityGames_1.0.0-pre4_win64_setup.exe | HTTPCODE=200;SIZE=262882 | local=262882
```

6/6 HTTP 200，下载字节数与记录 size 全部一致。

## 2. 本地哈希与三方比对（任务 1）

本地 SHA-256 用两种独立方式计算并交叉一致：Get-FileHash -Algorithm SHA256 与 node crypto.createHash('sha256')。FNV-1a 采用与 cpp/tools/manifest.mjs 完全相同的实现（h=0x811c9dc5; h^=b; h=Math.imul(h,0x01000193) 无符号; toString(16).padStart(8,'0')）。

原始输出（node 本地重算，格式 name|size|sha256|fnv1a）：

```text
InfinityCloud_1.0.0-pre4_win64_setup.exe|477846|732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5|0b904434
InfinityFileManager_1.0.0-pre4_win64_setup.exe|235017|a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae|4a4875f8
InfinityPackageManager_1.0.0-pre4_win64_setup.exe|278021|56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7|c3e7e13a
InfinityInstallerManager_1.0.0-pre4_win64_setup.exe|302978|08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2|8371a812
InfinityToolbox_1.0.0-pre4_win64_setup.exe|262473|4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2|24c8c25f
InfinityGames_1.0.0-pre4_win64_setup.exe|262882|96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456|b64cef09
```

### 2.1 三方比对表（记录 vs 本地 vs GitHub API digest）

| 资产 | size 记录/本地/API | SHA-256 记录 = 本地 = API digest | FNV-1a 记录 = 本地 | 结论 |
|------|-------------------|----------------------------------|-------------------|------|
| InfinityCloud_1.0.0-pre4_win64_setup.exe | 477846/477846/477846 | 732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5 | 0b904434 | PASS |
| InfinityFileManager_1.0.0-pre4_win64_setup.exe | 235017/235017/235017 | a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae | 4a4875f8 | PASS |
| InfinityPackageManager_1.0.0-pre4_win64_setup.exe | 278021/278021/278021 | 56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7 | c3e7e13a | PASS |
| InfinityInstallerManager_1.0.0-pre4_win64_setup.exe | 302978/302978/302978 | 08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2 | 8371a812 | PASS |
| InfinityToolbox_1.0.0-pre4_win64_setup.exe | 262473/262473/262473 | 4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2 | 24c8c25f | PASS |
| InfinityGames_1.0.0-pre4_win64_setup.exe | 262882/262882/262882 | 96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456 | b64cef09 | PASS |

三方 SHA-256 完全一致，FNV-1a 与记录完全一致，size 三方一致。

## 3. GitHub Release API 核对（任务 2）

命令（每个 repo）：

```powershell
curl.exe -s --ssl-no-revoke -H "Authorization: Bearer $env:EV_GH_TOKEN" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/zssx-2026/<repo>/releases/tags/v1.0.0-pre4"
```

原始输出：

```text
Infinity-Cloud|v1.0.0-pre4|200|tag_name=v1.0.0-pre4|prerelease=True|draft=False|assets=1|InfinityCloud_1.0.0-pre4_win64_setup.exe:477846:sha256:732f909f578864f1ead0c9539d40aa4e075c26a319d385fad5bacf671d85f7a5
Infinity-File-Manager|v1.0.0-pre4|200|tag_name=v1.0.0-pre4|prerelease=True|draft=False|assets=1|InfinityFileManager_1.0.0-pre4_win64_setup.exe:235017:sha256:a6062187cb97e2c7f8732c17529932a2c8356fcc6c2b285a62f4de96caf3d5ae
InfinityPackageManager|v1.0.0-pre4|200|tag_name=v1.0.0-pre4|prerelease=True|draft=False|assets=1|InfinityPackageManager_1.0.0-pre4_win64_setup.exe:278021:sha256:56e8afb8bff30cee76c7cc2184fb37f43ef2ec203060261eec6e11cfac2c0ed7
Infinity-Installer-Manager|v1.0.0-pre4|200|tag_name=v1.0.0-pre4|prerelease=True|draft=False|assets=1|InfinityInstallerManager_1.0.0-pre4_win64_setup.exe:302978:sha256:08ce3a05d83e9d38b4fb696f156e580fcc04a9e30066a21c8a41f9061210d2f2
Infinity-Toolbox|v1.0.0-pre4|200|tag_name=v1.0.0-pre4|prerelease=True|draft=False|assets=1|InfinityToolbox_1.0.0-pre4_win64_setup.exe:262473:sha256:4827d87c0ab9eb8f319ee96d59062ffee350ff06e6c571d248d4a74f0fc789f2
Infinity-Games|v1.0.0-pre4|200|tag_name=v1.0.0-pre4|prerelease=True|draft=False|assets=1|InfinityGames_1.0.0-pre4_win64_setup.exe:262882:sha256:96f0eb3e4e97044a8c02a4e06dba5a5f4b97de853a45ceba398ff07bfcfb9456
```

| repo | HTTP | tag_name | prerelease | draft | asset 数 | 大小与记录一致 | digest 与本地一致 | 结论 |
|------|------|----------|-----------|-------|---------|---------------|------------------|------|
| Infinity-Cloud | 200 | v1.0.0-pre4 | true | false | 1 | 是（477846） | 是 | PASS |
| Infinity-File-Manager | 200 | v1.0.0-pre4 | true | false | 1 | 是（235017） | 是 | PASS |
| InfinityPackageManager | 200 | v1.0.0-pre4 | true | false | 1 | 是（278021） | 是 | PASS |
| Infinity-Installer-Manager | 200 | v1.0.0-pre4 | true | false | 1 | 是（302978） | 是 | PASS |
| Infinity-Toolbox | 200 | v1.0.0-pre4 | true | false | 1 | 是（262473） | 是 | PASS |
| Infinity-Games | 200 | v1.0.0-pre4 | true | false | 1 | 是（262882） | 是 | PASS |

注：API 返回的 browser_download_url 与记录中的 url 逐字符一致。

## 4. v1.0.0-pre3 未被改动（任务 2）

原始输出（API tags/v1.0.0-pre3）：

```text
Infinity-Cloud|pre3|InfinityCloud_1.0.0-pre3_win64_setup.exe|441856|sha256:8837d69f9a7caf858a3f075872d3d81d7ad484ec56462b1d5805efb96c8e7a55|id=605584321|created=2026-10-02T12:37:28Z|updated=2026-10-02T12:37:29Z
Infinity-File-Manager|pre3|InfinityFileManager_1.0.0-pre3_win64_setup.exe|187658|sha256:390fcd1b0849f674b86dad90a8f6e29c7d4ce5fe5cfbba2d4d14c14f89cdb5d5|id=605584483|created=2026-10-02T12:37:33Z|updated=2026-10-02T12:37:34Z
InfinityPackageManager|pre3|InfinityPackageManager_1.0.0-pre3_win64_setup.exe|241405|sha256:e92d805e6119350e94f15a3aecb38ffe6542d1b52b97e79cd570e18a88376046|id=605584648|created=2026-10-02T12:37:38Z|updated=2026-10-02T12:37:38Z
Infinity-Installer-Manager|pre3|InfinityInstallerManager_1.0.0-pre3_win64_setup.exe|262570|sha256:c3ddb2be0da69ed40b0592f7c6345cd278fc0d30571fa4bab364e83d8da57d57|id=605584810|created=2026-10-02T12:37:43Z|updated=2026-10-02T12:37:43Z
Infinity-Toolbox|pre3|HTTP 404
Infinity-Games|pre3|HTTP 404
```

附加逐字节验证：按 asset id 经 https://api.github.com/repos/zssx-2026/<repo>/releases/assets/<id>（Accept: application/octet-stream）下载 4 个 pre3 资产，重算 FNV-1a 与 cpp/release/v1.0pre3/release-assets.json 比对，并重算 SHA-256 与 API digest 比对：

```text
InfinityCloud_1.0.0-pre3_win64_setup.exe|size 441856/441856|fnv 8326e783/8326e783|MATCH
InfinityFileManager_1.0.0-pre3_win64_setup.exe|size 187658/187658|fnv 07845dab/07845dab|MATCH
InfinityPackageManager_1.0.0-pre3_win64_setup.exe|size 241405/241405|fnv 933ef479/933ef479|MATCH
InfinityInstallerManager_1.0.0-pre3_win64_setup.exe|size 262570/262570|fnv 612d0a05/612d0a05|MATCH
```

| repo | pre3 HTTP | asset 名 | 数量 | 记录 size | API size | 记录 FNV-1a | 重算 FNV-1a | API digest = 重算 SHA-256 | 结论 |
|------|-----------|----------|------|-----------|----------|-------------|-------------|---------------------------|------|
| Infinity-Cloud | 200 | InfinityCloud_1.0.0-pre3_win64_setup.exe | 1 | 441856 | 441856 | 8326e783 | 8326e783 | 是（8837d69f…） | PASS |
| Infinity-File-Manager | 200 | InfinityFileManager_1.0.0-pre3_win64_setup.exe | 1 | 187658 | 187658 | 07845dab | 07845dab | 是（390fcd1b…） | PASS |
| InfinityPackageManager | 200 | InfinityPackageManager_1.0.0-pre3_win64_setup.exe | 1 | 241405 | 241405 | 933ef479 | 933ef479 | 是（e92d805e…） | PASS |
| Infinity-Installer-Manager | 200 | InfinityInstallerManager_1.0.0-pre3_win64_setup.exe | 1 | 262570 | 262570 | 612d0a05 | 612d0a05 | 是（c3ddb2be…） | PASS |
| Infinity-Toolbox | 404 | （无 pre3 release/tag） | 0 | — | — | — | — | — | PASS（本就不存在） |
| Infinity-Games | 404 | （无 pre3 release/tag） | 0 | — | — | — | — | — | PASS（本就不存在） |

说明：Toolbox 与 Games 两个仓库的 created_at 为 2026-10-03T13:14Z，晚于 pre3 发布（2026-10-02），且本地 cpp/release/v1.0pre3/release-assets.json 仅含 4 个应用。因此 v1.0.0-pre3 在 Toolbox/Games 上返回 404 属预期，不是“被删改”。存在的 4 个 pre3 资产 updated_at 仍为 2026-10-02，未受 pre4 发布影响。

## 5. 站点页面与整卡超链接（任务 3）

### 5.1 页面可达性

```text
index | HTTP=200 | <title>Infinity.Inc - the Infinity suite</title>
infinitycloud | HTTP=200 | <title>Infinity Cloud - Infinity.Inc</title>
infinityfilemanager | HTTP=200 | <title>Infinity File Manager - Infinity.Inc</title>
infinitypackagemanager | HTTP=200 | <title>InfinityPackageManager - Infinity.Inc</title>
infinityinstallmanager | HTTP=200 | <title>Infinity Installer Manager - Infinity.Inc</title>
infinitytoolbox | HTTP=200 | <title>Infinity Toolbox - Infinity.Inc</title>
infinitygames | HTTP=200 | <title>Infinity Games - Infinity.Inc</title>
```

### 5.2 下载页整卡链接的实现

下载页 HTML 是空壳（`<main id="app"></main>`），由 assets/product.js 渲染；整张卡片是一个 a 元素，其 href 由 assets/site.js 的 productHref() 生成：

```javascript
function productHref(p) {
  return 'https://github.com/zssx-2026/' + p.repo + '/releases/latest';
}

function productCard(p) {
  var card = el('a', { class: 'product pcard', href: productHref(p), title: p.name });
  ...
}
```

slug 到 repo 的映射取自 site.js 的 PRODUCTS 表（productBySlug(slug) 按下载页路径最后一段匹配）：

| 下载页 slug | HTTP | 页面 title 对应产品 | PRODUCTS.repo | 整卡 href（拼接结果） | 是否指向自身 repo | 结论 |
|-------------|------|---------------------|---------------|----------------------|------------------|------|
| infinitycloud | 200 | Infinity Cloud | Infinity-Cloud | https://github.com/zssx-2026/Infinity-Cloud/releases/latest | 是 | PASS |
| infinityfilemanager | 200 | Infinity File Manager | Infinity-File-Manager | https://github.com/zssx-2026/Infinity-File-Manager/releases/latest | 是 | PASS |
| infinitypackagemanager | 200 | InfinityPackageManager | InfinityPackageManager | https://github.com/zssx-2026/InfinityPackageManager/releases/latest | 是 | PASS |
| infinityinstallmanager | 200 | Infinity Installer Manager | Infinity-Installer-Manager | https://github.com/zssx-2026/Infinity-Installer-Manager/releases/latest | 是 | PASS |
| infinitytoolbox | 200 | Infinity Toolbox | Infinity-Toolbox | https://github.com/zssx-2026/Infinity-Toolbox/releases/latest | 是 | PASS |
| infinitygames | 200 | Infinity Games | Infinity-Games | https://github.com/zssx-2026/Infinity-Games/releases/latest | 是 | PASS |

卡片目标 URL 可达性（GitHub 跟随重定向后的落点）：

```text
Infinity-Cloud | 200 final=https://github.com/zssx-2026/Infinity-Cloud/releases/tag/v1.0pre1
Infinity-File-Manager | 200 final=https://github.com/zssx-2026/Infinity-File-Manager/releases/tag/v1.0pre1
InfinityPackageManager | 200 final=https://github.com/zssx-2026/InfinityPackageManager/releases/tag/v1.0pre1
Infinity-Installer-Manager | 200 final=https://github.com/zssx-2026/Infinity-Installer-Manager/releases
Infinity-Toolbox | 200 final=https://github.com/zssx-2026/Infinity-Toolbox/releases
Infinity-Games | 200 final=https://github.com/zssx-2026/Infinity-Games/releases
```

结论：6 个下载页的整卡超链接均指向「该产品自己的仓库」的 Release 页，没有串仓（例如 Cloud 的卡不会指向 File-Manager）。**PASS**（关于落点不是 pre4，见 NOTE-1）。

### 5.3 首页（附加核对）

首页产品卡 href = I.page('/download/' + p.slug + '/')，即指向该产品自己的下载页（不是 Release 页，属站点设计）；首页 Latest releases 表的 release notes 链接使用各产品自身 repo 的 latest.html_url。未发现串链。

## 6. /infinity/nope-xyz/ 的 404 跳转（任务 3）

```text
curl.exe -s -L --ssl-no-revoke -w "HTTP=%{http_code}" "https://zssx-2026.github.io/infinity/nope-xyz/"
-> 响应 HTTP 404，响应体为仓库根 404 处理页，含脚本：
```

```javascript
(function () {
  var path = location.pathname;
  if (path.indexOf('/infinity/') === 0 || path === '/infinity') {
    location.replace('https://zssx-2026.github.io/404');
    return;
  }
})();
```

直接 GET https://zssx-2026.github.io/404 返回 HTTP 200。**PASS**

## 7. 观察与限制（NOTES）

**NOTE-1（非 FAIL，建议跟进）**：整卡用的是 /releases/latest。GitHub 的 latest 只解析「最新的非预发布 release」。本案 pre4/pre3 均为 prerelease=true，因此：
- Infinity-Cloud / Infinity-File-Manager / InfinityPackageManager 的 /releases/latest 落到旧的 v1.0pre1（该 tag prerelease=false、40 个资产），而不是本次验证的 v1.0.0-pre4；
- Infinity-Installer-Manager / Infinity-Toolbox / Infinity-Games 只有预发布 release，/releases/latest 落到 /releases 列表页。
链接始终位于「对应产品自己的仓库」内（满足任务判定），但下载页文案 the card opens its latest release on GitHub 对当前以预发布为主的套件并不精确。是否改为 /releases 或指向具体 tag，交由发布方决定。

**NOTE-2（方法限制）**：下载页由浏览器端 JS 渲染，curl 只能取到 HTML 空壳，无法断言渲染后的 DOM。本节结论来自：①渲染逻辑源码（productHref / productCard）；②PRODUCTS 的 slug 到 repo 映射逐条核对；③把拼接出的目标 URL 实际请求并跟随重定向确认落在该产品自身仓库。三者互证。

**NOTE-3（环境）**：curl 经本机代理 127.0.0.1:38457。对 github.com 的下载在验证后半段一度返回 HTTP 502（代理侧无法连接 20.205.243.166:443），故 pre3 的 4 个资产改用 api.github.com/repos/.../releases/assets/<id> 下载成功；pre4 的 6 个资产全程用 browser_download_url 直达成功。方法差异不影响任何哈希结论。

## 8. 结论

任务 1 / 2 / 3 的全部检查项 **PASS**，**无 FAIL**。
- 6 个 pre4 安装包：记录、本地重算（SHA-256 与 FNV-1a）、GitHub release API digest 三方完全一致；
- 6 个 repo 的 v1.0.0-pre4：tag_name 正确、prerelease=true、asset 数=1、大小一致；
- v1.0.0-pre3：存在的 4 个资产逐字节未变，Toolbox/Games 本就不存在 pre3（预期）；
- 站点：7 个页面均 200，6 个下载页整卡链接各自指向对应产品自己的仓库 Release 页，未知路径按设计跳转 /404。

