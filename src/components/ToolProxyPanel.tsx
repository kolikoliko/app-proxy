import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import gitIcon from "../assets/git.svg";
import { isLatestRequest } from "../lib/asyncControl";
import { applyGitProxy, clearGitProxy, getGitProxyStatus } from "../lib/bridge";
import type { GitProxyStatus } from "../types";
import { StatusBar } from "./StatusBar";

type ToolProxyPanelProps = {
  proxyUrl: string;
  onOpenSettings: () => void;
};

type ToolAction = "refresh" | "apply" | "clear";

function ProxyValues({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="tool-proxy-empty">未配置</span>;
  return (
    <span className="tool-proxy-values">
      {values.map((value, index) => <code key={`${value}-${index}`}>{value}</code>)}
    </span>
  );
}

export function ToolProxyPanel({ proxyUrl, onOpenSettings }: ToolProxyPanelProps) {
  const [status, setStatus] = useState<GitProxyStatus>();
  const [busyAction, setBusyAction] = useState<ToolAction>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const latestRequest = useRef(0);

  const runAction = useCallback(async (action: ToolAction) => {
    const requestId = ++latestRequest.current;
    setBusyAction(action);
    setMessage(undefined);
    setError(undefined);
    try {
      const next = action === "apply"
        ? await applyGitProxy()
        : action === "clear"
          ? await clearGitProxy()
          : await getGitProxyStatus();
      if (!mounted.current || !isLatestRequest(requestId, latestRequest.current)) return;
      setStatus(next);
      if (action === "apply") setMessage("已写入 Git 全局代理配置");
      if (action === "clear") setMessage("已清除 Git 全局代理配置");
    } catch (reason) {
      if (!mounted.current || !isLatestRequest(requestId, latestRequest.current)) return;
      setError(String(reason));
    } finally {
      if (mounted.current && isLatestRequest(requestId, latestRequest.current)) {
        setBusyAction(undefined);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void runAction("refresh");
    return () => { mounted.current = false; };
  }, [runAction, proxyUrl]);

  const configured = useMemo(
    () => Boolean(status && (status.httpProxies.length > 0 || status.httpsProxies.length > 0)),
    [status],
  );
  const loading = busyAction === "refresh" && !status;

  return (
    <section className="tools-page" aria-labelledby="tools-title">
      <header className="page-bar">
        <div>
          <h1 id="tools-title">工具代理</h1>
          <p className="page-bar__sub">管理开发工具自身的用户级代理配置（独立于应用启动器）。</p>
        </div>
        <StatusBar proxyUrl={proxyUrl} onOpenSettings={onOpenSettings} />
      </header>

      <article className="tool-card">
        <header className="tool-card__header">
          <div className="tool-identity">
            <span className="tool-identity__icon"><img src={gitIcon} alt="" /></span>
            <span>
              <strong>Git</strong>
              <small>{status?.installed ? `Git ${status.version ?? "已安装"} · --global` : "未检测到 Git for Windows"}</small>
            </span>
          </div>

          {loading ? (
            <span className="tool-status"><LoaderCircle className="spin" size={12} />检测中</span>
          ) : status?.installed ? (
            <span className="tool-status" data-kind={status.matchesAppProxy ? "synced" : "ready"}>
              {status.matchesAppProxy ? <Check size={12} /> : <span className="tool-status__dot" />}
              {status.matchesAppProxy ? "已同步" : configured ? "配置不同" : "未配置"}
            </span>
          ) : (
            <span className="tool-status" data-kind="missing"><CircleAlert size={12} />未安装</span>
          )}
        </header>

        <div className="tool-config-grid" aria-busy={Boolean(busyAction)}>
          <div className="tool-config-item">
            <span className="tool-config-item__label">http.proxy</span>
            <ProxyValues values={status?.httpProxies ?? []} />
          </div>
          <div className="tool-config-item">
            <span className="tool-config-item__label">https.proxy</span>
            <ProxyValues values={status?.httpsProxies ?? []} />
          </div>
        </div>

        {message ? <div className="tool-feedback" data-kind="success"><Check size={14} />{message}</div> : null}
        {error ? <div className="tool-feedback" data-kind="error"><CircleAlert size={14} />{error}</div> : null}

        <footer className="tool-card__footer">
          <span className="tool-card__hint">
            SOCKS 写入时自动使用 <code>socks5h://</code> 代理 DNS；仓库本地配置优先于全局配置。
          </span>
          <div className="tool-actions">
            <button
              type="button"
              className="icon-button tool-refresh"
              disabled={Boolean(busyAction)}
              onClick={() => void runAction("refresh")}
              aria-label="刷新 Git 代理状态"
              title="刷新状态"
            >
              <RefreshCw className={busyAction === "refresh" ? "spin" : undefined} size={14} />
            </button>
            <button
              type="button"
              className="button button--quiet"
              disabled={Boolean(busyAction) || !status?.installed || !configured}
              onClick={() => void runAction("clear")}
            >
              {busyAction === "clear" ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
              清除
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={Boolean(busyAction) || !status?.installed || status.matchesAppProxy}
              onClick={() => void runAction("apply")}
            >
              {busyAction === "apply" ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
              {status?.matchesAppProxy ? "已同步" : "应用当前代理"}
            </button>
          </div>
        </footer>
      </article>

      <div className="tool-roadmap" aria-label="后续支持计划">
        <span>后续计划支持：</span>
        <code>npm</code>
        <span>·</span>
        <code>pnpm</code>
        <span>·</span>
        <code>pip</code>
        <span>·</span>
        <code>Cargo</code>
      </div>
    </section>
  );
}
