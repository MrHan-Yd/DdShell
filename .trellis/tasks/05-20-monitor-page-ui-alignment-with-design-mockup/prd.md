# Monitor page UI alignment with design mockup

## Goal

把 `app/src/features/monitor/MonitorPage.tsx` 的布局/样式向设计稿
`ui/monitor.html` 对齐，保留所有现有功能（Tauri 指标采集、会话选择、网络
RX/TX 切换、Session Health、进程/磁盘/命令模板等）可继续工作。

## What I already know

设计稿核心元素：

1. **Header**：title-block（`Monitor · <host>` + 副标题 `ip · OS · uptime · last sample Xs ago`）+ 右侧
   `seg-control`（5 档时间窗：5m/15m/1h/6h/24h）+ `Auto · 2s` 按钮
2. **KPI grid（4 列）**：CPU / Memory / Network / Load Avg，每张含
   label + 状态 badge + 大数字（num+unit）+ 副 meta + 底部 sparkline
3. **大图表卡**：4 个 tab（CPU usage / Memory / Network I/O / Disk I/O）+ legend +
   area chart（带渐变+游标+tooltip）+ 时间轴
4. **进程表**：表头 PID / USER / CPU%（条+数字）/ MEM%（条+数字）/ TIME / COMMAND / 操作按钮
5. **底部 statusbar**：采样状态 dot + 关键指标摘要 + 最后采样时间 + 健康徽章

现状 `MonitorPage.tsx`：

- Header 简洁版（无完整副标题），3 档时间窗（5/15/60）+ Stop 按钮
- 6 张概览卡（多了 Uptime、Session Health；缺 sparkline 和 badge）
- 2×2 mini chart（CPU/Memory/Network RX/Network TX）独立卡片，没有 tab 切换
- 进程表是普通 table（无 bar、无操作按钮），藏在折叠区
- 磁盘表 / Command Templates 各自折叠区
- 无底部 statusbar

设计稿样式 token 复用：`var(--space-*)`、`var(--radius-*)`、`var(--accent-violet)`、
`var(--accent-cyan)`、`var(--warning)`、`var(--bg-elevated)`、`var(--border-default)` 等。

## Assumptions (temporary)

- 时间窗仅前端 UI 增加 6h/24h 两个 tab；store 实际生效仍按现有
  `TimeWindowOption (5|15|60)` 处理（待确认）
- 设计稿的"上一次采样多少秒前"信息可从 `latest.serverTime` 或本地 tick 推导
- 设计稿大图表的 tab "Disk I/O" 在 store 里没有现成系列，需要后置或用占位

## Decision (ADR-lite)

**Context**：现状有 4 个设计稿里没有的模块（Uptime 卡 / Session Health 卡 /
折叠磁盘表 / 折叠命令模板），需要决定如何处理。

**Decision**：严格按设计稿对齐：

- Uptime → 合并进 header 的副标题（`ip · OS · uptime Xd · last sample Xs ago`）
- Session Health → 下沉到底部 statusbar 作为健康徽章
- 磁盘表 → 作为大图表卡的 `Disk I/O` tab（如无 disk I/O 速率系列，临时用占位）
- 命令模板 → 删除（设计稿无此模块）

**Consequences**：

- 页面视觉与设计稿一致度最高
- 命令模板功能暂时缺失（后续若需要可作为单独 page 或 modal 重新引入）
- 5 档时间窗 UI 全部展示，但 6h/24h 在 store 层面仍映射到 60m 数据，
  仅作为视觉档位（后端扩展属 out of scope）

## Requirements (evolving)

- Header 改为设计稿的 title-block + 5 档 seg-control + "Auto · 2s" 按钮
- KPI 卡形态：4 列 + label + badge + 大数字 + 副 meta + sparkline（沿用现有 MiniChart 即可）
- 大图表卡：4 tab 切换（CPU/Memory/Network/Disk），保留 MiniChart 的动画/插值能力
- 进程表：按设计稿样式重构（带 bar、TIME 列、操作按钮）
- 视觉/间距/边框统一用 `--space-*` / `--radius-card` 等 token

## Acceptance Criteria (evolving)

- [ ] Header 包含主标题、副标题（系统信息+采样时间）、5 档时间窗、Auto 按钮
- [ ] 4 张 KPI 卡每张都有 sparkline 和状态 badge
- [ ] 大图表卡可在 CPU/Memory/Network/Disk 之间切换
- [ ] 进程表样式与设计稿一致（bar+TIME+操作按钮）
- [ ] 所有原有数据流仍工作：collector 启停、网络 RX/TX 切换、Session Health、磁盘表、命令模板均可访问

## Definition of Done

- Tests / lint / typecheck 全绿
- 真实数据下页面可展示（连接一个会话观察）

## Out of Scope (explicit)

- 后端 collector 改动（不扩 6h/24h 时间窗的实际历史长度，UI 上仍可点但映射到 60m）
- 新增 disk I/O 速率指标采集（如 store 里没有，则该 tab 用占位展示磁盘使用率列表）
- 命令模板模块（决策中移除，后续如有需要单独再做）

## Technical Notes

- 现有文件：`app/src/features/monitor/MonitorPage.tsx`
- 设计稿：`ui/monitor.html` + `ui/styles/pages/monitor.css`
- 复用样式 token：`ui/styles/tokens.css`（app 端如有相同变量则直接复用）
- store：`app/src/stores/metrics.ts`（`timeWindow` / `snapshots` / `latest`）

## Implementation Summary

完成日期：2026-05-20

**修改文件：**

- `app/src/features/monitor/MonitorPage.tsx` — 整页重构（保留 SessionPicker / Sparkline 风格 /
  RollingNumber / store 接入逻辑，去掉 OverviewCard / CollapsibleSection / DiskTable /
  CommandTemplates，新增 KpiCard / AreaChart / ChartCard / ProcessTable / StatusBar）
- `app/src/styles.css` — 末尾追加约 320 行 `mon-*` 命名样式，复用 app 端
  `--color-*` / `--radius-*` / `--font-size-*` token
- `app/src/lib/i18n.ts` — 新增 17 个 monitor i18n key（lastSampleAgo / autoBadge /
  samplingBadge / filterByCommand / sortByCpu / chart 标签 / 健康文案 / cores 等）

**布局结构：**

```
mon-page
├── mon-scroll
│   └── mon-body
│       ├── mon-header  (title + subtitle + seg-picker + Auto·2s + Stop)
│       ├── mon-kpi-grid (CPU / Memory / Network / Load Avg，每张带 sparkline + badge)
│       ├── mon-chart-card (4 tab：CPU/Memory/Network/Disk + legend + area + axis)
│       └── mon-proc-card (filter + sort + grid table 带 CPU/MEM bar + 操作菜单)
└── mon-statusbar  (sampling 状态 dot + 关键指标摘要 + 上次采样时间 + 健康徽章)
```

**功能保留：**

- collector start/stop, history loading
- session picker / 多会话切换
- session health 信息（下沉到 statusbar，使用 `--color-good/fair/poor`）
- 磁盘列表（合入大图表 Disk I/O tab）
- 进程过滤 + CPU 排序（新增）
- 5 档时间窗（UI 上 5/15/60/360/1440，6h/24h 在 store 层映射回 60，
  视觉档位生效但底层不扩历史窗口——属 out of scope）

**功能移除：**

- Command Templates（按决策移除，i18n key 保留以便后续如需要再引入）

**验证：**

- `npx tsc --noEmit` monitor 部分零错误
- `npx vite build` 通过
