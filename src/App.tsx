import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppList } from "./components/AppList";
import { InstalledAppsDialog } from "./components/InstalledAppsDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar, type NavigationView } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { addRule, checkTunReady, chooseExecutable, createRuleDesktopLauncher, createRuleStartMenuLauncher, getTunStatus, launchRuleWithProxy, loadState, removeRule, saveSettings, syncAutostart, testProxy, updateRule } from "./lib/bridge";
import { DEFAULT_STATE } from "./lib/defaults";
import { useAppUpdater } from "./hooks/useAppUpdater";
import type { AppSettings, InstalledApp, PersistedState, ProxyTestResult, ThemeMode, TunStatus } from "./types";

const STOPPED_TUN_STATUS: TunStatus = {
  phase: "stopped",
  message: "TUN 已关闭，应用规则保持不变",
  kernelVersion: "1.13.12",
};

function effectiveTheme(theme: ThemeMode) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE);
  const settingsRef = useRef<AppSettings>(DEFAULT_STATE.settings);
  const [tunStatus, setTunStatus] = useState<TunStatus>(STOPPED_TUN_STATUS);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string>();
  const [activeView, setActiveView] = useState<NavigationView>("apps");
  const [pickerOpen, setPickerOpen] = useState(false);
  const updater = useAppUpdater(state.settings.proxyUrl, loaded);

  const refreshFromBackend = useCallback(async () => {
    const [nextState, nextTunStatus] = await Promise.all([loadState(), getTunStatus()]);
    settingsRef.current = nextState.settings;
    setState(nextState);
    setTunStatus(nextTunStatus);
    return nextState;
  }, []);

  useEffect(() => {
    refreshFromBackend()
      .catch((reason) => setError(String(reason)))
      .finally(() => setLoaded(true));
  }, [refreshFromBackend]);

  useLayoutEffect(() => {
    const theme = effectiveTheme(state.settings.theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accent = state.settings.accentColor ?? "green";
  }, [state.settings.theme, state.settings.accentColor]);

  const saveSettingsPatch = useCallback(async (patch: Partial<AppSettings>) => {
    const previous = settingsRef.current;
    const next = { ...previous, ...patch };
    settingsRef.current = next;
    setState((current) => ({ ...current, settings: next }));
    setError(null);
    try {
      if (typeof patch.launchAtLogin === "boolean") await syncAutostart(patch.launchAtLogin);
      const saved = await saveSettings(next);
      settingsRef.current = saved.settings;
      setState(saved);
      setTunStatus(await getTunStatus());
    } catch (reason) {
      setError(String(reason));
      try {
        await refreshFromBackend();
      } catch {
        settingsRef.current = previous;
        setState((current) => ({ ...current, settings: previous }));
      }
    }
  }, [refreshFromBackend]);

  useEffect(() => {
    let unlistenToggle: (() => void) | undefined;
    let unlistenState: (() => void) | undefined;
    listen("tray-toggle-tun", () => {
      void saveSettingsPatch({
        tunEnabled: !settingsRef.current.tunEnabled,
        pauseUntil: undefined,
      });
    }).then((fn) => { unlistenToggle = fn; }).catch(() => undefined);
    listen("state-changed", () => {
      void refreshFromBackend().catch((reason) => setError(String(reason)));
    }).then((fn) => { unlistenState = fn; }).catch(() => undefined);
    return () => {
      unlistenToggle?.();
      unlistenState?.();
    };
  }, [refreshFromBackend, saveSettingsPatch]);

  useEffect(() => {
    if (!state.settings.tunEnabled) return;
    const timer = window.setInterval(() => {
      void getTunStatus()
        .then(setTunStatus)
        .catch((reason) => setError(String(reason)));
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [state.settings.tunEnabled]);

  const applyStateMutation = useCallback(async (operation: () => Promise<PersistedState>) => {
    setError(null);
    try {
      const next = await operation();
      settingsRef.current = next.settings;
      setState(next);
      setTunStatus(await getTunStatus());
      return next;
    } catch (reason) {
      setError(String(reason));
      try { await refreshFromBackend(); } catch { /* Keep the last usable UI state. */ }
      throw reason;
    }
  }, [refreshFromBackend]);

  useEffect(() => {
    const pauseUntil = state.settings.pauseUntil;
    if (!pauseUntil || pauseUntil === "manual") return;
    const remaining = new Date(pauseUntil).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    if (remaining <= 0) {
      void saveSettingsPatch({ pauseUntil: undefined });
      return;
    }
    const timer = window.setTimeout(
      () => void saveSettingsPatch({ pauseUntil: undefined }),
      Math.min(remaining, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [state.settings.pauseUntil, saveSettingsPatch]);

  const handleBrowse = useCallback(async () => {
    const selected = await chooseExecutable();
    if (!selected) return;
    try {
      await applyStateMutation(() => addRule(selected));
      setPickerOpen(false);
    } catch (reason) {
      setError(String(reason));
    }
  }, [applyStateMutation]);

  const handleAddInstalled = useCallback(async (app: InstalledApp) => {
    try {
      await applyStateMutation(() => addRule(
        app.executablePath,
        app.displayName,
        app.packageFamilyName,
        app.applicationId,
      ));
    } catch (reason) {
      setError(String(reason));
      throw reason;
    }
  }, [applyStateMutation]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  const handleLauncherAction = useCallback(async (id: string, action: "launch" | "shortcut" | "start-menu") => {
    setBusyAction(`${action}:${id}`);
    setError(null);
    setNotice(null);
    try {
      const result = action === "launch"
        ? await launchRuleWithProxy(id)
        : action === "shortcut"
          ? await createRuleDesktopLauncher(id)
          : await createRuleStartMenuLauncher(id);
      setNotice(result.message);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  const handleTest = useCallback(async (proxyUrl: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      if (proxyUrl !== state.settings.proxyUrl) await saveSettingsPatch({ proxyUrl });
      const proxyResult = await testProxy(proxyUrl);
      if (proxyResult.reachable && state.rules.some((rule) => rule.enabled)) {
        await checkTunReady();
        setTunStatus(await getTunStatus());
        setTestResult({
          ...proxyResult,
          message: `${proxyResult.message}；TUN 配置有效`,
        });
      } else {
        setTestResult(proxyResult);
      }
    } catch (reason) {
      setTestResult({ reachable: false, message: String(reason) });
    } finally {
      setTesting(false);
    }
  }, [saveSettingsPatch, state.settings.proxyUrl]);

  const enabledApps = useMemo(() => state.rules.filter((rule) => rule.enabled).length, [state.rules]);
  if (!loaded) return <div className="app-loading">正在加载本地配置…</div>;

  return (
    <div className="app-shell">
      <Sidebar
        theme={state.settings.theme}
        version={updater.currentVersion}
        activeView={activeView}
        onNavigate={setActiveView}
        onThemeChange={(theme) => void saveSettingsPatch({ theme })}
      />
      <main className="workspace">
        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        {notice ? <div className="success-banner" role="status">{notice}</div> : null}
        {updater.phase === "available" || updater.phase === "downloaded" ? (
          <button type="button" className="update-banner" onClick={() => setActiveView("settings")}>
            <span>发现应用代理 v{updater.availableVersion}，可在设置中下载并安装。</span>
            <strong>查看更新</strong>
          </button>
        ) : null}
        {activeView === "apps" ? (
          <>
            <StatusBar
              requestedEnabled={state.settings.tunEnabled}
              status={tunStatus}
              enabledApps={enabledApps}
              proxyUrl={state.settings.proxyUrl}
              onToggle={(tunEnabled) => void saveSettingsPatch({ tunEnabled, pauseUntil: undefined })}
            />
            <AppList
              rules={state.rules}
              onAdd={() => setPickerOpen(true)}
              onToggle={(id, enabled) => void applyStateMutation(() => updateRule(id, enabled)).catch(() => undefined)}
              onRemove={(id) => void applyStateMutation(() => removeRule(id)).catch(() => undefined)}
              onProxyLaunch={(id) => void handleLauncherAction(id, "launch")}
              onCreateLauncher={(id) => void handleLauncherAction(id, "shortcut")}
              onCreateStartMenuLauncher={(id) => void handleLauncherAction(id, "start-menu")}
              busyAction={busyAction}
            />
          </>
        ) : (
          <section className="settings-page" aria-labelledby="settings-title">
            <header className="page-header">
              <h1 id="settings-title">设置</h1>
              <p>管理代理连接、自动化行为和网络安全选项。</p>
            </header>
            <SettingsPanel
              settings={state.settings}
              testing={testing}
              testResult={testResult}
              tunStatus={tunStatus}
              updater={updater}
              onChange={(patch) => void saveSettingsPatch(patch)}
              onProxyCommit={(proxyUrl) => {
                if (proxyUrl !== state.settings.proxyUrl) void saveSettingsPatch({ proxyUrl });
              }}
              onTest={handleTest}
              onPause={(minutes) => {
                const pauseUntil = minutes === 0
                  ? undefined
                  : minutes === null
                    ? "manual"
                    : new Date(Date.now() + minutes * 60_000).toISOString();
                void saveSettingsPatch({ pauseUntil });
              }}
            />
          </section>
        )}
      </main>
      {pickerOpen ? (
        <InstalledAppsDialog
          existingRules={state.rules}
          onAdd={handleAddInstalled}
          onBrowse={() => void handleBrowse()}
          onClose={closePicker}
        />
      ) : null}
    </div>
  );
}
