import { Monitor, Moon, Network, Settings, Sun, Wrench } from "lucide-react";
import type { ThemeMode } from "../types";

export type NavigationView = "apps" | "tools" | "settings";

type SidebarProps = {
  theme: ThemeMode;
  version: string;
  hasUpdate?: boolean;
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

export function Sidebar({ theme, version, hasUpdate = false, activeView, onNavigate, onThemeChange }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand" aria-label="应用代理" data-tauri-drag-region>
        <span className="brand__mark" aria-hidden="true" data-tauri-drag-region>
          <svg viewBox="0 0 512 512" width="16" height="16" fill="none">
            <path
              d="M223 116 C235 92 269 92 281 116 L296 146 L191 364 C182 383 161 392 141 386 C117 379 105 352 116 330 L223 116 Z"
              fill="currentColor"
              fillOpacity="0.62"
            />
            <path
              d="M228 118 C240 93 274 93 286 118 L396 330 C407 352 395 379 371 386 C351 392 330 383 321 364 L228 176 C220 158 220 135 228 118 Z"
              fill="currentColor"
            />
            <rect x="208" y="314" width="96" height="46" rx="23" fill="currentColor" fillOpacity="0.9" />
          </svg>
        </span>
        <span className="brand__text">应用代理</span>
      </div>

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
            <Icon size={16} strokeWidth={1.8} />
            <span>{label}</span>
            {id === "settings" && hasUpdate ? <span className="nav__dot" aria-hidden="true" /> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="theme-toggle" role="group" aria-label="界面外观">
          {themes.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={theme === value}
              onClick={() => onThemeChange(value)}
            >
              <Icon size={14} strokeWidth={1.8} />
            </button>
          ))}
        </div>
        <div className="sidebar__meta">
          <span>v{version}</span>
          {hasUpdate ? (
            <button
              type="button"
              className="sidebar__update-pill"
              onClick={() => onNavigate("settings")}
            >
              有更新
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
