# Contributing Guide

感谢你为 Shell App 做贡献。

## 1. 开发前准备
- 先阅读 `docs/README.md`。
- 从 `main` 拉取最新代码，基于 `feat/*` 或 `fix/*` 开发。

## 2. 提交规范
- 使用 Conventional Commits。
- 一个 PR 聚焦一件事。
- PR 描述必须包含：背景、方案、测试结果、风险。

## 3. 代码质量
- 前端通过 lint。
- Rust 通过 `fmt` 与 `clippy`。
- 新增功能必须补对应测试。

## 4. 文档要求
- 涉及行为变化必须更新 `docs/`。
- 新功能至少补：需求说明 + 验收标准。

## 5. AI 协作开发规范
- 开发时必须遵循 `docs/04-ENGINEERING/AI-DEVELOPMENT-SPEC.md`。
- 对关键功能必须增加 `[AI-FEATURE]` 注释块，明确功能 ID、状态、输入输出、错误与测试覆盖。
- 对已知缺陷必须增加 `[AI-ISSUE]` 注释块，明确严重级别、触发条件、影响范围与修复建议。
- 每次改动后必须同步更新功能状态，明确“已完成/未完成/阻塞/待修复”。

## Package Manager Policy
- Use `pnpm` only.
- Do not use `npm`; use `pnpm` only.
- Recommended commands: `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm test`.
