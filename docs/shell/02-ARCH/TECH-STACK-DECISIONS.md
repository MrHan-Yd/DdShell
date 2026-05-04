# Tech Stack Decisions & Version Baseline

更新时间：`2026-03-05`
目标：质量优先、跨平台稳定（Windows/macOS/Linux）

## 1) 结论（可执行）
- 现有技术栈可实现当前 PRD/MVP 目标。
- 版本策略建议采用：`大版本锁定 + 小版本跟进 + 补丁快速升级`。
- 生产默认选择 LTS 与稳定分支，避免追随非 LTS 的运行时主版本。

## 2) 推荐版本基线（截至 2026-03-05）

### 运行时与编译链
- Node.js：`24.x (Active LTS)`（生产推荐）
- Rust：`1.93.0 (stable)`

### 前端与桌面框架
- React：`19.2`
- Vite：`7.1.4`
- TypeScript：`5.8.x`（如需追新可评估 `5.9.x`）
- Tailwind CSS：`4.1.x`
- Zustand：`5.0.9`
- xterm：使用 `@xterm/xterm`（禁止新项目继续使用已弃用 `xterm` 包）

### Tauri 生态（建议同 minor 对齐）
- `@tauri-apps/cli`：`2.8.4`
- `@tauri-apps/api`：`2.8.0`
- 建议策略：Tauri 相关包统一 `2.8.x`，避免跨 minor 混搭。

## 3) 兼容性与风险说明
- Node 生产建议使用 LTS（`24.x`），非 LTS（如 `25.x`）仅用于评估。
- Rust 使用 stable 通道，避免 nightly 引入不确定性。
- React 19 需确认 SSR/RSC 依赖链安全补丁已纳入。
- `xterm` pnpm 包已弃用，必须迁移到 `@xterm/xterm`。
- Tauri JS 包与 Rust 侧 crate 要保持同代（v2）并尽量同 minor。

## 4) 锁版本建议（落地规则）
- `package.json`：核心框架使用 `~` 或精确版本；工具链可用 `^` 但需周检。
- Rust `Cargo.toml`：核心 crate 使用明确 minor（如 `2.8`），补丁可自动接收。
- CI 增加依赖漂移检查：
  - Node：锁文件变更必须附兼容性说明。
  - Rust：`cargo update` 需附回归结果。

## 5) 每周升级窗口（质量优先）
- 固定每周一次依赖评审（仅评估补丁与安全更新）。
- 小版本升级需先过：
  1. 构建成功
  2. 核心链路回归（连接/终端/SFTP）
  3. 跨平台冒烟（Win/macOS/Linux）

## 6) 版本核验命令（执行前再确认一次）
```bash
node -v
rustc -V
pnpm view react version
pnpm view vite version
pnpm view typescript version
pnpm view tailwindcss version
pnpm view zustand version
pnpm view @tauri-apps/cli version
pnpm view @tauri-apps/api version
pnpm view @xterm/xterm version
```

## 7) 数据来源（官方优先）
- Node.js Releases: https://nodejs.org/about/previous-releases
- Rust Releases: https://blog.rust-lang.org/releases/
- React Versions: https://react.dev/versions
- Vite Releases: https://vite.dev/releases
- pnpm packages:
  - https://www.npmjs.com/package/@tauri-apps/cli
  - https://www.npmjs.com/package/@tauri-apps/api
  - https://www.npmjs.com/package/tailwindcss
  - https://github.com/pmndrs/zustand (release)
  - https://www.npmjs.com/package/xterm (deprecated notice)
  - https://xtermjs.org/docs/guides/download/

