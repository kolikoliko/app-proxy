import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import gitIcon from "../assets/git.svg";
import { applyGitProxy, clearGitProxy, getGitProxyStatus } from "../lib/bridge";
import type { GitProxyStatus } from "../types";

type ToolProxyPanelProps = {
  proxyUrl: string;
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

export function ToolProxyPanel({ proxyUrl }: ToolProxyPanelProps) {
  const [status, setStatus] = useState<GitProxyStatus>();
  const [busyAction, setBusyAction] = useState<ToolAction>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const runAction = useCallback(async (action: ToolAction) => {
    setBusyAction(action);
    setMessage(undefined);
    setError(undefined);
    try {
      const next = action === "apply"
        ? await applyGitProxy()
        : action === "clear"
          ? await clearGitProxy()
          : await getGitProxyStatus();
      setStatus(next);
      if (action === "apply") setMessage("已将应用代理写入 Git 全局配置");
      if (action === "clear") setMessage("已清除 Git 全局代理配置");
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusyAction(undefined);
    }
  }, []);

  useEffect(() => {
    void runAction("refresh");
  }, [runAction, proxyUrl]);

  const configured = useMemo(
    () => Boolean(status && (status.httpProxies.length > 0 || status.httpsProxies.length > 0)),
    [status],
  );
  const loading = busyAction === "refresh" && !status;

  return (
    <section className="tools-page" aria-labelledby="tools-title">
      <header className="page-header tools-page__header">
        <div>
          <span className="page-kicker">DEVELOPER TOOLING</span>
          <h1 id="tools-title">工具代理</h1>
          <p>读取并管理开发工具自己的代理配置，独立于应用启动器。</p>
        </div>
        <div className="proxy-source" aria-label="当前应用代理">
          <span className="proxy-source__pulse" />
          <span>
            <small>应用代理源</small>
            <code>{proxyUrl}</code>
          </span>
        </div>
      </header>

      <div className="tool-proxy-summary" role="note">
        <ShieldCheck size={18} />
        <span>
          <strong>配置作用于当前 Windows 用户</strong>
          Git 仓库内的本地配置仍可能覆盖这里的全局设置。
        </span>
        <span className="scope-chip">--global</span>
      </div>

      <article className="tool-card" data-state={status?.matchesAppProxy ? "synced" : "idle"}>
        <div className="tool-card__rail" />
        <header className="tool-card__header">
          <div className="tool-identity">
            <span className="tool-identity__icon"><img src={gitIcon} alt="" /></span>
            <span>
              <span className="tool-identity__eyebrow">版本控制</span>
              <strong>Git</strong>
              <small>{status?.installed ? `Git ${status.version ?? "已安装"}` : "未检测到 Git for Windows"}</small>
            </span>
          </div>
          {loading ? (
            <span className="tool-status"><LoaderCircle className="spin" size={14} />正在检测</span>
          ) : status?.installed ? (
            <span className="tool-status" data-kind={status.matchesAppProxy ? "synced" : "ready"}>
              {status.matchesAppProxy ? <Check size={14} /> : <span className="tool-status__dot" />}
              {status.matchesAppProxy ? "已同步" : configured ? "配置不同" : "未配置"}
            </span>
          ) : (
            <span className="tool-status" data-kind="missing"><CircleAlert size={14} />未安装</span>
          )}
        </header>

        <div className="tool-config-grid" aria-busy={Boolean(busyAction)}>
          <div className="tool-config-item">
            <span className="tool-config-item__protocol">HTTP</span>
            <span className="tool-config-item__content">
              <small>http.proxy</small>
              <ProxyValues values={status?.httpProxies ?? []} />
            </span>
          </div>
          <div className="tool-config-item">
            <span className="tool-config-item__protocol">TLS</span>
            <span className="tool-config-item__content">
              <small>https.proxy</small>
              <ProxyValues values={status?.httpsProxies ?? []} />
            </span>
          </div>
        </div>

        {message ? <div className="tool-feedback" data-kind="success"><Check size={15} />{message}</div> : null}
        {error ? <div className="tool-feedback" data-kind="error"><CircleAlert size={15} />{error}</div> : null}

        <footer className="tool-card__footer">
          <span className="tool-card__hint">
            SOCKS 地址写入 Git 时会使用 <code>socks5h://</code>，让 DNS 查询也经过代理。
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
              <RefreshCw className={busyAction === "refresh" ? "spin" : undefined} size={17} />
            </button>
            <button
              type="button"
              className="button tool-clear"
              disabled={Boolean(busyAction) || !status?.installed || !configured}
              onClick={() => void runAction("clear")}
            >
              {busyAction === "clear" ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
              清除代理
            </button>
            <button
              type="button"
              className="button button--primary tool-apply"
              disabled={Boolean(busyAction) || !status?.installed || status.matchesAppProxy}
              onClick={() => void runAction("apply")}
            >
              {busyAction === "apply" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              {status?.matchesAppProxy ? "已应用" : "应用当前代理"}
            </button>
          </div>
        </footer>
      </article>

      <div className="tool-roadmap" aria-label="后续支持计划">
        <span>下一步可扩展</span>
        <span className="tool-roadmap__item">npm</span>
        <span className="tool-roadmap__item">pnpm</span>
        <span className="tool-roadmap__item">pip</span>
        <span className="tool-roadmap__item">Cargo</span>
      </div>
    </section>
  );
}
