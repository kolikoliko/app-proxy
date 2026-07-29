mod icon_extractor;
mod installed_apps;
mod launcher;
mod routing;
mod store;

use installed_apps::InstalledApp;
use launcher::LauncherResult;
use routing::{TunManager, TunStatus};
use serde::Serialize;
use std::{
    net::{TcpStream, ToSocketAddrs},
    time::{Duration, Instant},
};
use store::{AppSettings, AppStore, PersistedState};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyTestResult {
    reachable: bool,
    latency_ms: Option<u128>,
    message: String,
}

#[tauri::command]
fn load_state(store: tauri::State<'_, AppStore>) -> Result<PersistedState, String> {
    store.load()
}

#[tauri::command]
fn save_settings(
    mut settings: AppSettings,
    store: tauri::State<'_, AppStore>,
    tun: tauri::State<'_, TunManager>,
    app: tauri::AppHandle,
) -> Result<PersistedState, String> {
    // Until a separately supervised helper exists, leaving routes behind is not
    // safe. Normalize legacy/preview state to the fail-safe behavior.
    settings.exit_behavior = "restore_direct".into();
    validate_proxy_url(&settings.proxy_url)?;
    if !matches!(
        settings.accent_color.as_str(),
        "green" | "blue" | "purple" | "yellow" | "rose" | "cyan"
    ) {
        return Err("不支持的主题色".into());
    }
    for cidr in &settings.additional_bypass_cidrs {
        if !routing::validate_cidr(cidr) {
            return Err(format!("无效的绕过网段：{cidr}"));
        }
    }
    let previous = store.load()?;
    let needs_elevation =
        settings.tun_enabled && !previous.settings.tun_enabled && !is_process_elevated();
    if needs_elevation && cfg!(debug_assertions) {
        return Err(
            "开发模式无法在提权重启后保留 Vite 服务。请退出当前进程，以管理员身份打开 PowerShell，再运行 npm run tauri dev；正式安装版会自动请求 UAC。"
                .into(),
        );
    }
    let updated = store.update(|state| state.settings = settings)?;
    if needs_elevation {
        if let Err(error) = relaunch_elevated() {
            let _ = store.update(|state| state.settings.tun_enabled = false);
            return Err(error);
        }
        app.exit(0);
        return Ok(updated);
    }
    reconcile_or_disable(&app, &store, &tun, updated)
}

#[cfg(windows)]
fn is_process_elevated() -> bool {
    // SAFETY: IsUserAnAdmin takes no pointers and only reads the current token.
    unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() }
}

#[cfg(not(windows))]
fn is_process_elevated() -> bool {
    false
}

#[cfg(windows)]
fn relaunch_elevated() -> Result<(), String> {
    use windows::{
        core::{HSTRING, PCWSTR},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };

    let executable =
        std::env::current_exe().map_err(|error| format!("无法确定程序路径：{error}"))?;
    let operation = HSTRING::from("runas");
    let file = HSTRING::from(executable.as_os_str());
    // SAFETY: All strings are owned for the duration of the synchronous call.
    let result = unsafe {
        ShellExecuteW(
            None,
            &operation,
            &file,
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err("开启 TUN 需要管理员权限；已取消 Windows 权限请求".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn relaunch_elevated() -> Result<(), String> {
    Err("TUN 模式当前仅支持 Windows".into())
}

#[tauri::command]
fn add_rule(
    executable_path: String,
    display_name: Option<String>,
    package_family_name: Option<String>,
    application_id: Option<String>,
    store: tauri::State<'_, AppStore>,
    tun: tauri::State<'_, TunManager>,
    app: tauri::AppHandle,
) -> Result<PersistedState, String> {
    let package_scope = package_family_name.as_deref().and_then(|family| {
        installed_apps::resolve_package_application(family, application_id.as_deref())
    });
    let effective_path = package_scope
        .as_ref()
        .map(|scope| scope.executable_path.as_str())
        .unwrap_or(&executable_path);
    let updated = store.add_rule(
        effective_path,
        display_name.as_deref(),
        package_family_name.as_deref(),
        application_id.as_deref(),
        package_scope
            .as_ref()
            .map(|scope| scope.executable_scope_root.as_str()),
        package_scope
            .as_ref()
            .map(|scope| scope.executable_count)
            .unwrap_or_default(),
    )?;
    reconcile_or_disable(&app, &store, &tun, updated)
}

fn refresh_package_rule_scopes(store: &AppStore) -> Result<PersistedState, String> {
    let current = store.load()?;
    let resolutions: Vec<_> = current
        .rules
        .iter()
        .filter_map(|rule| {
            let family = rule.package_family_name.as_deref()?;
            let resolved = installed_apps::resolve_package_application(
                family,
                rule.application_id.as_deref(),
            )?;
            Some((rule.id.clone(), resolved))
        })
        .collect();
    if resolutions.is_empty() {
        return Ok(current);
    }

    store.update(move |state| {
        for (id, resolved) in resolutions {
            let Some(rule) = state.rules.iter_mut().find(|rule| rule.id == id) else {
                continue;
            };
            let changed = !rule
                .executable_path
                .eq_ignore_ascii_case(&resolved.executable_path)
                || rule.executable_scope_root.as_deref()
                    != Some(resolved.executable_scope_root.as_str())
                || rule.scope_executable_count != resolved.executable_count;
            rule.executable_path = resolved.executable_path;
            rule.executable_name = resolved.executable_name;
            rule.executable_scope_root = Some(resolved.executable_scope_root);
            rule.scope_executable_count = resolved.executable_count;
            if changed {
                rule.updated_at = store::now_string();
            }
        }
    })
}

#[tauri::command]
async fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    tauri::async_runtime::spawn_blocking(installed_apps::discover_installed_apps)
        .await
        .map_err(|error| format!("读取已安装软件失败：{error}"))
}

#[tauri::command]
async fn get_app_icon(executable_path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        icon_extractor::extract_icon_data_url(&executable_path)
    })
    .await
    .map_err(|error| format!("读取应用图标失败：{error}"))?
}

#[tauri::command]
fn update_rule(
    id: String,
    enabled: bool,
    store: tauri::State<'_, AppStore>,
    tun: tauri::State<'_, TunManager>,
    app: tauri::AppHandle,
) -> Result<PersistedState, String> {
    let updated = store.update(|state| {
        if let Some(rule) = state.rules.iter_mut().find(|rule| rule.id == id) {
            rule.enabled = enabled;
            rule.updated_at = store::now_string();
        }
    })?;
    reconcile_or_disable(&app, &store, &tun, updated)
}

#[tauri::command]
fn remove_rule(
    id: String,
    store: tauri::State<'_, AppStore>,
    tun: tauri::State<'_, TunManager>,
    app: tauri::AppHandle,
) -> Result<PersistedState, String> {
    let updated = store.update(|state| state.rules.retain(|rule| rule.id != id))?;
    reconcile_or_disable(&app, &store, &tun, updated)
}

fn launcher_rule(store: &AppStore, id: &str) -> Result<(store::AppRule, String), String> {
    let state = store.load()?;
    let mut rule = state
        .rules
        .iter()
        .find(|rule| rule.id == id)
        .cloned()
        .ok_or("找不到该应用规则")?;
    if let Some(family) = rule.package_family_name.as_deref() {
        let resolved =
            installed_apps::resolve_package_application(family, rule.application_id.as_deref())
                .ok_or("无法解析 Microsoft Store 应用；请确认应用仍已安装")?;
        rule.executable_path = resolved.executable_path;
        rule.executable_name = resolved.executable_name;
        rule.executable_scope_root = Some(resolved.executable_scope_root);
        rule.scope_executable_count = resolved.executable_count;
    }
    Ok((rule, state.settings.proxy_url))
}

#[tauri::command]
fn launch_rule_with_proxy(
    id: String,
    store: tauri::State<'_, AppStore>,
    app: tauri::AppHandle,
) -> Result<LauncherResult, String> {
    let (rule, proxy_url) = launcher_rule(&store, &id)?;
    launcher::launch_with_proxy(&app, &rule, &proxy_url)
}

#[tauri::command]
fn create_rule_desktop_launcher(
    id: String,
    store: tauri::State<'_, AppStore>,
    app: tauri::AppHandle,
) -> Result<LauncherResult, String> {
    let (rule, proxy_url) = launcher_rule(&store, &id)?;
    launcher::create_desktop_launcher(&app, &rule, &proxy_url)
}

#[tauri::command]
fn create_rule_start_menu_launcher(
    id: String,
    store: tauri::State<'_, AppStore>,
    app: tauri::AppHandle,
) -> Result<LauncherResult, String> {
    let (rule, proxy_url) = launcher_rule(&store, &id)?;
    launcher::create_start_menu_launcher(&app, &rule, &proxy_url)
}

#[tauri::command]
fn get_tun_status(
    store: tauri::State<'_, AppStore>,
    tun: tauri::State<'_, TunManager>,
) -> Result<TunStatus, String> {
    Ok(tun.status(&store.load()?))
}

#[tauri::command]
fn check_tun_ready(
    store: tauri::State<'_, AppStore>,
    tun: tauri::State<'_, TunManager>,
) -> Result<TunStatus, String> {
    tun.check(&store.load()?)
}

#[tauri::command]
fn prepare_for_update(tun: tauri::State<'_, TunManager>) -> Result<(), String> {
    tun.stop()
}

#[tauri::command]
fn resume_after_update_failure(
    store: tauri::State<'_, AppStore>,
    tun: tauri::State<'_, TunManager>,
) -> Result<(), String> {
    tun.reconcile(&store.load()?).map(|_| ())
}

fn reconcile_or_disable(
    app: &tauri::AppHandle,
    store: &AppStore,
    tun: &TunManager,
    state: PersistedState,
) -> Result<PersistedState, String> {
    if let Err(error) = tun.reconcile(&state) {
        let _ = tun.stop();
        if let Ok(disabled) = store.update(|current| current.settings.tun_enabled = false) {
            let _ = refresh_tray_menu(app, &disabled);
        }
        return Err(error);
    }
    refresh_tray_menu(app, &state)?;
    let _ = app.emit("state-changed", ());
    Ok(state)
}

#[tauri::command]
async fn test_proxy(proxy_url: String) -> Result<ProxyTestResult, String> {
    let parsed = validate_proxy_url(&proxy_url)?;
    let host = parsed.host_str().ok_or("代理地址缺少主机")?.to_string();
    let port = parsed.port_or_known_default().ok_or("代理地址缺少端口")?;

    tauri::async_runtime::spawn_blocking(move || {
        let address = format!("{host}:{port}");
        let socket = address
            .to_socket_addrs()
            .map_err(|_| "无法解析代理主机".to_string())?
            .next()
            .ok_or_else(|| "找不到可用的代理地址".to_string())?;
        let started = Instant::now();
        match TcpStream::connect_timeout(&socket, Duration::from_secs(3)) {
            Ok(_) => Ok(ProxyTestResult {
                reachable: true,
                latency_ms: Some(started.elapsed().as_millis()),
                message: "本地端口可连接".into(),
            }),
            Err(error) => Ok(ProxyTestResult {
                reachable: false,
                latency_ms: None,
                message: format!("连接失败：{error}"),
            }),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

fn validate_proxy_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value)
        .map_err(|_| "代理地址格式无效，请使用 socks://主机:端口 或 http://主机:端口")?;
    if !matches!(parsed.scheme(), "socks" | "socks5" | "http") {
        return Err("首版仅支持 SOCKS5 和 HTTP 代理".into());
    }
    if parsed.host_str().is_none() || parsed.port_or_known_default().is_none() {
        return Err("代理地址必须包含有效的主机和端口".into());
    }
    Ok(parsed)
}

fn tray_icon() -> Image<'static> {
    let size = 32usize;
    let mut rgba = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let dx = x as isize - 16;
            let dy = y as isize - 16;
            let inside = dx * dx + dy * dy <= 12 * 12;
            let index = (y * size + x) * 4;
            if inside {
                rgba[index] = 21;
                rgba[index + 1] = 147;
                rgba[index + 2] = 61;
                rgba[index + 3] = 255;
            }
            if inside && (dx.abs() <= 2 || dy.abs() <= 2) {
                rgba[index] = 255;
                rgba[index + 1] = 255;
                rgba[index + 2] = 255;
            }
        }
    }
    Image::new_owned(rgba, size as u32, size as u32)
}

fn build_tray_menu(
    app: &tauri::AppHandle,
    state: &PersistedState,
) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let show = MenuItem::with_id(app, "show", "打开管理窗口", true, None::<&str>)?;
    let tun_label = if state.settings.tun_enabled {
        "关闭 TUN"
    } else {
        "开启 TUN"
    };
    let toggle = MenuItem::with_id(app, "toggle", tun_label, true, None::<&str>)?;
    menu.append(&show)?;
    menu.append(&toggle)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if !state.rules.is_empty() {
        let heading = MenuItem::with_id(app, "apps-heading", "常用应用", false, None::<&str>)?;
        menu.append(&heading)?;
        for rule in state.rules.iter().filter(|rule| rule.pinned).take(12) {
            let item = CheckMenuItem::with_id(
                app,
                format!("rule:{}", rule.id),
                &rule.display_name,
                true,
                rule.enabled,
                None::<&str>,
            )?;
            menu.append(&item)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    menu.append(&quit)?;
    Ok(menu)
}

fn refresh_tray_menu(app: &tauri::AppHandle, state: &PersistedState) -> Result<(), String> {
    let tray = app.tray_by_id("main").ok_or("找不到系统托盘图标")?;
    let menu = build_tray_menu(app, state).map_err(|error| format!("无法更新托盘菜单：{error}"))?;
    tray.set_menu(Some(menu))
        .map_err(|error| format!("无法更新托盘菜单：{error}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--minimized"])
                .build(),
        )
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let store = AppStore::new(config_dir.clone());
            store.ensure().map_err(std::io::Error::other)?;
            refresh_package_rule_scopes(&store).map_err(std::io::Error::other)?;
            let tun = TunManager::new(config_dir);
            if let Ok(state) = store.load() {
                if let Err(error) = tun.reconcile(&state) {
                    eprintln!("无法恢复 TUN：{error}");
                    let _ = store.update(|current| current.settings.tun_enabled = false);
                }
            }
            let initial_state = store.load().map_err(std::io::Error::other)?;
            app.manage(store);
            app.manage(tun);
            let menu = build_tray_menu(app.handle(), &initial_state)?;

            TrayIconBuilder::with_id("main")
                .icon(tray_icon())
                .tooltip("应用代理")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "toggle" => {
                        let _ = app.emit("tray-toggle-tun", ());
                    }
                    "quit" => app.exit(0),
                    id if id.starts_with("rule:") => {
                        let rule_id = id.trim_start_matches("rule:");
                        let store = app.state::<AppStore>();
                        let tun = app.state::<TunManager>();
                        if let Ok(updated) = store.update(|state| {
                            if let Some(rule) =
                                state.rules.iter_mut().find(|rule| rule.id == rule_id)
                            {
                                rule.enabled = !rule.enabled;
                                rule.updated_at = store::now_string();
                            }
                        }) {
                            let _ = reconcile_or_disable(app, &store, &tun, updated);
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            if std::env::args().any(|arg| arg == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_settings,
            add_rule,
            list_installed_apps,
            get_app_icon,
            update_rule,
            remove_rule,
            launch_rule_with_proxy,
            create_rule_desktop_launcher,
            create_rule_start_menu_launcher,
            test_proxy,
            get_tun_status,
            check_tun_ready,
            prepare_for_update,
            resume_after_update_failure
        ])
        .run(tauri::generate_context!())
        .expect("failed to run app-proxy");
}
