# Workflow Recipe / Command Macros Design

> **版本标注（2026-04-14）**：本文档包含 MVP 和 future 内容。
> 标有 `[MVP]` 的章节为首版必须实现；标有 `[future]` 的为后续增量。
> 未标注的章节，以正文中明确列出的 "必须支持" 和 "明确不做" 划分为准（见 §6）。
> 三个已收敛的决策见 `WORKFLOW-RECIPE-DECISION-SUMMARY.md` §9：
> 1. Recipe 不绑定主机，`hostId` 在 Run 启动时选择。
> 2. 状态字段统一使用 `state`（非 `status`），MVP 枚举为 Run `running|completed|failed`、Step `pending|running|completed|failed`。
> 3. 模板语法 MVP 仅支持 `{{var}}` / `{{ var }}`，默认值通过参数定义字段指定，不支持 `{{var:default}}`。

## 1. 目标
- 为 Shell App 增加“命令宏 / 流程编排”能力，用于在单个目标主机上执行可参数化、可追踪、可取消的多步命令流程。
- 该能力定位为 `Workflow / Recipe`，不是现有 `Snippets` 的直接扩展；`Snippets` 继续承担“仅回填，不执行”的命令素材职责。
- UI / 产品名称统一使用“命令宏”；内部技术命名继续保留 `Workflow / Recipe`。
- 第一阶段目标是提供稳定、可控、可复盘的执行链路，并为后续统一任务中心（FR-43）预留任务模型。

## 1.1 当前实现快照（2026-04-11）
- 已落地：Recipe CRUD、参数定义、顺序步骤执行、运行时参数输入、最近运行历史持久化、历史详情回看。
- 当前执行模型：单主机、顺序执行、独立 SSH exec 通道、失败即停止。
- 当前状态字段：Run 使用 `running | completed | failed`；Step 使用 `pending | running | completed | failed`。
- 当前持久化模型：`workflow_recipes` 中使用 `params_json` / `steps_json`；`workflow_runs` 中使用 `params_json` / `steps_json`。
- 当前未落地：取消、重试、超时控制、独立 `workflow_run_steps` 子表。

## 2. 背景与约束
- 现有 `Snippets / Command Center` 已明确遵循“仅回填不执行”原则，见：
  - `docs/03-UX/COMMAND-CENTER-SPEC.md`
  - `命令助手介绍.md`
- 现有后端已具备以下可复用基础：
  - SSH 会话管理：`app/src-tauri/src/core/ssh.rs`
  - 传输任务与任务状态：`app/src-tauri/src/core/sftp.rs`
  - 事件总线：`app/src-tauri/src/core/event.rs`
  - SQLite 数据层：`app/src-tauri/src/core/store.rs`
- `未来功能规划.md` 已将“任务化工作流（Recipe，多步命令编排）”列为候选方向。
- `TASK-CARDS.md` 中的 FR-43 Unified Task Center 要求不同任务类型共享一致生命周期，因此 Workflow 应从设计上兼容统一任务模型。

### 2.1 FR 对齐建议
- `FR-43` 当前定义为 `Unified Task Center`，其重点是“统一任务展示与生命周期”。
- `Workflow Recipe` 更像是一个独立的新能力：既包含任务模板，也包含执行引擎与新的任务类型。
- 因此从需求建模上，更建议将 Workflow 定义为独立 FR，而不是直接并入 `FR-43`。
- 推荐做法：新增 `FR-44 Workflow Recipe`，并在 `FR-43` 中将 Workflow Run 作为后续统一任务中心要纳入的一类任务。
- 本设计按独立 FR 落地：Workflow 作为 `FR-44`，而 `FR-43` 继续承担统一任务中心的聚合职责。

## 3. 术语定义
- `Snippet`：单条命令片段，只回填，不执行。
- `Recipe`：一个可复用流程模板，包含参数定义与有序步骤列表。
- `Step`：Recipe 中的一个执行单元。MVP 仅支持 `command` 步骤。
- `Run`：某次 Recipe 的实际执行记录。
- `Run Step`：Run 中某个步骤的具体执行结果与日志。

## 4. 为什么不直接扩展 Snippets
- 语义冲突：现有 Snippet 在产品与 UX 上都强调“仅回填不执行”，直接变为可执行会破坏用户心智。
- 状态复杂度不同：Snippet 更像静态素材；Workflow 需要状态机、日志、取消、重试、失败处理。
- 风险等级不同：Workflow 属于显式执行功能，必须有更重的确认、日志与安全约束。
- 后续演进不同：Workflow 更适合接入统一任务中心，Snippets 更适合继续做参数化回填、排序、检索与复用。

## 5. 设计原则
- 正确性优先于“看起来方便”：优先选择可精确获取退出码、输出、失败原因的执行方式。
- 与现有架构一致：复用 Tauri command + event、SQLite、Zustand，不引入新技术栈。
- 先做最小闭环：先支持单主机、顺序执行、非交互命令，避免第一版进入高复杂度状态机。
- 显式优于隐式：命令上下文、变量、失败策略、超时都要明确，不依赖“当前终端里大概是这个状态”。
- 为 FR-43 预留：Workflow Run 生命周期应能自然映射到未来统一任务中心。

## 6. MVP 边界

### 6.1 必须支持
- 单主机执行。
- 顺序步骤执行。
- 步骤参数化（`{{var}}` / `{{ var }}`）。
- 每步独立状态：`pending | running | completed | failed`。
- Recipe 运行状态：`running | completed | failed`。
- 失败即停止（默认策略）。
- 运行日志查看。
- 运行历史持久化。

### 6.2 明确不做
- DAG / 可视化拖拽编排。
- 并行分支与条件分支。
- 多主机批量扇出执行。
- 交互式命令步骤（如 `passwd`、需要 TTY 输入的 `sudo` 交互）。
- 与当前终端 PTY 共享隐式上下文。
- 第一版混入 SFTP 上传下载、更新、重连等多类型步骤。
- 定时调度、cron 触发、webhook 触发、应用启动自动执行。
- 取消、重试、超时控制。

## 7. 交互定位
- 当前产品入口为独立一级导航“命令宏”，不再挂在 `Snippets` 下做二级切换。
- 运行入口建议同时支持：
  - 连接页 / 主机右键菜单：对目标主机运行 Recipe。
  - 终端页工具栏：对当前激活主机运行 Recipe。
- 结果展示第一阶段可用独立 Run List / Log Drawer，第二阶段再接入统一任务中心。

## 8. 执行方式选择

### 8.1 推荐方案：独立 SSH exec 通道执行
- Workflow 不通过 `session_write` 往当前终端注入命令。
- Workflow 运行时在 Rust 后端通过独立 SSH exec 通道逐步执行命令。
- 每个 Step 独立采集：
  - resolved command
  - stdout / stderr
  - exit code
  - duration
  - timeout / cancel / error

### 8.2 不推荐方案：复用当前 PTY 会话注入命令
- 无法可靠判断步骤边界。
- 难以稳定获取退出码。
- 用户手工输入会干扰自动流程状态。
- 难以取消与复盘。
- 会把“人工终端”和“自动任务”状态耦合在一起。

### 8.3 推荐方案的代价
- 每个 Step 默认不共享 shell 隐式上下文。
- 例如第一步 `cd /srv/app`，第二步 `pwd` 不应假设仍在 `/srv/app`。
- 因此 Step 应支持显式 `cwd_template`，或者将上下文写入命令本身，如 `cd /srv/app && git pull`。

### 8.4 凭据与会话来源优先级
- 当前实现不复用现有终端会话，也不向 PTY 注入命令。
- Run 启动时必须显式指定 `hostId`，通过已保存密码建立临时 SSH exec 会话。
- 若主机不存在或没有已保存密码，则阻断启动，返回 `WORKFLOW_HOST_NOT_FOUND` 或认证错误。
- Recipe 本身不绑定 `target_host_id`；主机选择完全由 Run 时参数决定。
- Workflow 执行必须沿用现有指纹校验与 known_hosts 安全策略，不能绕过现有安全链路。

### 8.5 远端 shell 执行语义
- 第一版应明确以“稳定可复现”为目标，而不是完全模拟用户手工打开终端后的交互环境。
- 建议默认按“非交互、非 login shell”执行。
- 建议通过显式 shell 包装命令，例如：
  - `/bin/sh -lc '<wrapped command>'`
  - 或目标主机可用默认 shell 的 `-lc` 形式
- `cwd_template` 不通过会话状态保存，而是通过包装命令实现，例如：
  - `cd <cwd> && <command>`
- Step 的 `exitCode` 以 shell 最终退出码为准。
- 不保证以下能力与人工终端完全一致：
  - alias
  - interactive shell profile
  - 手工加载的 nvm / conda / pyenv 环境
- 文档和 UI 提示都应明确这一点，避免用户把 Workflow 理解成“录制终端操作回放”。

## 9. 数据模型

### 9.1 Recipe
建议新增表：`workflow_recipes`

字段建议：
- `id`
- `title`
- `description`
- `group_id`（可选，用于分组；Recipe 不绑定主机）
- `params_json`
- `steps_json`
- `created_at`
- `updated_at`

> **决策收敛**：Recipe 作为可复用模板，不绑定特定主机。`target_host_id` 字段已从 Recipe 中移除。主机选择在 Run 启动时通过 `host_id` 参数指定。

### 9.2 Recipe Params / Steps
- 当前实现未拆分 `workflow_recipe_params` / `workflow_recipe_steps` 子表。
- 参数定义与步骤定义直接存于 `workflow_recipes.params_json` / `workflow_recipes.steps_json`。
- 参数结构（当前实现）：`key`、`label`、`default_value`、`required`。
- 步骤结构（当前实现）：`id`、`title`、`command`。

### 9.4 Workflow Runs
建议新增表：`workflow_runs`

字段建议：
- `id`
- `recipe_id`
- `recipe_title`
- `host_id`
- `state`
- `params_json`
- `steps_json`
- `error`
- `started_at`
- `finished_at`

### 9.5 Workflow Run Steps
- 当前实现未拆分 `workflow_run_steps` 子表。
- 每次运行的步骤结果作为 JSON 快照存于 `workflow_runs.steps_json`。

## 10. 模板与参数

### 10.1 语法
- 统一采用已有规划里的占位符风格：
  - `{{var}}`
  - `{{ var }}`
- 后续 Snippet 参数化也应复用同一解析器，避免形成多套模板语法。

### 10.2 变量解析规则 [已收敛]
- 运行前先合并用户输入参数与默认值。
- 缺失必填参数时，禁止启动 Run。
- 默认值从参数定义的 `defaultValue` 字段合并，不通过 `{{var:default}}` 内联语法解析。
- MVP 仅支持 `{{var}}` / `{{ var }}` 占位符；不支持 `{{var:default}}`、条件模板、循环模板、嵌套模板。
- 当前参数解析结果仅作用于命令模板。

### 10.3 示例
```json
{
  "title": "部署 nginx",
  "params": [
    { "key": "release_dir", "label": "发布目录", "type": "text", "required": true },
    { "key": "service", "label": "服务名", "type": "text", "required": true, "defaultValue": "nginx" }
  ],
  "steps": [
    {
      "title": "拉取代码",
      "stepType": "command",
      "cwdTemplate": "{{release_dir}}",
      "commandTemplate": "git pull",
      "timeoutSecs": 60
    },
    {
      "title": "重启服务",
      "stepType": "command",
      "commandTemplate": "sudo systemctl restart {{service}}",
      "timeoutSecs": 30
    }
  ]
}
```

## 11. 执行状态机

### 11.1 Run 状态
- `running`
- `completed`
- `failed`

### 11.2 Step 状态
- `pending`
- `running`
- `completed`
- `failed`

### 11.3 默认流转规则
1. Run 创建后立即进入 `running`。
2. Step 按顺序从 `pending -> running -> completed/failed`。
3. 任一步骤失败时：
   - 当前 Step 标为 `failed`
   - 后续 Step 保持 `pending`
   - Run 标为 `failed`
4. 所有 Step 成功后，Run 标为 `completed`。

## 12. Rust 后端设计

### 12.1 模块建议
- 新增 `app/src-tauri/src/core/workflow.rs`
- 职责：
  - Recipe/Run 领域模型
  - 模板解析
  - 执行调度
  - 运行状态持久化

### 12.2 对 `ssh.rs` 的补充需求
当前 `exec_command()` 只返回合并后的字符串输出，不足以支撑 Workflow。

建议新增能力：
- 返回 `stdout`、`stderr`、`exit_code`
- 当前已实现最小能力集；`timeout` / 运行中取消 / 流式输出仍属后续增强项。

可抽象为：
```text
execute_exec_step(session_or_host, command, cwd, timeout) -> ExecResult
```

其中 `ExecResult` 至少包含：
- `stdout`
- `stderr`
- `exit_code`
- `duration_ms`
- `timed_out`

### 12.3 Tauri Commands 建议
- `workflow_recipe_create`
- `workflow_recipe_update`
- `workflow_recipe_delete`
- `workflow_recipe_list`
- `workflow_recipe_get`
- `workflow_run_start`
- `workflow_run_list`
- `workflow_run_get`

### 12.4 Event 建议
在 `app/src-tauri/src/core/event.rs` 中增加：
- `workflow:run_updated`

建议事件载荷：
- `run_updated`：完整 `run` 快照，用于前端覆盖当前运行状态与步骤输出。

## 13. API Contract Draft

以下小节为正式契约草稿。已收敛决策：
- Command 名称使用 dot notation（与 `TECH-SPEC.md` 和 `API-CONTRACTS.md` 一致）。
- JSON 字段使用 camelCase。
- Recipe 显示名使用 `title`（不使用 `name`）。
- Run / Step 状态字段使用 `state`（不使用 `status`），枚举见 §11。
- Recipe 不绑定 `targetHostId`；主机在 Run 启动时通过 `hostId` 指定。

标有 `[MVP]` 的为首版必须实现；标有 `[future]` 的为后续增量。

### 13.1 命名与字段约定
- JSON 字段使用 camelCase。
- 所有 ID 使用字符串 UUID。
- 可选字段显式传 `null`，不依赖缺省字段表达业务语义。
- 状态字段统一使用 `state`，枚举见 §11。

### 13.2 `workflow.recipe.create` [MVP]
Request:
```json
{
  "title": "部署 nginx",
  "description": "拉代码并重启服务",
  "groupId": null,
  "params": [
    {
      "key": "release_dir",
      "label": "发布目录",
      "type": "text",
      "required": true,
      "defaultValue": null,
      "sortOrder": 0
    }
  ],
  "steps": [
    {
      "title": "拉取代码",
      "stepType": "command",
      "commandTemplate": "git pull",
      "cwdTemplate": "{{release_dir}}",
      "timeoutSecs": 60,
      "continueOnError": false,
      "sortOrder": 0
    }
  ]
}
```
Response:
```json
{
  "id": "workflow-recipe-uuid"
}
```

### 13.3 `workflow.recipe.update` [MVP]
Request:
```json
{
  "id": "workflow-recipe-uuid",
  "title": "部署 nginx",
  "description": "更新代码并重启服务",
  "groupId": null,
  "params": [],
  "steps": []
}
```
Response:
```json
{
  "success": true
}
```

### 13.4 `workflow.recipe.list` [MVP]
Response:
```json
[
  {
    "id": "workflow-recipe-uuid",
    "title": "部署 nginx",
    "description": "拉代码并重启服务",
    "groupId": null,
    "stepCount": 2,
    "updatedAt": "2026-04-11T10:00:00Z"
  }
]
```

### 13.5 `workflow.recipe.get` [MVP]
Response:
```json
{
  "id": "workflow-recipe-uuid",
  "title": "部署 nginx",
  "description": "拉代码并重启服务",
  "groupId": null,
  "params": [
    {
      "id": "param-uuid",
      "key": "release_dir",
      "label": "发布目录",
      "type": "text",
      "required": true,
      "defaultValue": null,
      "sortOrder": 0
    }
  ],
  "steps": [
    {
      "id": "step-uuid",
      "title": "拉取代码",
      "stepType": "command",
      "commandTemplate": "git pull",
      "cwdTemplate": "{{release_dir}}",
      "timeoutSecs": 60,
      "continueOnError": false,
      "sortOrder": 0
    }
  ],
  "createdAt": "2026-04-11T10:00:00Z",
  "updatedAt": "2026-04-11T10:00:00Z"
}
```

### 13.6 `workflow.run.start` [MVP]
Request:
```json
{
  "recipeId": "workflow-recipe-uuid",
  "hostId": "host-uuid",
  "params": {
    "release_dir": "/srv/app",
    "service": "nginx"
  }
}
```
Response:
```json
{
  "id": "workflow-run-uuid"
}
```

说明：`hostId` 为必填字段，在 Run 启动时指定目标主机。

### 13.7 `workflow.recipe.delete` [MVP]
Request:
```json
{
  "id": "workflow-recipe-uuid"
}
```
Response:
```json
{
  "success": true
}
```

### 13.8 `workflow.run.list` [MVP]
Request:
```json
{
  "recipeId": "workflow-recipe-uuid",
  "limit": 10
}
```
Response:
```json
[
  {
    "id": "workflow-run-uuid",
    "recipeId": "workflow-recipe-uuid",
    "recipeTitle": "部署 nginx",
    "hostId": "host-uuid",
    "state": "failed",
    "startedAt": "2026-04-11T10:00:00Z",
    "finishedAt": "2026-04-11T10:01:00Z",
    "error": "Step '重启服务' failed"
  }
]
```

### 13.9 `workflow.run.get` [MVP]
Request:
```json
{
  "runId": "workflow-run-uuid"
}
```
Response:
```json
{
  "id": "workflow-run-uuid",
  "recipeId": "workflow-recipe-uuid",
  "recipeTitle": "部署 nginx",
  "hostId": "host-uuid",
  "state": "completed",
  "params": {
    "release_dir": "/srv/app",
    "service": "nginx"
  },
  "startedAt": "2026-04-11T10:00:00Z",
  "finishedAt": "2026-04-11T10:00:04Z",
  "steps": [
    {
      "stepId": "step-1",
      "title": "拉取代码",
      "commandTemplate": "cd {{release_dir}} && git pull",
      "resolvedCommand": "cd /srv/app && git pull",
      "state": "completed",
      "stdoutTail": "Already up to date.\n",
      "stderrTail": "",
      "exitCode": 0,
      "durationMs": 820,
      "startedAt": "2026-04-11T10:00:00Z",
      "finishedAt": "2026-04-11T10:00:01Z"
    }
  ],
  "error": null
}
```

### 13.10 `workflow.run.cancel` [future]
> MVP 不实现取消功能，此接口在取消功能落地后启用。

Request:
```json
{
  "runId": "workflow-run-uuid"
}
```
Response:
```json
{
  "success": true
}
```

### 13.11 `workflow.run.retry` [future]
> MVP 不实现重试功能，此接口在重试功能落地后启用。

Request:
```json
{
  "runId": "workflow-run-uuid"
}
```
Response:
```json
{
  "id": "workflow-run-new-uuid"
}
```

### 13.12 `workflow.run.steps` [MVP]
Request:
```json
{
  "runId": "workflow-run-uuid"
}
```
Response:
```json
[
  {
    "id": "run-step-1",
    "recipeStepId": "step-uuid",
    "title": "拉取代码",
    "state": "completed",
    "resolvedCommand": "git pull",
    "resolvedCwd": "/srv/app",
    "exitCode": 0,
    "stdoutTail": "Already up to date.\n",
    "stderrTail": "",
    "durationMs": 820,
    "startedAt": "2026-04-11T10:00:00Z",
    "finishedAt": "2026-04-11T10:00:01Z"
  }
]
```

## 14. Error Model

以下错误码清单包含 MVP 和 future 两类。标有 `[MVP]` 的为首版必须实现，标有 `[future]` 的在后续增量启用。

### 14.1 错误码建议

**[MVP] 首版必须实现：**
- `WORKFLOW_RECIPE_NOT_FOUND`
- `WORKFLOW_RECIPE_INVALID`
- `WORKFLOW_RUN_NOT_FOUND`
- `WORKFLOW_HOST_NOT_FOUND`
- `WORKFLOW_PARAM_MISSING`
- `WORKFLOW_TEMPLATE_RENDER_FAILED`
- `WORKFLOW_EXEC_FAILED`
- `WORKFLOW_UNSUPPORTED_INTERACTIVE_COMMAND`

**[future] 后续增量启用：**
- `WORKFLOW_RUN_ALREADY_FINISHED`（取消功能落地后启用）
- `WORKFLOW_STEP_TIMEOUT`（超时控制落地后启用）
- `WORKFLOW_STEP_CANCELED`（取消功能落地后启用）
- `WORKFLOW_CONCURRENCY_LIMIT_REACHED`（并发队列落地后启用）

### 14.2 触发条件与处理建议

#### `WORKFLOW_RECIPE_NOT_FOUND`
- 触发条件：Recipe 已被删除或 ID 非法。
- 用户提示：流程不存在或已被删除。
- 恢复动作：刷新列表并重新选择流程。

#### `WORKFLOW_RECIPE_INVALID`
- 触发条件：空步骤、重复参数 key、非法超时值等静态校验失败。
- 用户提示：流程配置无效，请检查步骤或参数定义。
- 恢复动作：阻止保存并定位到对应字段。

#### `WORKFLOW_RUN_NOT_FOUND`
- 触发条件：查询、取消、重试时目标 Run 不存在。
- 用户提示：运行记录不存在。
- 恢复动作：刷新运行历史。

#### `WORKFLOW_RUN_ALREADY_FINISHED`
- 触发条件：对已完成 Run 再次执行取消等操作。
- 用户提示：当前运行已结束，无法继续该操作。
- 恢复动作：允许查看日志或执行重试。

#### `WORKFLOW_HOST_NOT_FOUND`
- 触发条件：目标主机被删除或不可解析。
- 用户提示：目标主机不存在。
- 恢复动作：重新选择主机。

#### `WORKFLOW_PARAM_MISSING`
- 触发条件：运行时缺失必填参数。
- 用户提示：缺少必填参数，无法启动流程。
- 恢复动作：回到参数表单补全。

#### `WORKFLOW_TEMPLATE_RENDER_FAILED`
- 触发条件：模板引用了不存在变量，或模板语法非法。
- 用户提示：流程参数渲染失败，请检查模板变量。
- 恢复动作：修正参数或 Recipe 模板。

#### `WORKFLOW_STEP_TIMEOUT`
- 触发条件：Step 执行超过 `timeoutSecs`。
- 用户提示：步骤执行超时。
- 恢复动作：查看日志、增大超时或重试。

#### `WORKFLOW_STEP_CANCELED`
- 触发条件：用户主动取消当前 Run。
- 用户提示：流程已取消。
- 恢复动作：可重新启动或重试整个流程。

#### `WORKFLOW_UNSUPPORTED_INTERACTIVE_COMMAND`
- 触发条件：命令被识别为高概率交互命令，MVP 不支持。
- 用户提示：当前流程包含交互式命令，第一版暂不支持自动执行。
- 恢复动作：改写为非交互命令或改为手工终端执行。

#### `WORKFLOW_CONCURRENCY_LIMIT_REACHED`
- 触发条件：同主机或全局并发超过限制。
- 用户提示：当前有任务正在占用执行槽位，请稍后重试。
- 恢复动作：等待当前任务结束，或取消占用任务后重试。

#### `WORKFLOW_EXEC_FAILED`
- 触发条件：SSH exec 通道建立失败或命令执行失败但未命中更具体错误。
- 用户提示：流程执行失败，请查看步骤日志。
- 恢复动作：检查连接状态、日志与参数后重试。

## 15. 日志、快照与持久化策略

### 15.1 Recipe Snapshot
- Run 启动时必须对 Recipe 做一次快照，避免运行过程中模板被修改导致历史不可复现。
- 建议在 `workflow_runs` 中新增：
  - `recipe_snapshot_json`
- 快照至少包含：
  - Recipe 基本信息
  - 参数定义
  - Step 定义

### 15.2 日志保留策略
- MVP 不要求完整日志长期持久化到 SQLite。
- future draft：若后续拆分 `workflow_run_steps` 子表，可仅保留 `stdout_tail` / `stderr_tail` 尾部窗口，避免数据库膨胀。
- 建议默认保留：
  - 每个字段最多 16 KB 文本
- 运行中的增量输出通过 event 流式推送给前端。
- 应用重启后，历史详情页展示持久化的 tail，而不是依赖完整流式日志回放。

### 15.3 Secret 脱敏
- `secret` 类型参数值禁止写入以下位置：
  - SQLite 普通字段
  - Tauri event payload
  - 前端持久化 store
- `resolvedCommand` 落库前必须按参数表做脱敏，例如：
  - `--token abc123` -> `--token ******`
  - `PASSWORD=abc123` -> `PASSWORD=******`

### 15.4 运行历史清理
- 第一版建议默认保留全部 Run 历史，不主动自动清理。
- 若后续发现数据膨胀，再增加：
  - 保留最近 N 条
  - 按天数清理
  - 手工删除历史

### 15.5 Retry 与 Run Again 语义 [future]
> MVP 不实现 Retry 和 Run Again。此节为后续增量设计预留。

- `Retry` 与 `Run Again` 必须区分，避免历史不可追踪。
- `Retry`：
  - 基于旧 Run 的 `recipe_snapshot_json`
  - 基于旧 Run 的参数快照
  - 基于旧 Run 的 `hostId`
  - 创建一个新的 Run 记录
- `Run Again`：
  - 基于当前最新 Recipe 模板
  - 使用用户当前输入的参数
  - 重新创建一个新的 Run 记录
- 结论：`Retry` 追求可复现；`Run Again` 追求基于当前模板重新执行。

### 15.6 同步范围建议
- 若项目后续启用自部署同步，建议同步以下 Workflow 资产：
  - `workflow_recipes`
  - `workflow_recipes.params_json`
  - `workflow_recipes.steps_json`
- 不建议同步以下运行态数据：
  - `workflow_runs`
- 原因：Recipe 属于用户资产，Run 属于设备/环境相关历史，跨设备同步价值低且噪声大。
- 当前文档体系已采用“同步 Recipe，不同步 Run 历史”的口径；后续实现必须与 `TECH-SPEC` 保持一致。

## 16. 并发、取消与中断恢复

> 本章大部分内容为 [future] 设计，MVP 仅实现 §16.1 中"同主机只允许一个 running，直接拒绝"的策略。
> §15.5 Retry 与 Run Again 语义也为 [future]。

### 16.1 并发策略 [MVP 部分]
- 不同主机之间允许并发运行。
- 同一主机的 Workflow Run，MVP 默认只允许一个 `running`。
- 同主机再次触发时直接返回 `WORKFLOW_EXEC_FAILED`（未来可改为 `WORKFLOW_CONCURRENCY_LIMIT_REACHED`）。
- 为简化第一版实现，不做 per-host queue。

### 16.2 全局限制 [future]
- 建议增加全局最大并发 Run 数，例如 `3`。
- 超出上限时直接返回并发错误，而不是在内存中无限排队。

### 16.3 取消语义 [future]
- 取消是 Run 级操作，不支持第一版"仅取消某一步"。
- 取消行为：
  - 标记 Run 为 cancel requested
  - 尝试中断当前 exec channel
  - 当前 Step 标记为 `canceled`
  - 未开始 Step 标记为 `skipped`
  - Run 标记为 `canceled`

### 16.4 应用退出与异常中断 [MVP]
- MVP 不做后台持续执行与恢复执行。
- 若应用退出或崩溃时存在 `running` Run：
  - 下次启动时将其标记为 `failed`
  - 在 `error` 字段中写明 `APP_TERMINATED`
- 不新增 `interrupted` 状态，统一落为 `failed`。

### 16.5 观测与追踪字段
- Workflow 属于长生命周期任务，必须补充最小可追踪字段，避免问题难以复盘。
- 建议在 command 返回、event payload、后端 tracing log 中尽量包含：
  - `requestId`
  - `runId`
  - `stepId`
  - `recipeId`
  - `hostId`
- 要求：
  - command 失败时至少能带回 `requestId`
  - step 级 event 至少带 `runId` 与 `stepId`
  - 后端日志应能按 `runId` 串联整次执行链路

## 17. UX 细化规则

### 17.1 Recipe 编辑规则
- 空步骤 Recipe 不允许保存。
- 参数 `key` 在同一 Recipe 内必须唯一。
- `timeoutSecs` 需限制在合理范围，例如 `1 ~ 3600`。
- Step 列表建议支持排序调整；第一版可先用上下移动按钮，不必强依赖拖拽。

### 17.2 Run 与模板隔离
- Run 启动后，不受后续 Recipe 模板修改影响。
- 历史详情展示应以 Run 快照为准，而不是实时读取当前 Recipe。

### 17.2.1 Host 绑定模型 [已收敛]
- Recipe 是全局可复用模板，不绑定特定主机。
- Run 启动时必须显式选择 `hostId`。
- 后续如需增强，可增加：
  - 推荐主机标签
  - 推荐分组
  - 最近使用主机

### 17.3 按钮与状态
- `running` 时显示：`Cancel`
- `success` 时显示：`Run Again`
- `failed` / `canceled` 时显示：`Retry`
- 日志视图为只读，不允许在历史详情里直接编辑命令。

### 17.4 风险交互
- 若 Recipe 包含危险命令，运行确认层需出现显式风险提醒。
- 若包含疑似交互式命令，启动前即阻断，不等执行时报错。

## 18. 测试矩阵建议

### 18.1 功能正确性
- 创建 Recipe 成功。
- 编辑 Recipe 成功。
- 删除 Recipe 成功。
- 3 步顺序执行全部成功。
- 第 2 步失败时，第 3 步被标记为 `skipped`。

### 18.2 参数与模板
- 必填参数缺失时禁止启动。
- `{{var}}` 被正确替换。
- `{{var:default}}` 在未输入时采用默认值。
- 不存在变量时触发 `WORKFLOW_TEMPLATE_RENDER_FAILED`。

### 18.3 取消与超时
- 用户取消后当前 Step 为 `canceled`，未开始 Step 为 `skipped`。
- Step 超时后 Run 标记为 `failed`。
- 已完成 Run 不允许再取消。

### 18.4 并发与资源
- 同一主机重复启动第二个 Run 时符合并发策略。
- 多主机并发运行时相互不污染状态。
- 全局并发达到上限时返回预期错误。

### 18.5 日志与脱敏
- stdout/stderr tail 截断逻辑正确。
- secret 参数不出现在事件流和数据库字段中。
- `resolvedCommand` 存储前已脱敏。

### 18.6 历史与重试
- Run 历史在应用重启后仍可查看。
- Retry 会创建新的 Run，不覆盖旧记录。
- 历史详情使用快照而不是当前模板。

### 18.7 风险控制
- 危险命令触发确认提醒。
- 疑似交互命令被预先阻断。
- 主机不存在时返回明确错误码而不是通用失败。

## 19. 前端设计

### 13.1 页面结构
建议新增独立一级页面 `WorkflowPage`（UI 名称：命令宏）：
- 左侧：Recipe 列表
- 中间：Recipe 编辑器 / 参数定义 / Step 列表
- 右侧：运行历史与最近结果

### 13.2 运行交互
- 选择 Recipe 后点击“运行”。
- 运行前弹出确认层，至少展示：
  - 目标主机
  - 参数输入项
  - 步骤数量
  - 风险提示
- 启动后展示：
  - 当前 Run 状态
  - 当前 Step
  - 每步日志
  - 取消按钮

### 13.3 结果展示
- 支持查看最近运行历史。
- 支持查看某次 Run 的逐步状态与日志。
- 支持对失败 Run 执行“重试整个流程”。

## 20. 安全与风控

### 14.1 运行确认
- Workflow 不是“回填”动作，属于显式执行功能。
- 运行前必须明确确认，不允许默认静默执行。

### 14.2 危险命令识别
- 可复用终端页的危险命令规则作为第一阶段基础护栏。
- 命中危险规则时，确认弹窗需做高亮提醒。

### 14.3 Secret 参数
- `secret` 参数不写入普通日志。
- `resolved_command` 存储前应做脱敏处理，避免把凭据、token、密码写入历史记录。

### 14.4 非交互限制
- MVP 默认禁止或显式提示不支持需要交互输入的命令。
- 对依赖 TTY 或交互密码输入的场景，后续再评估专门能力，不在第一阶段强行兼容。

## 21. 与统一任务中心（FR-43）的关系
- Workflow Run 天然属于一种任务类型。
- 第一阶段可先提供独立 Run 列表，减少实现面。
- 第二阶段可将以下任务统一进 Task Center：
  - transfer
  - update
  - reconnect
  - workflow run
- 统一后的核心是共享生命周期与一致操作：
  - filter/search
  - retry/cancel
  - history persistence
  - traceability

## 22. 分阶段实施建议

### Phase 1：数据与后端基础
- 增加 Workflow 相关 SQLite 表。
- 实现 Recipe CRUD。
- 抽象模板解析器。
- 为 SSH exec 增强退出码、超时、取消能力。

### Phase 2：执行引擎
- 实现 Run / Run Step 状态机。
- 实现顺序步骤执行。
- 实现日志落盘与事件推送。
- 实现取消与重试整次 Run。

### Phase 3：前端可用版本
- 增加命令宏独立页面。
- 增加 Recipe 编辑器。
- 增加运行确认弹窗。
- 增加 Run 历史与日志视图。

### Phase 4：任务中心融合
- 定义统一任务模型。
- 将 Workflow Run 接入 Task Center。
- 对齐 transfer/update/reconnect 的展示与操作语义。

## 23. 验收建议
- 可创建、编辑、删除 Recipe。
- 可在指定主机上启动 Run。
- 参数缺失时禁止启动。
- 每个 Step 的状态、耗时、退出码可查看。
- 失败时 Run 停止并保留日志。
- 取消时状态流转正确。
- Secret 参数不写入明文日志。
- 应用重启后仍可查看 Run 历史。

## 24. 当前推荐结论
- 命令宏应作为独立 `Workflow / Recipe` 能力实现，不应直接并入 `Snippets` 的“可执行版”。
- 第一版采用“单主机 + 顺序命令步骤 + 独立 SSH exec 通道”的设计最稳妥。
- 该方案最符合当前项目的技术栈、任务模型方向和“先做最小闭环”的工程策略。

## 25. 待确认问题
- Run 历史是否允许删除，还是只允许保留最近 N 条。
- `continue_on_error` 是否第一版就开放给用户配置，还是先固定“遇错停止”。
- 后续是否需要支持 `sftp_upload` / `sftp_download` 作为 Step 类型。
- 是否需要在主机级提供“常用 Recipe”快捷入口。

### 25.1 已收敛决策（2026-04-14）
以下问题已通过 `WORKFLOW-RECIPE-DECISION-SUMMARY.md` 收敛，不再列为待确认：
1. Recipe 不绑定主机 → `hostId` 在 Run 启动时选择。（已更新 §8.4、§9.1、§17.2.1）
2. 状态字段统一使用 `state`，MVP 枚举为 Run `running|completed|failed`、Step `pending|running|completed|failed`。（已更新 §11、§13）
3. 模板语法 MVP 仅支持 `{{var}}` / `{{ var }}`，不支持 `{{var:default}}`。（已更新 §10.2）
4. Recipe 字段统一使用 `title`（非 `name`）。（已更新 §9、§10、§13）
5. Command 命名统一使用 dot notation。（已更新 §13、TECH-SPEC、API-CONTRACTS）
6. 错误码已区分 MVP 和 future。（已更新 ERROR-CATALOG 和 §14）

## 26. 联动文档清单
- 若 Workflow 进入正式开发，建议同步更新以下文档，避免设计与全局 source of truth 脱节：
  - `docs/01-PRODUCT/FR-INDEX.md`
  - `docs/01-PRODUCT/PRD.md`
  - `docs/01-PRODUCT/FEATURE-STATUS.md`
  - `docs/02-ARCH/TECH-SPEC.md`
  - `docs/02-ARCH/API-CONTRACTS.md`
  - `docs/02-ARCH/ERROR-CATALOG.md`
  - `docs/04-ENGINEERING/TEST-PLAN.md`
  - `docs/04-ENGINEERING/TASK-CARDS.md`
  - `docs/CHANGELOG.md`

### 26.1 建议联动点
- `FR-INDEX.md`：若采纳独立 FR，新增 `FR-44 Workflow Recipe`。
- `PRD.md`：补充 Workflow 的产品目标、边界与验收标准。
- `FEATURE-STATUS.md`：新增 Workflow 能力状态项，避免被错误归到 `FR-43` 之下。
- `TECH-SPEC.md`：补充 Workflow 数据模型、同步范围、事件与命令契约。
- `API-CONTRACTS.md`：录入 Workflow command / event 的正式字段级契约。
- `ERROR-CATALOG.md`：录入 Workflow 专属错误码与恢复动作。
- `TEST-PLAN.md`：增加 Workflow 的 happy path / failure path / timeout / cancel / masking 用例。
- `TASK-CARDS.md`：拆出 Workflow 任务卡，而不是只挂在 Unified Task Center 下。
