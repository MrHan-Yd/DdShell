# Feature Status

状态说明：
- `TODO`：已确认需求，尚未发现实现
- `IN_PROGRESS`：代码中已存在实现或原型，但未完成完整自测 / 回归 / 验收
- `DONE`：实现完成并通过最小验证
- `BLOCKED`：被依赖或外部条件阻塞

## 评估口径

- 本文件于 `2026-04-07` 按 `app/` 与 `app/src-tauri/` 静态代码审阅结果更新。
- 本次更新不等于端到端测试通过；无明确测试记录的能力，统一保持 `IN_PROGRESS`，避免误标为 `DONE`。
- `FR-INDEX.md` 与本文件状态应保持一致。

## 核心能力

- SSH 会话：IN_PROGRESS
- SFTP 双栏：IN_PROGRESS
- 系统监控：IN_PROGRESS
- 命令中心：IN_PROGRESS
- 自部署同步：TODO

## 对标补漏能力（FR-20~FR-30）

- FR-20 多网卡监控：TODO
- FR-21 打包传输：TODO
- FR-22 高级网络监控：TODO
- FR-23 高级进程管理：TODO
- FR-24 快速输入路径：TODO
- FR-25 历史字段级选择：TODO
- FR-26 快速输入命令名：TODO
- FR-27 系统识别：IN_PROGRESS
- FR-28 命令提示：IN_PROGRESS
- FR-29 Ubuntu/CentOS 差异适配：IN_PROGRESS
- FR-30 终端背景自定义：IN_PROGRESS

## 当前已能从代码确认的实现面

- 连接管理：主机 CRUD、分组、收藏、连接测试、SSH config 导入
- 终端：会话连接、多标签、分屏、命令历史、命令提示、危险命令保护、背景/字体/颜色设置
- SFTP：双栏浏览、上传下载、删除、重命名、新建目录、拖拽上传、传输队列、路径收藏/最近路径
- 监控：CPU / 内存 / 网络图、进程表、磁盘表、命令模板、会话健康分
- 数据持久化：主机、分组、片段、设置、命令历史、known_hosts、收藏路径、最近路径
- 更新能力：后端已存在检查更新与下载接口，前端更新中心入口未确认

## 维护规则

- 每次需求状态变化必须同步本文件与 `FR-INDEX.md`。
- `DONE` 状态必须附测试记录链接或测试任务编号。
- 如果只有代码原型、尚未完成验收，保持 `IN_PROGRESS`。

## Full FR Status (FR-01~FR-43)

- FR-01: IN_PROGRESS
- FR-02: IN_PROGRESS
- FR-03: IN_PROGRESS
- FR-04: IN_PROGRESS
- FR-05: IN_PROGRESS
- FR-06: IN_PROGRESS
- FR-07: IN_PROGRESS
- FR-08: IN_PROGRESS
- FR-09: IN_PROGRESS
- FR-10: IN_PROGRESS
- FR-11: IN_PROGRESS
- FR-12: IN_PROGRESS
- FR-13: IN_PROGRESS
- FR-14: IN_PROGRESS
- FR-15: IN_PROGRESS
- FR-16: IN_PROGRESS
- FR-17: IN_PROGRESS
- FR-18: IN_PROGRESS
- FR-19: IN_PROGRESS
- FR-20: TODO
- FR-21: TODO
- FR-22: TODO
- FR-23: TODO
- FR-24: TODO
- FR-25: TODO
- FR-26: TODO
- FR-27: IN_PROGRESS
- FR-28: IN_PROGRESS
- FR-29: IN_PROGRESS
- FR-30: IN_PROGRESS
- FR-31: IN_PROGRESS
- FR-32: IN_PROGRESS
- FR-33: IN_PROGRESS
- FR-34: IN_PROGRESS
- FR-35: IN_PROGRESS
- FR-36: TODO
- FR-37: IN_PROGRESS
- FR-38: TODO
- FR-39: IN_PROGRESS
- FR-40: TODO
- FR-41: TODO
- FR-42: TODO
- FR-43: TODO
