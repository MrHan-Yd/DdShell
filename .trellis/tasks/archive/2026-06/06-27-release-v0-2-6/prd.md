# 发布 v0.2.6

## Goal

发布 DdShell `v0.2.6` 补丁版本，按发布文档完成版本号、发布文案、提交、tag 和推送。

## User Value

用户可以通过正式 Release 获取 macOS 更新安装包打开可靠性修复，并让应用内 updater 检查到新的版本。

## Confirmed Facts

- 主发布文档为 `docs/发布/发布文档.md`。
- 发布流程要求：
  - 本地执行 `cd app && pnpm build`。
  - 同步更新 `app/package.json`、`app/src-tauri/Cargo.toml`、`app/src-tauri/tauri.conf.json`。
  - 更新 `.github/workflows/release.yml` 的 GitHub Release 正文版本介绍。
  - 提交 `release: v0.2.6`，创建并推送 `v0.2.6` tag。
- `v0.2.5..HEAD` 的主要用户可见改动是：
  - 修复 macOS 下载更新后打开安装包不可靠的问题。
  - 下载更新完成前会 flush、关闭并校验文件，避免 UI 过早报告完成。
  - Windows updater 发布资产和 manifest 已检查，未发现同类问题。
  - README 已补充项目说明。

## Requirements

- 将应用版本号从 `0.2.5` 更新到 `0.2.6`。
- 新增 `docs/发布/v0.2.6-版本介绍.md`。
- 更新 README 最新版本介绍链接到 v0.2.6。
- 更新 GitHub Actions release body，使 v0.2.6 Release 页面展示本次补丁说明。
- 按发布文档执行本地构建检查。
- 提交发布改动、创建 `v0.2.6` tag，并推送到远端触发 GitHub Actions。

## Acceptance Criteria

- 三处版本号均为 `0.2.6`。
- 发布文案不再使用 v0.2.5 的正文。
- `pnpm build` 通过。
- `cargo check` 通过，用于补充验证 Rust/Tauri 版本配置。
- Git 提交 `release: v0.2.6` 存在。
- 本地 tag `v0.2.6` 存在并已推送到远端。
- GitHub Actions 发布流程被 tag 推送触发。

## Out Of Scope

- 不改业务功能。
- 不重发 v0.2.5。
- 不修改 updater 签名密钥或 release workflow 的产物结构。

## Open Questions

- 无阻塞问题；用户已指定发布 `v0.2.6`。

## Validation Results

- `cd app/src-tauri && cargo check` passed with `DdShell v0.2.6`.
- `cd app && pnpm build` passed with `app@0.2.6`.
- `git diff --check` passed.
- Remote `v0.2.6` tag lookup attempted, but GitHub network access timed out in the current environment.
- Local release commit created: `02fc25d release: v0.2.6`.
- Local tag created: `v0.2.6` points at `02fc25d`.
- `git push origin main --tags` was attempted twice, but GitHub HTTPS connection failed (`Error in the HTTP2 framing layer`, then timeout to `github.com:443`).
- Retried after network recovered:
  - `git push origin v0.2.6` succeeded.
  - GitHub Actions run `28291419068` completed successfully.
  - Release URL: `https://github.com/MrHan-Yd/DdShell/releases/tag/v0.2.6`.
  - Uploaded assets include macOS DMGs, macOS updater `.app.tar.gz` + `.sig`, Windows `.msi`, Windows NSIS `.exe` + `.exe.sig`, Linux `.deb`, Linux `.AppImage`, and `latest.json`.
  - `latest.json` contains `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64-nsis`, and `windows-x86_64`, each with URL and signature.
