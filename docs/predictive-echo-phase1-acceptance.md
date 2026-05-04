# Predictive Echo 阶段 1 验收手测脚本

> 用途：切片 1-4 代码全绿后的手测验收记录。逐项打勾，跑完即作为验收报告。
> 关联文档：[`predictive-echo-phase1-progress.md`](./predictive-echo-phase1-progress.md) §1.2 / §10.1quater
> 预计耗时：15-20 分钟（不含搭建高延迟环境）

---

## 0. 环境记录（开测前填）

| 项 | 值 |
|---|---|
| 测试日期 | YYYY-MM-DD |
| 本机 OS | macOS xx.x / arm64 |
| 应用 git hash | `git rev-parse --short HEAD` 输出 |
| 远程主机 | IP / hostname / 地理位置 |
| 测得 RTT | `ping -c 5 <host>` 平均值，单位 ms |
| 远程 shell | bash / zsh / fish |
| 远程 OSC 133 | 已装 / 未装 / 未知 |

> **RTT < 100ms 的环境验收无效**——预测和远程 echo 几乎同时到达，看不出差别。
> 推荐：海外 VPS（>200ms）/ 跨洲机器（>400ms）/ macOS 本地 dnctl 模拟（见附录 A）

---

## 1. 前置确认

- [ ] 已 `npx vite` 启动 dev 应用（生产构建没有 console.debug，metrics 看不到）
- [ ] 设置 → 「预测回显（实验）」开关已开启
- [ ] **第一次开启**时看到 toast：「预测回显已开启。预测中的字符显示为浅色，确认后转为正常色。如遇异常请在设置中关闭。」
- [ ] 已连到测试主机，看到正常 prompt
- [ ] 验证 OSC 133 是否装了：在远程敲一个无害命令（如 `pwd`），观察执行前后是否有 `\x1b]133;` 序列（高级用户：用 `cat -v` 或 `script` 抓取）。**未装也能继续测，但 §2.1 可能不预测**——这种情况记到异常表

---

## 2. 核心预测路径（必过项 ★）

### 2.1 普通输入颜色变化 ★

**步骤**：在远程 prompt 处，**慢慢**敲 `helloworld`（约 1 秒一字符），观察。

- [ ] 每个字符按键**瞬间**出现，颜色为**浅色（dim 灰）**
- [ ] 约 RTT 时间后，浅色变为**正常色**（白/默认前景色）
- [ ] 全部敲完整行为正常色，无错位 / 多余字符
- [ ] 此时按回车，命令正常执行

**异常分流**：
- 字符直接是正常色，没经历"浅色→正常"过渡 → 预测没启用（开关没开 / OSC 133 没装 / 状态卡 Cold）。看 §4 metrics 确认。
- 浅色一直不变 → 远程 echo 没回来或失配。看 §4 mismatchCount。

---

### 2.2 alternate screen / vim ★

**步骤**：在远程 prompt 处敲 `vim /tmp/pe_test.txt` + Enter

- [ ] vim 启动瞬间画面**完全干净**——**没有任何浅色字符残留**
- [ ] 在 vim 内敲字符（i 进入插入模式后敲 `abc`）：字符是 vim 的正常色，**不**是预测层的浅色
- [ ] `:q!` 退出 vim 后回到 shell，画面干净
- [ ] 回到 shell 后继续敲普通字符，预测**重新生效**（看到浅色→正常色过渡）

**追加测试**（同样必过）：
- [ ] `less /etc/passwd` 进入 → q 退出，画面干净
- [ ] `man ls` 进入 → q 退出，画面干净

**异常分流**：vim 内出现浅色字符 → CSI ?1049/47/1047 handler 没生效（progress.md §6.2）

---

### 2.3 退格 ★

**步骤 A**：在 prompt 处敲 `helloworld`，**等所有字符变正常色**，按退格 5 次。
- [ ] 每按一次退格，最后一个字符**立刻消失**（不等远程）
- [ ] 退格 5 次后剩 `hello`，光标位置正确
- [ ] 没有"幽灵字符"或残留下划线/方块

**步骤 B**：敲 `aaa`，**字符还是浅色时**立刻按退格 1 次。
- [ ] 浅色 `a` 立刻消失，剩两个字符（仍可能是浅色或已转正色）

**步骤 C**：清空命令行后（`Ctrl+U`），光标在 prompt 头部，按退格。
- [ ] 屏幕**不出错**（不会蹦出奇怪字符），状态进入 Frozen，后续输入暂时不预测——这是预期行为
- [ ] 按回车产生新 prompt 后，预测应恢复

---

### 2.4 ESC / Ctrl+C ★

**步骤 A**（Ctrl+C）：在 prompt 处敲 `helloworld`（**不**回车），按 Ctrl+C
- [ ] Ctrl+C 立即响应，进入新 prompt
- [ ] 之前的浅色字符被妥善处理（要么消失，要么由远程保留为正常色，**不**会有错位残留）
- [ ] 新 prompt 后继续敲字符，预测恢复

**步骤 B**（ESC）：在 prompt 处敲 `abc`，按 ESC
- [ ] 不卡顿
- [ ] 之后的输入不报错（可能短暂不预测，等下个 prompt 信号恢复）

---

### 2.5 切 tab / sessionId ★

前提：至少能开 2 个终端 tab。

- [ ] tab A 连主机 X，敲 `aaa`（保持浅色，不回车）
- [ ] 切到 tab B（新建或已有）
- [ ] 切回 tab A：屏幕**无错位、无串台**，浅色 `aaa` 仍在或已转正色
- [ ] tab B 内敲字符也能正常预测
- [ ] 关闭 tab A 后重开同一主机：状态干净，无残留

---

## 3. 兼容性场景（来自 §10.2）

- [ ] 命令助手 `//` 触发：在 prompt 敲 `//ls`，助手正常弹出（没被预测吃掉）
- [ ] 命令助手 Enter/Tab 接管：助手内交互正常
- [ ] 命令历史（上下箭头）：能正常翻历史，不会留浅色残影
- [ ] 危险命令拦截：敲 `rm -rf /` 弹出确认对话框，无预测干扰
- [ ] 宏运行：执行任意宏，输出正确无污染
- [ ] IME 中文输入：切到中文输入法敲一段中文（如「你好」），中文字符**不进入预测**（一开始就是正常色）
- [ ] Quick Edit 选区：选中文字、复制、粘贴均正常
- [ ] 重连：手动断网/断 SSH 后重连，预测层 reset 干净，再敲字符能恢复预测

---

## 4. 客观指标（dev console）

**打开方式**：dev 应用窗口下 → 右键 → Inspect Element / 检查 → Console 标签。

**等待**：保持终端活动 60 秒以上（持续敲字符更明显）。

**预期输出**（每 60 秒一条）：
```
[PredictiveEcho] predictions=N confirms=N mismatches=N hitRate=XX.X%
```
> 注意：队列从未发生预测时**不会输出**（predictionCount === 0 时跳过）

记录最后一条 metrics 实际值：
- `predictions = ____`
- `confirms = ____`
- `mismatches = ____`
- `hitRate = ____ %`

判定：
- [ ] `predictions > 0`（预测真的发生过）
- [ ] `hitRate ≥ 90%`（健康阈值，参考 progress.md §7.3）
- [ ] `mismatches / predictions ≤ 10%`

**异常分流**：
- 60 秒内一条都没打印 → predictionCount 一直 0 → 状态卡 Cold（OSC 133 没装，弱启发式也没识别 prompt）
- hitRate < 90% → 失配偏多，可能远程 shell 有 alias/着色干扰；记到异常表

---

## 5. 设置项相关验证（来自 §10.1quater）

- [ ] **持久化**：开关开启后退出应用、重开 → 开关仍是开启状态
- [ ] **实时同步**：保持 1 个终端 tab 在线，去设置里**关闭**开关 → 已开终端**立即停止预测**（不需要重连/重开 tab）
- [ ] **关闭后干净**：关闭开关，敲字符没有任何浅色（行为完全等同关闭前）
- [ ] **重新打开**：再次打开开关，敲字符恢复预测
- [ ] **toast 仅一次**：第二次打开开关不再弹 toast（localStorage `terminal.predictiveEcho.guidanceShown` 已置位）

---

## 6. 异常记录

跑测中遇到任何"实际 ≠ 预期"，记录于此（截图保存到 `docs/screenshots/` 引用）：

| # | 场景章节 | 预期行为 | 实际行为 | 复现步骤 | 截图/日志 | 严重度 |
|---|---|---|---|---|---|---|
|   |   |   |   |   |   |   |

严重度定义：
- **致命**：屏幕错乱、shell 不可用、数据丢失 → 阻塞发布
- **严重**：预测失效但不破坏功能 → 阻塞发布
- **轻微**：观感问题、边界 case → 记入阶段 2 待办

---

## 7. 验收结论

- [ ] §2 全部 ★ 必过项打勾
- [ ] §3 兼容性 ≥ 9/10 通过（IME 在某些输入法下可能边界，可酌情）
- [ ] §4 metrics 健康
- [ ] §5 设置项行为正确
- [ ] §6 无致命/严重异常

**结论**：⬜ 通过 / ⬜ 不通过

测试人：____________
日期：______________

通过后请：
1. 把本文件 commit 进 `docs/`
2. 把 `predictive-echo-phase1-progress.md` §1.2 切片 4 行从「代码完成（手测待验收）」改为「已完成（YYYY-MM-DD 验收）」
3. 在 §1.2 表格下补一行：「阶段 1 验收 → 见 `predictive-echo-phase1-acceptance.md`」

---

## 附录 A：macOS 本地模拟高延迟

如果手头没海外 VPS，可在本机模拟出口延迟（需要 sudo）：

```bash
# 模拟出 22 端口 500ms 延迟（双向共 1000ms RTT）
sudo dnctl pipe 1 config delay 500
sudo pfctl -e
echo "dummynet out proto tcp from any to any port 22 pipe 1" | sudo pfctl -f -

# 测完恢复
sudo pfctl -d
sudo dnctl -q flush
```

注意：`pfctl -f -` 会**覆盖**当前规则，如果你的 pf 已配置防火墙规则需要先备份 (`sudo pfctl -sr > /tmp/pf.bak`)。

更安全的替代：用 `tc`（Linux）/ Network Link Conditioner（macOS Xcode 工具）。

---

## 附录 B：快速重跑 selfCheck（开测前推荐）

```bash
cd /Users/hanyongding/project/rust/shell/app
npx -y tsx -e "import { selfCheck } from './src/features/terminal/predictiveEcho'; const r = selfCheck(); console.log(r.results.join('\n')); process.exit(r.passed ? 0 : 1);"
```

预期：104/104 passed，退出码 0。**手测前先跑一遍确认代码层无回归。**
