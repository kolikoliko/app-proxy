# 应用代理（App Proxy）

一个轻量、开源的 Windows 应用级代理控制器。选择哪些应用通过本地 SOCKS5/HTTP 代理，其余应用保持直连。

## 功能

- 基于 sing-box TUN 按 Windows 进程路径分流，不修改系统代理。
- 从已安装的 Win32 和 Microsoft Store 应用中搜索并添加程序。
- Microsoft Store/MSIX 应用自动按应用组匹配包内组件，例如 ChatGPT 与其 `codex.exe` 子组件。
- 每个应用独立开关，并可从系统托盘快捷切换。
- 自定义代理地址和端口，默认 `socks://127.0.0.1:7890`。
- 浅色、深色和系统主题，以及多种主题色。
- 开机自启、定时暂停、局域网绕过、连通性检查和安全退出。
- 主程序退出时由 Windows 自动回收受管 sing-box 进程和 TUN 句柄。

## 安装

从 [Releases](https://github.com/kolikoliko/app-proxy/releases) 下载最新的 Windows x64 安装包：

- 推荐普通用户使用 `AppProxy_*_x64-setup.exe`（NSIS）。
- 需要 MSI 部署时使用 `AppProxy_*_x64_zh-CN.msi`。

首个版本尚未购买商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。请只从本仓库 Releases 下载，并核对 Release 中的 SHA-256 校验值。

## 使用

1. 先启动 Clash/Mihomo、sing-box 或其他本地代理客户端，并确认本地 SOCKS5/HTTP 端口可用。
2. 打开应用代理，在设置中填写代理地址；默认端口为 `7890`。
3. 添加需要代理的应用并打开右侧开关。
4. 打开 TUN 模式并接受 Windows UAC 请求。

建议关闭其他代理客户端自身的 TUN，避免两个 TUN 同时修改路由。HTTP 上游仅代理 TCP；需要 UDP 时使用 SOCKS5。

## 当前限制

- 首发仅提供 Windows 10/11 x64 构建。
- 普通 Win32 软件按所选 `.exe` 精确匹配；Microsoft Store/MSIX 应用支持包内应用组。
- 本项目不提供节点、订阅或代理服务，必须配合现有本地代理使用。
- 安装包暂未进行 Authenticode 商业代码签名。

## 本地开发

需要 Node.js、Rust、Windows WebView2 和管理员 PowerShell（仅测试 TUN 时需要）：

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\fetch-sing-box.ps1
npm run tauri dev
```

仅运行浏览器界面：

```powershell
npm run dev
```

构建安装包：

```powershell
npm run tauri build
```

## 安全与隐私

规则和设置只保存在本机。程序不读取 HTTPS 内容，不上传访问历史，也不提供远程控制。安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

项目采用 [GPL-3.0-or-later](LICENSE)。sing-box 和其他第三方组件信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目与 sing-box、Clash/Mihomo 或任何代理服务不存在官方隶属关系。
