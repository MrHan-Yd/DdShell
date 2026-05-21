# Fix Monitor Chart-Tab Button Padding

## Problem

Monitor 页图表区域的 tab 按钮（CPU使用率 / 内存 / 网络 I/O / 磁盘 I/O）内部文字四周紧贴背景边缘，视觉上很不舒服。

具体表现：当按钮处于 hover 或 active 状态时，有背景色（`var(--color-bg-hover)` / `var(--color-accent-subtle)`），但文字紧贴背景色上下左右边缘，像是文字"撑满"了整个按钮。

## Root Cause

当前 `.mon-chart-tab` 样式：

```css
.mon-chart-tab {
  height: 26px;        /* 固定高度 */
  padding: 0 16px;     /* 上下 padding 为 0 */
  border-radius: 8px;
  font-size: var(--font-size-xs); /* 11px */
}
```

- `padding: 0 16px` — 上下 padding 为 0，文字垂直方向贴着背景边缘
- 固定 `height: 26px` 配合 0 上下 padding，行高把文字推到紧贴容器
- 设计稿用的是英文短文本（"CPU usage"/"Memory"/"Network I/O"/"Disk I/O"），26px + 0 上下行高勉强能看；但实际运行时 i18n 中文文本（"CPU 使用率"/"内存"/"网络 I/O"/"磁盘 I/O"）中文字高更大，视觉上更贴边

## Design Reference

设计稿 `ui/styles/pages/monitor.css`：
```css
.chart-tab {
  height: 26px;
  padding: 0 var(--space-3);  /* 0 12px */
  border-radius: var(--radius-sm);  /* 6px */
  font-size: var(--fs-xs);  /* 11px */
}
.chart-tab.is-active {
  background: var(--accent-subtle);
  color: var(--accent);
}
```

设计稿英文文本在 26px 高度下上下贴边不明显，但中文需要额外留白。

## Requirements

1. **上下 padding 必须有值**：去掉固定 height，改用 padding 自然撑开，或保留 height 但给足够的上下 padding
2. **左右 padding 保持合理**：设计稿 12px，实际代码 16px，取折中值
3. **中英文兼容**：按钮样式需要在中文和英文文本下都看起来舒适，文字不贴边
4. **视觉对齐设计稿**：border-radius、gap、整体风格与设计稿一致

## i18n Text Reference

| Key | zh | en |
|-----|----|----|
| monitor.cpuUsage | CPU 使用率 | CPU Usage |
| monitor.memory | 内存 | Memory |
| monitor.networkIo | 网络 I/O | Network I/O |
| monitor.diskIo | 磁盘 I/O | Disk I/O |

## Scope

- 仅修改 `app/src/styles.css` 中 `.mon-chart-tabs` 和 `.mon-chart-tab` 相关样式
- 不修改 TSX 组件代码

## Acceptance Criteria

- [ ] active/hover 状态下，文字上下左右与背景边缘有明显留白（非贴边）
- [ ] 中文文本 "CPU 使用率" 按钮上下不贴边
- [ ] 英文文本 "CPU Usage" 按钮上下不贴边
- [ ] 按钮之间间距合理，不过密也不过疏
- [ ] border-radius 与设计稿一致（6px）
