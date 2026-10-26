param([string]$Repo = (Join-Path $PSScriptRoot "..") )

$repo = (Resolve-Path $Repo).Path
$src = Join-Path $env:USERPROFILE ".dsh\plugins"
$dst = Join-Path $repo "plugins"

$names = @(
  "dsh-agent-md","dsh-amiko-p0","dsh-amiko-p1","dsh-bili-whale",
  "dsh-feiyu-mood","dsh-fish-memory","dsh-qq-bridge","dsh-qq-media",
  "dsh-qq-session-resumer","dsh-qq-social"
)

New-Item -ItemType Directory -Force -Path $dst | Out-Null
foreach ($n in $names) {
  $from = Join-Path $src $n
  if (Test-Path $from) {
    $to = Join-Path $dst $n
    if (Test-Path $to) { Remove-Item $to -Recurse -Force }
    Copy-Item $from $to -Recurse -Force
  }
}
$tone = Join-Path $src "dsh-fish-tone\packages\dsh-fish-tone"
if (Test-Path $tone) { $to = Join-Path $dst "dsh-fish-tone"; if (Test-Path $to) { Remove-Item $to -Recurse -Force }; Copy-Item $tone $to -Recurse -Force }
Get-ChildItem $dst -Recurse -Directory -Force | Where-Object { $_.Name -in @("node_modules",".git",".pnpm","__pycache__") } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Output "plugins synced to $dst"
