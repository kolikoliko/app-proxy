use serde::Serialize;
use std::{
    io,
    process::{Command, Output},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProxyStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub http_proxies: Vec<String>,
    pub https_proxies: Vec<String>,
    pub matches_app_proxy: bool,
}

pub fn get_git_proxy_status(app_proxy_url: &str) -> Result<GitProxyStatus, String> {
    let version_output = match run_git(&["--version"]) {
        Ok(output) => output,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(GitProxyStatus {
                installed: false,
                version: None,
                http_proxies: Vec::new(),
                https_proxies: Vec::new(),
                matches_app_proxy: false,
            });
        }
        Err(error) => return Err(format!("无法检测 Git：{error}")),
    };

    if !version_output.status.success() {
        return Err(command_error("无法检测 Git", &version_output));
    }

    let target = git_proxy_url(app_proxy_url)?;
    let raw_http = read_global_values("http.proxy")?;
    let raw_https = read_global_values("https.proxy")?;
    let matches_app_proxy = raw_http.len() == 1
        && raw_https.len() == 1
        && proxy_values_equal(&raw_http[0], &target)
        && proxy_values_equal(&raw_https[0], &target);

    let version_text = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();

    Ok(GitProxyStatus {
        installed: true,
        version: Some(
            version_text
                .strip_prefix("git version ")
                .unwrap_or(&version_text)
                .to_string(),
        ),
        http_proxies: raw_http
            .iter()
            .map(|value| redact_proxy_value(value))
            .collect(),
        https_proxies: raw_https
            .iter()
            .map(|value| redact_proxy_value(value))
            .collect(),
        matches_app_proxy,
    })
}

pub fn apply_git_proxy(app_proxy_url: &str) -> Result<GitProxyStatus, String> {
    let proxy_url = git_proxy_url(app_proxy_url)?;
    ensure_git_installed()?;
    replace_global_value("http.proxy", &proxy_url)?;
    replace_global_value("https.proxy", &proxy_url)?;
    get_git_proxy_status(app_proxy_url)
}

pub fn clear_git_proxy(app_proxy_url: &str) -> Result<GitProxyStatus, String> {
    ensure_git_installed()?;
    clear_global_value("http.proxy")?;
    clear_global_value("https.proxy")?;
    get_git_proxy_status(app_proxy_url)
}

fn git_proxy_url(value: &str) -> Result<String, String> {
    let mut parsed = url::Url::parse(value).map_err(|_| "代理地址格式无效".to_string())?;
    if !matches!(parsed.scheme(), "socks" | "socks5" | "http" | "https") {
        return Err("Git 代理仅支持 SOCKS、HTTP 和 HTTPS".into());
    }
    if parsed.host_str().is_none() || parsed.port_or_known_default().is_none() {
        return Err("代理地址必须包含有效的主机和端口".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Git 代理不支持带账号密码的应用代理地址".into());
    }
    if matches!(parsed.scheme(), "socks" | "socks5") {
        parsed
            .set_scheme("socks5h")
            .map_err(|_| "无法转换 SOCKS5 代理地址".to_string())?;
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

fn ensure_git_installed() -> Result<(), String> {
    match run_git(&["--version"]) {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(command_error("Git 当前不可用", &output)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Err("未检测到 Git，请先安装 Git for Windows".into())
        }
        Err(error) => Err(format!("无法启动 Git：{error}")),
    }
}

fn read_global_values(key: &str) -> Result<Vec<String>, String> {
    let output = run_git(&["config", "--global", "--get-all", key])
        .map_err(|error| format!("无法读取 Git 全局代理：{error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect());
    }
    if output.status.code() == Some(1) {
        return Ok(Vec::new());
    }
    Err(command_error("无法读取 Git 全局代理", &output))
}

fn replace_global_value(key: &str, value: &str) -> Result<(), String> {
    let output = run_git(&["config", "--global", "--replace-all", key, value])
        .map_err(|error| format!("无法写入 Git 全局代理：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error("无法写入 Git 全局代理", &output))
    }
}

fn clear_global_value(key: &str) -> Result<(), String> {
    if read_global_values(key)?.is_empty() {
        return Ok(());
    }
    let output = run_git(&["config", "--global", "--unset-all", key])
        .map_err(|error| format!("无法清除 Git 全局代理：{error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(command_error("无法清除 Git 全局代理", &output))
    }
}

fn proxy_values_equal(left: &str, right: &str) -> bool {
    normalize_proxy_value(left) == normalize_proxy_value(right)
}

fn normalize_proxy_value(value: &str) -> String {
    url::Url::parse(value.trim())
        .map(|parsed| {
            parsed
                .to_string()
                .trim_end_matches('/')
                .to_ascii_lowercase()
        })
        .unwrap_or_else(|_| value.trim().trim_end_matches('/').to_ascii_lowercase())
}

fn redact_proxy_value(value: &str) -> String {
    let Ok(mut parsed) = url::Url::parse(value.trim()) else {
        return value.trim().to_string();
    };
    if parsed.username().is_empty() && parsed.password().is_none() {
        return value.trim().to_string();
    }
    let _ = parsed.set_username("***");
    let _ = parsed.set_password(Some("***"));
    parsed.to_string().trim_end_matches('/').to_string()
}

fn command_error(context: &str, output: &Output) -> String {
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        format!("{context}，Git 返回状态 {}", output.status)
    } else {
        format!("{context}：{detail}")
    }
}

fn run_git(args: &[&str]) -> io::Result<Output> {
    let mut command = Command::new("git");
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output()
}

#[cfg(test)]
mod tests {
    use super::{git_proxy_url, proxy_values_equal, redact_proxy_value};

    #[test]
    fn converts_app_socks_url_for_git_dns_proxying() {
        assert_eq!(
            git_proxy_url("socks://127.0.0.1:7890").unwrap(),
            "socks5h://127.0.0.1:7890"
        );
    }

    #[test]
    fn keeps_http_proxy_url_for_git() {
        assert_eq!(
            git_proxy_url("http://127.0.0.1:7890").unwrap(),
            "http://127.0.0.1:7890"
        );
    }

    #[test]
    fn keeps_https_proxy_url_for_git() {
        assert_eq!(
            git_proxy_url("https://127.0.0.1:7890").unwrap(),
            "https://127.0.0.1:7890"
        );
    }

    #[test]
    fn compares_equivalent_proxy_urls() {
        assert!(proxy_values_equal(
            "http://127.0.0.1:7890/",
            "http://127.0.0.1:7890"
        ));
    }

    #[test]
    fn redacts_proxy_credentials() {
        let value = redact_proxy_value("http://alice:secret@127.0.0.1:7890");
        assert!(!value.contains("alice"));
        assert!(!value.contains("secret"));
    }
}
