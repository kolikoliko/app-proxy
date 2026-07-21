import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { isTauriRuntime, prepareForUpdate, resumeAfterUpdateFailure, testProxy } from "../lib/bridge";

const FALLBACK_VERSION = "0.2.2";
const AUTO_CHECK_KEY = "app-proxy-update-check-v1";
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export type UpdatePhase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type AppUpdateState = {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  notes?: string;
  publishedAt?: string;
  progress?: number;
  message?: string;
};

export type AppUpdater = AppUpdateState & {
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
};

type UpdateConnection = "proxy" | "direct";

function errorMessage(reason: unknown, connection: UpdateConnection = "proxy") {
  const detail = reason instanceof Error ? reason.message : String(reason);
  return connection === "proxy"
    ? `无法通过代理连接 GitHub 更新服务：${detail}。请检查代理端口以及 GitHub 是否可访问。`
    : `代理端口不可用，直连 GitHub 更新服务也失败：${detail}。请检查网络以及 GitHub 是否可访问。`;
}

async function selectUpdateConnection(proxyUrl: string): Promise<UpdateConnection> {
  try {
    const result = await testProxy(proxyUrl);
    return result.reachable ? "proxy" : "direct";
  } catch {
    return "direct";
  }
}

export function useAppUpdater(proxyUrl: string, ready: boolean): AppUpdater {
  const pendingUpdate = useRef<Update | null>(null);
  const pendingConnection = useRef<UpdateConnection>("proxy");
  const autoCheckStarted = useRef(false);
  const [state, setState] = useState<AppUpdateState>({
    phase: "idle",
    currentVersion: FALLBACK_VERSION,
  });

  const checkForUpdates = useCallback(async () => {
    if (!isTauriRuntime()) {
      setState({ phase: "current", currentVersion: FALLBACK_VERSION, message: "浏览器预览模式不会连接 GitHub。" });
      return;
    }

    let connection: UpdateConnection = "proxy";
    setState((current) => ({ ...current, phase: "checking", progress: undefined, message: undefined }));
    try {
      const [{ getVersion }, { check }] = await Promise.all([
        import("@tauri-apps/api/app"),
        import("@tauri-apps/plugin-updater"),
      ]);
      const currentVersion = await getVersion();
      await pendingUpdate.current?.close();
      pendingUpdate.current = null;

      connection = await selectUpdateConnection(proxyUrl);
      pendingConnection.current = connection;
      setState((current) => ({
        ...current,
        message: connection === "proxy"
          ? "代理端口可用，正在通过代理连接 GitHub…"
          : "代理端口不可用，正在回退为直连 GitHub…",
      }));
      const update: Update | null = await check(connection === "proxy"
        ? { proxy: proxyUrl, timeout: 15_000 }
        : { timeout: 15_000 });
      const connectionNote = connection === "proxy" ? "已通过代理检查" : "代理不可用，已回退直连";

      localStorage.setItem(AUTO_CHECK_KEY, String(Date.now()));
      pendingUpdate.current = update;
      setState(update ? {
        phase: "available",
        currentVersion,
        availableVersion: update.version,
        notes: update.body,
        publishedAt: update.date,
        message: `发现新版本 ${update.version}（${connectionNote}）`,
      } : {
        phase: "current",
        currentVersion,
        message: `当前已是最新版本（${connectionNote}）。`,
      });
    } catch (reason) {
      setState((current) => ({ ...current, phase: "error", message: errorMessage(reason, connection) }));
    }
  }, [proxyUrl]);

  const downloadUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;
    let downloaded = 0;
    let contentLength: number | undefined;
    setState((current) => ({ ...current, phase: "downloading", progress: 0, message: "正在从 GitHub 下载更新…" }));
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = contentLength ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : undefined;
          setState((current) => ({ ...current, progress }));
          return;
        }
        setState((current) => ({ ...current, progress: 100 }));
      }, { timeout: 5 * 60_000 });
      setState((current) => ({
        ...current,
        phase: "downloaded",
        progress: 100,
        message: "更新包下载并验签完成。安装时会暂时关闭 TUN，然后重启应用。",
      }));
    } catch (reason) {
      setState((current) => ({
        ...current,
        phase: "error",
        message: errorMessage(reason, pendingConnection.current),
      }));
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;
    setState((current) => ({ ...current, phase: "installing", message: "正在安全停止 TUN 并启动安装程序…" }));
    try {
      await prepareForUpdate();
      await update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (reason) {
      await resumeAfterUpdateFailure().catch(() => undefined);
      setState((current) => ({
        ...current,
        phase: "error",
        message: `更新安装失败：${reason instanceof Error ? reason.message : String(reason)}。TUN 已尝试恢复。`,
      }));
    }
  }, []);

  useEffect(() => {
    if (!ready || !isTauriRuntime() || autoCheckStarted.current) return;
    const lastCheck = Number(localStorage.getItem(AUTO_CHECK_KEY) ?? 0);
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < AUTO_CHECK_INTERVAL_MS) return;
    autoCheckStarted.current = true;
    void checkForUpdates();
  }, [checkForUpdates, ready]);

  useEffect(() => () => {
    void pendingUpdate.current?.close();
  }, []);

  return {
    ...state,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
