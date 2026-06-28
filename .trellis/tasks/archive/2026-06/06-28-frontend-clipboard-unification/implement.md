# Implementation Plan

## Steps

1. 读取 Trellis 规范。
2. 新增 `app/src/lib/clipboard.ts`。
3. 替换直接 `navigator.clipboard.writeText`：
   - `QuickEditTabContent.tsx`
   - `SnippetsPage.tsx`
   - `TerminalAiAssist.tsx`
4. 替换直接 plugin import：
   - `QuickEditor.tsx`
   - `TerminalPage.tsx`
5. 搜索确认：
   - `rg "navigator\\.clipboard" app/src`
   - `rg "@tauri-apps/plugin-clipboard-manager" app/src`
6. 验证：
   - `pnpm -C app build`
   - `cargo check` in `app/src-tauri`
   - `cargo test` in `app/src-tauri`
7. Trellis check。
8. 中文提交并归档。

## Risk Points

- 不要改 `useMacroRunner.ts` 的 session 写入 helper。
- `SnippetDetail` 的复制状态需要等写入成功后再置为 copied。
- `TerminalPage` 中键粘贴失败仍应静默处理。
