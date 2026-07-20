# 参与贡献

感谢参与应用代理的开发。提交改动前请：

1. 先阅读 `开发文档-应用级代理控制器.md`，确认改动没有扩大产品边界。
2. 对网络、权限、启动项或路由相关改动补充失败回退测试。
3. 运行 `npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` 和 `cargo test --manifest-path src-tauri/Cargo.toml`。
4. 不在日志、Issue、截图或测试数据中提交代理凭据、访问历史和用户路径。

较大的功能建议先创建 Issue，说明用户场景、权限影响、失败模式和验收标准。

安全漏洞请按照 `SECURITY.md` 私下报告，不要创建公开 Issue。
