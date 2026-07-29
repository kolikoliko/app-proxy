import { AppWindow, LoaderCircle, Menu, MonitorDown, Play, Plus, Trash2 } from "lucide-react";
import type { AppRule } from "../types";
import { ApplicationIcon } from "./ApplicationIcon";
import { Switch } from "./Switch";

type AppListProps = {
  rules: AppRule[];
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onProxyLaunch: (id: string) => void;
  onCreateLauncher: (id: string) => void;
  onCreateStartMenuLauncher: (id: string) => void;
  busyAction?: string;
};

export function AppList({
  rules,
  onAdd,
  onToggle,
  onRemove,
  onProxyLaunch,
  onCreateLauncher,
  onCreateStartMenuLauncher,
  busyAction,
}: AppListProps) {
  return (
    <section className="apps-panel">
      <header className="section-header">
        <div>
          <h1>常用应用</h1>
          <p>开关控制 TUN 分流；也可以在关闭 TUN 后使用环境代理启动。</p>
        </div>
        <button type="button" className="button button--primary" onClick={onAdd}>
          <Plus size={18} />
          添加应用
        </button>
      </header>

      <div className="app-list" role="list">
        <div className="app-list__head" aria-hidden="true">
          <span>应用</span><span>路径</span><span>代理</span><span>启动</span>
        </div>
        {rules.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon"><AppWindow size={24} /></span>
            <strong>还没有添加应用</strong>
            <p>选择一个 Windows 程序，然后用开关控制它是否走代理。</p>
            <button type="button" className="button button--quiet" onClick={onAdd}>选择 .exe 文件</button>
          </div>
        ) : rules.map((rule) => (
          <article className="app-row" role="listitem" key={rule.id}>
            <div className="app-row__identity">
              <ApplicationIcon
                displayName={rule.displayName}
                executablePath={rule.executablePath}
              />
              <span>
                <strong>{rule.displayName}</strong>
                <small>
                  {rule.executableName}
                  {rule.executableScopeRoot ? (
                    <span className="app-scope-label">
                      应用组 · 自动包含 {rule.scopeExecutableCount || 1} 个组件
                    </span>
                  ) : null}
                </small>
              </span>
            </div>
            <span className="app-row__path" title={rule.executablePath}>{rule.executablePath}</span>
            <Switch checked={rule.enabled} onChange={(enabled) => onToggle(rule.id, enabled)} label={`${rule.displayName} 使用代理`} />
            <div className="app-row__actions">
              <button
                type="button"
                className="icon-button"
                disabled={Boolean(busyAction)}
                onClick={() => onProxyLaunch(rule.id)}
                aria-label={`使用环境代理启动 ${rule.displayName}`}
                title="环境代理启动（无需 TUN）"
              >
                {busyAction === `launch:${rule.id}` ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
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
        <span>TUN 用于完整分流；播放键可在关闭 TUN 时按环境变量独立启动。</span>
        <strong>共 {rules.length} 个应用</strong>
      </footer>
    </section>
  );
}
