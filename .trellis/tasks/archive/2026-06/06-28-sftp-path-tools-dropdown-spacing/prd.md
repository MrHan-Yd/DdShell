# 修复文件管理路径收藏下拉贴边

## Goal

修复独立 SFTP 文件管理页路径收藏/最近访问下拉菜单内容贴边的问题，并确认是否由全局样式覆盖导致。

## Confirmed Facts

- 截图中的下拉菜单来自 `PathToolsDropdown`。
- 最近访问条目是 `<button>`，使用 Tailwind `px-3 py-1.5` 设置内边距。
- Aurora 全局规则 `[data-ui-theme="aurora"] button { padding: 0; ... }` 比 Tailwind 单 class 的 padding selector 更具体，会覆盖按钮行的内边距。
- 收藏条目外层是 `div`，受影响较小；但内部按钮和最近访问按钮仍应使用页面级样式兜住。

## Requirements

- 路径收藏/最近访问下拉的左右内容不能贴边。
- 最近访问行的路径和日期需要稳定排布，日期不能挤到边框上。
- 修复应覆盖本地/远程两侧 `PathToolsDropdown`。
- 不改变收藏、移除收藏、最近访问跳转、添加当前路径等功能逻辑。

## Acceptance Criteria

- 下拉菜单标题、空状态、收藏项、最近访问项都有清晰左右内边距。
- Aurora 全局 button reset 不再覆盖该下拉的按钮行 padding。
- `pnpm -C app build` 通过。
- `cargo check --manifest-path app/src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path app/src-tauri/Cargo.toml` 通过。
- `git diff --check` 通过。

## Out Of Scope

- 不重做 SFTP 页面整体布局。
- 不调整新建文件夹输入行动画。
- 不改终端内文件管理抽屉。

## Open Questions

- 无阻塞问题。
