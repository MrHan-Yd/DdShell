# Backlog

## P0（优先实现）
- FR-20 多网卡监控
  - 任务：接口定义、采集适配、UI 多网卡切换、测试用例
  - 预估：2~3 天
- FR-21 打包传输
  - 任务：压缩/解压流程、任务队列状态、失败回滚
  - 预估：2~4 天
- FR-24 快速输入路径
  - 任务：路径扫描、模糊搜索、回填交互
  - 预估：1~2 天
- FR-26 快速输入命令名
  - 任务：命令索引、提示排序、键盘交互
  - 预估：1~2 天
- FR-30 终端背景自定义
  - 任务：背景配置、会话级覆盖、可读性保护
  - 预估：1~2 天

## P1（增强）
- FR-22 高级网络监控（监听端口/连接状态）
  - 预估：2~3 天
- FR-23 高级进程管理（更多列/筛选）
  - 预估：1~2 天
- FR-25 历史字段级选择输入
  - 预估：1~2 天

## P2（打磨）
- 命令提示规则库扩展（Ubuntu/CentOS 更多差异映射）
- 终端背景预设主题包与导入导出
- 大数据量历史命令性能优化

## 统一验收要求
- 每项必须附带：接口说明、UI 状态图、测试用例、回滚方案。
- 每项合并前必须通过跨平台冒烟（Windows/macOS/Linux）。


- FR-35 Client update center (check/download/install/restart)
  - Tasks: update metadata contract, in-app state machine, signature/checksum verification, install/restart fallback
  - Estimate: 2~4 days
- FR-36 Self-host Docker update & redeploy
  - Tasks: backup automation, pull/redeploy pipeline, health check, rollback/restore drill
  - Estimate: 1~3 days
