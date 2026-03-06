# Release Plan

## 1. 版本策略
- `v0.x`：快速迭代验证期。
- `v1.0`：稳定可替代版本。
- 采用 SemVer。

## 2. 产物与分发
- Windows：`msi` 或 `exe` 安装包。
- macOS：`dmg` 安装包。
- Linux：`AppImage` + `deb`（优先）。

## 3. 签名与安全
- Windows：代码签名证书。
- macOS：签名 + notarization。
- Linux：发布页提供校验和（SHA256）。

## 4. 发布清单
- 版本说明（新增/修复/已知问题）。
- 安装与升级说明。
- 配置迁移说明。
- 回滚版本说明。

