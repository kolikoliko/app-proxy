use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub display_name: String,
    pub executable_path: String,
    pub executable_name: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_family_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PackageApplicationScope {
    pub executable_path: String,
    pub executable_name: String,
    pub executable_scope_root: String,
    pub executable_count: usize,
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{InstalledApp, PackageApplicationScope};
    use quick_xml::{events::Event, Reader, XmlVersion};
    use std::{
        collections::BTreeMap,
        env, fs,
        path::{Path, PathBuf},
    };
    use windows::{core::HSTRING, Management::Deployment::PackageManager};
    use winreg::{
        enums::{
            HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
        },
        RegKey,
    };

    const APP_PATHS: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths";
    const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

    pub fn discover() -> Vec<InstalledApp> {
        let mut apps = BTreeMap::<String, InstalledApp>::new();
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        for root in [&hklm, &hkcu] {
            for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
                scan_uninstall(root, view, &mut apps);
                scan_app_paths(root, view, &mut apps);
            }
        }

        scan_msix_packages(&mut apps);

        let mut result: Vec<_> = apps.into_values().collect();
        result.sort_by(|left, right| {
            left.display_name
                .to_lowercase()
                .cmp(&right.display_name.to_lowercase())
        });
        result
    }

    fn scan_app_paths(root: &RegKey, view: u32, apps: &mut BTreeMap<String, InstalledApp>) {
        let Ok(parent) = root.open_subkey_with_flags(APP_PATHS, KEY_READ | view) else {
            return;
        };
        for key_name in parent.enum_keys().flatten() {
            let Ok(entry) = parent.open_subkey_with_flags(&key_name, KEY_READ | view) else {
                continue;
            };
            let Ok(raw_path) = entry.get_value::<String, _>("") else {
                continue;
            };
            let display_name = key_name.trim_end_matches(".exe").to_string();
            insert_candidate(apps, &display_name, &raw_path, "registry-app-path");
        }
    }

    fn scan_uninstall(root: &RegKey, view: u32, apps: &mut BTreeMap<String, InstalledApp>) {
        let Ok(parent) = root.open_subkey_with_flags(UNINSTALL, KEY_READ | view) else {
            return;
        };
        for key_name in parent.enum_keys().flatten() {
            let Ok(entry) = parent.open_subkey_with_flags(&key_name, KEY_READ | view) else {
                continue;
            };
            if entry.get_value::<u32, _>("SystemComponent").unwrap_or(0) == 1 {
                continue;
            }
            let Ok(display_name) = entry.get_value::<String, _>("DisplayName") else {
                continue;
            };
            let Ok(display_icon) = entry.get_value::<String, _>("DisplayIcon") else {
                continue;
            };
            insert_candidate(apps, &display_name, &display_icon, "registry-uninstall");
        }
    }

    fn insert_candidate(
        apps: &mut BTreeMap<String, InstalledApp>,
        display_name: &str,
        raw_path: &str,
        source: &str,
    ) {
        let Some(path) = executable_from_value(raw_path) else {
            return;
        };
        let executable_name = match path.file_name().and_then(|value| value.to_str()) {
            Some(value) => value.to_string(),
            None => return,
        };
        let executable_path = path
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string();
        let key = executable_path.to_lowercase();
        apps.entry(key).or_insert_with(|| InstalledApp {
            display_name: display_name.trim().to_string(),
            executable_path,
            executable_name,
            source: source.to_string(),
            package_family_name: None,
            application_id: None,
        });
    }

    fn scan_msix_packages(apps: &mut BTreeMap<String, InstalledApp>) {
        let Ok(manager) = PackageManager::new() else {
            return;
        };
        // Windows treats an empty SID as the current user for this API.
        let Ok(packages) = manager.FindPackagesByUserSecurityId(&HSTRING::new()) else {
            return;
        };

        for package in packages {
            if package.IsFramework().unwrap_or(true) || package.IsResourcePackage().unwrap_or(true)
            {
                continue;
            }
            let Ok(identity) = package.Id() else {
                continue;
            };
            let Ok(family_name) = identity.FamilyName() else {
                continue;
            };
            let Ok(location) = package.InstalledLocation() else {
                continue;
            };
            let Ok(location_path) = location.Path() else {
                continue;
            };
            let package_root = PathBuf::from(location_path.to_string());
            let display_name = package
                .DisplayName()
                .map(|value| value.to_string())
                .unwrap_or_default();

            for application in manifest_applications(&package_root) {
                let candidate = package_root.join(application.executable.replace('/', "\\"));
                let Ok(canonical) = fs::canonicalize(candidate) else {
                    continue;
                };
                if !canonical.is_file()
                    || canonical
                        .extension()
                        .and_then(|value| value.to_str())
                        .map(|value| !value.eq_ignore_ascii_case("exe"))
                        .unwrap_or(true)
                {
                    continue;
                }
                let Some(executable_name) = canonical.file_name().and_then(|value| value.to_str())
                else {
                    continue;
                };
                let executable_path = canonical
                    .to_string_lossy()
                    .trim_start_matches(r"\\?\")
                    .to_string();
                let friendly_name = application
                    .display_name
                    .filter(|value| !value.starts_with("ms-resource:"))
                    .or_else(|| {
                        (!display_name.is_empty() && !display_name.starts_with("ms-resource:"))
                            .then(|| display_name.clone())
                    })
                    .unwrap_or_else(|| executable_name.trim_end_matches(".exe").to_string());

                apps.insert(
                    executable_path.to_lowercase(),
                    InstalledApp {
                        display_name: friendly_name,
                        executable_path,
                        executable_name: executable_name.to_string(),
                        source: "msix-package".to_string(),
                        package_family_name: Some(family_name.to_string()),
                        application_id: Some(application.id),
                    },
                );
            }
        }
    }

    pub fn resolve_package_application(
        package_family_name: &str,
        application_id: Option<&str>,
    ) -> Option<PackageApplicationScope> {
        let manager = PackageManager::new().ok()?;
        let packages = manager.FindPackagesByUserSecurityId(&HSTRING::new()).ok()?;

        for package in packages {
            if package.IsFramework().unwrap_or(true) || package.IsResourcePackage().unwrap_or(true)
            {
                continue;
            }
            let Ok(identity) = package.Id() else {
                continue;
            };
            let Ok(family_name) = identity.FamilyName() else {
                continue;
            };
            let family_name = family_name.to_string();
            if !family_name.eq_ignore_ascii_case(package_family_name) {
                continue;
            }
            let Ok(location) = package.InstalledLocation() else {
                continue;
            };
            let Ok(location_path) = location.Path() else {
                continue;
            };
            let location = location_path.to_string();
            let package_root = PathBuf::from(location);
            let canonical_root = fs::canonicalize(&package_root).ok()?;
            let applications = manifest_applications(&package_root);
            let application = application_id
                .and_then(|expected| {
                    applications
                        .iter()
                        .find(|application| application.id.eq_ignore_ascii_case(expected))
                })
                .or_else(|| applications.first())?;
            let executable =
                fs::canonicalize(package_root.join(application.executable.replace('/', "\\")))
                    .ok()?;
            if !is_executable_file(&executable) {
                return None;
            }
            let executable_name = executable.file_name()?.to_str()?.to_string();
            return Some(PackageApplicationScope {
                executable_path: display_path(&executable),
                executable_name,
                executable_scope_root: display_path(&canonical_root),
                executable_count: count_executables(&canonical_root).max(1),
            });
        }
        None
    }

    fn is_executable_file(path: &Path) -> bool {
        path.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
    }

    fn display_path(path: &Path) -> String {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string()
    }

    fn count_executables(root: &Path) -> usize {
        const MAX_COMPONENTS: usize = 4096;
        const MAX_DIRECTORIES: usize = 8192;
        let mut directories = vec![root.to_path_buf()];
        let mut visited_directories = 0usize;
        let mut count = 0usize;
        while let Some(directory) = directories.pop() {
            visited_directories += 1;
            if visited_directories > MAX_DIRECTORIES {
                break;
            }
            let Ok(entries) = fs::read_dir(directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    directories.push(path);
                } else if is_executable_file(&path) {
                    count += 1;
                    if count >= MAX_COMPONENTS {
                        return count;
                    }
                }
            }
        }
        count
    }

    #[derive(Debug, PartialEq)]
    struct ManifestApplication {
        id: String,
        executable: String,
        display_name: Option<String>,
        square44_logo: Option<String>,
        square150_logo: Option<String>,
    }

    fn manifest_applications(package_root: &Path) -> Vec<ManifestApplication> {
        let Ok(raw) = fs::read(package_root.join("AppxManifest.xml")) else {
            return Vec::new();
        };
        parse_manifest_applications(&raw)
    }

    fn parse_manifest_applications(raw: &[u8]) -> Vec<ManifestApplication> {
        let mut reader = Reader::from_reader(raw);
        reader.config_mut().trim_text(true);
        let mut buffer = Vec::new();
        let mut applications = Vec::new();
        let mut current: Option<ManifestApplication> = None;

        loop {
            match reader.read_event_into(&mut buffer) {
                Ok(Event::Start(element)) | Ok(Event::Empty(element))
                    if element.local_name().as_ref() == b"Application" =>
                {
                    let mut id = None;
                    let mut executable = None;
                    for attribute in element.attributes().flatten() {
                        let Ok(value) = attribute.decoded_and_normalized_value(
                            XmlVersion::Implicit1_0,
                            reader.decoder(),
                        ) else {
                            continue;
                        };
                        match attribute.key.local_name().as_ref() {
                            b"Id" => id = Some(value.into_owned()),
                            b"Executable" => executable = Some(value.into_owned()),
                            _ => {}
                        }
                    }
                    if let (Some(id), Some(executable)) = (id, executable) {
                        current = Some(ManifestApplication {
                            id,
                            executable,
                            display_name: None,
                            square44_logo: None,
                            square150_logo: None,
                        });
                    }
                }
                Ok(Event::Start(element)) | Ok(Event::Empty(element))
                    if element.local_name().as_ref() == b"VisualElements" =>
                {
                    if let Some(application) = current.as_mut() {
                        for attribute in element.attributes().flatten() {
                            if let Ok(value) = attribute.decoded_and_normalized_value(
                                XmlVersion::Implicit1_0,
                                reader.decoder(),
                            ) {
                                match attribute.key.local_name().as_ref() {
                                    b"DisplayName" => {
                                        application.display_name = Some(value.into_owned())
                                    }
                                    b"Square44x44Logo" => {
                                        application.square44_logo = Some(value.into_owned())
                                    }
                                    b"Square150x150Logo" => {
                                        application.square150_logo = Some(value.into_owned())
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                Ok(Event::End(element)) if element.local_name().as_ref() == b"Application" => {
                    if let Some(application) = current.take() {
                        applications.push(application);
                    }
                }
                Ok(Event::Eof) => {
                    if let Some(application) = current.take() {
                        applications.push(application);
                    }
                    break;
                }
                Err(_) => break,
                _ => {}
            }
            buffer.clear();
        }
        applications
    }

    pub fn resolve_package_icon_path(
        package_root: &str,
        application_id: Option<&str>,
    ) -> Option<PathBuf> {
        let package_root = Path::new(package_root);
        let applications = manifest_applications(package_root);
        let application = application_id
            .and_then(|expected| {
                applications
                    .iter()
                    .find(|application| application.id.eq_ignore_ascii_case(expected))
            })
            .or_else(|| applications.first())?;

        application
            .square44_logo
            .as_deref()
            .and_then(|logo| best_logo_asset(package_root, logo))
            .or_else(|| {
                application
                    .square150_logo
                    .as_deref()
                    .and_then(|logo| best_logo_asset(package_root, logo))
            })
    }

    fn best_logo_asset(package_root: &Path, manifest_value: &str) -> Option<PathBuf> {
        let base = package_root.join(manifest_value.replace('/', "\\"));
        let directory = base.parent()?.to_path_buf();
        let stem = base.file_stem()?.to_str()?.to_ascii_lowercase();
        let mut candidates = Vec::new();
        if base.is_file() {
            candidates.push((logo_asset_score(&base), base));
        }
        for entry in fs::read_dir(directory).ok()?.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let lower = name.to_ascii_lowercase();
            if !lower.ends_with(".png")
                || !(lower == format!("{stem}.png") || lower.starts_with(&format!("{stem}.")))
            {
                continue;
            }
            candidates.push((logo_asset_score(&path), path));
        }
        candidates
            .into_iter()
            .max_by_key(|(score, _)| *score)
            .map(|(_, path)| path)
    }

    fn logo_asset_score(path: &Path) -> u32 {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let target_size = name
            .split("targetsize-")
            .nth(1)
            .and_then(|value| {
                value
                    .split(|character: char| !character.is_ascii_digit())
                    .next()
            })
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        let scale = name
            .split("scale-")
            .nth(1)
            .and_then(|value| {
                value
                    .split(|character: char| !character.is_ascii_digit())
                    .next()
            })
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0);
        if target_size > 256 {
            return 0;
        }
        let variant = if name.contains("altform-unplated") {
            30_000
        } else if name.contains("altform-lightunplated") {
            20_000
        } else if target_size > 0 {
            10_000
        } else if scale == 0 {
            1_000
        } else {
            0
        };
        variant + target_size.max(scale / 2)
    }

    fn executable_from_value(raw: &str) -> Option<PathBuf> {
        let expanded = expand_environment_variables(raw.trim());
        let lower = expanded.to_ascii_lowercase();
        let exe_end = lower.find(".exe")? + 4;
        let candidate = expanded[..exe_end].trim().trim_matches('"');
        let canonical = fs::canonicalize(candidate).ok()?;
        canonical.is_file().then_some(canonical)
    }

    fn expand_environment_variables(value: &str) -> String {
        let mut result = value.to_string();
        let mut cursor = 0usize;
        while let Some(start_offset) = result[cursor..].find('%') {
            let start = cursor + start_offset;
            let Some(end_offset) = result[start + 1..].find('%') else {
                break;
            };
            let end = start + 1 + end_offset;
            let name = &result[start + 1..end];
            let Ok(replacement) = env::var(name) else {
                cursor = end + 1;
                continue;
            };
            result.replace_range(start..=end, &replacement);
            cursor = start + replacement.len();
        }
        result
    }

    #[cfg(test)]
    mod tests {
        use super::{
            best_logo_asset, discover, executable_from_value, parse_manifest_applications,
            resolve_package_application, resolve_package_icon_path,
        };
        use std::{collections::HashSet, env};

        #[test]
        fn accepts_quoted_icon_resource_paths() {
            let current_exe = env::current_exe().expect("current executable path");
            let raw = format!("\"{}\",0", current_exe.display());
            let parsed = executable_from_value(&raw).expect("parsed executable path");
            assert!(parsed.is_file());
            assert_eq!(parsed.file_name(), current_exe.file_name());
        }

        #[test]
        fn discovered_apps_have_unique_existing_executables() {
            let mut paths = HashSet::new();
            for app in discover() {
                assert!(app.executable_path.to_ascii_lowercase().ends_with(".exe"));
                assert!(std::path::Path::new(&app.executable_path).is_file());
                assert!(paths.insert(app.executable_path.to_lowercase()));
                if app.source == "msix-package" {
                    assert!(app.package_family_name.is_some());
                    assert!(app.application_id.is_some());
                }
            }
        }

        #[test]
        fn discovers_chatgpt_when_its_msix_package_is_installed() {
            use windows::{core::HSTRING, Management::Deployment::PackageManager};

            let Some(packages) = PackageManager::new()
                .ok()
                .and_then(|manager| manager.FindPackagesByUserSecurityId(&HSTRING::new()).ok())
            else {
                return;
            };
            let installed = packages.into_iter().any(|package| {
                package
                    .Id()
                    .and_then(|identity| identity.FamilyName())
                    .map(|family| {
                        family
                            .to_string()
                            .eq_ignore_ascii_case("OpenAI.Codex_2p2nqsd0c76g0")
                    })
                    .unwrap_or(false)
            });

            if installed {
                assert!(discover().into_iter().any(|app| {
                    app.package_family_name.as_deref().is_some_and(|family| {
                        family.eq_ignore_ascii_case("OpenAI.Codex_2p2nqsd0c76g0")
                    }) && app.display_name.eq_ignore_ascii_case("ChatGPT")
                        && app.executable_name.eq_ignore_ascii_case("ChatGPT.exe")
                }));
            }
        }

        #[test]
        fn resolves_chatgpt_package_as_an_application_group_when_installed() {
            let Some(scope) =
                resolve_package_application("OpenAI.Codex_2p2nqsd0c76g0", Some("App"))
            else {
                return;
            };
            assert!(scope.executable_path.ends_with(r"\app\ChatGPT.exe"));
            assert!(scope.executable_count > 1);
            assert!(std::path::Path::new(&scope.executable_scope_root)
                .join(r"app\resources\codex.exe")
                .is_file());
        }

        #[test]
        fn resolves_chatgpt_high_resolution_unplated_icon_when_installed() {
            let Some(scope) =
                resolve_package_application("OpenAI.Codex_2p2nqsd0c76g0", Some("App"))
            else {
                return;
            };
            let icon = resolve_package_icon_path(&scope.executable_scope_root, Some("App"))
                .expect("ChatGPT manifest icon");
            let name = icon
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            assert!(name.contains("targetsize-256_altform-unplated"));
        }

        #[test]
        fn parses_full_trust_msix_application() {
            let manifest = br#"<Package xmlns:uap="urn:test"><Applications><Application Id="App" Executable="app/ChatGPT.exe"><uap:VisualElements DisplayName="ChatGPT" Square44x44Logo="assets/Square44x44Logo.png" Square150x150Logo="assets/Square150x150Logo.png" /></Application></Applications></Package>"#;
            let applications = parse_manifest_applications(manifest);
            assert_eq!(applications.len(), 1);
            assert_eq!(applications[0].id, "App");
            assert_eq!(applications[0].executable, "app/ChatGPT.exe");
            assert_eq!(applications[0].display_name.as_deref(), Some("ChatGPT"));
            assert_eq!(
                applications[0].square44_logo.as_deref(),
                Some("assets/Square44x44Logo.png")
            );
        }

        #[test]
        fn prefers_high_resolution_unplated_store_logo() {
            let directory = std::env::temp_dir().join(format!(
                "app-proxy-logo-selection-test-{}",
                uuid::Uuid::new_v4()
            ));
            let assets = directory.join("assets");
            std::fs::create_dir_all(&assets).unwrap();
            for name in [
                "Square44x44Logo.png",
                "Square44x44Logo.scale-200.png",
                "Square44x44Logo.targetsize-48_altform-unplated.png",
                "Square44x44Logo.targetsize-256_altform-unplated.png",
                "Square44x44Logo.targetsize-256_altform-lightunplated.png",
            ] {
                std::fs::write(assets.join(name), []).unwrap();
            }
            let selected = best_logo_asset(&directory, r"assets\Square44x44Logo.png").unwrap();
            assert_eq!(
                selected.file_name().and_then(|value| value.to_str()),
                Some("Square44x44Logo.targetsize-256_altform-unplated.png")
            );
            std::fs::remove_dir_all(directory).unwrap();
        }
    }
}

#[cfg(target_os = "windows")]
pub fn discover_installed_apps() -> Vec<InstalledApp> {
    windows::discover()
}

#[cfg(target_os = "windows")]
pub fn resolve_package_application(
    package_family_name: &str,
    application_id: Option<&str>,
) -> Option<PackageApplicationScope> {
    windows::resolve_package_application(package_family_name, application_id)
}

#[cfg(target_os = "windows")]
pub fn resolve_package_icon_path(
    package_root: &str,
    application_id: Option<&str>,
) -> Option<std::path::PathBuf> {
    windows::resolve_package_icon_path(package_root, application_id)
}

#[cfg(not(target_os = "windows"))]
pub fn discover_installed_apps() -> Vec<InstalledApp> {
    Vec::new()
}

#[cfg(not(target_os = "windows"))]
pub fn resolve_package_application(
    _package_family_name: &str,
    _application_id: Option<&str>,
) -> Option<PackageApplicationScope> {
    None
}

#[cfg(not(target_os = "windows"))]
pub fn resolve_package_icon_path(
    _package_root: &str,
    _application_id: Option<&str>,
) -> Option<std::path::PathBuf> {
    None
}
