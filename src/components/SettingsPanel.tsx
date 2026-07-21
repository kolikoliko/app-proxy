import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, LoaderCircle, Palette, ShieldCheck, TriangleAlert } from "lucide-react";
import type { AccentColor, AppSettings, ProxyTestResult, TunStatus } from "../types";
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

type SettingsPanelProps = {
  settings: AppSettings;
  testing: boolean;
  testResult: ProxyTestResult | null;
  tunStatus: TunStatus;
  updater: AppUpdater;
  onChange: (patch: Partial<AppSettings>) => void;
  onProxyCommit: (proxyUrl: string) => void;
  onTest: (proxyUrl: string) => void;
  onPause: (minutes: number | null) => void;
};

export function SettingsPanel({ settings, testing, testResult, tunStatus, updater, onChange, onProxyCommit, onTest, onPause }: SettingsPanelProps) {
  const paused = Boolean(settings.pauseUntil);
  const [proxyDraft, setProxyDraft] = useState(settings.proxyUrl);

  useEffect(() => setProxyDraft(settings.proxyUrl), [settings.proxyUrl]);

  return (
    <aside className="settings-panel">
      <section className="settings-group">
        <h2 className="settings-group__title"><Palette size={16} />主题色</h2>
        <p className="settings-group__description">应用到按钮、开关、状态和选中项。</p>
        <div className="accent-picker" role="group" aria-label="主题色">
          {ACCENT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="accent-option"
              data-selected={(settings.accentColor ?? "green") === option.value}
              aria-pressed={(settings.accentColor ?? "green") === option.value}
              aria-label={`${option.label}主题色`}
              onClick={() => onChange({ accentColor: option.value })}
            >
              <span className="accent-option__swatch" style={{ backgroundColor: option.color }} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h2>代理地址</h2>
        <label className="field">
          <span className="sr-only">代理地址</span>
          <input
            value={proxyDraft}
            spellCheck={false}
            onChange={(event) => setProxyDraft(event.target.value)}
            onBlur={() => onProxyCommit(proxyDraft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onProxyCommit(proxyDraft);
            }}
            placeholder="socks://127.0.0.1:7890"
          />
        </label>
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
        {tunStatus.protocolNote ? <p className="hint">{tunStatus.protocolNote}</p> : null}
        <div className="proxy-mode-notice" role="note">
          <TriangleAlert size={17} />
          <span>
            <strong>Clash / Mihomo 请使用全局模式</strong>
            如需所选应用的全部流量强制使用代理节点，请将上游代理软件切换为全局模式；规则模式仍可能把部分域名、IP 或 QUIC 流量判定为 DIRECT。
          </span>
        </div>
      </section>

      <section className="settings-group">
        <h2>定时暂停</h2>
        <div className="pause-control">
          <Clock3 size={17} />
          <select
            value={paused ? "paused" : "running"}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "running") onPause(0);
              else if (value === "manual") onPause(null);
              else onPause(Number(value));
            }}
          >
            <option value="running">不暂停</option>
            <option value="5">暂停 5 分钟</option>
            <option value="15">暂停 15 分钟</option>
            <option value="30">暂停 30 分钟</option>
            <option value="60">暂停 1 小时</option>
            <option value="manual">直到手动恢复</option>
            {paused ? <option value="paused">暂停中</option> : null}
          </select>
        </div>
        {paused ? <p className="hint">已暂停。选择“不暂停”可立即恢复。</p> : null}
      </section>

      <section className="settings-group settings-group--rows">
        <SettingRow label="TUN 模式" description={tunStatus.message}>
          <Switch
            checked={settings.tunEnabled}
            onChange={(tunEnabled) => onChange({ tunEnabled, pauseUntil: undefined })}
            label="TUN 模式"
          />
        </SettingRow>
        <SettingRow label="局域网绕过" description="NAS、打印机与内网地址直连">
          <Switch checked={settings.bypassLan} onChange={(bypassLan) => onChange({ bypassLan })} label="局域网绕过" />
        </SettingRow>
        <SettingRow label="开机自启" description="登录后静默启动到托盘">
          <Switch checked={settings.launchAtLogin} onChange={(launchAtLogin) => onChange({ launchAtLogin })} label="开机自启" />
        </SettingRow>
        <SettingRow label="退出安全保护" description="当前版本始终清理临时路由和 TUN">
          <Switch
            checked
            disabled
            onChange={() => undefined}
            label="退出安全保护"
          />
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
