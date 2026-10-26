param([string]$Repo = (Join-Path $PSScriptRoot "..") )

$repo = (Resolve-Path $Repo).Path
$src = Join-Path $env:USERPROFILE ".dsh\plugins"
$dst = Join-Path $repo "plugins"

$names = @(
  "dsh-agent-md","dsh-amiko-p0","dsh-bili-whale","dsh-feiyu-mood",
  "dsh-fish-memory","dsh-persona-dafeiyu","dsh-qq-bridge",
  "dsh-qq-media","dsh-qq-session-opener","dsh-qq-session-resumer",
  "dsh-qq-social","dsh-speak-up"
)

New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($n in $names) {
  $from = Join-Path $src $n
  if (Test-Path $from) {
    Copy-Item $from (Join-Path $dst $n) -Recurse -Force
  }
}
$tone = Join-Path $src "dsh-fish-tone\packages\dsh-fish-tone"
if (Test-Path $tone) { Copy-Item $tone (Join-Path $dst "dsh-fish-tone") -Recurse -Force }
Get-ChildItem $dst -Recurse -Directory -Force | Where-Object { $_.Name -in @("node_modules",".git",".pnpm","__pycache__") } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "plugins synced to $dst"
