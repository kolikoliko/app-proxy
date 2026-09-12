import { useDeferredValue, useState } from "react";
import { AppWindow, LoaderCircle, Menu, MonitorDown, Play, Plus, Search, ShieldCheck, Trash2 } from "lucide-react";
import type { AppRule } from "../types";
import { ApplicationIcon } from "./ApplicationIcon";

type AppListProps = {
  rules: AppRule[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onProxyLaunch: (id: string) => void;
  onCreateLauncher: (id: string) => void;
  onCreateStartMenuLauncher: (id: string) => void;
  busyAction?: string;
};

export function AppList({
  rules,
  onAdd,
  onRemove,
  onProxyLaunch,
  onCreateLauncher,
  onCreateStartMenuLauncher,
  busyAction,
}: AppListProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleRules = rules.filter((rule) => `${rule.displayName}\n${rule.executablePath}`.toLocaleLowerCase().includes(deferredQuery));

  return (
    <section className="apps-panel">
      <header className="section-header">
        <div>
          <h2>常用应用 <span className="count-badge">{rules.length}</span></h2>
          <p>一键启动，或创建专属代理快捷方式。</p>
        </div>
        <button type="button" className="button button--primary" onClick={onAdd}>
          <Plus size={18} />
          添加应用
        </button>
      </header>
      {rules.length > 0 ? <div className="app-list__toolbar">
        <label className="search-field app-search"><Search size={16} /><input aria-label="搜索常用应用" placeholder="搜索应用名称或路径…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <span>应用与快捷方式</span>
      </div> : null}
      <div className="app-list" role="list">
        <div className="app-list__head" aria-hidden="true">
          <span>应用名称 / 路径</span><span>应用类型</span><span>操作</span>
        </div>
        {rules.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon"><AppWindow size={24} /></span>
            <strong>还没有添加应用</strong>
            <p>添加常用的 Windows 应用，使用当前代理一键启动，或创建桌面快捷方式。</p>
            <button type="button" className="button button--quiet" onClick={onAdd}><Plus size={16} />添加第一个应用</button>
          </div>
        ) : visibleRules.length === 0 ? (
          <div className="empty-state empty-state--search"><Search size={26} /><strong>没有找到匹配的应用</strong><p>试试其他名称或路径。</p><button className="button" type="button" onClick={() => setQuery("")}>清空搜索</button></div>
        ) : visibleRules.map((rule) => (
          <article className="app-row" role="listitem" key={rule.id}>
            <div className="app-row__identity">
              <ApplicationIcon
                displayName={rule.displayName}
                executablePath={rule.executablePath}
              />
              <span>
                <strong>{rule.displayName}</strong>
                <small className="app-row__path" title={rule.executablePath}>{rule.executablePath}</small>
              </span>
            </div>
            <span className="app-row__type" title={rule.executableScopeRoot ? `自动包含 ${rule.scopeExecutableCount || 1} 个组件` : rule.executableName}>{rule.packageFamilyName ? "Store 应用" : "桌面应用"}</span>
            <div className="app-row__actions">
              <button
                type="button"
                className="button app-launch"
                disabled={Boolean(busyAction)}
                onClick={() => onProxyLaunch(rule.id)}
                aria-label={`使用环境代理启动 ${rule.displayName}`}
                title="使用当前代理启动"
              >
                {busyAction === `launch:${rule.id}` ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
                <span>启动</span>
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={Boolean(busyAction)}
                onClick={() => onCreateLauncher(rule.id)}
                aria-label={`为 ${rule.displayName} 创建桌面代理启动器`}
                title="创建独立桌面启动器"
              >
                {busyAction === `shortcut:${rule.id}` ? <LoaderCircle className="spin" size={16} /> : <MonitorDown size={16} />}
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={Boolean(busyAction)}
                onClick={() => onCreateStartMenuLauncher(rule.id)}
                aria-label={`为 ${rule.displayName} 添加开始菜单代理启动器`}
                title="添加到开始菜单（可再手动固定）"
              >
                {busyAction === `start-menu:${rule.id}` ? <LoaderCircle className="spin" size={16} /> : <Menu size={16} />}
              </button>
              <button
                type="button"
                className="icon-button app-row__delete"
                disabled={Boolean(busyAction)}
                onClick={() => onRemove(rule.id)}
                aria-label={`移除 ${rule.displayName}`}
                title="移除应用"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <footer className="apps-panel__footer">
        <span><ShieldCheck size={14} />代理仅用于从这里或代理快捷方式启动的应用</span>
        <strong>{deferredQuery ? `${visibleRules.length} / ${rules.length}` : `${rules.length} 个应用`}</strong>
      </footer>
    </section>
  );
}
