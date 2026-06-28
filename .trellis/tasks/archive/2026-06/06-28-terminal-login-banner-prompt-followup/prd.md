# 继续修复终端登录 banner prompt 混排

## 目标

SSH 终端首次连接时，登录 banner 文本必须完整显示，shell prompt 必须落在 banner 后面的独立输入行，不能覆盖 `failed login attempts` 等提示行的前半段。

## 现象

用户复测截图显示：

```text
Last failed login: ...
[root@C20240428105430 ~]# attempts since the last successful login.
Last login: ...
```

这说明 banner 中 `... attempts since ...` 所在行的前半段已经被 prompt 覆盖。上一轮修复解决了跨 chunk `\r\r\n`，但还没有覆盖“bare CR 后跟 prompt 回到当前行首覆盖文本”的场景。

## 需求

1. 继续在 SSH 输出流层修复登录 banner/prompt 覆盖问题。
2. 当 banner 文本行后出现 bare `\r` 并紧跟典型 bracket prompt（例如 `[root@host ~]# `）时，应把这个 CR 作为换行处理，避免 prompt 覆盖当前行。
3. 保留 `\r\r\n -> \r\n` 和跨 chunk 归一化行为。
4. 尽量避免影响普通命令运行中的 CR 行为，例如进度条或状态刷新。
5. 继续避免前端启动期向远端 shell 注入 CPR 探测。

## 验收标准

- `There were 1 failed login attempts...\r[root@host ~]# ` 归一化后 prompt 位于下一行。
- 上述场景即使 `\r[` / prompt 被拆成多个 SSH chunk 也能正确处理。
- 普通不匹配 bracket prompt 的 bare `\r` 仍保留原行为。
- 前端构建通过。
- Rust check 和 Rust tests 通过。

## 不在范围

- 不重写 xterm 渲染。
- 不修改远端服务器 PAM/MOTD/profile。
- 不改变正常用户输入和命令输出路径。
