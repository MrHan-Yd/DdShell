# 检查文件管理样式覆盖并添加新建文件夹动画

## Goal

确认独立 SFTP 文件管理页中新建文件夹样式没有被组件或主题 CSS 覆盖，并让新建文件夹输入行出现时带有自然的过渡动画。

## Confirmed Facts

- `app/src/main.tsx` 先加载 `styles.css`，再加载 `styles/aurora-index.css`。
- Aurora 的 `pages/sftp.css` 在 `aurora/components.css` 之后加载，SFTP 页面级规则可以覆盖 Aurora 通用 `.input` / `button` 规则。
- Classic 的 `.sftp-main .mkdir-editor ...` 规则选择器比 Tailwind utility 和组件 class 更具体。
- 目前新建文件夹输入行通过条件渲染直接出现，没有进入动画。

## Requirements

- 复查并保留 SFTP 页面中新建文件夹输入行的尺寸、间距、按钮样式覆盖能力。
- 给新建文件夹输入行添加轻量进入动画，避免直接跳出。
- 动画不应影响创建文件夹、取消、Enter/Escape、blur 提交这些原有交互。
- 同步覆盖 Classic 和 Aurora 两套主题。

## Acceptance Criteria

- 新建文件夹输入行出现时有短暂的 opacity/translate 过渡。
- 输入框和按钮尺寸仍由 SFTP 页面样式控制，不被通用 Input/Button 样式压回默认尺寸。
- `pnpm -C app build` 通过。
- `cargo check --manifest-path app/src-tauri/Cargo.toml` 通过。
- `cargo test --manifest-path app/src-tauri/Cargo.toml` 通过。
- `git diff --check` 通过。

## Out Of Scope

- 不改 SFTP 创建目录业务逻辑。
- 不重做文件管理页面布局。
- 不调整终端内文件管理抽屉。

## Open Questions

- 无阻塞问题。
