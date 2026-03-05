# Step-by-Step Execution Prompts

本文件用于“按步骤驱动 AI 开发”，每一步都有输入、输出和完成判定。

## 全局母提示词
你是本项目实现助手。必须严格按文档执行，不得扩展范围。
必读：PRD、TECH-SPEC、UI-SPEC、TEST-PLAN、TASK-CARDS。

输出必须包含：
1) 当前步骤目标
2) 计划修改文件
3) 详细实现步骤
4) 自测与验收结果
5) 下一步建议

---

## STEP-1 需求冻结
### 输入
- `docs/01-PRODUCT/PRD.md`
- `docs/01-PRODUCT/GAP-LIST.md`
- `docs/04-ENGINEERING/TASK-CARDS.md`

### 指令模板
请提取当前任务卡（如 CARD-01）的边界、依赖、验收标准，输出“本次只做什么，不做什么”。

### 完成判定
- 明确列出范围与非范围。
- 明确列出验收标准。

---

## STEP-2 方案设计
### 输入
- `docs/02-ARCH/TECH-SPEC.md`
- 对应任务卡

### 指令模板
请输出实现方案：模块划分、数据结构、接口、异常处理、日志策略。

### 完成判定
- 方案覆盖正常/异常路径。
- 接口命名与错误码符合 TECH-SPEC。

---

## STEP-3 UI/交互设计
### 输入
- `docs/03-UX/UI-SPEC.md`
- 相关专项文档（如 `COMMAND-CENTER-SPEC`、`TOKEN-INSERT-SPEC`）

### 指令模板
请输出页面状态机（加载/空态/错误/成功）和交互细节，给出键盘与鼠标行为。

### 完成判定
- 所有状态完整。
- “仅回填不执行”等关键规则被明确。

---

## STEP-4 测试设计
### 输入
- `docs/04-ENGINEERING/TEST-PLAN.md`

### 指令模板
请生成本任务卡测试清单：单元、集成、回归、跨平台。

### 完成判定
- 覆盖正常/异常/边界。
- 包含 Ubuntu/CentOS 差异场景（若适用）。

---

## STEP-5 完成验收
### 指令模板
请按任务卡“完成定义”逐条自评，并输出证据列表（文档/测试/结论）。

### 完成判定
- 所有验收项标记为通过。
- 给出下一任务卡建议。


## Status Vocabulary (Mandatory)
- Allowed status values only: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.
- Disallowed: `Not Started`, `In Progress`, `Verified`, or any custom status word.
- If a task is marked `DONE`, it must include test evidence (test record link or test task ID).
- Status changes must be synchronized to `docs/01-PRODUCT/FEATURE-STATUS.md` and related task records.
