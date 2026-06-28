# 修复终端启动后 prompt 重复和残片

## Goal

修复 SSH 终端首次连接后，登录提示和 shell prompt 显示完成后又出现重复 prompt 或残片的问题，例如：

```text
[root@C20240428105430 ~]#
[root@C20240428105430 ~]#
0 ~]# 05430
```

## Confirmed Facts

- 之前的后端输出规范化已经能让 `Last failed login`、`There was ... failed login attempt`、`Last login` 等登录提示完整换行显示。
- 当前剩余问题发生在登录完成后的启动阶段：prompt 已出现，但随后又出现重复 prompt 和 prompt 片段。
- 前端 `TerminalPage.tsx` 在连接绑定后会显式延迟 800ms 调用 `sessionResize`，代码注释已经说明这类 resize 可能导致某些 shell 重发 prompt 并污染显示。
- 后端创建 SSH PTY 时已经传入初始 `cols` / `rows`，启动期额外 resize 不应成为连接可用性的前置条件。

## Requirements

- 终端首次连接后，登录 banner 和第一个 shell prompt 应按远端原始输出顺序显示。
- 启动期自动布局/fit 不应向远端发送会导致 prompt 重绘的多余 resize。
- 连接稳定后，真实窗口尺寸变化、分屏拖拽、容器尺寸变化仍应继续同步到远端 PTY。
- 不改变用户输入、命令执行、重连、宏、AI assist、文件抽屉等非 resize 功能。

## Acceptance Criteria

- 重新连接后，命令输入位置是干净 prompt，不再在 prompt 后追加 `0 ~]# 05430` 这类残片。
- 启动后不应额外出现第二个空 prompt，除非远端 shell 自己真实输出。
- 手动调整窗口或分屏尺寸后，终端行列数仍能同步到远端。
- 前端构建通过；后端检查和现有测试通过或记录无法运行的原因。

## Out of Scope

- 不修改远端服务器 SSH 配置、登录失败提示来源或 root 密码策略。
- 不引入新的终端渲染库或重构整个终端页。
- 不改变登录认证方式；是否每次输入系统密码属于连接认证配置，不在本次修复范围内。

## Open Questions

无阻塞问题。用户已确认可以继续修复，并要求改完后校验原功能可用。
