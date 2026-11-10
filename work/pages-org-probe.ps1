$ErrorActionPreference='Stop'
$nl=[string][char]10
$req='protocol=https'+$nl+'host=github.com'+$nl+$nl
$cred=($req | git credential fill) -split $nl
$tok=(($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=','').Trim()
if(-not $tok){'NO-TOKEN';exit 2}
$H=@{Authorization='Bearer '+$tok;'User-Agent'='infinity-pages';Accept='application/vnd.github+json'}
$org=Invoke-RestMethod -Uri 'https://api.github.com/orgs/Infinity-Studio-craft' -Headers $H
'ORG login='+$org.login+' repos='+$org.public_repos+' plan='+$org.plan.name
$repos=Invoke-RestMethod -Uri 'https://api.github.com/orgs/Infinity-Studio-craft/repos?per_page=100' -Headers $H
'ORG-REPOS '+(@($repos).Count)
foreach($r in @($repos)){ '  '+$r.name+' '+$r.size+'KB' }
try { $p=Invoke-RestMethod -Uri 'https://api.github.com/repos/Infinity-Studio-craft/infinity-studio-craft.github.io/pages' -Headers $H; 'PAGES '+$p.status+' '+$p.html_url } catch { 'PAGES-NONE '+$_.Exception.Response.StatusCode.value__ }