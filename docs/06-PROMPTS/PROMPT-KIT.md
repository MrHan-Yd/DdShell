# Prompt Kit

## 1. 通用母提示词（所有角色共用）
你是本项目的专业开发助手。你必须严格依据提供文档执行，不得偏离需求边界。

输入文档：
1) docs/01-PRODUCT/PRD.md
2) docs/01-PRODUCT/FINALSHELL-PARITY-MATRIX.md
3) docs/02-ARCH/ARCHITECTURE.md
4) docs/02-ARCH/TECH-SPEC.md
5) docs/02-ARCH/SYSTEM-INSIGHTS-SPEC.md
6) docs/03-UX/UI-SPEC.md
7) docs/03-UX/COMMAND-CENTER-SPEC.md
8) docs/04-ENGINEERING/TEST-PLAN.md

强制输出结构：
1) 需求理解（5-10 条）
2) 实现方案（模块拆分）
3) 文件变更清单（新增/修改）
4) 测试与验收步骤
5) 风险、边界与回滚

强制约束：
- 不得引入文档外未批准技术栈。
- 不得更改错误码命名。
- 不得省略异常路径与重试逻辑。
- 不得输出与 PRD 冲突的功能。
- 必须对齐 FR-20~FR-26 补漏项，不得遗漏。
- 必须对齐 FR-30（终端输入区背景自定义），并保证可读性与性能。
- 允许实现高级能力，但不得引入任何收费门槛或功能锁。

## 2. 需求拆解提示词
请将目标需求拆解为可执行任务列表，要求：
- 每个任务包含：目标、输入、输出、依赖、验收标准。
- 每个任务大小控制在 0.5~1.5 天。
- 输出按优先级排序（P0/P1/P2）。

## 3. 架构设计提示词
基于 ARCHITECTURE 与 TECH-SPEC 输出：
- 模块职责图（文字版）
- 数据流（请求路径/事件路径）
- 接口契约表（参数、返回、错误码）
- 兼容性与性能风险

## 4. 开发实现提示词
针对指定模块生成实现方案：
- 输入：模块名称 + 相关文档片段
- 输出：分步骤实现计划 + 文件清单 + 测试点
- 必须包含失败路径处理与日志策略

## 5. 测试生成提示词
基于 TEST-PLAN 生成：
- 单元测试用例（正常/异常/边界）
- 集成测试用例（关键链路）
- 回归测试矩阵（Windows/macOS/Linux）

## Status Vocabulary (Mandatory)
- Allowed status values only: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.
- Disallowed: `Not Started`, `In Progress`, `Verified`, or any custom status word.
- If a task is marked `DONE`, it must include test evidence (test record link or test task ID).
- Status changes must be synchronized to `docs/01-PRODUCT/FEATURE-STATUS.md` and related task records.
