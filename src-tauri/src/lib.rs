mod icon_extractor;
mod installed_apps;
mod launcher;
mod store;
mod tool_proxy;

use installed_apps::InstalledApp;
use launcher::LauncherResult;
use serde::Serialize;
use std::{
    net::{TcpStream, ToSocketAddrs},
    time::{Duration, Instant},
};
use store::{AppSettings, AppStore, PersistedState};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tool_proxy::GitProxyStatus;

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
    app: tauri::AppHandle,
) -> Result<PersistedState, String> {
    validate_proxy_url(&settings.proxy_url)?;
    settings.launcher_suffix = settings.launcher_suffix.trim().to_string();
    if settings.launcher_suffix.chars().count() > 40 {
        return Err("快捷方式后缀不能超过 40 个字符".into());
    }
    if settings.launcher_suffix.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )
    }) {
        return Err("快捷方式后缀不能包含 Windows 文件名非法字符".into());
    }
    if !matches!(
        settings.accent_color.as_str(),
        "green" | "blue" | "purple" | "yellow" | "rose" | "cyan"
    ) {
        return Err("不支持的主题色".into());
    }
    let updated = store.update(|state| state.settings = settings)?;
    refresh_tray_menu(&app, &updated)?;
    Ok(updated)
}

#[tauri::command]
fn add_rule(
    executable_path: String,
    display_name: Option<String>,
    package_family_name: Option<String>,
    application_id: Option<String>,
    store: tauri::State<'_, AppStore>,
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
    refresh_tray_menu(&app, &updated)?;
    Ok(updated)
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
fn remove_rule(
    id: String,
    store: tauri::State<'_, AppStore>,
    app: tauri::AppHandle,
) -> Result<PersistedState, String> {
    let updated = store.update(|state| state.rules.retain(|rule| rule.id != id))?;
    refresh_tray_menu(&app, &updated)?;
    Ok(updated)
}

fn launcher_rule(store: &AppStore, id: &str) -> Result<(store::AppRule, String, String), String> {
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
    Ok((
        rule,
        state.settings.proxy_url,
        state.settings.launcher_suffix,
    ))
}

#[tauri::command]
fn launch_rule_with_proxy(
    id: String,
    store: tauri::State<'_, AppStore>,
    app: tauri::AppHandle,
) -> Result<LauncherResult, String> {
    let (rule, proxy_url, _) = launcher_rule(&store, &id)?;
    launcher::launch_with_proxy(&app, &rule, &proxy_url)
}

#[tauri::command]
fn create_rule_desktop_launcher(
    id: String,
    store: tauri::State<'_, AppStore>,
    app: tauri::AppHandle,
) -> Result<LauncherResult, String> {
    let (rule, proxy_url, launcher_suffix) = launcher_rule(&store, &id)?;
    launcher::create_desktop_launcher(&app, &rule, &proxy_url, &launcher_suffix)
}

#[tauri::command]
fn create_rule_start_menu_launcher(
    id: String,
    store: tauri::State<'_, AppStore>,
    app: tauri::AppHandle,
) -> Result<LauncherResult, String> {
    let (rule, proxy_url, launcher_suffix) = launcher_rule(&store, &id)?;
    launcher::create_start_menu_launcher(&app, &rule, &proxy_url, &launcher_suffix)
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

#[tauri::command]
async fn get_git_proxy_status(store: tauri::State<'_, AppStore>) -> Result<GitProxyStatus, String> {
    let proxy_url = store.load()?.settings.proxy_url;
    tauri::async_runtime::spawn_blocking(move || tool_proxy::get_git_proxy_status(&proxy_url))
        .await
        .map_err(|error| format!("读取 Git 代理任务失败：{error}"))?
}

#[tauri::command]
async fn apply_git_proxy(store: tauri::State<'_, AppStore>) -> Result<GitProxyStatus, String> {
    let proxy_url = store.load()?.settings.proxy_url;
    tauri::async_runtime::spawn_blocking(move || tool_proxy::apply_git_proxy(&proxy_url))
        .await
        .map_err(|error| format!("设置 Git 代理任务失败：{error}"))?
}

#[tauri::command]
async fn clear_git_proxy(store: tauri::State<'_, AppStore>) -> Result<GitProxyStatus, String> {
    let proxy_url = store.load()?.settings.proxy_url;
    tauri::async_runtime::spawn_blocking(move || tool_proxy::clear_git_proxy(&proxy_url))
        .await
        .map_err(|error| format!("清除 Git 代理任务失败：{error}"))?
}

fn validate_proxy_url(value: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(value)
        .map_err(|_| "代理地址格式无效，请使用 socks://主机:端口 或 http://主机:端口")?;
    if !matches!(parsed.scheme(), "socks" | "socks5" | "http" | "https") {
        return Err("仅支持 SOCKS、HTTP 和 HTTPS 代理".into());
    }
    if parsed.host_str().is_none() || parsed.port_or_known_default().is_none() {
        return Err("代理地址必须包含有效的主机和端口".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("代理地址不支持账号密码；请使用不含 userinfo 的代理地址".into());
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
    menu.append(&show)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if !state.rules.is_empty() {
        let heading = MenuItem::with_id(app, "apps-heading", "常用应用", false, None::<&str>)?;
        menu.append(&heading)?;
        for rule in state.rules.iter().filter(|rule| rule.pinned).take(12) {
            let item = MenuItem::with_id(
                app,
                format!("launch:{}", rule.id),
                format!("使用代理启动 {}", rule.display_name),
                true,
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
            let store = AppStore::new(config_dir);
            store.ensure().map_err(std::io::Error::other)?;
            refresh_package_rule_scopes(&store).map_err(std::io::Error::other)?;
            let initial_state = store.load().map_err(std::io::Error::other)?;
            app.manage(store);
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
                    "quit" => app.exit(0),
                    id if id.starts_with("launch:") => {
                        let rule_id = id.trim_start_matches("launch:");
                        let store = app.state::<AppStore>();
                        if let Ok((rule, proxy_url, _)) = launcher_rule(&store, rule_id) {
                            let _ = launcher::launch_with_proxy(app, &rule, &proxy_url);
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
            remove_rule,
            launch_rule_with_proxy,
            create_rule_desktop_launcher,
            create_rule_start_menu_launcher,
            test_proxy,
            get_git_proxy_status,
            apply_git_proxy,
            clear_git_proxy
        ])
        .run(tauri::generate_context!())
        .expect("failed to run app-proxy");
}

#[cfg(test)]
mod tests {
    use super::validate_proxy_url;

    #[test]
    fn rejects_proxy_userinfo_without_echoing_credentials() {
        let error = validate_proxy_url("socks://alice:secret@127.0.0.1:7890").unwrap_err();
        assert!(error.contains("不支持账号密码"));
        assert!(!error.contains("alice"));
        assert!(!error.contains("secret"));
    }

    #[test]
    fn accepts_unauthenticated_proxy_url() {
        assert!(validate_proxy_url("socks://127.0.0.1:7890").is_ok());
        assert!(validate_proxy_url("http://127.0.0.1:7890").is_ok());
        assert!(validate_proxy_url("https://127.0.0.1:7890").is_ok());
    }
}
