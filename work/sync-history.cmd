@echo off
cd /d D:\dev\DeepSeekHarnessWorkspace\Infinity.inc
"D:\program\nodejs\node.exe" work\sync-history.mjs --quiet >> work\history-sync.log 2>&1
"D:\program\nodejs\node.exe" work\build-manifest.mjs --quiet --verify 0 >> work\history-sync.log 2>&1
