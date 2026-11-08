# 归档健康面板：两个假失败与一次真修复

`work/archive-health.mjs` 报 `ARCHIVE-HEALTH-FAIL`，终验第 22 项随之掉到 22/23。
逐条查下来是**两个判据本身写错了**，归档一直健康。

## 假失败一：写死的 `-14`

原判据：

    manifest paths 26687 != header.files-14 26688

`header.files` 是"写过的条目总数"，manifest 是"去重后的路径数"，差值就是重复写入的路径条目。
这个数不是常量——早年是 9 条重复路径 / 14 条多余条目，后来变成 14。写死 `-14` 等于把
一次观测当成永久事实。

改法：让 manifest 自己报。`build-manifest.mjs` 现在额外写一份
`work/history-manifest-stats.json`（含 `entryLines` / `uniquePaths` / `duplicateEntries` /
`shadowedChunkIds` / `verified` / `verifyFailed`），健康面板读它而不是猜常量：

    duplicateEntries 14 | entryLines 26703 | uniquePaths 26689
    26689 === 26703 - 14  ✓

顺带省掉一次 300 MB 重扫——想了解归档形状不必再读整个文件。

## 假失败二：日志里两种行，取了最后一行

同步一轮写两行日志：`appended` 一行、`manifest` 一行，间隔几秒。面板只读"最后一行"，
于是一轮刚 append 完、manifest 还没重建时，它拿 append 行当 manifest 状态，
必然得出"manifest 落后"。

改法：按 action 各自取最后一条（`lastOf('appended')` / `lastOf('manifest')`）。

## 真修复：manifest 重建本来就不记日志

修完上面两条后暴露出真问题：`build-manifest.mjs` 从不往 `work/history-sync.log` 写东西
（只有 `sync-history.mjs` 写），所以"最近一轮 manifest"永远是上一轮的，
`lastManifest.archiveBytes 299990897 != lastAppend.archiveBytes 300024892` 是真的落后。

改法：manifest 重建也往同一日志文件追加同样形状的一行（与 `sync-history.cmd` 里
`build-manifest.mjs --quiet --verify 0 >> work/history-sync.log` 的顺序一致）。
写日志失败不阻断已经成功的重建。

## 顺带：日志被崩溃栈污染

此前一次 `build-manifest.mjs` 报错（`ReferenceError: path is not defined`，补 `import path`
已修），stderr 也重定向进了同一个日志文件，于是 311 行里有 67 行不是 JSON，
`JSON.parse` 直接把面板炸了。

改法两处：
- 清洗现有日志，只保留 JSON 行（311 → 244 行）；
- 面板只读以 `{` 开头的行，且 `JSON.parse` 包 try/catch —— 管道崩一次不该让整个面板不可读。

## 现状

    node work/archive-health.mjs   → ARCHIVE-HEALTH-PASS

    archiveBytes   300,024,892
    header         files 26703 / chunks 215 / snapshots 115 / origBytes 1,646,714,798
    manifest       26,689 唯一路径（5,987,002 B）
    appendCount    105
    计划任务       Ready / lastResult 0 / nextRun 19:07
