import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { DEFAULT_STATE } from "./defaults";
import type { AppRule, AppSettings, GitProxyStatus, InstalledApp, LauncherResult, PersistedState, ProxyTestResult } from "../types";

const STORAGE_KEY = "app-proxy-state-v1";

export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function inferBrowserPackageScope(executablePath: string, packageFamilyName?: string) {
  if (!packageFamilyName) return undefined;
  const marker = "\\windowsapps\\";
  const lowerPath = executablePath.toLocaleLowerCase();
  const packageStart = lowerPath.indexOf(marker);
  if (packageStart < 0) return undefined;
  const rootStart = packageStart + marker.length;
  const rootEnd = executablePath.indexOf("\\", rootStart);
  return rootEnd < 0 ? undefined : executablePath.slice(0, rootEnd);
}

function readBrowserState(): PersistedState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(DEFAULT_STATE);
  try {
    const stored = JSON.parse(raw) as Partial<PersistedState>;
    const defaults = structuredClone(DEFAULT_STATE);
    const currentSettings = stored.settings;
    return {
      ...defaults,
      ...stored,
      settings: {
        proxyUrl: currentSettings?.proxyUrl ?? defaults.settings.proxyUrl,
        launcherSuffix: currentSettings?.launcherSuffix ?? defaults.settings.launcherSuffix,
        theme: currentSettings?.theme ?? defaults.settings.theme,
        accentColor: currentSettings?.accentColor ?? defaults.settings.accentColor,
        launchAtLogin: currentSettings?.launchAtLogin ?? defaults.settings.launchAtLogin,
        startMinimized: currentSettings?.startMinimized ?? defaults.settings.startMinimized,
      },
      rules: (stored.rules ?? defaults.rules).map((rule) => {
        const executableScopeRoot = rule.executableScopeRoot
          ?? inferBrowserPackageScope(rule.executablePath, rule.packageFamilyName);
        return {
          id: rule.id,
          displayName: rule.displayName,
          executablePath: rule.executablePath,
          executableName: rule.executableName,
          packageFamilyName: rule.packageFamilyName,
          applicationId: rule.applicationId,
          executableScopeRoot,
          scopeExecutableCount: rule.scopeExecutableCount ?? (executableScopeRoot ? 1 : 0),
          pinned: rule.pinned,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
        };
      }),
    } as PersistedState;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function writeBrowserState(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function loadState(): Promise<PersistedState> {
  if (isTauriRuntime()) return invoke<PersistedState>("load_state");
  return readBrowserState();
}

export async function saveSettings(settings: AppSettings): Promise<PersistedState> {
  if (isTauriRuntime()) return invoke<PersistedState>("save_settings", { settings });
  const state = readBrowserState();
  state.settings = settings;
  writeBrowserState(state);
  return state;
}

export async function chooseExecutable(): Promise<string | null> {
  if (isTauriRuntime()) {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Windows 应用", extensions: ["exe"] }],
    });
    return typeof selected === "string" ? selected : null;
  }
  return "C:\\Program Files\\Example\\Example.exe";
}

export async function addRule(
  executablePath: string,
  displayName?: string,
  packageFamilyName?: string,
  applicationId?: string,
): Promise<PersistedState> {
  if (isTauriRuntime()) {
    return invoke<PersistedState>("add_rule", {
      executablePath,
      displayName,
      packageFamilyName,
      applicationId,
    });
  }
  const state = readBrowserState();
  const executableName = executablePath.split(/[\\/]/).at(-1) ?? "application.exe";
  const now = new Date().toISOString();
  const executableScopeRoot = inferBrowserPackageScope(executablePath, packageFamilyName);
  const rule: AppRule = {
    id: crypto.randomUUID(),
    displayName: displayName?.trim() || executableName.replace(/\.exe$/i, ""),
    executablePath,
    executableName,
    packageFamilyName,
    applicationId,
    executableScopeRoot,
    scopeExecutableCount: executableScopeRoot ? 8 : 0,
    pinned: true,
    createdAt: now,
    updatedAt: now,
  };
  state.rules = [
    rule,
    ...state.rules.filter((item) => {
      if (item.executablePath.toLocaleLowerCase() === executablePath.toLocaleLowerCase()) return false;
      return !(
        packageFamilyName
        && applicationId
        && item.packageFamilyName?.toLocaleLowerCase() === packageFamilyName.toLocaleLowerCase()
        && item.applicationId?.toLocaleLowerCase() === applicationId.toLocaleLowerCase()
      );
    }),
  ];
  writeBrowserState(state);
  return state;
}

export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (isTauriRuntime()) return invoke<InstalledApp[]>("list_installed_apps");
  const apps: InstalledApp[] = [
    {
      displayName: "ChatGPT",
      executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.715.4045.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe",
      executableName: "ChatGPT.exe",
      source: "msix-package",
      packageFamilyName: "OpenAI.Codex_2p2nqsd0c76g0",
      applicationId: "App",
    },
  ];
  const desktopApps = [
    ["Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
    ["Microsoft Edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
    ["Telegram Desktop", "C:\\Users\\User\\AppData\\Roaming\\Telegram Desktop\\Telegram.exe"],
    ["Visual Studio Code", "C:\\Users\\User\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"],
    ["Steam", "D:\\Steam\\steam.exe"],
    ["GitHub Desktop", "C:\\Users\\User\\AppData\\Local\\GitHubDesktop\\GitHubDesktop.exe"],
  ].map(([displayName, executablePath]): InstalledApp => ({
    displayName,
    executablePath,
    executableName: executablePath.split("\\").at(-1) ?? "application.exe",
    source: "browser-preview" as const,
  }));
  return [...apps, ...desktopApps];
}

export async function getAppIcon(executablePath: string): Promise<string | null> {
  if (isTauriRuntime()) return invoke<string | null>("get_app_icon", { executablePath });
  await new Promise((resolve) => window.setTimeout(resolve, 40));
  return "/app-icon.svg";
}

export async function removeRule(id: string): Promise<PersistedState> {
  if (isTauriRuntime()) return invoke<PersistedState>("remove_rule", { id });
  const state = readBrowserState();
  state.rules = state.rules.filter((rule) => rule.id !== id);
  writeBrowserState(state);
  return state;
}

export async function launchRuleWithProxy(id: string): Promise<LauncherResult> {
  if (isTauriRuntime()) return invoke<LauncherResult>("launch_rule_with_proxy", { id });
  const rule = readBrowserState().rules.find((item) => item.id === id);
  const displayName = rule?.displayName ?? "应用";
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  return {
    message: `已发送 ${displayName} 的环境代理启动请求（浏览器预览）`,
    launcherPath: `C:\\Users\\User\\AppData\\Local\\应用代理\\launchers\\${id}\\Launch-With-Proxy.cmd`,
    chromiumMode: true,
  };
}

export async function createRuleDesktopLauncher(id: string): Promise<LauncherResult> {
  if (isTauriRuntime()) return invoke<LauncherResult>("create_rule_desktop_launcher", { id });
  const state = readBrowserState();
  const rule = state.rules.find((item) => item.id === id);
  const displayName = rule?.displayName ?? "应用";
  const shortcutName = `${displayName}${state.settings.launcherSuffix}`;
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  return {
    message: `已创建“${shortcutName}”桌面启动器；关闭应用代理后仍可使用`,
    launcherPath: `C:\\Users\\User\\AppData\\Local\\应用代理\\launchers\\${id}\\Launch-With-Proxy.cmd`,
    shortcutPath: `C:\\Users\\User\\Desktop\\${shortcutName}.lnk`,
    chromiumMode: true,
  };
}

export async function createRuleStartMenuLauncher(id: string): Promise<LauncherResult> {
  if (isTauriRuntime()) return invoke<LauncherResult>("create_rule_start_menu_launcher", { id });
  const state = readBrowserState();
  const rule = state.rules.find((item) => item.id === id);
  const displayName = rule?.displayName ?? "应用";
  const shortcutName = `${displayName}${state.settings.launcherSuffix}`;
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  return {
    message: `已添加“${shortcutName}”至开始菜单的“所有应用”；可在开始菜单中右键选择“固定到开始屏幕”（浏览器预览）`,
    launcherPath: `C:\\Users\\User\\AppData\\Local\\应用代理\\launchers\\${id}\\Launch-With-Proxy.cmd`,
    shortcutPath: `C:\\Users\\User\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\应用代理\\${shortcutName}.lnk`,
    chromiumMode: true,
  };
}

export async function testProxy(proxyUrl: string): Promise<ProxyTestResult> {
  if (isTauriRuntime()) return invoke<ProxyTestResult>("test_proxy", { proxyUrl });
  await new Promise((resolve) => window.setTimeout(resolve, 420));
  return { reachable: true, latencyMs: 18, message: "本地端口可连接" };
}

const BROWSER_GIT_PROXY_KEY = "app-proxy-browser-git-proxy";

function browserGitProxyUrl() {
  const parsed = new URL(readBrowserState().settings.proxyUrl);
  if (parsed.protocol === "socks:" || parsed.protocol === "socks5:") parsed.protocol = "socks5h:";
  return parsed.toString().replace(/\/$/, "");
}

function browserGitProxyStatus(configuredProxy?: string | null): GitProxyStatus {
  const targetProxy = browserGitProxyUrl();
  const matchesAppProxy = configuredProxy === targetProxy;
  return {
    installed: true,
    version: "2.54.0.windows.1",
    httpProxies: configuredProxy ? [configuredProxy] : [],
    httpsProxies: configuredProxy ? [configuredProxy] : [],
    matchesAppProxy,
  };
}

export async function getGitProxyStatus(): Promise<GitProxyStatus> {
  if (isTauriRuntime()) return invoke<GitProxyStatus>("get_git_proxy_status");
  await new Promise((resolve) => window.setTimeout(resolve, 240));
  return browserGitProxyStatus(localStorage.getItem(BROWSER_GIT_PROXY_KEY));
}

export async function applyGitProxy(): Promise<GitProxyStatus> {
  if (isTauriRuntime()) return invoke<GitProxyStatus>("apply_git_proxy");
  await new Promise((resolve) => window.setTimeout(resolve, 360));
  const proxyUrl = browserGitProxyUrl();
  localStorage.setItem(BROWSER_GIT_PROXY_KEY, proxyUrl);
  return browserGitProxyStatus(proxyUrl);
}

export async function clearGitProxy(): Promise<GitProxyStatus> {
  if (isTauriRuntime()) return invoke<GitProxyStatus>("clear_git_proxy");
  await new Promise((resolve) => window.setTimeout(resolve, 360));
  localStorage.removeItem(BROWSER_GIT_PROXY_KEY);
  return browserGitProxyStatus();
}

export async function syncAutostart(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  const current = await isEnabled();
  if (enabled && !current) await enable();
  if (!enabled && current) await disable();
}
