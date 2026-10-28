$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$nodeVersion = (Get-Content -LiteralPath (Join-Path $projectRoot '.node-version') -Raw).Trim()
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($nodeVersion -notmatch '^\d+\.\d+\.\d+$' -or $package.packageManager -notmatch '^npm@\d+\.\d+\.\d+$') { throw 'Invalid pinned toolchain version' }
# workerd on Windows ARM requires x64; use the same architecture for npm installs.
$toolsRoot = Join-Path $projectRoot '.tools/node-x64'
$archiveName = "node-v$nodeVersion-win-x64.zip"
$runtimeRoot = Join-Path $toolsRoot "node-v$nodeVersion-win-x64"
$node = Join-Path $runtimeRoot 'node.exe'
if (!(Test-Path -LiteralPath $node)) {
    New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
    $archive = Join-Path $toolsRoot $archiveName
    $baseUrl = "https://nodejs.org/dist/v$nodeVersion"
    $checksums = (Invoke-WebRequest "$baseUrl/SHASUMS256.txt").Content
    $entry = ($checksums -split "`n") | Where-Object { $_.Trim().EndsWith("  $archiveName") }
    if (@($entry).Count -ne 1) { throw 'Official Node checksum missing or ambiguous' }
    $expected = ($entry.Trim() -split '\s+')[0]
    Invoke-WebRequest "$baseUrl/$archiveName" -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Node checksum mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath $toolsRoot -Force
}
$env:Path = "$runtimeRoot;$env:Path"
$npmCli = Join-Path $runtimeRoot 'node_modules/npm/bin/npm-cli.js'
$npmVersion = $package.packageManager.Substring(4)
if ((& $node $npmCli --version) -ne $npmVersion) {
    & $node $npmCli install --global --prefix $runtimeRoot $package.packageManager --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm toolchain installation failed' }
}
& $node --version
& $node $npmCli --version
Write-Output 'Project toolchain ready. Dot-source this script to keep PATH in the current PowerShell session.'
