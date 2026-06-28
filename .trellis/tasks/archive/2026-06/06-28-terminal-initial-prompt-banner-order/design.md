# 技术方案

## 后端输出归一化

将当前无状态 `normalize_crlf(data)` 改为有状态归一化器，在每个 SSH session 的 `output_reader_loop` 中持有。

核心规则：

- 将连续模式 `\r\r\n` 归一化为 `\r\n`。
- 如果 chunk 末尾是 `\r`，先暂存，等下个 chunk 决定它是否参与 `\r\r\n`。
- 如果后续字节不能组成 `\r\r\n`，再按原样输出暂存的 `\r`。
- EOF 前 flush 暂存的 `\r`，避免吞掉真实输出。

这样能覆盖 `\r\r\n` 被切成 `"\r"` + `"\r\n"` 或 `"\r\r"` + `"\n"` 的情况。

## 前端启动期探测

移除首次连接固定 300ms 的远端 CPR 注入：

```ts
api.sessionWrite(sessionId, Array.from(TEXT_ENCODER.encode("\x1b[6n")))
```

预测回显仍可通过以下路径进入可用状态：

- 远端 shell 的 OSC 133 prompt signal。
- 现有 prompt 启发式检测。
- 后续如需要再设计本地 CPR 查询，但不能通过远端 stdin 注入启动期控制序列。

保留首次 resize 的延迟逻辑和用户/容器 resize 同步逻辑。

## 风险与取舍

- 删除启动 CPR 可能让少数无法识别 prompt 的 shell 中，预测回显进入 Active 的时间更晚；这是可接受的，因为不污染真实终端输出优先级更高。
- 有状态 CR 归一化只影响 SSH output 中的 CR 序列，不改普通文本、不改 LF、不改用户输入。
