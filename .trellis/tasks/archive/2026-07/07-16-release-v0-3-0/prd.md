# 发布 v0.3.0

## 目标

按照 `docs/发布/发布文档.md` 将当前 `main` 发布为 DdShell v0.3.0，通过推送 `v0.3.0` 标签触发 GitHub Actions，生成 macOS、Windows、Linux 安装包和 Tauri updater 产物。

## 已确认事实

- 当前版本为 `0.2.9`，上一发布标签为 `v0.2.9`。
- 远端不存在 `v0.3.0` 标签。
- 本地 `main` 比远端 `origin/main` 领先 30 个提交，发布内容以 `v0.2.9..HEAD` 为准。
- 本次实际功能范围以主题系统扩展为主：在 Classic、Aurora 基础上新增 14 套完整主题，共 16 套可选主题，并补充主题持久化、深浅模式、设置预览和真实页面覆盖。
- 本次还包含连接详情长名称布局修复及多项主题一致性优化。
- GitHub 已配置 Tauri updater 私钥和密码；Apple Developer 签名 Secrets 未配置，macOS 将走现有无 Developer ID 的构建路径。

## 要求

1. 将以下版本号更新为 `0.3.0`：
   - `app/package.json`
   - `app/src-tauri/tauri.conf.json`
   - `app/src-tauri/Cargo.toml`
   - `app/src-tauri/Cargo.lock` 中 DdShell 根包版本
2. 更新 `.github/workflows/release.yml` 顶部版本介绍，只替换上版动态正文，保留固定下载表格和 macOS 说明。
3. 新增 `docs/发布/v0.3.0-版本介绍.md`，内容必须来自 `v0.2.9..HEAD` 的实际提交。
4. 更新 README 的“最新版本介绍”链接。
5. 本地运行前端构建、预测回显测试、Rust 检查和发布文件一致性检查。
6. 提交发布准备，提交信息使用 `发布 v0.3.0`。
7. 将 `main` 推送到 origin，创建并推送 `v0.3.0` 标签，触发 Release workflow。
8. 持续监控 GitHub Actions，直至构建完成或发现明确失败；验证 Release 资产和 `latest.json` 平台键。

## 验收标准

- 四处应用版本均为 `0.3.0`，旧版本介绍文档保持历史不变。
- GitHub Release 正文和 v0.3.0 版本介绍准确描述 14 套新主题、16 套主题总量、双模式与页面覆盖。
- `pnpm --dir app build`、`pnpm --dir app test:predictive-echo`、`cargo check` 和 `git diff --check` 通过。
- `origin/main` 包含发布提交，远端 `v0.3.0` 指向同一提交。
- Release workflow 成功完成。
- Release 包含 6 个普通安装包、macOS/Windows updater 签名产物以及 `latest.json`。
- `latest.json` 包含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64-nsis`、`windows-x86_64-msi`，不包含宽泛 `windows-x86_64` fallback。

## 已知限制

- 未配置 Apple Developer Secrets 时，macOS 首次启动仍可能需要系统手动放行或执行 `xattr -cr`。
- Linux 应用内更新继续回退到 GitHub Releases 下载页。
- Windows 非默认目录和本地数据保留需要发布后使用真实 MSI/NSIS 安装环境完成烟测。

## 开放问题

无。用户已明确要求正式发布 v0.3.0。
