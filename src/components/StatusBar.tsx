import { ArrowUpRight } from "lucide-react";

type StatusBarProps = {
  proxyUrl: string;
  onOpenSettings: () => void;
};

export function StatusBar({ proxyUrl, onOpenSettings }: StatusBarProps) {
  const endpoint = (() => {
    try {
      const url = new URL(proxyUrl);
      return { address: url.host, protocol: url.protocol.replace(":", "").toUpperCase() };
    } catch {
      return { address: "未配置代理", protocol: "OFF" };
    }
  })();

  return (
    <button
      type="button"
      className="proxy-pill"
      onClick={onOpenSettings}
      aria-label="前往设置修改代理地址"
      title={`当前代理 ${proxyUrl}，点击修改`}
    >
      <span className="proxy-pill__dot" aria-hidden="true" />
      <span className="proxy-pill__proto">{endpoint.protocol}</span>
      <span className="proxy-pill__addr">{endpoint.address}</span>
      <ArrowUpRight size={12} aria-hidden="true" />
    </button>
  );
}
