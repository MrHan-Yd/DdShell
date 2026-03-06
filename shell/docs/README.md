# Shell App Documentation Hub

本目录是项目唯一文档入口，目标是让开发者按顺序阅读后即可开始实现。

## 1. 阅读顺序（必须）
1. `docs/00-AI-HANDBOOK.md`
2. `docs/01-PRODUCT/PRD.md`
3. `docs/01-PRODUCT/FR-INDEX.md`
4. `docs/01-PRODUCT/FINALSHELL-PARITY-MATRIX.md`
5. `docs/01-PRODUCT/FEATURE-STATUS.md`
6. `docs/01-PRODUCT/GAP-LIST.md`
7. `docs/02-ARCH/ARCHITECTURE.md`
8. `docs/02-ARCH/TECH-SPEC.md`
9. `docs/02-ARCH/TECH-STACK-DECISIONS.md`
10. `docs/02-ARCH/API-CONTRACTS.md`
11. `docs/02-ARCH/GLOSSARY.md`
12. `docs/02-ARCH/SYSTEM-INSIGHTS-SPEC.md`
13. `docs/03-UX/UI-SPEC.md`
14. `docs/03-UX/COMMAND-CENTER-SPEC.md`
15. `docs/03-UX/TOKEN-INSERT-SPEC.md`
16. `docs/04-ENGINEERING/IMPLEMENTATION-PLAN.md`
17. `docs/04-ENGINEERING/BACKLOG.md`
18. `docs/04-ENGINEERING/TASK-CARDS.md`
19. `docs/04-ENGINEERING/ACCEPTANCE-TEMPLATE.md`
20. `docs/04-ENGINEERING/TEST-PLAN.md`
21. `docs/05-RELEASE/RELEASE-PLAN.md`
22. `docs/05-RELEASE/DEPLOYMENT.md`
23. `docs/05-RELEASE/OPS-RUNBOOK.md`
24. `docs/06-PROMPTS/PROMPT-KIT.md`
25. `docs/06-PROMPTS/STEP-BY-STEP-EXECUTION.md`
26. `docs/06-PROMPTS/ROLE-PROMPTS.md`
27. `docs/06-PROMPTS/REVIEW-CHECKLIST.md`

## 2. 文档结构
- `01-PRODUCT`：产品目标、范围、需求、验收。
- `01-PRODUCT/FEATURE-STATUS.md`：功能完成度看板（TODO/IN_PROGRESS/DONE/BLOCKED）。
- `02-ARCH`：系统架构、模块职责、数据流、接口契约。
- `02-ARCH/SYSTEM-INSIGHTS-SPEC.md`：系统监控指标口径、采样与图表规范。
- `03-UX`：视觉与交互规范、页面与组件标准。
- `03-UX/COMMAND-CENTER-SPEC.md`：命令中心页面细粒度规范（macOS 质感 + 历史命令回填）。
- `04-ENGINEERING`：开发计划、编码规范、测试与质量门禁。
- `04-ENGINEERING/BACKLOG.md`：任务排期、优先级与工时预估。
- `05-RELEASE`：打包签名、发布流程、版本策略。
- `06-PROMPTS`：AI 角色提示词、评审清单与执行模板。

## 3. 项目定位
- 开源、免费、跨平台（Windows/macOS/Linux）。
- 个人和小团队都可使用，但不做企业协作平台。
- 核心价值：高质感 UI + 高效率终端体验 + 稳定可控。
- 发布原则：以质量门禁通过为发布条件，不承诺固定周数。

## 4. 开发规范（AI 协作）
- 开发与评审必须遵循：`docs/04-ENGINEERING/AI-DEVELOPMENT-SPEC.md`。
- 任何功能实现、缺陷修复、技术债处理，必须同步更新功能状态与风险记录。

## 5. 术语约定
- 本项目对标对象统一写作 `FinalShell`。
- 会话指 SSH Terminal Session。
- 传输指 SFTP Transfer Task。

## Package Manager Policy
- Use `pnpm` only.
- Do not use `npm`; use `pnpm` only.
- Recommended commands: `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm test`.

## Source of Truth
- Product requirements source of truth: `docs/01-PRODUCT/PRD.md`.
- Root `PRD.md` is kept as a legacy summary and must not override docs PRD.
- `03-UX/COMPONENT-STYLE-SPEC.md`: macOS feel component texture, states, tokens, motion and accessibility gate.

## License
- This project is licensed under the Apache License 2.0.
- See `LICENSE` at the repository root for the full text.
