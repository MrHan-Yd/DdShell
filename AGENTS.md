<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 追溯看板支持（Agent Client Protocol + 决策笔记 + 历史回查）

Agent 在本项目的一切任务中，必须遵循以下约定，使执行过程可被追溯宿主拦截、留痕、回查并在「追溯看板」中回看：

### 1. Agent Client Protocol (ACP) 交互与控制

- **上下文与能力**：Agent 须通过 initialize 握手识别客户端能力，优先依赖 ACP 动态推送的 Workspace Diff 和环境状态，不向开发者索要已有上下文。
- **修改与工具调用**：修改代码优先输出结构化 Patch/Diff，执行终端命令或文件覆盖等副作用操作须过 ACP 权限中间件校验。
- **异常处理**：发生错误必须按 JSON-RPC 2.0 返回标准 Error Code，禁止静默挂起。

### 2. 宿主存在性（先判链路，再谈留痕）

会话开始时（至少在首次写码或拍板前）分两层判：

- **项目层**：确认本项目是否部署追溯宿主（`.agents/runner/host.mjs`，文件/终端的能力声明来自它）。未部署时提醒使用者"副作用不会被拦截、看板不会有事件"，禁止假装存在合规保证。
- **会话层**：项目部署了宿主 ≠ 当前会话在宿主链路上——直开的客户端会话不经宿主，协议事件流不存在。机械判据：`node -e "process.stdout.write(process.env.SPARK_TRACE_SESSION ?? '')"` 非空 = 本会话正跑在宿主链路上（宿主拉起 agent 时注入 `SPARK_TRACE_SESSION` 与 `SPARK_TRACE_DIR`）；为空 = 无宿主链路。
- **诚实义务**：无宿主链路的会话里，最终回复须如实声明「本轮未过宿主，无协议留痕」；禁止假装本轮已被追溯。
- **上链路提示**：检测到无宿主链路时，可向使用者提两条升级路径——客户端支持自定义 agent 启动命令的，配成宿主代理 `node <runner>/host.mjs --proxy --agent "<真 agent CLI>" --cwd <项目根>`（协议级全量留痕）；不支持的，配 PreToolUse hook 桥（`.agents/runner/hook-recorder.mjs`，匹配器 `Write, Edit, Bash`，命令 `node`，参数两行：脚本绝对路径、项目根），获得操作级自报留痕。

### 3. 反向锚点（写码即留痕，条件式）

- 修改代码时，凡注释里解释「为什么这么写」的决策点（反直觉实现、被否决方案、实测结论），必须**在写码的同一会话里**就近补挂锚点，不留到事后考古。**先按第 2 节会话层判链路**，再选写法：
  - **有宿主链路**（`SPARK_TRACE_SESSION` 非空）：`@trace s_<会话>#<事件序号> 实测：…` —— 追溯坐标，指向 `.agents/trace` 里对应会话的对应事件；事件序号必须是写锚点那一刻**已落盘**的事件（先跑命令/读文件拿证据，下一次写盘时把锚挂上去；项目带 `.agents/skills/trace-anchor/scripts/resolve-coordinates.mjs` 时用它取坐标）；
  - **无宿主链路**（`SPARK_TRACE_SESSION` 为空）：**禁止写 `@trace`**——校验器对指向不存在会话的锚点只静默 SKIPPED，硬写就是假锚点；降级为决策笔记（第 4 节）+ `@see`；
  - `@see [文档 §x.y](相对路径)` —— 文档锚点，决策已沉淀进文档小节或决策笔记时用，两种链路都可写。
- 项目部署了追溯宿主：提交前跑 `.agents/runner/check-trace-anchors.mjs`，失效即修；宿主链路里对「新增解释性注释但未挂锚」按 WARN 提示（`TRACE_WHY_ANCHORED`，不拦盘，但要处理）。

### 4. 决策笔记 (Agent Notes)

反向锚点管「代码内为什么这么写」；本节管**跨会话可检索的决策知识**——拍板、妥协、裁剪要落成结构化笔记（`.agents/notes/`），追溯宿主会解析进索引、看板直接展示；**无宿主链路的会话里，笔记是主留痕通道**。谱系：write-notes-like-deepseek（DeepSeek Harness 的 Agent Notes 实践）。

**什么时候写**（命中任一即"非平凡"；判不准时从严）：

- **必写**：改动涉及行为/架构/跨文件契约/流程工具链/测试策略/落盘·网络·配置格式；推翻或取代旧决定；写复盘。
- 三向自查：**立新规**（新契约/边界/运行时不变量）、**记妥协**（为看不见的约束放弃了主流或直觉解法）、**做减法**（破坏性重构/裁剪/API 收窄）。
- **禁写**（直接改代码）：纯格式化、错别字、无歧义重命名、不改行为的样式/依赖补丁、单模块内看 diff 即懂的修复。
- 对话信号：拍板（"就选 X"）、比较中（"X 和 Y 怎么选"）、同一段理由被解释第二遍。

**路径即状态，路径即分类**：

    .agents/notes/{proposed|implemented|rejected|archived}/{feature|bug-fix|simplification|architecture|process|testing}/yyyy-mm-dd-主题.md

- 状态四个 lifecycle：`proposed` 方案稿 / `implemented` 已落地（与代码同批提交） / `rejected` 审慎否掉（防重犯才留） / `archived` 封存只读。
- 分类六个枚举**不许自造**；转状态 = git mv 挪目录，不改文件名。
- **文件名即锚点 id**（`yyyy-mm-dd-主题`），别的笔记用相对链接指它，代码用 `@see` 指文件。
- **笔记落盘后顺手重建看板索引**：`node .agents/runner/trace-index.mjs`——看板读的是 index.json，不重建就看不到新笔记（宿主链路会话的收尾会自动重建，这条主要管直开的客户端会话）。

**笔记骨架**（部署追溯宿主时，合规规则 `AGENT_NOTE_FORMAT` 会机械校验）：

    # Agent Note: <一句话标题>
    Status: implemented
    Class: architecture

    ## 背景
    ## 决策           ← 现在时,写"是什么",不写"我们考虑过"
    ## 放弃方案        ← 先写它最强的理由,再写为什么仍然不用
    ## 代价与后果      ← 收益和代价都要写

- `Status:`/`Class:` 行必须与所在目录一致；proposed 稿与 implemented 篇互链，施工完同批转正。
- 笔记互链死链不过夜；可在正文写 `Trace: s_<会话>#<序号>` 关联当次追溯事件（仅宿主链路会话可写）。

### 5. 追溯回查（recall，动手前先问历史）

追溯库是 agent 的**经验记忆**，不只是给人看的监督面。部署追溯宿主（`.agents/runner/`，含 `recall.mjs`）的项目里，`.agents/runner/recall.mjs` 是给 agent 自己的查询面：纯读盘、零依赖、**永远 exit 0**——查询失败不阻断任务，输出里如实说明空结果。未部署 runner 的项目本节跳过。

    node .agents/runner/recall.mjs --path <项目相对路径>   # 该文件的写盘/被拦/合规历史 + 相关笔记
    node .agents/runner/recall.mjs --rule <rule_id>       # 该检查器的通过/未通过台账
    node .agents/runner/recall.mjs --denied               # 全库被拦/被拒清单（按目标聚合）

**什么时候查**（命中任一就先查再动手）：

- **改文件前**：这个文件有过合规未过/被拦记录的，先 `--path` 回查——同一坑不踩第二遍；
- **被审批拒绝或被拦后**：立即 `--path <刚才的路径>`，看历史上同类操作怎么被处理的，调整方案再试；
- **写合规相关代码（锚点/笔记格式/发布物）前**：`--rule` 看这条规则的失败台账，了解机器怎么判。

**结果怎么用**：

- 命中「审批被拒/执行被拦」→ 该目标有过敏感历史，这次动手要更收敛（拆小步、先说明意图）；
- 命中「合规未过」→ 先读失败 message 与相关笔记，按规则要求改，**不要绕过检查器**；
- 空结果 → 正常开工，不阻塞；recall 只回答历史，不替 agent 做决定。

（与本项目原有硬性约定冲突时，以项目约定为准。）
