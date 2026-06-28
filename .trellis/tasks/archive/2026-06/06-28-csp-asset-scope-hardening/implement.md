# Implementation Plan

## Steps

1. 读取适用 Trellis 规范。
2. 在 Rust 后端增加终端背景图导入命令：
   - 请求：`{ sourcePath: string }`
   - 响应：`{ path: string }`
   - 校验文件存在、是文件、扩展名属于图片白名单。
   - 复制到 `$APPDATA/terminal-backgrounds/<sha256-prefix>.<ext>`。
3. 在 `app/src/lib/tauri.ts` 增加类型封装。
4. 更新设置页：
   - 选择图片后调用导入命令。
   - 加载旧背景图路径时尝试迁移并落库。
   - 保存时确保图片路径已是导入路径或空。
5. 更新终端页：
   - 加载 `terminal.bgImagePath` 时尝试迁移旧路径并落库。
6. 更新 `tauri.conf.json`：
   - 添加 CSP baseline。
   - 收窄 asset scope 到 `$APPDATA/terminal-backgrounds/**`。
7. 验证：
   - `pnpm -C app build`
   - `cargo check` in `app/src-tauri`
   - `cargo test` in `app/src-tauri`
8. 运行 Trellis check，修正发现的问题。
9. 中文提交工作变更，然后归档任务。

## Risk Points

- CSP 可能阻断 Tauri IPC 或 asset 图片协议，需通过 build/check 和代码审查确认 scheme 覆盖。
- 旧路径迁移若在终端加载中失败，不能影响终端启动。
- 前端异步迁移需要避免组件卸载后 setState。

## Validation Notes

- 当前项目没有专门的前端单元测试脚本；以 TypeScript/Vite build 为主要前端验证。
- Rust 命令应尽量拆出纯函数，便于 `cargo test` 覆盖扩展名和目标文件名逻辑。
