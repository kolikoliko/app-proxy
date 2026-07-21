import { CheckCircle2, Download, Github, LoaderCircle, RefreshCw, Rocket } from "lucide-react";
import type { AppUpdater } from "../hooks/useAppUpdater";

type UpdatePanelProps = {
  updater: AppUpdater;
};

export function UpdatePanel({ updater }: UpdatePanelProps) {
  const busy = updater.phase === "checking" || updater.phase === "downloading" || updater.phase === "installing";
  const releaseDate = updater.publishedAt
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(updater.publishedAt))
    : null;

  return (
    <section className="settings-group update-panel">
      <div className="update-panel__heading">
        <div>
          <h2 className="settings-group__title"><Rocket size={16} />应用更新</h2>
          <p className="settings-group__description">当前版本 v{updater.currentVersion}</p>
        </div>
        <button
          type="button"
          className="button update-check-button"
          disabled={busy || updater.phase === "downloaded"}
          onClick={() => void updater.checkForUpdates()}
        >
          {updater.phase === "checking" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
          {updater.phase === "checking" ? "检查中" : "检查更新"}
        </button>
      </div>

      <div className="github-notice">
        <Github size={18} aria-hidden="true" />
        <span><strong>更新服务连接 GitHub</strong>优先使用上方代理地址；代理端口不可用时自动回退直连。</span>
      </div>

      {updater.message ? (
        <div className="update-message" data-phase={updater.phase} role={updater.phase === "error" ? "alert" : "status"}>
          {updater.phase === "checking" || updater.phase === "downloading" || updater.phase === "installing"
            ? <LoaderCircle className="spin" size={17} />
            : <CheckCircle2 size={17} />}
          <span>{updater.message}</span>
        </div>
      ) : null}

      {updater.phase === "available" || updater.phase === "downloaded" || updater.phase === "downloading" ? (
        <div className="update-release">
          <div className="update-release__title">
            <strong>v{updater.availableVersion}</strong>
            {releaseDate ? <span>{releaseDate}</span> : null}
          </div>
          {updater.notes ? <div className="update-notes">{updater.notes}</div> : null}
        </div>
      ) : null}

      {updater.phase === "downloading" || updater.phase === "downloaded" ? (
        <div className="update-progress" aria-label="更新下载进度">
          <div className="update-progress__track">
            <span style={{ width: `${updater.progress ?? 8}%` }} />
          </div>
          <small>{typeof updater.progress === "number" ? `${updater.progress}%` : "正在接收数据"}</small>
        </div>
      ) : null}

      {updater.phase === "available" || updater.phase === "downloaded" ? (
        <div className="update-actions">
          {updater.phase === "available" ? (
            <button type="button" className="button button--primary" onClick={() => void updater.downloadUpdate()}>
              <Download size={17} />下载更新
            </button>
          ) : null}
          {updater.phase === "downloaded" ? (
            <button type="button" className="button button--primary" onClick={() => void updater.installUpdate()}>
              <Rocket size={17} />安装并重启
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="update-panel__footnote">应用每天最多自动检查一次；不会自动下载或强制安装。</p>
    </section>
  );
}
