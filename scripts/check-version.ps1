$ErrorActionPreference = "Stop"

# package.json is the canonical application version. All generated/package
# metadata must agree with it before a PR or release can pass the quality gate.
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
function Read-Utf8Json([string]$path) {
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
}

$package = Read-Utf8Json (Join-Path $projectRoot "package.json")
$packageLockRaw = Get-Content -LiteralPath (Join-Path $projectRoot "package-lock.json") -Raw
$tauri = Read-Utf8Json (Join-Path $projectRoot "src-tauri\tauri.conf.json")
$cargoToml = Get-Content -LiteralPath (Join-Path $projectRoot "src-tauri\Cargo.toml") -Raw
$cargoLock = Get-Content -LiteralPath (Join-Path $projectRoot "src-tauri\Cargo.lock") -Raw
$changelog = Get-Content -LiteralPath (Join-Path $projectRoot "CHANGELOG.md") -Raw

$canonical = [string]$package.version
if ($canonical -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') {
    throw "package.json version is not a valid semantic version: $canonical"
}

$packageLockVersions = [regex]::Matches($packageLockRaw, '"version"\s*:\s*"([^"]+)"')
if ($packageLockVersions.Count -lt 2) {
    throw "package-lock.json does not contain both root version declarations"
}

$cargoVersionMatch = [regex]::Match(
    $cargoToml,
    '(?ms)^\[package\]\s+name\s*=\s*"app-proxy"\s+version\s*=\s*"([^"]+)"'
)
$cargoLockVersionMatch = [regex]::Match(
    $cargoLock,
    '(?ms)^\[\[package\]\]\s+name\s*=\s*"app-proxy"\s+version\s*=\s*"([^"]+)"'
)
$changelogVersionMatch = [regex]::Match(
    $changelog,
    '(?m)^##\s+v?([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\b'
)

$declared = [ordered]@{
    "package.json" = [string]$package.version
    "package-lock.json" = $packageLockVersions[0].Groups[1].Value
    "package-lock.json (root package)" = $packageLockVersions[1].Groups[1].Value
    "src-tauri/tauri.conf.json" = [string]$tauri.version
    "src-tauri/Cargo.toml" = $cargoVersionMatch.Groups[1].Value
    "src-tauri/Cargo.lock" = $cargoLockVersionMatch.Groups[1].Value
    "CHANGELOG.md (first release heading)" = $changelogVersionMatch.Groups[1].Value
}

$errors = @(
    $declared.GetEnumerator() |
        Where-Object { [string]::IsNullOrWhiteSpace($_.Value) -or $_.Value -ne $canonical } |
        ForEach-Object { "$($_.Key) declares '$($_.Value)', expected '$canonical'" }
)
if ($errors.Count -gt 0) {
    throw "Version consistency check failed:`n$($errors -join "`n")"
}

Write-Host "Version consistency check passed: $canonical"
