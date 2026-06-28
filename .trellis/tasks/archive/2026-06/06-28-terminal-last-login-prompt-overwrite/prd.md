# 继续修复 Last login 被 prompt 覆盖

## 目标

SSH 首次连接后，`Last login` 和失败登录提示必须完整显示；`[root@host ~]#` prompt 必须出现在独立输入位置，不能覆盖 `Last login` 行。

## 现象

用户完整重启应用后复测仍出现：

```text
[root@C20240428105430 ~]# 21:04 2026 from 60.13.118.194
```

这说明 prompt 仍然回到了 `Last login` 行行首并覆盖了前半段，只剩时间/来源尾部。

## 判断

上一版已处理 `...\r[root@host ~]#`，但实际服务器输出可能是：

```text
Last login: ...\r<ANSI 控制序列>[root@host ~]#
```

也就是 bare CR 和 bracket prompt 之间夹了 ANSI/CSI 控制序列，导致现有“CR 后第一个字节必须是 `[`”的判断没有命中。

## 需求

1. 扩展 SSH 输出归一化，处理 `bare CR + ANSI 控制序列 + bracket prompt` 覆盖场景。
2. 保留已有 `\r\r\n` 跨 chunk 归一化。
3. 保留普通非 prompt bare CR 行为，避免破坏进度条/状态刷新。
4. 新增回归测试覆盖 `Last login...\r\x1b[... [root@host ~]#` 和跨 chunk 版本。

## 验收标准

- `Last login: ...\r[root@host ~]#` 输出为 `Last login: ...\r\n[root@host ~]#`。
- `Last login: ...\r\x1b[0m[root@host ~]#` 输出为 `Last login: ...\r\n\x1b[0m[root@host ~]#`。
- 上述 ANSI 版本即使跨 chunk 也正确。
- `progress 10%\rprogress 20%` 保持不变。
- 前端构建、Rust check、Rust tests 通过。
