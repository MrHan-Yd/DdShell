# 发布 v0.2.7

## Goal

按项目发布文档准备并发布 DdShell v0.2.7。

## Confirmed Facts

- 当前最新发布 tag 是 `v0.2.6`。
- 发布流程由推送 `v*` tag 触发 GitHub Actions。
- 发布文档要求更新版本号、GitHub Release 正文、版本介绍文档，并在打 tag 前通过本地检查。
- 用户明确要求：更新内容要看提交记录，即上个版本发布之后到目前的改动情况。

## Requirements

- 版本号更新到 `0.2.7`：
  - `app/package.json`
  - `app/src-tauri/Cargo.toml`
  - `app/src-tauri/tauri.conf.json`
  - lockfile 中对应版本如有变化需同步
- v0.2.7 更新内容必须基于 `git log v0.2.6..HEAD --oneline` 和 `git diff --stat v0.2.6..HEAD` 归纳。
- 将“更新内容看提交记录，上个版本发布后到目前的改动情况”记录到发布文档中，作为后续版本说明生成规则。
- 新增 `docs/发布/v0.2.7-版本介绍.md`。
- 更新 `.github/workflows/release.yml` 中 Release body 顶部版本介绍。
- 更新 README 最新版本介绍入口。
- 本地校验通过后提交 `release: v0.2.7`。
- 创建并推送 `v0.2.7` tag 触发发布。

## Acceptance Criteria

- 版本号文件均为 `0.2.7`。
- 版本介绍内容覆盖 `v0.2.6..HEAD` 的主要用户可见变化。
- `pnpm -C app build` 通过。
- `cargo check --manifest-path app/src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path app/src-tauri/Cargo.toml` 通过。
- `git diff --check` 通过。
- release commit 和 `v0.2.7` tag 已创建。

## Out Of Scope

- 不修改 release workflow 的构建矩阵和签名策略。
- 不手动编辑 GitHub Release 页面；由 tag workflow 自动创建。

## Open Questions

- 无阻塞问题。
