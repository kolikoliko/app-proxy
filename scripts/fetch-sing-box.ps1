$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$metadataPath = Join-Path $projectRoot "src-tauri\sing-box.version.json"
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$binaryDirectory = Join-Path $projectRoot "src-tauri\binaries"
$binaryPath = Join-Path $binaryDirectory "sing-box-x86_64-pc-windows-msvc.exe"
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("app-proxy-sing-box-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $temporaryDirectory $metadata.asset

New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
try {
    & curl.exe --location --fail --retry 3 --retry-delay 2 --output $archivePath $metadata.url
    if ($LASTEXITCODE -ne 0) {
        throw "下载 sing-box 失败，curl.exe 退出代码：$LASTEXITCODE"
    }
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $metadata.sha256.ToLowerInvariant()) {
        throw "sing-box SHA-256 校验失败。期望 $($metadata.sha256)，实际 $actualHash"
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $temporaryDirectory
    $sourceBinary = Get-ChildItem -LiteralPath $temporaryDirectory -Recurse -Filter "sing-box.exe" | Select-Object -First 1
    if (-not $sourceBinary) {
        throw "下载包内未找到 sing-box.exe"
    }

    New-Item -ItemType Directory -Path $binaryDirectory -Force | Out-Null
    Copy-Item -LiteralPath $sourceBinary.FullName -Destination $binaryPath -Force
    Write-Host "已安装 sing-box $($metadata.version)：$binaryPath"
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}
