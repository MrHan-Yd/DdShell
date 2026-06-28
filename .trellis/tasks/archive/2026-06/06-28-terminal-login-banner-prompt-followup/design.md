# 技术方案

## 方案

扩展 `CrLfNormalizer` 的流式状态：

- 继续持有跨 chunk 的 pending CR。
- 增加当前输出行是否已有可见文本的状态。
- 当遇到 pending bare CR 后的第一个非 LF 字节时：
  - 如果当前行已有文本，且下一个字节是 `[`，按登录 banner bracket prompt 覆盖场景处理为 `\r\n[`。
  - 否则保留原行为，输出 bare `\r` 后继续输出该字节。

这个判断有意收窄到 `[root@host ~]#` / `[user@host path]$` 这类常见 Linux prompt，不把所有 bare CR 都改成换行，避免破坏进度条。

## 数据流

```text
SSH ChannelMsg::Data bytes
  -> CrLfNormalizer::normalize
  -> encoding decoder
  -> session:output event
  -> xterm term.write
```

归一化必须发生在编码解码之前，因为 CR/LF 是 ASCII 控制字节，跨 chunk 判断在字节层更可靠。

## 风险

- 如果某个命令输出使用 `\r[` 开头刷新同一行，会被转成换行。该风险比登录时 prompt 覆盖低，且判断只在当前行已有文本后触发。
- 如果远端 prompt 不以 `[` 开头，此补丁不覆盖；后续可基于实际输出继续扩展，但先解决当前截图里的 bracket prompt。
