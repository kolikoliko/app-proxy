use crate::store::PersistedState;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::Write,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

const LAN_CIDRS: &[&str] = &[
    "127.0.0.0/8",
    "169.254.0.0/16",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "::1/128",
    "fe80::/10",
    "fc00::/7",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunStatus {
    pub phase: &'static str,
    pub message: String,
    pub kernel_version: &'static str,
    pub protocol_note: Option<String>,
}

struct Runtime {
    child: Child,
    config_signature: Vec<u8>,
    _kill_on_close_job: KillOnCloseJob,
}

#[cfg(windows)]
struct KillOnCloseJob(windows::Win32::Foundation::HANDLE);

#[cfg(windows)]
// SAFETY: A Windows job handle can be closed from any thread. Runtime owns the
// only handle copy and Drop closes it exactly once.
unsafe impl Send for KillOnCloseJob {}

#[cfg(not(windows))]
struct KillOnCloseJob;

#[cfg(windows)]
impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        // SAFETY: The handle was returned by CreateJobObjectW and is owned here.
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.0) };
    }
}

pub struct TunManager {
    config_dir: PathBuf,
    runtime: Mutex<Option<Runtime>>,
    last_error: Mutex<Option<String>>,
}

impl TunManager {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            config_dir,
            runtime: Mutex::new(None),
            last_error: Mutex::new(None),
        }
    }

    pub fn reconcile(&self, state: &PersistedState) -> Result<TunStatus, String> {
        let should_run = state.settings.tun_enabled
            && state.settings.pause_until.is_none()
            && state.rules.iter().any(|rule| rule.enabled);

        if should_run {
            let signature = serde_json::to_vec(&build_config(state)?)
                .map_err(|error| format!("无法生成 TUN 配置摘要：{error}"))?;
            let already_running = self
                .runtime
                .lock()
                .map_err(|_| "TUN 运行锁异常")?
                .as_mut()
                .is_some_and(|runtime| {
                    runtime.config_signature == signature
                        && matches!(runtime.child.try_wait(), Ok(None))
                });
            if !already_running {
                self.restart(state, signature)?;
            }
        } else {
            self.stop()?;
        }
        Ok(self.status(state))
    }

    pub fn check(&self, state: &PersistedState) -> Result<TunStatus, String> {
        if !state.rules.iter().any(|rule| rule.enabled) {
            return Err("请先至少开启一个应用规则".into());
        }
        let config_path = self.write_config(state)?;
        check_config(&sing_box_path(), &config_path)?;
        Ok(TunStatus {
            phase: "ready",
            message: "TUN 配置校验通过，内核已就绪".into(),
            kernel_version: "1.13.12",
            protocol_note: protocol_note(&state.settings.proxy_url),
        })
    }

    pub fn status(&self, state: &PersistedState) -> TunStatus {
        let mut detected_error = None;
        let running = self
            .runtime
            .lock()
            .map(|mut runtime| {
                let status = runtime
                    .as_mut()
                    .map(|active| active.child.try_wait())
                    .transpose();
                match status {
                    Ok(Some(Some(exit))) => {
                        detected_error = Some(format!(
                            "sing-box 已意外退出（{exit}），当前流量已恢复直连；请查看内核日志"
                        ));
                        *runtime = None;
                        false
                    }
                    Ok(Some(None)) => true,
                    Ok(None) => false,
                    Err(error) => {
                        detected_error = Some(format!("无法读取 sing-box 状态：{error}"));
                        false
                    }
                }
            })
            .unwrap_or(false);
        if let Some(error) = detected_error {
            if let Ok(mut last_error) = self.last_error.lock() {
                *last_error = Some(error);
            }
        }
        let last_error = self.last_error.lock().ok().and_then(|value| value.clone());
        let (phase, message) = if let Some(error) = last_error {
            ("error", error)
        } else if running {
            ("running", "TUN 正在运行，仅代理已开启的应用".into())
        } else if state.settings.pause_until.is_some() && state.settings.tun_enabled {
            ("paused", "TUN 已定时暂停，应用规则保持不变".into())
        } else if state.settings.tun_enabled && !state.rules.iter().any(|rule| rule.enabled) {
            ("waiting", "TUN 已开启，等待至少一个应用规则".into())
        } else {
            ("stopped", "TUN 已关闭，应用规则保持不变".into())
        };
        TunStatus {
            phase,
            message,
            kernel_version: "1.13.12",
            protocol_note: protocol_note(&state.settings.proxy_url),
        }
    }

    fn restart(&self, state: &PersistedState, config_signature: Vec<u8>) -> Result<(), String> {
        self.stop()?;
        ensure_proxy_reachable(&state.settings.proxy_url)?;
        let config_path = self.write_config(state)?;
        let binary = sing_box_path();
        check_config(&binary, &config_path)?;

        fs::create_dir_all(&self.config_dir)
            .map_err(|error| format!("无法创建运行目录：{error}"))?;
        let log_path = self.config_dir.join("sing-box.log");
        let stdout =
            File::create(&log_path).map_err(|error| format!("无法创建内核日志：{error}"))?;
        let stderr = stdout
            .try_clone()
            .map_err(|error| format!("无法打开内核日志：{error}"))?;
        let mut command = background_command(&binary);
        let mut child = command
            .args(["run", "-c"])
            .arg(&config_path)
            .stdin(Stdio::null())
            .stdout(Stdio::from(stdout))
            .stderr(Stdio::from(stderr))
            .spawn()
            .map_err(|error| format!("无法启动 sing-box：{error}"))?;
        let kill_on_close_job = match assign_kill_on_close_job(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };

        thread::sleep(Duration::from_millis(700));
        if let Some(exit) = child
            .try_wait()
            .map_err(|error| format!("无法读取内核状态：{error}"))?
        {
            let detail = fs::read_to_string(&log_path).unwrap_or_default();
            let detail = detail.lines().last().unwrap_or("未知错误");
            let message = format!("TUN 启动失败（{exit}）：{detail}");
            if let Ok(mut error) = self.last_error.lock() {
                *error = Some(message.clone());
            }
            return Err(message);
        }

        *self.runtime.lock().map_err(|_| "TUN 运行锁异常")? = Some(Runtime {
            child,
            config_signature,
            _kill_on_close_job: kill_on_close_job,
        });
        if let Ok(mut error) = self.last_error.lock() {
            *error = None;
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut runtime = self.runtime.lock().map_err(|_| "TUN 运行锁异常")?;
        if let Some(mut active) = runtime.take() {
            // Closing the process also closes the Windows TUN handle. Waiting here
            // makes sure routes are released before a replacement is started.
            active
                .child
                .kill()
                .map_err(|error| format!("无法停止 sing-box：{error}"))?;
            active
                .child
                .wait()
                .map_err(|error| format!("等待 sing-box 退出失败：{error}"))?;
        }
        Ok(())
    }

    fn write_config(&self, state: &PersistedState) -> Result<PathBuf, String> {
        fs::create_dir_all(&self.config_dir)
            .map_err(|error| format!("无法创建运行目录：{error}"))?;
        let target = self.config_dir.join("sing-box.json");
        let temporary = self.config_dir.join("sing-box.json.tmp");
        let raw = serde_json::to_vec_pretty(&build_config(state)?)
            .map_err(|error| format!("无法生成 TUN 配置：{error}"))?;
        let mut file =
            File::create(&temporary).map_err(|error| format!("无法写入 TUN 配置：{error}"))?;
        file.write_all(&raw)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("无法保存 TUN 配置：{error}"))?;
        if target.exists() {
            fs::remove_file(&target).map_err(|error| format!("无法更新旧 TUN 配置：{error}"))?;
        }
        fs::rename(&temporary, &target).map_err(|error| format!("无法替换 TUN 配置：{error}"))?;
        Ok(target)
    }
}

#[cfg(windows)]
fn assign_kill_on_close_job(child: &Child) -> Result<KillOnCloseJob, String> {
    use std::{mem::size_of, os::windows::io::AsRawHandle};
    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::HANDLE,
            System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
        },
    };

    // SAFETY: No security descriptor or name is supplied; Windows returns a new
    // process-local job handle which is immediately wrapped for deterministic close.
    let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
        .map_err(|error| format!("无法创建 TUN 进程守护：{error}"))?;
    let owned_job = KillOnCloseJob(job);
    let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    // SAFETY: The information pointer and byte length describe a live value of
    // the exact structure requested by JobObjectExtendedLimitInformation.
    unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const information).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(|error| format!("无法设置 TUN 进程守护：{error}"))?;

    let process_handle = HANDLE(child.as_raw_handle());
    // SAFETY: Child owns a valid process handle for the running sing-box process;
    // the job remains alive in Runtime for at least as long as that child.
    unsafe { AssignProcessToJobObject(job, process_handle) }
        .map_err(|error| format!("无法绑定 TUN 进程守护：{error}"))?;
    Ok(owned_job)
}

#[cfg(not(windows))]
fn assign_kill_on_close_job(_child: &Child) -> Result<KillOnCloseJob, String> {
    Ok(KillOnCloseJob)
}

impl Drop for TunManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

pub fn build_config(state: &PersistedState) -> Result<Value, String> {
    let proxy = url::Url::parse(&state.settings.proxy_url).map_err(|_| "代理地址格式无效")?;
    let host = proxy.host_str().ok_or("代理地址缺少主机")?;
    let port = proxy.port_or_known_default().ok_or("代理地址缺少端口")?;
    let is_http = proxy.scheme() == "http";
    let proxy_outbound = if is_http {
        json!({"type":"http", "tag":"proxy", "server":host, "server_port":port})
    } else {
        json!({"type":"socks", "tag":"proxy", "server":host, "server_port":port, "version":"5"})
    };

    let process_paths: Vec<&str> = state
        .rules
        .iter()
        .filter(|rule| rule.enabled && rule.executable_scope_root.is_none())
        .map(|rule| rule.executable_path.as_str())
        .collect();
    // Windows may report a process through a normalized/device path that is not
    // byte-for-byte identical to the installation path. Keep the full-path rule
    // as the precise match and add an executable-name fallback for classic
    // desktop apps. Packaged apps remain constrained to their package root.
    let process_names: Vec<&str> = state
        .rules
        .iter()
        .filter(|rule| rule.enabled && rule.executable_scope_root.is_none())
        .map(|rule| rule.executable_name.as_str())
        .collect();
    let process_path_regex: Vec<String> = state
        .rules
        .iter()
        .filter(|rule| rule.enabled)
        .filter_map(|rule| rule.executable_scope_root.as_deref())
        .filter_map(executable_scope_regex)
        .collect();
    if process_paths.is_empty() && process_names.is_empty() && process_path_regex.is_empty() {
        return Err("请先至少开启一个应用规则".into());
    }

    let mut route_rules = vec![json!({"port":53, "action":"hijack-dns"})];
    if state.settings.bypass_lan {
        route_rules.push(json!({"ip_is_private":true, "action":"route", "outbound":"direct"}));
    }
    if !process_paths.is_empty() {
        push_app_rules(
            &mut route_rules,
            "process_path",
            json!(process_paths),
            is_http,
        );
    }
    if !process_names.is_empty() {
        push_app_rules(
            &mut route_rules,
            "process_name",
            json!(process_names),
            is_http,
        );
    }
    if !process_path_regex.is_empty() {
        push_app_rules(
            &mut route_rules,
            "process_path_regex",
            json!(process_path_regex),
            is_http,
        );
    }

    let mut inbound = json!({
        "type":"tun",
        "tag":"tun-in",
        "interface_name":"AppProxyTun",
        "address":["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
        "mtu":1500,
        "auto_route":true,
        "strict_route":true,
        "stack":"system"
    });
    let mut excluded: Vec<String> = Vec::new();
    if state.settings.bypass_lan {
        excluded.extend(LAN_CIDRS.iter().map(|value| (*value).to_string()));
    }
    excluded.extend(state.settings.additional_bypass_cidrs.iter().cloned());
    if !excluded.is_empty() {
        inbound["route_exclude_address"] = json!(excluded);
    }

    Ok(json!({
        "log":{"level":"warn", "timestamp":true},
        "dns":{
            "servers":[{"type":"local", "tag":"local-dns"}],
            "final":"local-dns",
            "reverse_mapping":true
        },
        "inbounds":[inbound],
        "outbounds":[proxy_outbound, {"type":"direct", "tag":"direct"}],
        "route":{"auto_detect_interface":true, "rules":route_rules, "final":"direct"}
    }))
}

fn push_app_rules(route_rules: &mut Vec<Value>, selector: &str, values: Value, is_http: bool) {
    let mut sniff_rule = json!({
        "action":"sniff",
        "sniffer": if is_http { json!(["http", "tls"]) } else { json!(["http", "tls", "quic"]) },
        "timeout":"300ms"
    });
    sniff_rule[selector] = values.clone();
    if is_http {
        sniff_rule["network"] = json!("tcp");
    }
    route_rules.push(sniff_rule);

    let mut proxy_rule = json!({
        "action":"route",
        "outbound":"proxy"
    });
    proxy_rule[selector] = values;
    if is_http {
        proxy_rule["network"] = json!("tcp");
    }
    route_rules.push(proxy_rule);
}

fn executable_scope_regex(scope_root: &str) -> Option<String> {
    let normalized = scope_root
        .trim()
        .trim_end_matches(['\\', '/'])
        .replace('/', "\\");
    if normalized.is_empty() {
        return None;
    }
    let mut escaped = String::with_capacity(normalized.len() * 2);
    for character in normalized.chars() {
        if matches!(
            character,
            '\\' | '.' | '^' | '$' | '|' | '?' | '*' | '+' | '(' | ')' | '[' | ']' | '{' | '}'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    Some(format!(r"(?i)^{escaped}\\.*\.exe$"))
}

pub fn validate_cidr(value: &str) -> bool {
    let Some((address, prefix)) = value.split_once('/') else {
        return false;
    };
    let Ok(address) = address.parse::<std::net::IpAddr>() else {
        return false;
    };
    let Ok(prefix) = prefix.parse::<u8>() else {
        return false;
    };
    prefix <= if address.is_ipv4() { 32 } else { 128 }
}

fn check_config(binary: &Path, config: &Path) -> Result<(), String> {
    if !binary.is_file() {
        return Err(format!(
            "缺少 sing-box 内核，请先运行 scripts\\fetch-sing-box.ps1（{}）",
            binary.display()
        ));
    }
    let output = background_command(binary)
        .args(["check", "-c"])
        .arg(config)
        .output()
        .map_err(|error| format!("无法校验 TUN 配置：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("TUN 配置校验失败：{}", stderr.trim()))
}

fn background_command(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // sing-box is a console executable. CREATE_NO_WINDOW keeps both the
        // short config check and the long-running TUN process in the background.
        command.creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0);
    }
    command
}

fn ensure_proxy_reachable(proxy_url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(proxy_url).map_err(|_| "代理地址格式无效")?;
    let host = parsed.host_str().ok_or("代理地址缺少主机")?;
    let port = parsed.port_or_known_default().ok_or("代理地址缺少端口")?;
    let address = format!("{host}:{port}");
    let addresses = address.to_socket_addrs().map_err(|_| "无法解析代理主机")?;
    for socket in addresses {
        if TcpStream::connect_timeout(&socket, Duration::from_secs(2)).is_ok() {
            return Ok(());
        }
    }
    Err("代理端口不可达，已保持直连；请先启动代理软件并检查端口".into())
}

fn sing_box_path() -> PathBuf {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("sing-box.exe")));
    if let Some(path) = bundled.filter(|path| path.is_file()) {
        return path;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("sing-box-x86_64-pc-windows-msvc.exe")
}

fn protocol_note(proxy_url: &str) -> Option<String> {
    proxy_url
        .starts_with("http://")
        .then(|| "HTTP 上游仅代理 TCP；应用的 UDP 流量保持直连。需要 UDP 时请使用 SOCKS5。".into())
}

#[cfg(test)]
mod tests {
    use super::{build_config, check_config, sing_box_path, validate_cidr};
    use crate::store::{AppRule, PersistedState};
    use serde_json::json;

    fn state(proxy: &str) -> PersistedState {
        let mut state = PersistedState::default();
        state.settings.proxy_url = proxy.into();
        state.rules.push(AppRule {
            id: "one".into(),
            display_name: "Browser".into(),
            executable_path: r"C:\Program Files\Browser\browser.exe".into(),
            executable_name: "browser.exe".into(),
            package_family_name: None,
            application_id: None,
            executable_scope_root: None,
            scope_executable_count: 0,
            enabled: true,
            pinned: true,
            created_at: "0".into(),
            updated_at: "0".into(),
        });
        state
    }

    #[test]
    fn socks_routes_selected_process_and_bypasses_lan() {
        let config = build_config(&state("socks://127.0.0.1:7890")).unwrap();
        assert_eq!(config["outbounds"][0]["type"], "socks");
        assert_eq!(config["route"]["final"], "direct");
        assert_eq!(config["dns"]["reverse_mapping"], true);
        assert_eq!(
            config["route"]["rules"][2]["process_path"][0],
            r"C:\Program Files\Browser\browser.exe"
        );
        assert_eq!(config["route"]["rules"][2]["action"], "sniff");
        assert_eq!(config["route"]["rules"][2]["sniffer"][2], "quic");
        assert_eq!(
            config["route"]["rules"][5]["process_name"][0],
            "browser.exe"
        );
        assert_eq!(config["route"]["rules"][5]["outbound"], "proxy");
        assert!(
            config["inbounds"][0]["route_exclude_address"]
                .as_array()
                .unwrap()
                .len()
                >= 8
        );
    }

    #[test]
    fn http_limits_proxy_rule_to_tcp() {
        let config = build_config(&state("http://127.0.0.1:7890")).unwrap();
        assert_eq!(config["outbounds"][0]["type"], "http");
        assert_eq!(config["route"]["rules"][2]["network"], "tcp");
        assert_eq!(config["route"]["rules"][3]["network"], "tcp");
        assert_eq!(
            config["route"]["rules"][2]["sniffer"],
            json!(["http", "tls"])
        );
        assert_eq!(config["route"]["rules"][4]["network"], "tcp");
        assert_eq!(config["route"]["rules"][5]["network"], "tcp");
    }

    #[test]
    fn msix_application_group_routes_nested_executables_only_inside_package() {
        let mut state = state("socks://127.0.0.1:7890");
        let package_root =
            r"C:\Program Files\WindowsApps\OpenAI.Codex_26.715.4045.0_x64__2p2nqsd0c76g0";
        state.rules[0].executable_path = format!(r"{package_root}\app\ChatGPT.exe");
        state.rules[0].executable_scope_root = Some(package_root.into());
        state.rules[0].scope_executable_count = 8;

        let config = build_config(&state).unwrap();
        let pattern = config["route"]["rules"][3]["process_path_regex"][0]
            .as_str()
            .unwrap();
        let regex = regex::Regex::new(pattern).unwrap();
        assert!(regex.is_match(&format!(r"{package_root}\app\resources\codex.exe")));
        assert!(regex.is_match(&format!(r"{package_root}\app\ChatGPT.exe")));
        assert!(!regex
            .is_match(r"C:\Program Files\WindowsApps\OpenAI.Codex_Other\app\resources\codex.exe"));
        assert!(!regex.is_match(&format!(r"{package_root}.backup\app\ChatGPT.exe")));
    }

    #[test]
    fn validates_ipv4_and_ipv6_cidrs() {
        assert!(validate_cidr("192.168.0.0/16"));
        assert!(validate_cidr("fd00::/8"));
        assert!(!validate_cidr("192.168.0.0/99"));
        assert!(!validate_cidr("not-an-ip/8"));
    }

    #[test]
    fn stable_sing_box_accepts_generated_config_when_available() {
        let binary = sing_box_path();
        if !binary.is_file() {
            return;
        }
        let path = std::env::temp_dir().join(format!(
            "app-proxy-sing-box-check-{}.json",
            std::process::id()
        ));
        let raw =
            serde_json::to_vec_pretty(&build_config(&state("socks://127.0.0.1:7890")).unwrap())
                .unwrap();
        std::fs::write(&path, raw).unwrap();
        let result = check_config(&binary, &path);
        let _ = std::fs::remove_file(path);
        result.unwrap();
    }

    #[test]
    fn stable_sing_box_accepts_application_group_config_when_available() {
        let binary = sing_box_path();
        if !binary.is_file() {
            return;
        }
        let mut grouped = state("socks://127.0.0.1:7890");
        grouped.rules[0].executable_scope_root = Some(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_26.715.4045.0_x64__2p2nqsd0c76g0".into(),
        );
        grouped.rules[0].scope_executable_count = 8;
        let path = std::env::temp_dir().join(format!(
            "app-proxy-sing-box-group-check-{}.json",
            std::process::id()
        ));
        let raw = serde_json::to_vec_pretty(&build_config(&grouped).unwrap()).unwrap();
        std::fs::write(&path, raw).unwrap();
        let result = check_config(&binary, &path);
        let _ = std::fs::remove_file(path);
        result.unwrap();
    }
}
