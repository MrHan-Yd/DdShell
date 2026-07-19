# 发布 v0.3.1

## 背景

v0.3.0 的 Windows MSI 包存在 2503 安装失败与自动更新静默失败（根因与修复见归档任务 07-18-windows-msi-2503）。修复已合入 main，需要尽快发布补丁版本，并引导存量 v0.3.0 MSI 用户手动升级一次。

## 发布范围（git log v0.3.0..HEAD 实际提交）

- `42d1930` 修复主题选择卡片边框裁切
- `0b58cd3` 修复 Windows MSI 安装 2503 并改为手动安装向导更新

## 发布步骤（按 docs/发布/发布文档.md）

1. 本地检查：`cd app && pnpm build`
2. 版本号 0.3.0 → 0.3.1 三处同步：`app/src-tauri/tauri.conf.json`、`app/src-tauri/Cargo.toml`、`app/package.json`
3. 更新 `.github/workflows/release.yml` create-release body 的版本介绍段（只替换介绍段，保留固定说明），**并在正文加入对存量 v0.3.0 MSI 用户的手动升级引导**
4. 编写 `docs/发布/v0.3.1-版本介绍.md`
5. 提交 `release: v0.3.1` → 打 tag `v0.3.1` → push main + tags
6. 验证 CI 与 Release 产物（发布文档第 4 步清单）

## 验收标准

- [ ] 三处版本号一致为 0.3.1
- [ ] release.yml body 为 v0.3.1 介绍，含 MSI 用户手动升级提示
- [ ] 版本介绍文档基于实际提交编写
- [ ] tag 推送后 CI 触发
- [ ] Release 产物齐全（6 安装包 + updater 产物 + latest.json 四平台 key）
- [ ] Windows 实测（人工）：MSI 手动安装无 2503；MSI 版程序内更新停在"打开安装程序"提示；NSIS 版静默更新正常

## 已知限制

- Windows 实测需在真机进行（开发机为 macOS），发布后由 han 验证
- 存量 v0.3.0 MSI 用户机器上的旧更新逻辑仍是坏的，只能通过 Release 说明引导手动下载
