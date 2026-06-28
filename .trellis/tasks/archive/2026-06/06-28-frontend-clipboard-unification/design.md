# Design

## Approach

新增 `app/src/lib/clipboard.ts` 作为前端剪贴板文本读写的唯一入口。

## API

```ts
export async function readClipboardText(): Promise<string>
export async function writeClipboardText(text: string): Promise<void>
```

## Behavior

1. 优先调用 Tauri clipboard plugin：
   - `readText()`
   - `writeText(text)`
2. 如果 Tauri plugin 抛错，尝试浏览器 fallback：
   - `navigator.clipboard.readText()`
   - `navigator.clipboard.writeText(text)`
3. 如果 fallback 不存在或失败，抛出原始错误或 fallback 错误。

## Call Sites

- `QuickEditTabContent`: 推荐动作复制命令。
- `SnippetsPage`: 详情复制、右键菜单复制。
- `TerminalAiAssist`: AI 命令复制。
- `QuickEditor`: 编辑器 context menu 剪切/复制/粘贴。
- `TerminalPage`: 中键粘贴读取剪贴板。

## Compatibility

- 调用方仍然决定成功/失败 toast。
- `SnippetDetail` 当前是 fire-and-forget 写剪贴板并设置 copied 状态；统一后改成 async，但保持成功后再显示 copied，更准确。
- Terminal 中键粘贴继续吞掉读取失败，保持现有静默失败行为。

## Validation

- 静态搜索确认没有业务代码直接使用 `navigator.clipboard` 或 plugin import。
- 前端 build 确认类型正确。
- Rust check/test 确认桌面侧未受影响。
