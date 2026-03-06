# Implementation Plan

## 1. 阶段计划
- Phase 1（Week 1-2）：项目脚手架、主题系统、数据层基础。
- Phase 2（Week 3-4）：SSH 会话链路、连接管理 CRUD。
- Phase 3（Week 5-6）：SFTP 双栏与传输队列、Snippets。
- Phase 4（Week 7-8）：稳定性、错误处理、发布打包。

## 2. 开发规范
- 前端：ESLint + Prettier，组件按 feature 划分。
- Rust：`cargo fmt` + `clippy`，按 core 模块组织。
- 提交：Conventional Commits。

## 3. 分支策略
- `main`：稳定分支。
- `dev`：集成分支。
- `feat/*`：功能分支。
- `fix/*`：修复分支。

## 4. 任务拆解模板
- 背景
- 目标
- 技术方案
- 验收标准
- 回滚方案

