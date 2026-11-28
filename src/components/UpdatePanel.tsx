import { CheckCircle2, CircleAlert, Download, LoaderCircle, RefreshCw, Rocket } from "lucide-react";
import type { AppUpdater } from "../hooks/useAppUpdater";

type UpdatePanelProps = {
  updater: AppUpdater;
};

export function UpdatePanel({ updater }: UpdatePanelProps) {
  const busy = updater.phase === "checking" || updater.phase === "downloading" || updater.phase === "installing";
  const releaseDate = updater.publishedAt
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(updater.publishedAt))
    : null;
  const showBody = Boolean(updater.message)
    || updater.phase === "available"
    || updater.phase === "downloading"
    || updater.phase === "downloaded";

  return (
    <section className="settings-section">
      <h2 className="settings-section__label">应用更新</h2>
      <div className="settings-group">
        <div className="update-row">
          <div className="update-row__meta">
            <strong>当前版本 v{updater.currentVersion}</strong>
            <small>从 GitHub Releases 检查更新，优先走上方代理，不可用时自动回退直连。</small>
          </div>
          <button
            type="button"
            className="button"
            disabled={busy || updater.phase === "downloaded"}
            onClick={() => void updater.checkForUpdates()}
          >
            {updater.phase === "checking" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
            {updater.phase === "checking" ? "检查中" : "检查更新"}
          </button>
        </div>

        {showBody ? (
          <div className="update-body">
            {updater.message ? (
              <div className="update-message" data-phase={updater.phase} role={updater.phase === "error" ? "alert" : "status"}>
                {busy
                  ? <LoaderCircle className="spin" size={14} />
                  : updater.phase === "error"
                    ? <CircleAlert size={14} />
                    : <CheckCircle2 size={14} />}
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
                <small>{typeof updater.progress === "number" ? `${updater.progress}%` : "接收中"}</small>
              </div>
            ) : null}

            {updater.phase === "available" || updater.phase === "downloaded" ? (
              <div className="update-actions">
                {updater.phase === "available" ? (
                  <button type="button" className="button button--primary" onClick={() => void updater.downloadUpdate()}>
                    <Download size={14} />下载更新
                  </button>
                ) : null}
                {updater.phase === "downloaded" ? (
                  <button type="button" className="button button--primary" onClick={() => void updater.installUpdate()}>
                    <Rocket size={14} />安装并重启
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
