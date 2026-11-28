import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Minus, Plus, Square, X } from "lucide-react";
import { AppList } from "./components/AppList";
import { InstalledAppsDialog } from "./components/InstalledAppsDialog";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar, type NavigationView } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { ToolProxyPanel } from "./components/ToolProxyPanel";
import { addRule, chooseExecutable, closeWindow, createRuleDesktopLauncher, createRuleStartMenuLauncher, isTauriRuntime, isWindowMaximized, launchRuleWithProxy, loadState, minimizeWindow, onTrayLaunchError, onWindowResized, removeRule, saveSettings, setRuleChromiumMode, syncAutostart, syncWindowTheme, testProxy, toggleMaximizeWindow } from "./lib/bridge";
import { DEFAULT_STATE } from "./lib/defaults";
import { createSerialQueue, isLatestRequest, settleSubscription } from "./lib/asyncControl";
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
  const [maximized, setMaximized] = useState(false);
  const desktopRuntime = isTauriRuntime();
  const stateRef = useRef(state);
  stateRef.current = state;
  const mutationQueue = useRef(createSerialQueue());
  const stateEpoch = useRef(0);
  const latestRefreshRequest = useRef(0);
  const updater = useAppUpdater(state.settings.proxyUrl, loaded);
  const hasUpdate = updater.phase === "available" || updater.phase === "downloaded";

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

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void onTrayLaunchError((message) => {
      setNotice(null);
      setError(message);
    })
      .then((fn) => settleSubscription(() => disposed, (assigned) => { unsubscribe = assigned; }, fn))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!desktopRuntime) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const syncMaximized = () => {
      void isWindowMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      }).catch(() => undefined);
    };
    syncMaximized();
    void onWindowResized(syncMaximized)
      .then((fn) => settleSubscription(() => disposed, (assigned) => { unsubscribe = assigned; }, fn))
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [desktopRuntime]);

  useLayoutEffect(() => {
    const updateTheme = () => {
      const resolved = effectiveTheme(state.settings.theme);
      document.documentElement.dataset.theme = resolved;
      void syncWindowTheme(resolved);
    };
    updateTheme();
    document.documentElement.dataset.accent = state.settings.accentColor ?? "blue";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
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
        hasUpdate={hasUpdate}
        activeView={activeView}
        onNavigate={setActiveView}
        onThemeChange={(theme) => void saveSettingsPatch({ theme })}
      />
      <main className="workspace">
        {desktopRuntime ? (
          <div
            className="window-titlebar"
            data-tauri-drag-region
            onDoubleClick={(event) => {
              if (event.target === event.currentTarget) {
                void toggleMaximizeWindow().then(setMaximized).catch(() => undefined);
              }
            }}
          >
            <div className="window-controls">
              <button
                type="button"
                className="window-control"
                aria-label="最小化窗口"
                title="最小化"
                onClick={() => void minimizeWindow()}
              >
                <Minus size={14} strokeWidth={1.6} />
              </button>
              <button
                type="button"
                className="window-control"
                aria-label={maximized ? "还原窗口" : "最大化窗口"}
                title={maximized ? "还原" : "最大化"}
                onClick={() => void toggleMaximizeWindow().then(setMaximized).catch(() => undefined)}
              >
                {maximized ? <Copy size={12} strokeWidth={1.6} /> : <Square size={12} strokeWidth={1.6} />}
              </button>
              <button
                type="button"
                className="window-control window-control--close"
                aria-label="隐藏到系统托盘"
                title="隐藏到托盘"
                onClick={() => void closeWindow()}
              >
                <X size={14} strokeWidth={1.7} />
              </button>
            </div>
          </div>
        ) : null}
        <div className="workspace-scroll">
        <div className="workspace-content">
          {error ? (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button type="button" className="icon-button" aria-label="关闭错误提示" onClick={() => setError(null)}>
                <X size={14} />
              </button>
            </div>
          ) : null}

          {notice ? (
            <div className="success-banner" role="status">
              <CheckCircle2 size={15} />
              <span>{notice}</span>
              <button type="button" className="icon-button" aria-label="关闭操作提示" onClick={() => setNotice(null)}>
                <X size={14} />
              </button>
            </div>
          ) : null}

          {hasUpdate && activeView !== "settings" ? (
            <button type="button" className="update-banner" onClick={() => setActiveView("settings")}>
              <span>发现新版本 v{updater.availableVersion}</span>
              <strong>前往更新</strong>
            </button>
          ) : null}

          {activeView === "apps" ? (
            <>
              <header className="page-bar">
                <div className="page-bar__left">
                  <h1>应用代理</h1>
                  <span className="count-badge">{state.rules.length}</span>
                  <StatusBar
                    proxyUrl={state.settings.proxyUrl}
                    onOpenSettings={() => setActiveView("settings")}
                  />
                </div>
                <button type="button" className="button button--primary" onClick={() => setPickerOpen(true)}>
                  <Plus size={14} />
                  添加应用
                </button>
              </header>
              <AppList
                rules={state.rules}
                onAdd={() => setPickerOpen(true)}
                onRemove={(id) => void applyStateMutation(() => removeRule(id)).catch(() => undefined)}
                onToggleChromiumMode={(id, nextMode) => void applyStateMutation(() => setRuleChromiumMode(id, nextMode)).catch(() => undefined)}
                onProxyLaunch={(id) => void handleLauncherAction(id, "launch")}
                onCreateLauncher={(id) => void handleLauncherAction(id, "shortcut")}
                onCreateStartMenuLauncher={(id) => void handleLauncherAction(id, "start-menu")}
                busyAction={busyAction}
              />
            </>
          ) : activeView === "tools" ? (
            <ToolProxyPanel proxyUrl={state.settings.proxyUrl} onOpenSettings={() => setActiveView("settings")} />
          ) : (
            <section className="settings-page" aria-labelledby="settings-title">
              <header className="page-bar">
                <div>
                  <h1 id="settings-title">设置</h1>
                  <p className="page-bar__sub">代理连接、快捷方式、外观与版本更新。</p>
                </div>
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
        </div>
        </div>
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
