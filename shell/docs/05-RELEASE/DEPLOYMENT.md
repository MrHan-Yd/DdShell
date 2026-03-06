# Deployment (Docker Compose)

## 1. 目标
- 提供可自部署的同步服务能力。
- 部署方式统一为 `Docker Compose`。

## 2. 部署拓扑
- `shell-sync-api`：同步 API 服务。
- `postgres`：元数据存储（配置、片段、偏好，不含明文凭据）。
- `redis`（可选）：任务队列与短期缓存。
- `caddy/nginx`（可选）：TLS 终止与反向代理。

## 3. 环境要求
- Docker Engine 24+
- Docker Compose v2+
- Linux 主机（Ubuntu LTS 优先）

## 4. 目录建议
```text
deploy/
  compose/
    docker-compose.yml
    .env.example
  caddy/
    Caddyfile
  scripts/
    backup.sh
    restore.sh
```

## 5. 环境变量（最小集）
- `APP_ENV=production`
- `APP_PORT=8080`
- `DATABASE_URL=postgres://...`
- `JWT_SECRET=...`
- `ENCRYPTION_KEY=...`
- `CORS_ORIGIN=...`

## 6. 部署步骤
1. 准备 `docker-compose.yml` 与 `.env`。
2. 初始化数据库卷与网络。
3. 执行 `docker compose pull`。
4. 执行 `docker compose up -d`。
5. 使用健康检查接口确认服务状态。

## 7. 健康检查
- API：`GET /healthz` 返回 `200`。
- DB：容器日志无连接错误。
- 同步：客户端可完成一次上传/拉取。

## 8. 安全要求
- 必须启用 HTTPS。
- 不允许将 `JWT_SECRET`、`ENCRYPTION_KEY` 写入仓库。
- 数据库仅开放内网访问。

## 9. 备份建议
- 每日数据库逻辑备份 + 每周全量快照。
- 备份保留策略：7 日增量、4 周全量。

## 10. 验收标准
- 新节点部署时间 < 30 分钟。
- 故障重启后服务 5 分钟内恢复。
- 升级后数据与配置可用。


## 11. Docker Update & Redeploy (Mandatory)
- Standard procedure:
  1) create backup (`db` + `.env` + compose file snapshot)
  2) pull new images: `docker compose pull`
  3) redeploy: `docker compose up -d --remove-orphans`
  4) health check and smoke test
  5) confirm logs and publish deployment result
- Rollback:
  - keep previous stable image tag
  - redeploy previous tag when failure occurs
  - restore database when schema incompatibility detected
- Acceptance:
  - zero secret leakage
  - service recovered within objective window
  - key sync path remains available after redeploy
