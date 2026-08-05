import { useDeferredValue, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { FolderOpen, LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import { listInstalledApps } from "../lib/bridge";
import type { AppRule, InstalledApp } from "../types";
import { ApplicationIcon } from "./ApplicationIcon";

type InstalledAppsDialogProps = {
  existingRules: AppRule[];
  onAdd: (app: InstalledApp) => Promise<void>;
  onBrowse: () => void;
  onClose: () => void;
};

export function InstalledAppsDialog({ existingRules, onAdd, onBrowse, onClose }: InstalledAppsDialogProps) {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingPath, setAddingPath] = useState<string | null>(null);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());

  const loadApps = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const nextApps = await listInstalledApps();
      if (mounted.current && currentRequest === requestId.current) setApps(nextApps);
    } catch (reason) {
      if (mounted.current && currentRequest === requestId.current) setError(String(reason));
    } finally {
      if (mounted.current && currentRequest === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    void loadApps();
    return () => {
      mounted.current = false;
      previousFocus.current?.focus();
    };
  }, [loadApps]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !addingPath) onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(document.querySelectorAll<HTMLElement>(
        ".app-picker button:not(:disabled), .app-picker input:not(:disabled), .app-picker select:not(:disabled)",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addingPath, onClose]);

  const existingPaths = useMemo(
    () => new Set(existingRules.map((rule) => rule.executablePath.toLocaleLowerCase())),
    [existingRules],
  );
  const existingPackageApps = useMemo(
    () => new Map(existingRules.flatMap((rule) => (
      rule.packageFamilyName && rule.applicationId
        ? [[`${rule.packageFamilyName}!${rule.applicationId}`.toLocaleLowerCase(), rule] as const]
        : []
    ))),
    [existingRules],
  );
  const visibleApps = useMemo(() => {
    if (!deferredQuery) return apps;
    return apps.filter((app) =>
      `${app.displayName}\n${app.executableName}\n${app.executablePath}`.toLocaleLowerCase().includes(deferredQuery),
    );
  }, [apps, deferredQuery]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !addingPath) onClose();
    }}>
      <section className="app-picker" role="dialog" aria-modal="true" aria-labelledby="app-picker-title">
        <header className="app-picker__header">
          <div>
            <h2 id="app-picker-title">添加应用</h2>
            <p>从 Windows 已安装的桌面软件中选择。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={Boolean(addingPath)} aria-label="关闭添加应用窗口">
            <X size={19} />
          </button>
        </header>

        <div className="app-picker__toolbar">
          <label className="search-field">
            <Search size={17} />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索应用名称或路径" />
          </label>
          <button type="button" className="button" onClick={() => void loadApps()} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : undefined} />刷新
          </button>
        </div>

        <div className="installed-apps" role="list">
          {loading ? (
            <div className="picker-message"><LoaderCircle className="spin" size={22} />正在读取已安装软件…</div>
          ) : error ? (
            <div className="picker-message picker-message--error">{error}</div>
          ) : visibleApps.length === 0 ? (
            <div className="picker-message">没有找到匹配的软件，可以手动浏览 `.exe`。</div>
          ) : visibleApps.map((app) => {
            const packageAppId = app.packageFamilyName && app.applicationId
              ? `${app.packageFamilyName}!${app.applicationId}`.toLocaleLowerCase()
              : null;
            const matchingPackageRule = packageAppId === null ? undefined : existingPackageApps.get(packageAppId);
            const samePath = existingPaths.has(app.executablePath.toLocaleLowerCase());
            const needsPathUpdate = matchingPackageRule !== undefined
              && matchingPackageRule.executablePath.toLocaleLowerCase() !== app.executablePath.toLocaleLowerCase();
            const added = samePath || (matchingPackageRule !== undefined && !needsPathUpdate);
            const adding = addingPath === app.executablePath;
            return (
              <article className="installed-app-row" role="listitem" key={app.executablePath}>
                <ApplicationIcon displayName={app.displayName} executablePath={app.executablePath} />
                <span className="installed-app-row__identity">
                  <strong>
                    {app.displayName}
                    {app.source === "msix-package" ? (
                      <>
                        <span className="source-badge">Microsoft Store</span>
                        <span className="source-badge source-badge--neutral">自动包含应用组件</span>
                      </>
                    ) : null}
                  </strong>
                  <small title={app.executablePath}>{app.executablePath}</small>
                </span>
                <button
                  type="button"
                  className="button installed-app-row__action"
                  disabled={added || Boolean(addingPath)}
                  onClick={async () => {
                    if (addingPath) return;
                    setAddingPath(app.executablePath);
                    try { await onAdd(app); } finally { setAddingPath(null); }
                  }}
                >
                  {adding ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}
                  {added ? "已添加" : needsPathUpdate ? "更新路径" : "添加"}
                </button>
              </article>
            );
          })}
        </div>

        <footer className="app-picker__footer">
          <span>显示能定位到 `.exe` 的桌面软件和 Microsoft Store 应用。</span>
          <button type="button" className="button button--quiet" onClick={onBrowse} disabled={Boolean(addingPath)}>
            <FolderOpen size={17} />浏览其他程序
          </button>
        </footer>
      </section>
    </div>
  );
}
