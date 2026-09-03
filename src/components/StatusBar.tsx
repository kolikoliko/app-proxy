import { CheckCircle2 } from "lucide-react";

type StatusBarProps = {
  appCount: number;
  proxyUrl: string;
};

export function StatusBar({ appCount, proxyUrl }: StatusBarProps) {
  const port = (() => {
    try {
      return new URL(proxyUrl).port || "—";
    } catch {
      return "—";
    }
  })();

  return (
    <section className="status-bar" aria-label="应用代理状态">
      <span className="status-bar__primary" data-phase="ready">
        <CheckCircle2 size={22} />
        <strong>按需代理</strong>
      </span>
      <span className="status-bar__divider" />
      <span>已添加 {appCount} 个应用</span>
      <span className="status-bar__divider" />
      <span>系统代理：未修改</span>
      <span className="status-bar__divider" />
      <span>服务端口：{port}</span>
    </section>
  );
}
