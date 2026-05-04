# 动画风格指南

## 风格关键词

**轻量、精准、有层次感** — 接近 macOS 原生应用的动画质感：不炫技、不拖沓，每个动画都有明确目的。

---

## 核心规则

### 1. 双层运动

所有显眼的动画都是 opacity + transform 组合，永远不要只做其中一个。

| 效果 | 做法示例 |
|------|----------|
| 弹出菜单 | opacity 0→1 + scale(0.95)→scale(1) + translateY(-5px)→0 |
| 内容切换 | opacity 0→1 + translateY(10px)→0 |
| 抽屉展开 | opacity 0→1 + translateY(-6px)→0 |
| 收藏星标 | opacity 0→1 + scale(0.5)→scale(1) |

单做 opacity 是"闪烁"，单做 transform 是"跳跃"，两者叠加才是"出现"。

### 2. 入场用 spring，退场用 smooth

- **入场**（弹出、展开、出现）：spring 曲线，有轻微惯性但不回弹，表示"自然到位"
- **退场**（关闭、收起、消失）：smooth 曲线，干净利落地消失，不要拖泥带水

```
入场: cubic-bezier(0.175, 0.885, 0.32, 1.1)  —  阻尼弹簧，微弱 overshoot（~10%）
退场: cubic-bezier(0.2, 0.8, 0.2, 1)          —  匀速减速
```

例外：高度/尺寸变化（grid-template-rows、width、height）不用 spring，overshoot 会让尺寸回弹抖动。用专门的 ease-out 曲线：

```
cubic-bezier(0.32, 0.72, 0, 1)  —  先快后慢，无回弹
```

### 3. 位移幅度要小

| 属性 | 典型范围 | 超出则过于夸张 |
|------|----------|----------------|
| translateY | 5 ~ 16px | > 20px |
| translateX | 8 ~ 20px | > 30px |
| scale | 0.82 ~ 0.95 | < 0.8 |

动画是"暗示运动方向"，不是"真的在移动"。小幅度让人感到响应快、干脆。

### 4. 时长分级

不要所有动画一个时长。按反馈层级区分：

| 层级 | 时长 | 何时用 |
|------|------|--------|
| 即时反馈 | 80 ~ 120ms | hover 背景色变化、按钮按下回弹 |
| 微交互 | 140 ~ 200ms | 图标切换、淡入淡出、菜单弹出 |
| 状态切换 | 250 ~ 320ms | Tab 切换、开关 toggle、抽屉展开 |
| 面板级 | 350 ~ 400ms | 侧边栏宽度变化、页面路由切换 |

**体感规律**：用户等 200ms 以内感知为"即时"，200-350ms 感知为"流畅过渡"，超过 400ms 开始感觉"慢"。

### 5. opacity 先行

当 opacity 和 transform 同步变化时，opacity 的时长可以比 transform 短 30%~50%。

效果：内容先变得可见（opacity 完成），再滑到最终位置（transform 还在走）。这比两者同步完成看起来更轻快。

### 6. 列表入场用 stagger

列表项不要同时出现。用 `animation-delay` 做逐个入场，间隔 30ms。

```css
animation-delay: calc(var(--i, 0) * 30ms);
```

10 个以内的列表，总入场时间控制在 300ms 以内。超过 10 个的只给前几项做 stagger，后面的直接出现。

---

## 缓动曲线参考

项目预定义了 4 条曲线，对应不同的运动性格：

```css
--ease-default: ease-out;                              /* CSS 默认 ease-out */
--ease-smooth: cubic-bezier(0.2, 0.8, 0.2, 1);       /* 丝滑减速 */
--ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.1); /* 阻尼弹簧，微弱回弹 */
--ease-bounce: cubic-bezier(0.68, -0.6, 0.32, 1.6);   /* 明显弹跳（慎用） */
```

| 曲线 | overshoot | 适用属性 | 不适用 |
|------|-----------|----------|--------|
| smooth | 无 | opacity、background-color、border-color | — |
| spring | ~10% | scale、rotate、translateY（视觉上有惯性但不弹跳） | grid-template-rows（尺寸不应 overshoot） |
| bounce | 60% | 仅限特殊装饰效果（几乎不用） | 常规 UI |
| ease-out | 无 | 高度变化、宽度变化 | — |

---

## 动画模式速查

### 菜单/弹窗弹出

```css
@keyframes popup-enter {
  from { opacity: 0; transform: scale(0.95) translateY(-5px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
/* 用 spring，200ms */
```

已有 class：`.animate-context-menu`

### 内容面板切换

```css
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
/* 用 smooth，380ms */
```

已有 class：`.animate-fade-in-up` / `.animate-fade-in-down`

### 抽屉/手风琴展开

```css
/* 外层用 grid-template-rows 控制高度 */
.drawer-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 300ms cubic-bezier(0.32, 0.72, 0, 1),
              opacity 200ms cubic-bezier(0.32, 0.72, 0, 1);
}
.drawer-wrapper.expanded {
  grid-template-rows: 1fr;
  opacity: 1;
}
/* 内层用 translateY 增加滑动感 */
.drawer-wrapper > .drawer-inner {
  overflow: hidden;
  min-height: 0;
  transform: translateY(-6px);
  transition: transform 300ms cubic-bezier(0.32, 0.72, 0, 1);
}
.drawer-wrapper.expanded > .drawer-inner {
  transform: translateY(0);
}
```

已有 class：`.drawer-wrapper` / `.drawer-inner`

### 图标状态切换

```css
@keyframes icon-pop {
  0%   { transform: scale(0) rotate(-90deg); opacity: 0; }
  60%  { transform: scale(1.2) rotate(10deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
/* 用 spring，350ms */
```

已有 class：`.icon-swap-enter` / `.animate-star-pop`

### 按下反馈

```css
/* 按下时缩小 3~5% */
.btn-press:active {
  transform: scale(0.97);
}
```

已有 class：`.btn-press`

### 列表项逐个入场

```css
.animate-list-item {
  animation: list-item-in 200ms var(--ease-smooth) both;
  animation-delay: calc(var(--i, 0) * 30ms);
}
/* 通过 style="--i: index" 设置序号 */
```

已有 class：`.animate-list-item`

---

## 不要做的事

| 禁止 | 原因 |
|------|------|
| 纯 opacity 动画（不加 transform） | 像闪烁，没有方向感 |
| 纯 transform 动画（不加 opacity） | 像机械位移，不够自然 |
| 超过 400ms 的常规 UI 动画 | 用户会感觉卡顿 |
| spring 用在 height/width/grid-template-rows 上 | 尺寸属性 overshoot = 视觉抖动 |
| 同一时间超过 3 个元素在做不同动画 | 视觉噪音，分散注意力 |
| 退场用 spring 曲线 | 关闭应该是干脆的，不要弹弹弹 |
| translateY 超过 20px | 动画轨迹太长，看起来慢 |
| hover 时加 transform 动画 | hover 只改颜色类属性，不加位移/缩放 |

---

## 新增动画时的自检

- [ ] 是不是 opacity + transform 双层组合？
- [ ] 入场曲线和退场曲线选对了吗？（入场 spring，退场 smooth）
- [ ] 涉及高度/尺寸变化时，是否用了无回弹的 ease-out？
- [ ] 时长是否对得上反馈层级？（hover 120ms，弹窗 200ms，面板 300ms）
- [ ] 位移幅度是否在合理范围内？（translate ≤ 16px，scale ≥ 0.82）
- [ ] 多个属性同时变化时，opacity 是否先于 transform 完成？
