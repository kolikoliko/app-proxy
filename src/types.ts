export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "green" | "blue" | "purple" | "yellow" | "rose" | "cyan";
export type ExitBehavior = "restore_direct" | "keep_routing";

export type AppSettings = {
  proxyUrl: string;
  tunEnabled: boolean;
  theme: ThemeMode;
  accentColor: AccentColor;
  launchAtLogin: boolean;
  startMinimized: boolean;
  bypassLan: boolean;
  additionalBypassCidrs: string[];
  exitBehavior: ExitBehavior;
  pauseUntil?: string;
};

export type TunPhase = "stopped" | "ready" | "running" | "paused" | "waiting" | "error";

export type TunStatus = {
  phase: TunPhase;
  message: string;
  kernelVersion: string;
  protocolNote?: string;
};

export type AppRule = {
  id: string;
  displayName: string;
  executablePath: string;
  executableName: string;
  packageFamilyName?: string;
  applicationId?: string;
  executableScopeRoot?: string;
  scopeExecutableCount?: number;
  enabled: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InstalledApp = {
  displayName: string;
  executablePath: string;
  executableName: string;
  source: "registry-app-path" | "registry-uninstall" | "msix-package" | "browser-preview";
  packageFamilyName?: string;
  applicationId?: string;
};

export type PersistedState = {
  settings: AppSettings;
  rules: AppRule[];
};

export type ProxyTestResult = {
  reachable: boolean;
  latencyMs?: number;
  message: string;
};

export type LauncherResult = {
  message: string;
  launcherPath: string;
  shortcutPath?: string;
  chromiumMode: boolean;
};

export type GitProxyStatus = {
  installed: boolean;
  version?: string;
  httpProxies: string[];
  httpsProxies: string[];
  matchesAppProxy: boolean;
};
