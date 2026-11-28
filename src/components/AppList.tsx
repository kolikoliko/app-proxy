import { useDeferredValue, useState } from "react";
import { AppWindow, LoaderCircle, Menu, MonitorDown, Play, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import type { AppRule } from "../types";
import { ApplicationIcon } from "./ApplicationIcon";

type AppListProps = {
  rules: AppRule[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onToggleChromiumMode: (id: string, nextMode?: boolean) => void;
  onProxyLaunch: (id: string) => void;
  onCreateLauncher: (id: string) => void;
  onCreateStartMenuLauncher: (id: string) => void;
  busyAction?: string;
};

function nextChromiumMode(current?: boolean): boolean | undefined {
  if (current === undefined) return true;
  if (current === true) return false;
  return undefined;
}

function chromiumModeMeta(current?: boolean) {
  if (current === true) {
    return {
      key: "forced",
      label: "强制参数",
      title: "已强制附加 --proxy-server 启动参数（点击切换为仅环境变量）",
    };
  }
  if (current === false) {
    return {
      key: "env-only",
      label: "仅环境",
      title: "仅注入代理环境变量，不附加 Chromium 启动参数（点击恢复自动识别）",
    };
  }
  return {
    key: "auto",
    label: "自动",
    title: "自动识别 Chromium / Electron / CEF 应用并附加 --proxy-server 参数（点击强制开启）",
  };
}

export function AppList({
  rules,
  onAdd,
  onRemove,
  onToggleChromiumMode,
  onProxyLaunch,
  onCreateLauncher,
  onCreateStartMenuLauncher,
  busyAction,
}: AppListProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const visibleRules = rules.filter((rule) => `${rule.displayName}\n${rule.executablePath}`.toLocaleLowerCase().includes(deferredQuery));

  return (
    <>
      {rules.length > 0 ? (
        <div className="apps-toolbar">
          <label className="search-field app-search">
            <Search size={14} />
            <input
              aria-label="搜索常用应用"
              placeholder="筛选应用名称或路径…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                type="button"
                className="search-field__clear"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <X size={12} />
              </button>
            ) : null}
          </label>
          <span className="apps-toolbar__note">
            <ShieldCheck size={13} />
            按需启动，不修改系统代理
          </span>
        </div>
      ) : null}

      <section className="apps-panel" aria-label="已添加应用列表">
        <div className="app-list" role="list">
          {rules.length > 0 ? (
            <div className="app-list__head" aria-hidden="true">
              <span>应用</span>
              <span>代理参数</span>
              <span>操作</span>
            </div>
          ) : null}

          {rules.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__icon"><AppWindow size={20} /></span>
              <strong>还没有添加应用</strong>
              <p>选择需要走代理的 Windows 应用，支持一键按需启动或生成独立桌面快捷方式。</p>
              <button type="button" className="button button--primary" onClick={onAdd}>
                <Plus size={14} />添加第一个应用
              </button>
            </div>
          ) : visibleRules.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__icon"><Search size={18} /></span>
              <strong>没有匹配的应用</strong>
              <p>试试其他名称或路径关键词。</p>
              <button className="button" type="button" onClick={() => setQuery("")}>清空搜索</button>
            </div>
          ) : visibleRules.map((rule) => {
            const mode = chromiumModeMeta(rule.chromiumProxyMode);
            return (
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

                <div className="app-row__meta">
                  {rule.packageFamilyName ? (
                    <span
                      className="app-row__type"
                      title={rule.executableScopeRoot ? `自动包含 ${rule.scopeExecutableCount || 1} 个组件` : rule.executableName}
                    >
                      Store
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="app-row__mode"
                    data-mode={mode.key}
                    disabled={Boolean(busyAction)}
                    title={mode.title}
                    aria-label={`${rule.displayName} 代理参数模式：${mode.label}`}
                    onClick={() => onToggleChromiumMode(rule.id, nextChromiumMode(rule.chromiumProxyMode))}
                  >
                    {mode.label}
                  </button>
                </div>

                <div className="app-row__actions">
                  <button
                    type="button"
                    className="button app-launch"
                    disabled={Boolean(busyAction)}
                    onClick={() => onProxyLaunch(rule.id)}
                    aria-label={`使用环境代理启动 ${rule.displayName}`}
                    title="使用当前代理启动"
                  >
                    {busyAction === `launch:${rule.id}` ? <LoaderCircle className="spin" size={13} /> : <Play size={13} />}
                    <span>启动</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={Boolean(busyAction)}
                    onClick={() => onCreateLauncher(rule.id)}
                    aria-label={`为 ${rule.displayName} 创建桌面代理启动器`}
                    title="创建独立桌面快捷方式"
                  >
                    {busyAction === `shortcut:${rule.id}` ? <LoaderCircle className="spin" size={14} /> : <MonitorDown size={14} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={Boolean(busyAction)}
                    onClick={() => onCreateStartMenuLauncher(rule.id)}
                    aria-label={`为 ${rule.displayName} 添加开始菜单代理启动器`}
                    title="添加到开始菜单"
                  >
                    {busyAction === `start-menu:${rule.id}` ? <LoaderCircle className="spin" size={14} /> : <Menu size={14} />}
                  </button>
                  <button
                    type="button"
                    className="icon-button app-row__delete"
                    disabled={Boolean(busyAction)}
                    onClick={() => onRemove(rule.id)}
                    aria-label={`移除 ${rule.displayName}`}
                    title="移除应用"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
