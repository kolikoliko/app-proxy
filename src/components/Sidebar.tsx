import { Box, CircleHelp, Moon, Network, Settings, Stethoscope, Sun } from "lucide-react";
import type { ThemeMode } from "../types";

export type NavigationView = "apps" | "settings";

type SidebarProps = {
  theme: ThemeMode;
  version: string;
  activeView: NavigationView;
  onNavigate: (view: NavigationView) => void;
  onThemeChange: (theme: ThemeMode) => void;
};

const navigation = [
  { id: "apps", label: "应用代理", icon: Network, enabled: true },
  { id: "settings", label: "设置", icon: Settings, enabled: true },
  { id: "diagnostics", label: "诊断", icon: Stethoscope, enabled: false },
  { id: "about", label: "关于", icon: CircleHelp, enabled: false },
] as const;

export function Sidebar({ theme, version, activeView, onNavigate, onThemeChange }: SidebarProps) {
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <aside className="sidebar">
      <div className="brand" aria-label="应用代理">
        <span className="brand__mark"><Box size={26} strokeWidth={1.8} /></span>
        <span className="brand__text">应用代理</span>
      </div>
      <nav className="nav" aria-label="主导航">
        {navigation.map(({ id, label, icon: Icon, enabled }) => (
          <button
            className="nav__item"
            data-active={activeView === id}
            type="button"
            key={id}
            disabled={!enabled}
            title={enabled ? undefined : "即将推出"}
            onClick={() => {
              if (enabled) onNavigate(id);
            }}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar__footer">
        <button
          type="button"
          className="theme-toggle"
          onClick={() => onThemeChange(nextTheme)}
          aria-label={`切换到${nextTheme === "dark" ? "深色" : "浅色"}模式`}
        >
          <Sun size={18} className="theme-toggle__sun" />
          <Moon size={18} className="theme-toggle__moon" />
          <span className="theme-toggle__thumb" />
        </button>
        <span className="version">v{version}</span>
      </div>
    </aside>
  );
}
