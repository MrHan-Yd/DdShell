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

## 5. 发布流程

### 5.1 本地检查（必做）
在推送代码前，先在本地运行构建检查，确保没有错误：

```bash
cd app
pnpm build
```

如果构建成功，再进行下一步。

### 5.2 更新版本号
- `app/package.json`
- `app/src-tauri/Cargo.toml`
- `app/src-tauri/tauri.conf.json`

### 5.3 提交代码
```bash
git add -A
git commit -m "release: v0.x.x"
```

### 5.4 创建 Tag 并推送
```bash
git tag v0.x.x
git push origin v0.x.x
```

GitHub Actions 会自动构建并创建 Release。

