import { useEffect, useState } from "react";
import { Check, CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import type { AccentColor, AppSettings, ProxyTestResult } from "../types";
import type { AppUpdater } from "../hooks/useAppUpdater";
import { Switch } from "./Switch";
import { UpdatePanel } from "./UpdatePanel";

const ACCENT_OPTIONS: ReadonlyArray<{ value: AccentColor; label: string; color: string }> = [
  { value: "blue", label: "蓝色", color: "#2563eb" },
  { value: "green", label: "绿色", color: "#16a34a" },
  { value: "purple", label: "紫色", color: "#7c3aed" },
  { value: "cyan", label: "青色", color: "#0891b2" },
  { value: "yellow", label: "黄色", color: "#b45309" },
  { value: "rose", label: "玫红", color: "#e11d48" },
];

type ProxyProtocol = "socks" | "http" | "https";

const PROXY_PROTOCOLS: ReadonlyArray<{ value: ProxyProtocol; label: string }> = [
  { value: "http", label: "HTTP" },
  { value: "https", label: "HTTPS" },
  { value: "socks", label: "SOCKS" },
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
    ?? ACCENT_OPTIONS[0];

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
    <div className="settings-panel">
      <section className="settings-section">
        <h2 className="settings-section__label">代理连接</h2>
        <div className="settings-group settings-group__pad">
          <div className="proxy-address-row">
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
            <button type="button" className="button" disabled={testing} onClick={() => onTest(proxyDraft)}>
              {testing ? <LoaderCircle className="spin" size={14} /> : null}
              {testing ? "测试中" : "测试连接"}
            </button>
          </div>

          {testResult ? (
            <div className="test-result" data-success={testResult.reachable}>
              {testResult.reachable ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
              <span>{testResult.message}</span>
              {typeof testResult.latencyMs === "number" ? <strong>{testResult.latencyMs} ms</strong> : null}
            </div>
          ) : null}

          <p className="settings-help">
            支持 HTTP、HTTPS 与 SOCKS 本地代理；修改地址后会自动同步已创建的桌面和开始菜单启动器配置。
          </p>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__label">常规与外观</h2>
        <div className="settings-group">
          <div className="setting-row setting-row--accent">
            <span>
              <strong>主题色</strong>
              <small>应用于主按钮、开关与高亮状态</small>
            </span>
            <div className="accent-options" role="group" aria-label="主题色">
              {ACCENT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="accent-swatch"
                  title={option.label}
                  aria-label={option.label}
                  aria-pressed={selectedAccent.value === option.value}
                  style={{ backgroundColor: option.color }}
                  onClick={() => onChange({ accentColor: option.value })}
                >
                  {selectedAccent.value === option.value ? <Check size={12} strokeWidth={3} /> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="setting-row setting-row--field">
            <span>
              <strong>快捷方式后缀</strong>
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

          <div className="setting-row">
            <span>
              <strong>开机自启</strong>
              <small>登录 Windows 后静默驻留到系统托盘</small>
            </span>
            <Switch
              checked={settings.launchAtLogin}
              onChange={(launchAtLogin) => onChange({ launchAtLogin })}
              label="开机自启"
            />
          </div>
        </div>
      </section>

      <UpdatePanel updater={updater} />
    </div>
  );
}
