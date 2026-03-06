# START HERE

本页用于让开发者或 AI 在 10 分钟内进入可执行状态。

## 1. 先读这些文档（按顺序）
1. `docs/01-PRODUCT/PRD.md`
2. `docs/01-PRODUCT/FINALSHELL-PARITY-MATRIX.md`
3. `docs/01-PRODUCT/FEATURE-STATUS.md`
4. `docs/01-PRODUCT/FR-INDEX.md`
5. `docs/02-ARCH/ARCHITECTURE.md`
6. `docs/02-ARCH/TECH-SPEC.md`
7. `docs/02-ARCH/SYSTEM-INSIGHTS-SPEC.md`
8. `docs/02-ARCH/API-CONTRACTS.md`
9. `docs/02-ARCH/GLOSSARY.md`
10. `docs/03-UX/UI-SPEC.md`
11. `docs/03-UX/COMMAND-CENTER-SPEC.md`
12. `docs/03-UX/TOKEN-INSERT-SPEC.md`
13. `docs/04-ENGINEERING/IMPLEMENTATION-PLAN.md`
14. `docs/04-ENGINEERING/BACKLOG.md`
15. `docs/04-ENGINEERING/TASK-CARDS.md`
16. `docs/04-ENGINEERING/ACCEPTANCE-TEMPLATE.md`
17. `docs/04-ENGINEERING/TEST-PLAN.md`
18. `docs/05-RELEASE/DEPLOYMENT.md`
19. `docs/05-RELEASE/OPS-RUNBOOK.md`
20. `docs/00-AI-HANDBOOK.md`

## 2. 项目目标（一句话）
- 构建可替代 `FinalShell` 的开源跨平台 SSH/SFTP 客户端，支持高质感 UI、稳定连接、系统监控与自部署同步。

## 3. 当前功能优先级
- P0：连接管理、SSH 终端、SFTP、系统监控、基础安全。
- P1：端口转发、代理、自部署同步。
- P2：增强可观测性与高级体验细节。

## 4. AI 开发使用方式
1. 把 `docs/00-AI-HANDBOOK.md` 发给 AI。
2. 按任务再附对应模块文档（PRD/ARCH/TECH-SPEC/UI-SPEC）。
3. 使用 `docs/06-PROMPTS/ROLE-PROMPTS.md` 选择角色提示词。
4. 输出后用 `docs/06-PROMPTS/REVIEW-CHECKLIST.md` 复核。

## 5. 每次任务必须产出
- 任务目标与边界。
- 模块实现步骤。
- 文件变更清单。
- 测试与验收清单。
- 风险与回滚方案。

## 6. 里程碑验收
- M1：基础框架与连接链路可用。
- M2：终端与传输核心体验可用。
- M3：系统监控与错误处理完整。
- M4：Docker Compose 自部署 + 发布文档齐全。

## Package Manager Policy
- Use `pnpm` only.
- Do not use `npm`; use `pnpm` only.
- Recommended commands: `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm test`.
