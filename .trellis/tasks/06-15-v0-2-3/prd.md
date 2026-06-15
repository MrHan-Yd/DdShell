# PRD: 发布 v0.2.3

## Goal

按仓库发布文档发布 DdShell v0.2.3，并触发 GitHub Actions 自动构建 GitHub Release 产物。

## Confirmed Facts

- 发布文档位于 `docs/发布/发布文档.md` 和 `docs/shell/05-RELEASE/RELEASE-PLAN.md`。
- 发布流程为：本地 `pnpm build` 检查，更新版本号，提交 `release: v0.2.3`，创建并推送 `v0.2.3` tag。
- 推送 `v*` tag 会触发 `.github/workflows/release.yml`，自动创建 GitHub Release 并构建 macOS、Windows、Linux 产物。
- 当前已存在 tag：`v0.2.0`、`v0.2.1`、`v0.2.2`。
- 当前版本号为 `0.2.2`，分布在：
  - `app/package.json`
  - `app/src-tauri/Cargo.toml`
  - `app/src-tauri/tauri.conf.json`
- `Cargo.lock` 中 root package 也记录了当前包版本，需要在版本 bump 后保持一致。
- 发布文档要求每次发布生成版本介绍文案，上一版示例为 `docs/发布/v0.2.2-版本介绍.md`。

## Requirements

- 将应用版本从 `0.2.2` 更新为 `0.2.3`。
- 新增 `docs/发布/v0.2.3-版本介绍.md`，基于 `v0.2.2..HEAD` 的用户可见改动总结本次版本。
- 运行本地构建检查：`cd app && pnpm build`。
- 提交发布改动，提交信息使用 `release: v0.2.3`。
- 创建 tag `v0.2.3`。
- 推送 `main` 和 `v0.2.3` tag 到 `origin`，触发 GitHub Actions 发布。

## Acceptance Criteria

- `app/package.json`、`app/src-tauri/Cargo.toml`、`app/src-tauri/tauri.conf.json` 均为 `0.2.3`。
- `app/src-tauri/Cargo.lock` root package 版本与 `0.2.3` 一致。
- `docs/发布/v0.2.3-版本介绍.md` 存在，并包含亮点、其他改进和已知限制。
- `pnpm build` 通过。
- 本地存在 `v0.2.3` tag，且该 tag 指向发布提交。
- `main` 和 `v0.2.3` 已推送到 `origin`。

## Out of Scope

- 修改 GitHub Actions release workflow。
- 本机执行完整 `pnpm tauri build` 多平台打包。
- 修改签名、公证、Secrets 配置。
