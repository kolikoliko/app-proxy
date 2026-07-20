# 第三方软件声明

应用代理使用 Tauri、React、Vite、Lucide 及 Rust/JavaScript 生态依赖；精确版本记录在 `package-lock.json` 与 `src-tauri/Cargo.lock` 中，各组件继续适用其原始许可证。

透明分流内核使用 sing-box 1.13.12（GPL-3.0-or-later）。`scripts/fetch-sing-box.ps1` 从 SagerNet 官方 GitHub Release 下载 Windows AMD64 构建，并根据 `src-tauri/sing-box.version.json` 中记录的 SHA-256 校验文件完整性。

项目独立开发，不隶属于或代表 SagerNet、sing-box、Clash/Mihomo 或任何代理服务。发行包随附本项目 GPL-3.0-or-later 许可说明及本第三方声明；对应源代码可从本项目 GitHub 仓库和 sing-box 上游仓库获取。
