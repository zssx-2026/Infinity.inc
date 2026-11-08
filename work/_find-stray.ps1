$rows = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'gate-test' -or $_.CommandLine -match 'work\\verify\.js' -or $_.CommandLine -match 'pwsh-132') }
if (-not $rows) { 'NO STRAY MATCH' } else { foreach ($r in $rows) { '{0} | {1} | {2} | start={3}' -f $r.ProcessId, $r.Name, ($r.CommandLine -replace '\s+',' ').Substring(0, [Math]::Min(150, ($r.CommandLine -replace '\s+',' ').Length)), $r.CreationDate } }
''
'node processes newer than 40 min:'
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddMinutes(-40) } | ForEach-Object { '{0} start={1}' -f $_.Id, $_.StartTime.ToString('HH:mm:ss') }