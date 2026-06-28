# CSP 与资源范围安全加固

## Goal

降低 WebView 可加载资源面和本地文件暴露范围，同时保持现有终端背景图、Quick Edit、设置页和更新器 UI 正常可用。

## Confirmed Facts

- `app/src-tauri/tauri.conf.json` 当前 `app.security.csp` 为 `null`，未启用显式 Content-Security-Policy。
- 当前 `assetProtocol.enable` 为 `true`，但 `assetProtocol.scope.allow` 为 `["**"]`，WebView asset 协议理论上可请求任意本地文件路径。
- 当前唯一明确使用 `convertFileSrc` 的前端路径是终端背景图：
  - `app/src/features/terminal/TerminalPage.tsx`
  - `backgroundImage: url(${convertFileSrc(termSettings!.bgImagePath!)})`
- 设置页允许用户选择任意本地图片路径并保存到 `terminal.bgImagePath`。
- Quick Edit 使用 `WebviewWindowBuilder` 打开 `index.html?window=quick-edit&open=...`，它不依赖任意本地 asset 路径。
- 代码搜索未发现 `dangerouslySetInnerHTML`、`eval`、`new Function` 等明显需要放宽脚本 CSP 的用法。
- CSS 中存在 `data:image/svg+xml` 背景，因此 CSP 的 `img-src` 需要允许 `data:`。
- React 组件大量使用内联 `style={...}`，CSP 的 `style-src` 需要保留 `'unsafe-inline'`，否则当前 UI 会被破坏。
- Tauri v2 schema 支持 asset scope 使用 `$APPDATA/**` 等变量；`convertFileSrc` 默认协议为 `asset`，跨平台需要兼容 `asset://localhost/...` 与 Windows 的 `http://asset.localhost/...`。

## Requirements

1. 启用显式 CSP baseline：
   - 禁止任意对象、frame 和外部脚本执行。
   - 允许 Tauri IPC、应用自身静态资源、asset 协议图片、data 图片和当前内联样式需求。
   - 不阻断 Rust 后端发起的 GitHub updater / AI provider 网络请求。
2. 收窄 `assetProtocol.scope.allow`：
   - 不再使用 `["**"]`。
   - 终端背景图通过受控导入进入应用数据目录下的固定子目录。
   - asset scope 仅允许该固定子目录下的文件。
3. 终端背景图兼容：
   - 用户新选择背景图时复制到应用数据目录并保存复制后的路径。
   - 已保存的旧绝对路径在设置页或终端加载时尽量自动导入迁移，避免升级后直接失效。
   - 如果旧路径不存在或复制失败，不应阻断应用启动；应回退为无背景图或保留可恢复的设置状态。
4. 文件导入安全：
   - 后端命令只接受本地图片文件路径。
   - 限制支持的扩展名为当前设置页允许的图片类型：png、jpg、jpeg、webp、gif、bmp。
   - 复制目标文件名应避免使用用户原始文件名直接形成可预测/冲突路径。
5. 保持现有功能：
   - 设置保存流程、终端加载流程、Quick Edit 窗口、SFTP/SSH、更新器 UI 不应因 CSP 或 asset scope 调整而被破坏。

## Acceptance Criteria

- `app/src-tauri/tauri.conf.json` 启用 CSP，且 `assetProtocol.scope.allow` 不再是 `["**"]`。
- 新选择终端背景图片时，前端保存的是应用数据目录下的导入文件路径。
- 终端渲染背景图仍通过 `convertFileSrc` 工作。
- 已保存的旧背景图绝对路径会被尝试迁移到导入目录；迁移失败时应用不崩溃。
- `pnpm -C app build` 通过。
- `cargo check` 在 `app/src-tauri` 下通过。
- `cargo test` 在 `app/src-tauri` 下通过，或若现有环境无法运行，需要记录原因。

## Out Of Scope

- 完全移除 `'unsafe-inline'` style。当前 React 内联样式较多，需要单独 UI 重构。
- 引入 CSP nonce/hash 管理。
- 改造 Rust 后端网络访问或 AI provider 配置。
- 对所有用户文件导入功能做统一资产库管理。

## Open Questions

无阻塞问题。按上述安全优先但兼容现有终端背景图的方案实施。
