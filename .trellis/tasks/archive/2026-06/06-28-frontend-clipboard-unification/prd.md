# 统一前端剪贴板调用

## Goal

统一前端剪贴板读写入口，优先使用 Tauri clipboard plugin，让桌面原生能力继续受 capability 权限控制，同时保留浏览器/dev fallback，避免改坏现有复制、剪切、粘贴和终端中键粘贴功能。

## Confirmed Facts

- 已存在 Tauri clipboard plugin 权限：
  - `clipboard-manager:allow-read-text`
  - `clipboard-manager:allow-write-text`
- 当前直接使用 `navigator.clipboard.writeText` 的位置：
  - `app/src/features/quick-edit/QuickEditTabContent.tsx`
  - `app/src/features/snippets/SnippetsPage.tsx` 两处
  - `app/src/features/terminal/TerminalAiAssist.tsx`
- 当前直接使用 `@tauri-apps/plugin-clipboard-manager` 的位置：
  - `app/src/features/sftp/components/QuickEditor.tsx` 读写剪贴板
  - `app/src/features/terminal/TerminalPage.tsx` 中键粘贴读取剪贴板
- `app/src/features/terminal/hooks/useMacroRunner.ts` 中的 `writeText` 是向 SSH session 写入文本，不是剪贴板 API，不能误改。

## Requirements

1. 新增一个薄封装，统一提供：
   - `readClipboardText(): Promise<string>`
   - `writeClipboardText(text: string): Promise<void>`
2. 封装行为：
   - 优先调用 `@tauri-apps/plugin-clipboard-manager`。
   - 如果 Tauri clipboard plugin 不可用或失败，再尝试 `navigator.clipboard`，用于浏览器 preview/dev fallback。
   - 两者都失败时向调用方抛错，保持原有 toast/error 行为。
3. 替换直接 `navigator.clipboard.writeText` 的调用。
4. 将已有 Tauri clipboard plugin 直接调用改为走统一封装。
5. 不改变现有 UI 文案、toast 成功/失败语义或业务操作顺序。
6. 不修改 Tauri capability 权限，本轮只统一前端调用入口。

## Acceptance Criteria

- `rg "navigator\\.clipboard" app/src` 不再命中业务代码调用。
- `rg "@tauri-apps/plugin-clipboard-manager" app/src` 只应命中新建统一封装。
- Snippets 复制命令仍会设置 copied 状态或显示成功 toast。
- Terminal AI Assist 复制仍显示成功/失败 toast。
- Quick Edit 推荐动作复制仍显示成功/失败 toast。
- QuickEditor 剪切/复制/粘贴仍通过统一封装执行。
- Terminal 中键粘贴仍读取剪贴板并写入 session。
- `pnpm -C app build` 通过。
- `cargo check` 和 `cargo test` 在 `app/src-tauri` 下通过。

## Out Of Scope

- 改动剪贴板 capability 权限。
- 改动浏览器 Clipboard API 权限策略。
- 改造 UI 文案或交互。
- 手动 UI 自动化测试。

## Open Questions

无阻塞问题。用户已同意继续并要求保证原功能可用。
