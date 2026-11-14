
$urls = @(
 'https://ghfast.top/https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe',
 'https://gh-proxy.com/https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe',
 'https://ghproxy.net/https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe',
 'https://hub.gitmirror.com/https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe',
 'https://gh.llkk.cc/https://github.com/zssx-2026/Infinity-Server/releases/download/v1.0.0-pre8/InfinityServer_1.0.0-pre8_win64_setup.exe'
)
foreach ($u in $urls) {
  $tag = $u.Split('/')[2]
  $r = & curl.exe -sS -o NUL --max-time 12 -w '%{http_code} bytes=%{size_download} speed=%{speed_download} t=%{time_total}' -r 0-1048575 $u 2>&1
  Write-Output ($tag + ' -> ' + ($r -join ' '))
}
