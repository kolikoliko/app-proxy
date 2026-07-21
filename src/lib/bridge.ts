import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { DEFAULT_STATE } from "./defaults";
import type { AppRule, AppSettings, InstalledApp, LauncherResult, PersistedState, ProxyTestResult, TunStatus } from "../types";

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
    const legacySettings = stored.settings as (Partial<AppSettings> & { globalEnabled?: boolean }) | undefined;
    const { globalEnabled, ...currentSettings } = legacySettings ?? {};
    return {
      ...defaults,
      ...stored,
      settings: {
        ...defaults.settings,
        ...currentSettings,
        tunEnabled: currentSettings.tunEnabled ?? globalEnabled ?? defaults.settings.tunEnabled,
      },
      rules: (stored.rules ?? defaults.rules).map((rule) => {
        const executableScopeRoot = rule.executableScopeRoot
          ?? inferBrowserPackageScope(rule.executablePath, rule.packageFamilyName);
        return {
          ...rule,
          executableScopeRoot,
          scopeExecutableCount: rule.scopeExecutableCount ?? (executableScopeRoot ? 1 : 0),
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
    enabled: true,
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

export async function updateRule(id: string, enabled: boolean): Promise<PersistedState> {
  if (isTauriRuntime()) return invoke<PersistedState>("update_rule", { id, enabled });
  const state = readBrowserState();
  state.rules = state.rules.map((rule) =>
    rule.id === id ? { ...rule, enabled, updatedAt: new Date().toISOString() } : rule,
  );
  writeBrowserState(state);
  return state;
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
  const rule = readBrowserState().rules.find((item) => item.id === id);
  const displayName = rule?.displayName ?? "应用";
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  return {
    message: `已创建“${displayName} - 应用代理”桌面启动器；关闭应用代理后仍可使用`,
    launcherPath: `C:\\Users\\User\\AppData\\Local\\应用代理\\launchers\\${id}\\Launch-With-Proxy.cmd`,
    shortcutPath: `C:\\Users\\User\\Desktop\\${displayName} - 应用代理.lnk`,
    chromiumMode: true,
  };
}

export async function testProxy(proxyUrl: string): Promise<ProxyTestResult> {
  if (isTauriRuntime()) return invoke<ProxyTestResult>("test_proxy", { proxyUrl });
  await new Promise((resolve) => window.setTimeout(resolve, 420));
  return { reachable: true, latencyMs: 18, message: "本地端口可连接" };
}

function browserTunStatus(state: PersistedState): TunStatus {
  const enabledApps = state.rules.filter((rule) => rule.enabled).length;
  const protocolNote = state.settings.proxyUrl.startsWith("http://")
    ? "HTTP 上游仅代理 TCP；应用的 UDP 流量保持直连。需要 UDP 时请使用 SOCKS5。"
    : undefined;
  if (state.settings.tunEnabled && state.settings.pauseUntil) {
    return { phase: "paused", message: "TUN 已定时暂停，应用规则保持不变", kernelVersion: "1.13.12", protocolNote };
  }
  if (state.settings.tunEnabled && enabledApps === 0) {
    return { phase: "waiting", message: "TUN 已开启，等待至少一个应用规则", kernelVersion: "1.13.12", protocolNote };
  }
  if (state.settings.tunEnabled) {
    return { phase: "running", message: "TUN 正在运行，仅代理已开启的应用", kernelVersion: "1.13.12", protocolNote };
  }
  return { phase: "stopped", message: "TUN 已关闭，应用规则保持不变", kernelVersion: "1.13.12", protocolNote };
}

export async function getTunStatus(): Promise<TunStatus> {
  if (isTauriRuntime()) return invoke<TunStatus>("get_tun_status");
  return browserTunStatus(readBrowserState());
}

export async function checkTunReady(): Promise<TunStatus> {
  if (isTauriRuntime()) return invoke<TunStatus>("check_tun_ready");
  const state = readBrowserState();
  if (!state.rules.some((rule) => rule.enabled)) throw new Error("请先至少开启一个应用规则");
  return {
    ...browserTunStatus(state),
    phase: "ready",
    message: "TUN 配置校验通过，内核已就绪",
  };
}

export async function syncAutostart(enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  const current = await isEnabled();
  if (enabled && !current) await enable();
  if (!enabled && current) await disable();
}

export async function prepareForUpdate(): Promise<void> {
  if (isTauriRuntime()) await invoke("prepare_for_update");
}

export async function resumeAfterUpdateFailure(): Promise<void> {
  if (isTauriRuntime()) await invoke("resume_after_update_failure");
}
