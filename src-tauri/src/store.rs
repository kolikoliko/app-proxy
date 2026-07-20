use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub proxy_url: String,
    #[serde(default, alias = "globalEnabled")]
    pub tun_enabled: bool,
    pub theme: String,
    #[serde(default = "default_accent_color")]
    pub accent_color: String,
    pub launch_at_login: bool,
    pub start_minimized: bool,
    pub bypass_lan: bool,
    pub additional_bypass_cidrs: Vec<String>,
    pub exit_behavior: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pause_until: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            proxy_url: "socks://127.0.0.1:7890".into(),
            tun_enabled: false,
            theme: "system".into(),
            accent_color: default_accent_color(),
            launch_at_login: false,
            start_minimized: true,
            bypass_lan: true,
            additional_bypass_cidrs: Vec::new(),
            exit_behavior: "restore_direct".into(),
            pause_until: None,
        }
    }
}

fn default_accent_color() -> String {
    "green".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRule {
    pub id: String,
    pub display_name: String,
    pub executable_path: String,
    pub executable_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_family_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_scope_root: Option<String>,
    #[serde(default)]
    pub scope_executable_count: usize,
    pub enabled: bool,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub settings: AppSettings,
    pub rules: Vec<AppRule>,
}

pub struct AppStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl AppStore {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            path: config_dir.join("state.json"),
            lock: Mutex::new(()),
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|_| "配置锁异常")?;
        if self.path.exists() {
            return Ok(());
        }
        self.write_unlocked(&PersistedState::default())
    }

    pub fn load(&self) -> Result<PersistedState, String> {
        let _guard = self.lock.lock().map_err(|_| "配置锁异常")?;
        self.read_unlocked()
    }

    pub fn update<F>(&self, mutate: F) -> Result<PersistedState, String>
    where
        F: FnOnce(&mut PersistedState),
    {
        let _guard = self.lock.lock().map_err(|_| "配置锁异常")?;
        let mut state = self.read_unlocked()?;
        mutate(&mut state);
        self.write_unlocked(&state)?;
        Ok(state)
    }

    pub fn add_rule(
        &self,
        executable_path: &str,
        preferred_display_name: Option<&str>,
        package_family_name: Option<&str>,
        application_id: Option<&str>,
        executable_scope_root: Option<&str>,
        scope_executable_count: usize,
    ) -> Result<PersistedState, String> {
        let path = Path::new(executable_path);
        if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("exe"))
            != Some(true)
        {
            return Err("请选择 .exe 可执行文件".into());
        }
        if !path.is_file() {
            return Err("所选程序不存在或无法访问".into());
        }
        let canonical =
            fs::canonicalize(path).map_err(|error| format!("无法读取程序路径：{error}"))?;
        let path_string = canonical
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        let executable_name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or("无法读取程序名称")?
            .to_string();
        let display_name = preferred_display_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| executable_name.trim_end_matches(".exe"))
            .to_string();
        let now = now_string();

        self.update(|state| {
            let same_package_app = |rule: &&mut AppRule| {
                package_family_name
                    .zip(application_id)
                    .is_some_and(|(family, app_id)| {
                        rule.package_family_name
                            .as_deref()
                            .zip(rule.application_id.as_deref())
                            .is_some_and(|(saved_family, saved_app_id)| {
                                saved_family.eq_ignore_ascii_case(family)
                                    && saved_app_id.eq_ignore_ascii_case(app_id)
                            })
                    })
            };
            if let Some(existing) = state.rules.iter_mut().find(|rule| {
                rule.executable_path.eq_ignore_ascii_case(&path_string) || same_package_app(rule)
            }) {
                let executable_unchanged =
                    existing.executable_path.eq_ignore_ascii_case(&path_string);
                existing.display_name = display_name.clone();
                existing.executable_path = path_string.clone();
                existing.executable_name = executable_name.clone();
                existing.package_family_name = package_family_name.map(str::to_string);
                existing.application_id = application_id.map(str::to_string);
                existing.executable_scope_root = executable_scope_root.map(str::to_string);
                existing.scope_executable_count = scope_executable_count;
                // A Store update changes the versioned WindowsApps path. Preserve
                // the user's switch while repairing that path.
                if executable_unchanged {
                    existing.enabled = true;
                }
                existing.updated_at = now.clone();
                return;
            }
            state.rules.insert(
                0,
                AppRule {
                    id: Uuid::new_v4().to_string(),
                    display_name,
                    executable_path: path_string,
                    executable_name,
                    package_family_name: package_family_name.map(str::to_string),
                    application_id: application_id.map(str::to_string),
                    executable_scope_root: executable_scope_root.map(str::to_string),
                    scope_executable_count,
                    enabled: true,
                    pinned: true,
                    created_at: now.clone(),
                    updated_at: now,
                },
            );
        })
    }

    fn read_unlocked(&self) -> Result<PersistedState, String> {
        if !self.path.exists() {
            return Ok(PersistedState::default());
        }
        let raw =
            fs::read_to_string(&self.path).map_err(|error| format!("无法读取配置：{error}"))?;
        serde_json::from_str(&raw).map_err(|error| format!("配置文件格式错误：{error}"))
    }

    fn write_unlocked(&self, state: &PersistedState) -> Result<(), String> {
        let parent = self.path.parent().ok_or("无法确定配置目录")?;
        fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
        let raw = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
        fs::write(&self.path, raw).map_err(|error| format!("无法保存配置：{error}"))
    }
}

pub fn now_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{AppRule, AppSettings};

    #[test]
    fn old_settings_migrate_global_switch_and_green_accent() {
        let raw = r#"{
            "proxyUrl":"socks://127.0.0.1:7890",
            "globalEnabled":true,
            "theme":"system",
            "launchAtLogin":false,
            "startMinimized":true,
            "bypassLan":true,
            "additionalBypassCidrs":[],
            "exitBehavior":"restore_direct"
        }"#;
        let settings: AppSettings = serde_json::from_str(raw).expect("legacy settings");
        assert_eq!(settings.accent_color, "green");
        assert!(settings.tun_enabled);
    }

    #[test]
    fn old_application_rule_migrates_to_exact_executable_scope() {
        let raw = r#"{
            "id":"legacy",
            "displayName":"Browser",
            "executablePath":"C:\\Browser\\browser.exe",
            "executableName":"browser.exe",
            "enabled":true,
            "pinned":true,
            "createdAt":"0",
            "updatedAt":"0"
        }"#;
        let rule: AppRule = serde_json::from_str(raw).expect("legacy application rule");
        assert!(rule.executable_scope_root.is_none());
        assert_eq!(rule.scope_executable_count, 0);
    }
}
