# Ops Runbook

## 1. 日常巡检
- 检查容器状态：全部 `healthy`。
- 检查 API 错误率与延迟。
- 检查磁盘空间与数据库增长。

## 2. 升级流程
1. 备份数据库。
2. 拉取新镜像。
3. 执行灰度或直接滚动重启。
4. 运行健康检查与冒烟测试。
5. 发布升级公告与变更说明。

## 3. 回滚流程
1. 停止当前版本容器。
2. 切换到上一个稳定镜像 tag。
3. 恢复数据库（如 schema 不兼容）。
4. 验证健康检查与关键同步路径。

## 4. 备份恢复
- 备份：`pg_dump` 每日执行。
- 恢复：`pg_restore` 到新实例后切流。
- 恢复后必须执行一致性核验（记录数、最新更新时间）。

## 5. 常见故障排查
- 无法连接 API：检查网关证书、端口、防火墙。
- 同步失败：检查 token 有效期、服务时钟偏差。
- 数据库连接满：检查连接池上限与慢查询。

## 6. 监控与告警
- 核心指标：请求成功率、P95 延迟、同步成功率。
- 告警阈值：
  - 错误率 > 5% 持续 5 分钟。
  - P95 > 1.5s 持续 10 分钟。
  - DB 可用连接 < 10%。


## 7. Update Failure Runbook
- Symptom A: update package download timeout
  - check outbound network/DNS/proxy
  - retry with backoff and verify artifact endpoint
- Symptom B: signature verification failed
  - stop install immediately
  - verify signing key rotation record and manifest integrity
  - keep current version running, issue security alert
- Symptom C: service unhealthy after redeploy
  - rollback to previous stable image tag
  - run `/healthz` and sync smoke tests
  - if DB incompatible, execute restore procedure
- Postmortem output:
  - root cause
  - impact window
  - mitigation
  - prevention action items
