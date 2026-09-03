# 应用内更新与发布

应用代理从 v0.2.0 开始使用 Tauri Updater 和 GitHub Releases 提供签名更新。v0.1.0 未内置更新公钥，因此用户需要手动安装一次 v0.2.0；之后可以在设置页直接升级。

## 用户侧流程

1. 应用每天最多检查一次，也可以在设置页手动检查。
2. 检查和下载均连接 `github.com`；应用优先使用设置中的 SOCKS、HTTP 或 HTTPS 代理，代理端口不可用时自动回退直连，并提示实际使用的连接方式。
3. 下载完成后，Tauri 使用内置公钥验证更新包签名。
4. 用户点击“安装并重启”后，应用以被动模式启动 Windows 安装程序并重启。

更新不会静默下载，也不会强制安装。

## 发布新版本

1. 只将 `package.json` 作为版本源更新；运行 `npm run version:check`，确认 `package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 及 `CHANGELOG.md` 首个版本条目一致。
2. 在本地完成版本检查、前端构建、Rust 格式检查、Clippy 和测试后推送提交。
3. 创建并推送完全匹配的标签，例如 `v0.3.2`。
4. `.github/workflows/release.yml` 只在发布版本标签时运行，在 Windows x64 runner 上构建 NSIS/MSI、更新签名和 `latest.json`，然后发布 GitHub Release；普通推送和 PR 不再运行云端编译检查。
5. 使用上一正式版本执行一次应用内升级，确认检查、下载、验签、安装和重启均正常。

Release 工作流需要以下仓库 Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

私钥和密码不可提交到仓库。丢失其中任何一项都会导致已安装版本无法信任后续更新，因此至少保留一份受保护的离线备份。

## 安全边界

Updater 的 minisign 密钥用于验证更新来源，不等同于 Windows Authenticode 证书。未购买 Authenticode 证书时，SmartScreen 仍可能提示“未知发布者”，但应用不会接受未通过 Updater 签名验证的安装包。
