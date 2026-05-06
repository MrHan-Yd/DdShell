# Predictive Echo M1 and Release v0.2.2

## Goal

将 Predictive Echo 从 M0 过渡到 M1，并按仓库既有发布流程准备并发布 `v0.2.2`，确保版本内容、发布说明和回滚预案与当前实现状态一致。

## What I already know

* 当前无 active task，本次已创建任务目录 `.trellis/tasks/05-06-predictive-echo-m1-release-v0-2-2`。
* `app/package.json` 当前版本仍为 `0.2.1`；发布文档要求同步更新 `app/package.json`、`app/src-tauri/Cargo.toml`、`app/src-tauri/tauri.conf.json` 三处版本号。
* 发布流程定义在 `docs/发布/发布文档.md`：本地先跑 `pnpm build`，然后提交 release commit、打 `vX.Y.Z` tag、push 触发 GitHub Actions。
* Predictive Echo 阶段 2 文档定义的 M1 关键变更是：默认值从 `false` 改为 `true`，保留“（实验）”角标，并保留“如遇问题请关闭”的引导。
* `docs/技术方案/predictive-echo-phase2-progress.md` 记录：切片 5-9 已完成，`pnpm test:predictive-echo` 与 `pnpm build` 通过，但切片 7/8/9 的 dogfood 仍待做。

## Assumptions (temporary)

* 本次目标是发布一个“Predictive Echo 升到 M1”的用户版本，而不是直接转正到 M2。
* 现有工作树干净，发布可以基于 `main` 直接推进。
* 用户已确认由我直接执行 release commit、打 tag、push 远程发版。

## Requirements (evolving)

* 将 Predictive Echo 调整到 M1 定义状态。
* `v0.2.2` 以当前 `main` 上所有未发布改动作为正式发布范围，包含 Predictive Echo 与最近的应用内更新。
* 对照发布文档完成 `v0.2.2` 的版本准备、验证与发布。
* 生成与本次实际发布范围一致的 release notes / 版本介绍文案。

## Acceptance Criteria (evolving)

* [ ] Predictive Echo 的默认值符合 M1 定义。
* [ ] 发布前必要检查完成并记录结果。
* [ ] 版本号、发布说明、tag 与实际发布内容一致。
* [ ] release commit、`v0.2.2` tag 与远程 push 完成，GitHub Actions release workflow 被触发。

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Technical Approach

* 将 M1 改动限制为最小必要集：只调整 Predictive Echo 默认开启状态，继续保留“（实验）”标签与异常关闭引导，不提前做 M2 文案转正。
* 按 `v0.2.1..HEAD` 实际差异整理 `v0.2.2` 发布说明，覆盖 Predictive Echo 阶段 2 与应用内更新两条主线。
* 先完成本地验证，再统一改三处版本号、补 release notes、提交 release commit、打 tag、push 远程触发 workflow。

## Decision (ADR-lite)

**Context**: 当前 `main` 已包含未发布的 Predictive Echo 阶段 2 与应用内更新功能；用户希望直接发出 `v0.2.2`，同时让 Predictive Echo 进入可公开验证的 M1。

**Decision**: 本次采用“全量未发布改动一并发版”的口径推进 `v0.2.2`，并将 Predictive Echo 升到 M1（默认开启、仍标实验），由我直接完成 commit / tag / push。

**Consequences**: release notes 需要覆盖两条功能线；如果 Predictive Echo 在真实使用中暴露 critical bug，后续按 M1 回滚预案将默认值改回 `false`。

## Out of Scope (explicit)

* Predictive Echo 直接转正到 M2
* 重写整套转正标准
* 重做 GitHub Release workflow 本身

## Technical Notes

* 发布文档：`docs/发布/发布文档.md`
* M1/M2 定义：`docs/技术方案/predictive-echo-phase2-plan.md`
* 当前进度：`docs/技术方案/predictive-echo-phase2-progress.md`
* 发布范围基线：`git log --oneline v0.2.1..HEAD` 与 `git diff --stat v0.2.1..HEAD`
