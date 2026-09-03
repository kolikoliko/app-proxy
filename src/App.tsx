import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppList } from "./components/AppList";
import { InstalledAppsDialog } from "./components/InstalledAppsDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar, type NavigationView } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { ToolProxyPanel } from "./components/ToolProxyPanel";
import { addRule, chooseExecutable, createRuleDesktopLauncher, createRuleStartMenuLauncher, launchRuleWithProxy, loadState, removeRule, saveSettings, syncAutostart, testProxy } from "./lib/bridge";
import { DEFAULT_STATE } from "./lib/defaults";
import { createSerialQueue, isLatestRequest } from "./lib/asyncControl";
import { useAppUpdater } from "./hooks/useAppUpdater";
import type { AppSettings, InstalledApp, PersistedState, ProxyTestResult, ThemeMode } from "./types";

function effectiveTheme(theme: ThemeMode) {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function App() {
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE);
  const settingsRef = useRef<AppSettings>(DEFAULT_STATE.settings);
  const [loaded, setLoaded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string>();
  const [activeView, setActiveView] = useState<NavigationView>("apps");
  const [pickerOpen, setPickerOpen] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mutationQueue = useRef(createSerialQueue());
  const stateEpoch = useRef(0);
  const latestRefreshRequest = useRef(0);
  const updater = useAppUpdater(state.settings.proxyUrl, loaded);

  const refreshFromBackend = useCallback(async () => {
    const requestId = ++latestRefreshRequest.current;
    const epochAtStart = stateEpoch.current;
    const nextState = await loadState();
    if (!isLatestRequest(requestId, latestRefreshRequest.current) || epochAtStart !== stateEpoch.current) {
      return stateRef.current;
    }
    settingsRef.current = nextState.settings;
    setState(nextState);
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
    document.documentElement.dataset.accent = state.settings.accentColor ?? "blue";
  }, [state.settings.theme, state.settings.accentColor]);

  const saveSettingsPatch = useCallback(async (patch: Partial<AppSettings>) => {
    return mutationQueue.current(async () => {
      const epoch = ++stateEpoch.current;
      const previous = settingsRef.current;
      const next = { ...previous, ...patch };
      settingsRef.current = next;
      setState((current) => ({ ...current, settings: next }));
      setError(null);
      try {
        if (typeof patch.launchAtLogin === "boolean") await syncAutostart(patch.launchAtLogin);
        const saved = await saveSettings(next);
        if (epoch === stateEpoch.current) {
          settingsRef.current = saved.settings;
          setState(saved);
        }
      } catch (reason) {
        setError(String(reason));
        await refreshFromBackend().catch(() => {
          if (epoch === stateEpoch.current) {
            settingsRef.current = previous;
            setState((current) => ({ ...current, settings: previous }));
          }
        });
      }
    });
  }, [refreshFromBackend]);

  const applyStateMutation = useCallback(async (operation: () => Promise<PersistedState>) => {
    return mutationQueue.current(async () => {
      const epoch = ++stateEpoch.current;
      setError(null);
      try {
        const next = await operation();
        if (epoch === stateEpoch.current) {
          settingsRef.current = next.settings;
          setState(next);
        }
        return next;
      } catch (reason) {
        setError(String(reason));
        await refreshFromBackend().catch(() => undefined);
        throw reason;
      }
    });
  }, [refreshFromBackend]);

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
      setTestResult(proxyResult);
    } catch (reason) {
      setTestResult({ reachable: false, message: String(reason) });
    } finally {
      setTesting(false);
    }
  }, [saveSettingsPatch, state.settings.proxyUrl]);

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
              appCount={state.rules.length}
              proxyUrl={state.settings.proxyUrl}
            />
            <AppList
              rules={state.rules}
              onAdd={() => setPickerOpen(true)}
              onRemove={(id) => void applyStateMutation(() => removeRule(id)).catch(() => undefined)}
              onProxyLaunch={(id) => void handleLauncherAction(id, "launch")}
              onCreateLauncher={(id) => void handleLauncherAction(id, "shortcut")}
              onCreateStartMenuLauncher={(id) => void handleLauncherAction(id, "start-menu")}
              busyAction={busyAction}
            />
          </>
        ) : activeView === "tools" ? (
          <ToolProxyPanel proxyUrl={state.settings.proxyUrl} />
        ) : (
          <section className="settings-page" aria-labelledby="settings-title">
            <header className="page-header">
              <h1 id="settings-title">设置</h1>
              <p>管理代理连接、外观、启动行为和应用更新。</p>
            </header>
            <SettingsPanel
              settings={state.settings}
              testing={testing}
              testResult={testResult}
              updater={updater}
              onChange={(patch) => void saveSettingsPatch(patch)}
              onProxyCommit={(proxyUrl) => {
                if (proxyUrl !== state.settings.proxyUrl) void saveSettingsPatch({ proxyUrl });
              }}
              onTest={handleTest}
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
