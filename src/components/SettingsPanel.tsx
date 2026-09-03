import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, Palette, ShieldCheck } from "lucide-react";
import type { AccentColor, AppSettings, ProxyTestResult } from "../types";
import type { AppUpdater } from "../hooks/useAppUpdater";
import { Switch } from "./Switch";
import { UpdatePanel } from "./UpdatePanel";

const ACCENT_OPTIONS: ReadonlyArray<{ value: AccentColor; label: string; color: string }> = [
  { value: "green", label: "绿色", color: "#15933d" },
  { value: "blue", label: "蓝色", color: "#2563eb" },
  { value: "purple", label: "紫色", color: "#7c3aed" },
  { value: "yellow", label: "黄色", color: "#b86b00" },
  { value: "rose", label: "玫红", color: "#db2777" },
  { value: "cyan", label: "青色", color: "#07838f" },
];

type ProxyProtocol = "socks" | "http" | "https";

const PROXY_PROTOCOLS: ReadonlyArray<{ value: ProxyProtocol; label: string }> = [
  { value: "socks", label: "SOCKS" },
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
];

function splitProxyUrl(value: string): { protocol: ProxyProtocol; endpoint: string } {
  const match = value.match(/^([a-z][a-z\d+.-]*):\/\/(.*)$/i);
  const scheme = match?.[1].toLocaleLowerCase();
  const protocol = scheme === "socks" || scheme === "socks5"
    ? "socks"
    : scheme === "https"
      ? "https"
      : "http";
  return { protocol, endpoint: match?.[2] ?? value };
}

type SettingsPanelProps = {
  settings: AppSettings;
  testing: boolean;
  testResult: ProxyTestResult | null;
  updater: AppUpdater;
  onChange: (patch: Partial<AppSettings>) => void;
  onProxyCommit: (proxyUrl: string) => void;
  onTest: (proxyUrl: string) => void;
};

export function SettingsPanel({ settings, testing, testResult, updater, onChange, onProxyCommit, onTest }: SettingsPanelProps) {
  const initialProxy = splitProxyUrl(settings.proxyUrl);
  const [proxyProtocol, setProxyProtocol] = useState<ProxyProtocol>(initialProxy.protocol);
  const [proxyEndpoint, setProxyEndpoint] = useState(initialProxy.endpoint);
  const [launcherSuffixDraft, setLauncherSuffixDraft] = useState(settings.launcherSuffix);
  const proxyDraft = `${proxyProtocol}://${proxyEndpoint}`;
  const selectedAccent = ACCENT_OPTIONS.find((option) => option.value === (settings.accentColor ?? "blue"))
    ?? ACCENT_OPTIONS[1];

  useEffect(() => {
    const next = splitProxyUrl(settings.proxyUrl);
    setProxyProtocol(next.protocol);
    setProxyEndpoint(next.endpoint);
  }, [settings.proxyUrl]);

  useEffect(() => setLauncherSuffixDraft(settings.launcherSuffix), [settings.launcherSuffix]);

  const commitLauncherSuffix = () => {
    const launcherSuffix = launcherSuffixDraft.trim();
    setLauncherSuffixDraft(launcherSuffix);
    if (launcherSuffix !== settings.launcherSuffix) onChange({ launcherSuffix });
  };

  return (
    <aside className="settings-panel">
      <section className="settings-group">
        <h2>代理地址</h2>
        <div className="proxy-address-field">
          <label className="field">
            <span className="sr-only">代理协议</span>
            <select
              aria-label="代理协议"
              value={proxyProtocol}
              onChange={(event) => {
                const protocol = event.target.value as ProxyProtocol;
                setProxyProtocol(protocol);
                onProxyCommit(`${protocol}://${proxyEndpoint}`);
              }}
            >
              {PROXY_PROTOCOLS.map((protocol) => (
                <option key={protocol.value} value={protocol.value}>{protocol.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="sr-only">代理主机和端口</span>
            <input
              aria-label="代理主机和端口"
              value={proxyEndpoint}
              spellCheck={false}
              onChange={(event) => {
                const value = event.target.value;
                if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
                  const next = splitProxyUrl(value);
                  setProxyProtocol(next.protocol);
                  setProxyEndpoint(next.endpoint);
                } else {
                  setProxyEndpoint(value);
                }
              }}
              onBlur={() => onProxyCommit(proxyDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onProxyCommit(proxyDraft);
              }}
              placeholder="127.0.0.1:7890"
            />
          </label>
        </div>
        <button type="button" className="button button--test" disabled={testing} onClick={() => onTest(proxyDraft)}>
          {testing ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />}
          {testing ? "正在测试" : "测试连接"}
        </button>
        {testResult ? (
          <div className="test-result" data-success={testResult.reachable}>
            <CheckCircle2 size={17} />
            <span>{testResult.message}</span>
            {testResult.latencyMs ? <strong>{testResult.latencyMs} ms</strong> : null}
          </div>
        ) : null}
        <div className="proxy-mode-notice proxy-mode-notice--compatible" role="note">
          <ShieldCheck size={17} />
          <span>
            <strong>支持 SOCKS、HTTP 和 HTTPS 本地代理</strong>
            应用启动器会设置代理环境变量；Chromium/Electron 应用还会自动附加代理启动参数。
          </span>
        </div>
      </section>

      <section className="settings-group settings-group--rows">
        <div className="setting-row setting-row--accent">
          <span>
            <strong className="setting-label-with-icon"><Palette size={16} />主题色</strong>
            <small>应用到按钮、开关、状态和选中项</small>
          </span>
          <label className="field setting-select-field accent-select-field">
            <span className="accent-select-field__swatch" style={{ backgroundColor: selectedAccent.color }} />
            <select
              aria-label="主题色"
              value={selectedAccent.value}
              onChange={(event) => onChange({ accentColor: event.target.value as AccentColor })}
            >
              {ACCENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="setting-row setting-row--field">
          <span>
            <strong>快捷方式后缀</strong>
            <small>应用到新建的桌面和开始菜单快捷方式</small>
            <small className="shortcut-name-preview">示例：Chrome{launcherSuffixDraft.trim()}.lnk</small>
          </span>
          <label className="field shortcut-suffix-field">
            <span className="sr-only">快捷方式后缀</span>
            <input
              aria-label="快捷方式后缀"
              value={launcherSuffixDraft}
              maxLength={40}
              spellCheck={false}
              onChange={(event) => setLauncherSuffixDraft(event.target.value.replace(/[<>:"/\\|?*]/g, ""))}
              onBlur={commitLauncherSuffix}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitLauncherSuffix();
              }}
              placeholder="-proxy"
            />
          </label>
        </div>
        <SettingRow label="开机自启" description="登录后静默启动到托盘">
          <Switch checked={settings.launchAtLogin} onChange={(launchAtLogin) => onChange({ launchAtLogin })} label="开机自启" />
        </SettingRow>
      </section>

      <UpdatePanel updater={updater} />
    </aside>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      {children}
    </div>
  );
}
