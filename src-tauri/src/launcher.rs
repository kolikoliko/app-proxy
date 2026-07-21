use crate::{icon_extractor, installed_apps, store::AppRule};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherConfig {
    display_name: String,
    executable_path: String,
    executable_name: String,
    package_family_name: Option<String>,
    application_id: Option<String>,
    proxy_url: String,
    chromium_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherResult {
    pub message: String,
    pub launcher_path: String,
    pub shortcut_path: Option<String>,
    pub chromium_mode: bool,
}

struct LauncherFiles {
    directory: PathBuf,
    script: PathBuf,
    command: PathBuf,
    config: PathBuf,
    icon_path: PathBuf,
    chromium_mode: bool,
}

pub fn launch_with_proxy(
    app: &AppHandle,
    rule: &AppRule,
    proxy_url: &str,
) -> Result<LauncherResult, String> {
    let files = write_launcher_files(app, rule, proxy_url)?;
    spawn_launcher(&files.script, &files.config)?;
    Ok(LauncherResult {
        message: format!(
            "已发送 {} 的环境代理启动请求{}；检测到已有进程时，启动器会询问是否关闭并重新启动",
            rule.display_name,
            if files.chromium_mode {
                "（已附加 Chromium 代理参数）"
            } else {
                ""
            }
        ),
        launcher_path: files.command.to_string_lossy().into_owned(),
        shortcut_path: None,
        chromium_mode: files.chromium_mode,
    })
}

pub fn create_desktop_launcher(
    app: &AppHandle,
    rule: &AppRule,
    proxy_url: &str,
) -> Result<LauncherResult, String> {
    let files = write_launcher_files(app, rule, proxy_url)?;
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|error| format!("无法确定桌面目录：{error}"))?;
    let shortcut = desktop.join(format!(
        "{} - 应用代理.lnk",
        sanitize_shortcut_name(&rule.display_name)
    ));
    let helper = files.directory.join("Create-Shortcut.ps1");
    write_utf8_bom(&helper, SHORTCUT_SCRIPT)?;
    let icon_path = shortcut_icon_path(rule, &files);

    let output = powershell_command()
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&helper)
        .arg("-ShortcutPath")
        .arg(&shortcut)
        .arg("-TargetPath")
        .arg(&files.command)
        .arg("-WorkingDirectory")
        .arg(&files.directory)
        .arg("-Description")
        .arg(format!(
            "使用 {} 启动 {}",
            proxy_display(proxy_url)?,
            rule.display_name
        ))
        .arg("-IconPath")
        .arg(&icon_path)
        .output()
        .map_err(|error| format!("无法创建桌面快捷方式：{error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "创建桌面快捷方式失败".into()
        } else {
            format!("创建桌面快捷方式失败：{detail}")
        });
    }

    Ok(LauncherResult {
        message: format!(
            "已创建“{} - 应用代理”桌面启动器；关闭应用代理后仍可使用",
            rule.display_name
        ),
        launcher_path: files.command.to_string_lossy().into_owned(),
        shortcut_path: Some(shortcut.to_string_lossy().into_owned()),
        chromium_mode: files.chromium_mode,
    })
}

fn shortcut_icon_path(rule: &AppRule, files: &LauncherFiles) -> PathBuf {
    let generated = files.directory.join("Application.ico");
    if rule.package_family_name.is_some() {
        let source = rule.executable_scope_root.as_deref().and_then(|root| {
            installed_apps::resolve_package_icon_path(root, rule.application_id.as_deref())
        });
        if source
            .as_deref()
            .is_some_and(|source| icon_extractor::write_png_as_ico(source, &generated).is_ok())
        {
            return generated;
        }
        if generated.is_file() {
            return generated;
        }
    }
    files.icon_path.clone()
}

fn write_launcher_files(
    app: &AppHandle,
    rule: &AppRule,
    proxy_url: &str,
) -> Result<LauncherFiles, String> {
    validate_launcher_proxy(proxy_url)?;
    let chromium_mode = is_chromium_like(rule);
    let executable_path = normalized_launcher_executable(rule, chromium_mode);
    if rule.package_family_name.is_none() && !Path::new(&executable_path).is_file() {
        return Err("目标程序不存在；请重新添加该应用".into());
    }
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法确定启动器目录：{error}"))?
        .join("launchers")
        .join(&rule.id);
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建启动器目录：{error}"))?;

    let config = LauncherConfig {
        display_name: rule.display_name.clone(),
        executable_path: executable_path.clone(),
        executable_name: rule.executable_name.clone(),
        package_family_name: rule.package_family_name.clone(),
        application_id: rule.application_id.clone(),
        proxy_url: proxy_url.to_string(),
        chromium_mode,
    };
    let config_path = directory.join("launcher.json");
    let config_json = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(&config_path, config_json).map_err(|error| format!("无法写入启动器配置：{error}"))?;

    let script = directory.join("Launch-With-Proxy.ps1");
    write_utf8_bom(&script, RUNTIME_SCRIPT)?;
    let command = directory.join("Launch-With-Proxy.cmd");
    fs::write(
        &command,
        b"@echo off\r\nsetlocal\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0Launch-With-Proxy.ps1\" -ConfigPath \"%~dp0launcher.json\"\r\n",
    )
    .map_err(|error| format!("无法写入启动器入口：{error}"))?;

    Ok(LauncherFiles {
        directory,
        script,
        command,
        config: config_path,
        icon_path: PathBuf::from(executable_path),
        chromium_mode,
    })
}

#[cfg(windows)]
fn spawn_launcher(script: &Path, config: &Path) -> Result<(), String> {
    powershell_command()
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(script)
        .arg("-ConfigPath")
        .arg(config)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法启动代理启动器：{error}"))
}

#[cfg(not(windows))]
fn spawn_launcher(_script: &Path, _config: &Path) -> Result<(), String> {
    Err("环境代理启动器当前仅支持 Windows".into())
}

#[cfg(windows)]
fn powershell_command() -> Command {
    let mut command = Command::new("powershell.exe");
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn powershell_command() -> Command {
    Command::new("powershell")
}

fn validate_launcher_proxy(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value)
        .map_err(|_| "代理地址格式无效，请使用 socks://主机:端口 或 http://主机:端口")?;
    if !matches!(parsed.scheme(), "socks" | "socks5" | "http") {
        return Err("环境启动器仅支持 SOCKS5 和 HTTP 代理".into());
    }
    if parsed.host_str().is_none() || parsed.port_or_known_default().is_none() {
        return Err("代理地址必须包含有效的主机和端口".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("为避免在桌面启动器中保存凭据，暂不支持带账号密码的代理地址".into());
    }
    Ok(parsed)
}

fn proxy_display(value: &str) -> Result<String, String> {
    let parsed = validate_launcher_proxy(value)?;
    Ok(format!(
        "{}:{}",
        parsed.host_str().unwrap_or_default(),
        parsed.port_or_known_default().unwrap_or_default()
    ))
}

fn is_chromium_like(rule: &AppRule) -> bool {
    if rule
        .package_family_name
        .as_deref()
        .is_some_and(|family| family.eq_ignore_ascii_case("OpenAI.Codex_2p2nqsd0c76g0"))
    {
        return true;
    }
    matches!(
        rule.executable_name.to_ascii_lowercase().as_str(),
        "chatgpt.exe"
            | "codex.exe"
            | "chrome.exe"
            | "msedge.exe"
            | "brave.exe"
            | "opera.exe"
            | "vivaldi.exe"
            | "code.exe"
            | "cursor.exe"
            | "discord.exe"
            | "slack.exe"
            | "teams.exe"
            | "ms-teams.exe"
    )
}

fn normalized_launcher_executable(rule: &AppRule, chromium_mode: bool) -> String {
    if !chromium_mode || rule.package_family_name.is_some() {
        return rule.executable_path.clone();
    }
    let path = Path::new(&rule.executable_path);
    let Some(version_directory) = path.parent() else {
        return rule.executable_path.clone();
    };
    let looks_versioned = version_directory
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            value.contains('.')
                && value
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '.')
        });
    if !looks_versioned {
        return rule.executable_path.clone();
    }
    let Some(application_directory) = version_directory.parent() else {
        return rule.executable_path.clone();
    };
    let stable = application_directory.join(&rule.executable_name);
    if stable.is_file() {
        stable.to_string_lossy().into_owned()
    } else {
        rule.executable_path.clone()
    }
}

fn sanitize_shortcut_name(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = sanitized.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        "应用".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn write_utf8_bom(path: &Path, content: &str) -> Result<(), String> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(content.as_bytes());
    fs::write(path, bytes).map_err(|error| format!("无法写入启动器脚本：{error}"))
}

const SHORTCUT_SCRIPT: &str = r#"param(
  [Parameter(Mandatory=$true)][string]$ShortcutPath,
  [Parameter(Mandatory=$true)][string]$TargetPath,
  [Parameter(Mandatory=$true)][string]$WorkingDirectory,
  [Parameter(Mandatory=$true)][string]$Description,
  [Parameter(Mandatory=$true)][string]$IconPath
)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $TargetPath
$shortcut.WorkingDirectory = $WorkingDirectory
$shortcut.Description = $Description
$shortcut.WindowStyle = 7
if (Test-Path -LiteralPath $IconPath) { $shortcut.IconLocation = "$IconPath,0" }
$shortcut.Save()
"#;

const RUNTIME_SCRIPT: &str = r#"param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'

function Show-LauncherMessage([string]$Message, [string]$Title, [int]$Icon) {
  $shell = New-Object -ComObject WScript.Shell
  $shell.Popup($Message, 0, $Title, $Icon) | Out-Null
}

function Test-TcpPort([string]$HostName, [int]$Port) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    return $task.Wait(1800) -and $client.Connected
  } catch { return $false } finally { $client.Dispose() }
}

function Resolve-Target($Config) {
  if ($Config.packageFamilyName) {
    $package = Get-AppxPackage -ErrorAction SilentlyContinue |
      Where-Object { $_.PackageFamilyName -eq $Config.packageFamilyName -and $_.InstallLocation } |
      Sort-Object Version -Descending | Select-Object -First 1
    if (-not $package) { throw "找不到 Microsoft Store 应用：$($Config.displayName)" }
    $manifestPath = Join-Path $package.InstallLocation 'AppxManifest.xml'
    [xml]$manifest = Get-Content -LiteralPath $manifestPath
    $applications = @($manifest.Package.Applications.Application) | Where-Object { $_.Executable }
    $application = if ($Config.applicationId) {
      $applications | Where-Object { $_.Id -eq $Config.applicationId } | Select-Object -First 1
    } else {
      $applications | Select-Object -First 1
    }
    if (-not $application) { throw "无法从应用清单解析启动入口：$($Config.displayName)" }
    $candidate = Join-Path $package.InstallLocation ($application.Executable -replace '/', '\')
    if (-not (Test-Path -LiteralPath $candidate)) { throw "应用入口不存在：$candidate" }
    return [PSCustomObject]@{ Path = $candidate; ScopeRoot = $package.InstallLocation }
  }
  if (-not (Test-Path -LiteralPath $Config.executablePath)) {
    throw "目标程序不存在：$($Config.executablePath)"
  }
  return [PSCustomObject]@{ Path = $Config.executablePath; ScopeRoot = $null }
}

function Get-RunningProcesses($TargetInfo, $Config) {
  $target = $TargetInfo.Path
  $scopeRoot = $TargetInfo.ScopeRoot
  $targetName = [IO.Path]::GetFileName($target)
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    if (-not $_.ExecutablePath) {
      $false
    } elseif ($scopeRoot) {
      $scopePrefix = $scopeRoot.TrimEnd('\') + '\'
      $_.ExecutablePath.StartsWith($scopePrefix, [StringComparison]::OrdinalIgnoreCase)
    } elseif ($Config.chromiumMode) {
      $_.Name.Equals($targetName, [StringComparison]::OrdinalIgnoreCase)
    } else {
      $_.ExecutablePath.Equals($target, [StringComparison]::OrdinalIgnoreCase)
    }
  })
}

try {
  $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $ConfigPath | ConvertFrom-Json
  $targetInfo = Resolve-Target $config
  $target = $targetInfo.Path
  $proxy = [Uri]$config.proxyUrl
  if (-not $proxy.IsAbsoluteUri -or $proxy.Port -le 0) { throw '代理地址格式无效' }
  if (-not (Test-TcpPort $proxy.Host $proxy.Port)) {
    Show-LauncherMessage "代理端口 $($proxy.Host):$($proxy.Port) 不可用。请先启动 Clash / Mihomo。" "$($config.displayName) Proxy" 16
    exit 2
  }

  $running = @(Get-RunningProcesses $targetInfo $config)
  if ($running.Count -gt 0) {
    $shell = New-Object -ComObject WScript.Shell
    $choice = $shell.Popup("$($config.displayName) 已有后台或窗口进程。是否立即关闭这些进程并使用代理重新启动？未保存的内容可能丢失。", 0, "$($config.displayName) Proxy", 4 + 32)
    if ($choice -ne 6) { exit 3 }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
      foreach ($process in $running) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
      }
      Start-Sleep -Milliseconds 250
      $running = @(Get-RunningProcesses $targetInfo $config)
    } while ($running.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
    if ($running.Count -gt 0) {
      throw "$($config.displayName) 的后台进程未能完全退出。请在应用设置中关闭后台运行或启动增强后重试。"
    }
  }

  $hostPort = "$($proxy.Host):$($proxy.Port)"
  if ($proxy.Scheme -in @('socks', 'socks5')) {
    $httpProxy = "http://$hostPort"
    $allProxy = "socks5://$hostPort"
    $chromiumProxy = "http=$hostPort;https=$hostPort;socks=$hostPort"
  } else {
    $httpProxy = "http://$hostPort"
    $allProxy = $httpProxy
    $chromiumProxy = "http=$hostPort;https=$hostPort"
  }
  $env:HTTP_PROXY=$httpProxy; $env:HTTPS_PROXY=$httpProxy; $env:ALL_PROXY=$allProxy
  $env:http_proxy=$httpProxy; $env:https_proxy=$httpProxy; $env:all_proxy=$allProxy
  $env:NO_PROXY='localhost,127.0.0.1,::1'; $env:no_proxy=$env:NO_PROXY

  $arguments = @()
  if ($config.chromiumMode) {
    $arguments += "--proxy-server=$chromiumProxy"
    $arguments += '--proxy-bypass-list=<-loopback>;localhost;127.0.0.1;::1'
  }
  if ($arguments.Count -gt 0) {
    Start-Process -FilePath $target -ArgumentList $arguments
  } else {
    Start-Process -FilePath $target
  }
} catch {
  Show-LauncherMessage $_.Exception.Message '应用代理启动器' 16
  exit 1
}
"#;

#[cfg(test)]
mod tests {
    use super::{
        is_chromium_like, normalized_launcher_executable, powershell_command,
        sanitize_shortcut_name, shortcut_icon_path, validate_launcher_proxy, write_utf8_bom,
        LauncherFiles, RUNTIME_SCRIPT, SHORTCUT_SCRIPT,
    };
    use crate::store::AppRule;

    fn rule(executable_name: &str, package_family_name: Option<&str>) -> AppRule {
        AppRule {
            id: "one".into(),
            display_name: "Test".into(),
            executable_path: format!(r"C:\Apps\{executable_name}"),
            executable_name: executable_name.into(),
            package_family_name: package_family_name.map(str::to_string),
            application_id: None,
            executable_scope_root: None,
            scope_executable_count: 0,
            enabled: true,
            pinned: true,
            created_at: "0".into(),
            updated_at: "0".into(),
        }
    }

    #[test]
    fn detects_chromium_and_codex_launchers() {
        assert!(is_chromium_like(&rule("chrome.exe", None)));
        assert!(is_chromium_like(&rule(
            "ChatGPT.exe",
            Some("OpenAI.Codex_2p2nqsd0c76g0")
        )));
        assert!(!is_chromium_like(&rule("notepad.exe", None)));
    }

    #[test]
    fn validates_safe_local_proxy_urls() {
        assert!(validate_launcher_proxy("socks://127.0.0.1:7890").is_ok());
        assert!(validate_launcher_proxy("http://127.0.0.1:7890").is_ok());
        assert!(validate_launcher_proxy("https://127.0.0.1:7890").is_err());
        assert!(validate_launcher_proxy("socks://user:secret@127.0.0.1:7890").is_err());
    }

    #[test]
    fn sanitizes_windows_shortcut_names() {
        assert_eq!(sanitize_shortcut_name("Chat:GPT?"), "Chat_GPT_");
        assert_eq!(sanitize_shortcut_name("..."), "应用");
    }

    #[test]
    fn chromium_versioned_executable_uses_stable_application_entry() {
        let directory = std::env::temp_dir().join(format!(
            "app-proxy-stable-entry-test-{}",
            uuid::Uuid::new_v4()
        ));
        let application = directory.join("Application");
        let version = application.join("150.0.4078.83");
        std::fs::create_dir_all(&version).unwrap();
        let stable = application.join("msedge.exe");
        let versioned = version.join("msedge.exe");
        std::fs::write(&stable, []).unwrap();
        std::fs::write(&versioned, []).unwrap();

        let mut edge = rule("msedge.exe", None);
        edge.executable_path = versioned.to_string_lossy().into_owned();
        assert_eq!(
            normalized_launcher_executable(&edge, true),
            stable.to_string_lossy()
        );

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn store_shortcut_uses_generated_manifest_icon() {
        let Some(scope) = crate::installed_apps::resolve_package_application(
            "OpenAI.Codex_2p2nqsd0c76g0",
            Some("App"),
        ) else {
            return;
        };
        let directory = std::env::temp_dir().join(format!(
            "app-proxy-store-shortcut-icon-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let mut chatgpt = rule("ChatGPT.exe", Some("OpenAI.Codex_2p2nqsd0c76g0"));
        chatgpt.application_id = Some("App".into());
        chatgpt.executable_path = scope.executable_path.clone();
        chatgpt.executable_scope_root = Some(scope.executable_scope_root);
        let files = LauncherFiles {
            directory: directory.clone(),
            script: directory.join("Launch-With-Proxy.ps1"),
            command: directory.join("Launch-With-Proxy.cmd"),
            config: directory.join("launcher.json"),
            icon_path: std::path::PathBuf::from(&chatgpt.executable_path),
            chromium_mode: true,
        };

        let icon = shortcut_icon_path(&chatgpt, &files);
        assert_eq!(icon, directory.join("Application.ico"));
        let decoded = ico::IconDir::read(std::fs::File::open(icon).unwrap()).unwrap();
        assert_eq!(decoded.entries()[0].width(), 256);
        assert_eq!(decoded.entries()[0].height(), 256);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn generated_powershell_scripts_parse() {
        let directory = std::env::temp_dir().join(format!(
            "app-proxy-launcher-script-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let parser = directory.join("Parse-Script.ps1");
        let runtime = directory.join("Launch-With-Proxy.ps1");
        let shortcut = directory.join("Create-Shortcut.ps1");
        write_utf8_bom(
            &parser,
            r#"param([Parameter(Mandatory=$true)][string]$ScriptPath)
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { Write-Error $_.Message }
  exit 1
}
"#,
        )
        .unwrap();
        write_utf8_bom(&runtime, RUNTIME_SCRIPT).unwrap();
        write_utf8_bom(&shortcut, SHORTCUT_SCRIPT).unwrap();

        for script in [&runtime, &shortcut] {
            let status = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&parser)
                .arg("-ScriptPath")
                .arg(script)
                .status()
                .unwrap();
            assert!(status.success(), "PowerShell parser rejected {script:?}");
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn shortcut_script_creates_windows_link() {
        let directory =
            std::env::temp_dir().join(format!("app-proxy-shortcut-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let helper = directory.join("Create-Shortcut.ps1");
        let command = directory.join("Launch-With-Proxy.cmd");
        let shortcut = directory.join("Test - 应用代理.lnk");
        write_utf8_bom(&helper, SHORTCUT_SCRIPT).unwrap();
        std::fs::write(&command, b"@echo off\r\n").unwrap();

        let output = powershell_command()
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&helper)
            .arg("-ShortcutPath")
            .arg(&shortcut)
            .arg("-TargetPath")
            .arg(&command)
            .arg("-WorkingDirectory")
            .arg(&directory)
            .arg("-Description")
            .arg("App Proxy launcher test")
            .arg("-IconPath")
            .arg(std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into()))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "shortcut helper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(shortcut.is_file());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
