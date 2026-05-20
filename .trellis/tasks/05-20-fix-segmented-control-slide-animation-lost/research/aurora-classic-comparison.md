# Classic vs Aurora SegmentedControl 实现差异（供 implement / check 参考）

> 这是给 sub-agent 注入的上下文，避免它在主仓库里重复查找。
> 任务目标：把 Aurora 实现升级成「带滑块」版本，对齐 Classic 的滑动机制。

---

## Classic 实现（参考样本，**不要修改**）

文件：`app/src/components/ui/SegmentedControl.tsx`

### TSX 关键片段

```tsx
const containerRef = useRef<HTMLDivElement>(null);
const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

useEffect(() => {
  const container = containerRef.current;
  if (!container) return;
  const idx = options.findIndex((o) => o.value === value);
  if (idx < 0) return;
  const btn = container.children[idx + 1] as HTMLElement; // +1 to skip pill div
  if (!btn) return;
  setPillStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
}, [value, options]);

return (
  <div ref={containerRef} className={`segmented-control ${className ?? ""}`}>
    <div className="seg-pill" style={{ left: pillStyle.left, width: pillStyle.width }} />
    {options.map((opt) => (
      <button
        key={opt.value}
        data-active={value === opt.value}
        onClick={() => onChange(opt.value)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
```

### Classic CSS 关键片段（`app/src/styles.css:760-804`）

```css
.segmented-control {
  position: relative;          /* ← 必须，pill 绝对定位的参考系 */
  display: flex;
  padding: 2px;
}
.segmented-control .seg-pill {
  position: absolute;
  top: 2px;
  bottom: 2px;
  transition: left var(--duration-toggle) var(--ease-spring),
              width var(--duration-toggle) var(--ease-spring);
  z-index: 0;
}
.segmented-control button {
  position: relative;
  z-index: 1;
}
```

---

## Aurora 当前实现（**这次要改的**）

文件：`app/src/components/ui/aurora/SegmentedControl.tsx`

当前 DOM：`<div.seg-control><button.seg.is-active>` —— 没有 .seg-pill。
当前 CSS：`app/src/styles/aurora/pages/settings.css:342-367`，active 用
`background: var(--accent-gradient)` 直接刷在 button 上。

---

## 改造原则

1. **DOM 结构对齐 Classic 思路**：在 buttons 之前插 `.seg-pill`，用
   ref + useEffect 计算位置。
2. **类名仍用 Aurora 既有的 `.seg-control` / `.seg`**：不要换成 `.segmented-control`，
   否则会与 Classic 的全局样式冲突且 Aurora 现有 CSS 失效。
3. **active 视觉从 button 转移到 pill**：
   - `.seg.is-active` 去掉 `background`，保留 `color` / `font-weight`
   - `.seg-pill` 上加 `background: var(--accent-gradient)` +
     `box-shadow: 0 0 10px var(--accent-glow)`
4. **transition token 选择**：优先复用 Aurora 已有 motion token；如果没有
   spring 曲线 token，可借用 Classic 的 `--duration-toggle / --ease-spring`
   （已在 `styles.css` 中定义，全局可用）。
5. **保持 z-index 层级**：`.seg-pill` z-index 0，`.seg` 用 `position: relative; z-index: 1`，
   让文字盖在 pill 上。
6. **不要改 `themed/SegmentedControl.tsx` 分发器**。
7. **不要碰 Classic 实现** 与 `app/src/styles.css:760-804`。

---

## 验收要点（供 check agent 用）

- Aurora 主题下 snippets 第二栏排序切换 tab：pill 平滑滑动
- Aurora 主题下 settings 页所有 SegmentedControl：同样获得滑块滑动
- Classic 主题下 SegmentedControl：行为不变（CSS / TSX 都没动）
- 初次挂载 pill 位置正确（覆盖在 active tab 上，不应从 left=0 跳过来）
- 点击响应、键盘焦点、a11y 不变
