# 修复终端首次登录提示和 prompt 混排

## 目标

首次打开 SSH 终端时，远端登录提示、失败登录提示、Last login 等 banner 内容必须按顺序显示；命令输入 prompt 行必须是干净的，不能插入到 banner 文本中间，也不能残留上一行内容。

## 背景与证据

- 用户截图显示 root prompt 出现在失败登录提示文本中间：`[root@... ~]# ttempt since...`。
- `app/src-tauri/src/lib.rs` 已有 `normalize_crlf(data)` 处理 `\r\r\n -> \r\n`，注释明确说明部分服务器/PAM 会发送 double CR，导致 xterm 光标停在 MOTD 文本中间。
- 当前归一化按单个 SSH output chunk 执行；如果 `\r\r\n` 被拆到多个 chunk，处理会漏掉。
- `app/src/features/terminal/TerminalPage.tsx` 首次连接固定 300ms 向远端写入 `\x1b[6n` 做 CPR 探测，800ms 后发 resize；代码注释已记录启动期 resize 可能让 shell 重发 prompt 并污染显示。

## 需求

1. 修复跨 chunk 的 `\r\r\n` 归一化，避免 bare `\r` 在 banner 中让后续 prompt 回到当前行开头覆盖文本。
2. 启动期不要主动向远端 shell 注入 CPR 探测，避免在 login banner/MOTD 尚未稳定时触发 echo、prompt 或输入流污染。
3. 保留正常远端输出渲染、用户输入、resize、预测回显启发式和 OSC 133 行为。
4. 不改变 SSH 连接认证流程，不修改服务器端配置，不隐藏远端真实 banner 内容。

## 验收标准

- `\r\r\n` 即使跨 SSH output chunk 分割，也应输出为单个 `\r\n`。
- 首次连接时前端不再固定向远端发送 `\x1b[6n` CPR 探测。
- 终端 prompt 行保持在 banner 之后的独立输入位置。
- 前端构建通过。
- Rust check 和相关测试通过。

## 不在范围

- 不重写预测回显机制。
- 不修改远端 shell profile、MOTD、PAM 配置。
- 不改变用户手动 resize 后同步远端 PTY 大小的行为。
