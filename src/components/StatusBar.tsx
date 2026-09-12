import { ArrowUpRight, Layers2, Radio, ShieldCheck } from "lucide-react";

type StatusBarProps = {
  appCount: number;
  proxyUrl: string;
  onOpenSettings: () => void;
};

export function StatusBar({ appCount, proxyUrl, onOpenSettings }: StatusBarProps) {
  const endpoint = (() => {
    try {
      const url = new URL(proxyUrl);
      return { address: url.host, protocol: url.protocol.replace(":", "").toUpperCase() };
    } catch {
      return { address: "请设置代理地址", protocol: "未配置" };
    }
  })();

  return (
    <section className="status-bar" aria-label="应用代理状态">
      <div className="status-item">
        <span className="status-icon"><Layers2 size={20} /></span>
        <span className="status-item__content"><small>我的应用</small><strong>{appCount}<span> 个应用</span></strong></span>
      </div>
      <div className="status-item">
        <span className="status-icon status-icon--green"><ShieldCheck size={20} /></span>
        <span className="status-item__content"><small>代理方式</small><strong>按需启动</strong><span>不修改系统代理</span></span>
      </div>
      <button type="button" className="status-item status-item--link" onClick={onOpenSettings} aria-label="前往设置修改代理地址">
        <span className="status-icon"><Radio size={20} /></span>
        <span className="status-item__content"><small>当前代理 · {endpoint.protocol}</small><strong className="status-endpoint" title={endpoint.address}>{endpoint.address}</strong><span>管理连接</span></span>
        <ArrowUpRight size={15} className="status-item__arrow" />
      </button>
    </section>
  );
}
