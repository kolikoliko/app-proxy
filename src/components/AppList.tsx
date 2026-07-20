import { AppWindow, MoreVertical, Plus, Trash2 } from "lucide-react";
import type { AppRule } from "../types";
import { ApplicationIcon } from "./ApplicationIcon";
import { Switch } from "./Switch";

type AppListProps = {
  rules: AppRule[];
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
};

export function AppList({ rules, onAdd, onToggle, onRemove }: AppListProps) {
  return (
    <section className="apps-panel">
      <header className="section-header">
        <div>
          <h1>常用应用</h1>
          <p>只对开启的应用生效，其他应用保持直连。</p>
        </div>
        <button type="button" className="button button--primary" onClick={onAdd}>
          <Plus size={18} />
          添加应用
        </button>
      </header>

      <div className="app-list" role="list">
        <div className="app-list__head" aria-hidden="true">
          <span>应用</span><span>路径</span><span>代理</span><span />
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
            <div className="app-row__menu">
              <button type="button" className="icon-button app-row__more" aria-label={`${rule.displayName} 更多操作`}>
                <MoreVertical size={18} />
              </button>
              <button type="button" className="icon-button app-row__delete" onClick={() => onRemove(rule.id)} aria-label={`移除 ${rule.displayName}`}>
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <footer className="apps-panel__footer">
        <span>规则保存在本机；TUN 开启后按进程分流，不修改系统代理。</span>
        <strong>共 {rules.length} 个应用</strong>
      </footer>
    </section>
  );
}
