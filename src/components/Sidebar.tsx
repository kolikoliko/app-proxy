import { ArrowUpRight, Monitor, Moon, Network, Settings, Sun, Wrench } from "lucide-react";
import type { ThemeMode } from "../types";

export type NavigationView = "apps" | "tools" | "settings";

type SidebarProps = {
  theme: ThemeMode;
  version: string;
  activeView: NavigationView;
  onNavigate: (view: NavigationView) => void;
  onThemeChange: (theme: ThemeMode) => void;
};

const navigation = [
  { id: "apps", label: "应用代理", icon: Network },
  { id: "tools", label: "工具代理", icon: Wrench },
  { id: "settings", label: "设置", icon: Settings },
] as const;

const themes = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export function Sidebar({ theme, version, activeView, onNavigate, onThemeChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="应用代理">
        <span className="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 512 512" width="24" height="24" fill="none">
            <path
              d="M223 116 C235 92 269 92 281 116 L296 146 L191 364 C182 383 161 392 141 386 C117 379 105 352 116 330 L223 116 Z"
              fill="currentColor"
              fillOpacity="0.62"
            />
            <path
              d="M228 118 C240 93 274 93 286 118 L396 330 C407 352 395 379 371 386 C351 392 330 383 321 364 L228 176 C220 158 220 135 228 118 Z"
              fill="currentColor"
            />
            <rect x="208" y="314" width="96" height="46" rx="23" fill="currentColor" fillOpacity="0.88" />
          </svg>
        </span>
        <span className="brand__text">应用代理<small>APP PROXY</small></span>
      </div>
      <span className="sidebar__label">工作空间</span>
      <nav className="nav" aria-label="主导航">
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            className="nav__item"
            data-active={activeView === id}
            type="button"
            key={id}
            aria-label={label}
            aria-current={activeView === id ? "page" : undefined}
            title={label}
            onClick={() => onNavigate(id)}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span>{label}</span>
            {activeView === id ? <span className="nav__indicator" /> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">
        <div className="sidebar-note">
          <ArrowUpRight size={18} />
          <strong>让连接，更简单</strong>
          <p>为需要的应用，选择合适的连接方式。</p>
        </div>
        <div className="theme-toggle" role="group" aria-label="界面外观">
          {themes.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" title={label} aria-label={label}
              aria-pressed={theme === value} onClick={() => onThemeChange(value)}>
              <Icon size={16} strokeWidth={1.8} />
            </button>
          ))}
        </div>
        <span className="version">APP PROXY <span>v{version}</span></span>
      </div>
    </aside>
  );
}
