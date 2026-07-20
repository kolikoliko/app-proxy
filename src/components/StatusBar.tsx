import { AlertCircle, CheckCircle2, CircleOff, Clock3 } from "lucide-react";
import type { TunStatus } from "../types";

type StatusBarProps = {
  requestedEnabled: boolean;
  status: TunStatus;
  enabledApps: number;
  proxyUrl: string;
  onToggle: (enabled: boolean) => void;
};

const STATUS_LABELS: Record<TunStatus["phase"], string> = {
  stopped: "TUN 已关闭",
  ready: "内核已就绪",
  running: "TUN 运行中",
  paused: "TUN 已暂停",
  waiting: "等待应用",
  error: "TUN 启动失败",
};

export function StatusBar({ requestedEnabled, status, enabledApps, proxyUrl, onToggle }: StatusBarProps) {
  const port = (() => {
    try {
      return new URL(proxyUrl).port || "—";
    } catch {
      return "—";
    }
  })();

  return (
    <section className="status-bar" aria-label="TUN 状态" title={status.message}>
      <button
        type="button"
        className="status-bar__primary"
        data-phase={status.phase}
        aria-label={`${STATUS_LABELS[status.phase]}，点击${requestedEnabled ? "关闭" : "开启"} TUN`}
        onClick={() => onToggle(!requestedEnabled)}
      >
        {status.phase === "error" ? <AlertCircle size={22} />
          : status.phase === "paused" || status.phase === "waiting" ? <Clock3 size={22} />
            : status.phase === "running" || status.phase === "ready" ? <CheckCircle2 size={22} />
              : <CircleOff size={22} />}
        <strong>{STATUS_LABELS[status.phase]}</strong>
      </button>
      <span className="status-bar__divider" />
      <span>已选择 {enabledApps} 个应用使用代理</span>
      <span className="status-bar__divider" />
      <span>系统代理：未修改</span>
      <span className="status-bar__divider" />
      <span>服务端口：{port}</span>
    </section>
  );
}
