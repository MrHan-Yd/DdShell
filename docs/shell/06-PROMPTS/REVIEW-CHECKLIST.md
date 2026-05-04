# Review Checklist

## 1. 需求一致性检查
- 是否严格覆盖 PRD 范围。
- 是否出现未授权功能扩展。
- 是否保留个人开发者核心场景优先。

## 2. 架构一致性检查
- 是否遵循 ARCHITECTURE 模块边界。
- 是否遵循 TECH-SPEC 接口命名与错误码。
- 是否包含事件流和状态同步逻辑。

## 3. UI/交互一致性检查
- 是否遵循 UI-SPEC 的布局尺寸与动效参数。
- 是否包含加载、空态、错误态。
- 是否保证高频操作路径简洁。

## 4. 安全与稳定性检查
- 凭据是否避免明文落盘。
- known_hosts 策略是否完整。
- 异常流程是否有重试、回退与可观测日志。

## 5. 测试完备性检查
- 是否覆盖正常、异常、边界场景。
- 是否包含跨平台回归计划。
- 是否有清晰可执行的验收步骤。

## 6. 发布可执行性检查
- 是否提供 Docker Compose 自部署说明。
- 是否包含升级、回滚、备份恢复。
- 是否有版本说明与兼容性说明。


## Status Vocabulary (Mandatory)
- Check that status values only use: `TODO`, `IN_PROGRESS`, `DONE`, `BLOCKED`.
- Reject outputs using `Not Started`, `In Progress`, `Verified`, or custom status words.
- Reject `DONE` items that do not include test evidence.

## 7. FR-37~FR-43 Review Addendum
- FR-37: score formula stable, reasons explainable, no focus stealing.
- FR-38: search accuracy, clip export integrity, sensitive output masking.
- FR-39: ssh config parse compatibility and conflict resolution safety.
- FR-40: sync conflict preview correctness and rollback executability.
- FR-41: extraction precision/recall and safe quick-action mapping.
- FR-42: alert threshold tuning, debounce/cooldown, low-noise behavior.
- FR-43: unified task state machine consistency across task types.
