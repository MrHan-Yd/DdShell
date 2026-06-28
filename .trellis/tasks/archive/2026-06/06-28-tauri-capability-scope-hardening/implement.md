# Implementation Plan

## Steps

1. 读取 Trellis 规范和任务文档。
2. 修改 `app/src-tauri/capabilities/default.json`：
   - 删除 `opener:default`。
   - 将 `dialog:default` 改为 `dialog:allow-open`。
   - 删除 `notification:default`。
3. 修改 `app/src-tauri/capabilities/quick-edit.json`：
   - 删除 `dialog:default`。
4. 验证：
   - `pnpm -C app build`
   - `cargo check` in `app/src-tauri`
   - `cargo test` in `app/src-tauri`
   - `pnpm -C app tauri build --no-bundle`
5. 若 Tauri build 暴露缺失权限，按报错只恢复明确需要的权限。
6. 运行 Trellis check。
7. 中文提交工作变更并归档任务。

## Risk Points

- `dialog:allow-open` 必须覆盖目录选择和多文件选择。
- Quick Edit 复用编辑器，剪贴板权限不能删除。
- 完整 Tauri 构建可能比纯 Rust/前端检查更能发现 capability 权限名错误。
