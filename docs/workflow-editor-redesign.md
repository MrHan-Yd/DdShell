# 命令宏编辑器 重设计方案

> 目标：将传统列表式表单（Label + Input 堆叠）升级为两种现代 2D 交互范式，
> 彻底消除"填表感"，让编辑体验接近 Notion / Raycast / Linear 级别的现代效率工具。

---

## 现状问题

当前 `WorkflowEditor.tsx` 存在以下"传统表单"特征：

1. **Label + Input 堆叠**：每个字段都有独立的 Label 行和 Input 行，纵向空间浪费大
2. **三段式隔离**：基础信息 / 参数 / 步骤被硬切为三大 Card，切换上下文成本高
3. **参数区是 Excel 行式**：每行 5 列（Key / Label / Default / Required / Delete），拥挤且不易扫视
4. **操作按钮固化**：删除、添加等操作按钮始终可见，视觉噪音大

---

## 方案概览

| 方案 | 核心理念 | 交互风格 | 适合场景 |
|------|----------|----------|----------|
| **方案 A：沉浸式画布编辑器** | 行内编辑 + 卡片流 + Cmd+K 聚光灯 + 悬停操作 | Notion / Linear 风格 | 偏结构化配置，步骤为主 |
| **方案 B：斜杠命令编辑器** | 输入 `/` 唤出菜单，逐步组装宏 | Notion Block / Raycast 风格 | 偏自由编排，参数灵活 |

---

# 方案 A：沉浸式画布编辑器

## A1. 整体布局

```
┌─────────────────────────────────────────────────────────┐
│  [← 返回]                          [Cmd+K]   [▶ 试运行] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   宏标题（大号行内编辑）                                    │
│   描述（小号行内编辑，灰色占位符）                            │
│                                                         │
│   ┌─ 元信息栏 ─────────────────────────────────────┐    │
│   │  📁 分组: 未分组 ▾    🖥 目标主机: 未指定 ▾      │    │
│   └──────────────────────────────────────────────────┘    │
│                                                         │
│   ══ 步骤流水线 ══════════════════════════════════════    │
│                                                         │
│       ①  Step Title                                    │
│       │  ┌────────────────────────────────────┐        │
│       │  │ echo "Hello {{name}}"              │        │
│       │  │ ↳ 预览: echo "Hello World"          │        │
│       │  └────────────────────────────────────┘        │
│       │                                                 │
│       ②  Step Title                                    │
│       │  ┌────────────────────────────────────┐        │
│       │  │ scp file {{host}}:/tmp              │        │
│       │  └────────────────────────────────────┘        │
│       │                                                 │
│       ┊  + 添加步骤                                     │
│                                                         │
│   ══ 参数 ═════════════════════════════════════════     │
│                                                         │
│   ┌──────────────────────┐  ┌──────────────────────┐   │
│   │  name          ✕      │  │  + 添加参数            │   │
│   │  显示名: 用户名       │  └──────────────────────┘   │
│   │  默认值: World   ○必填│                              │
│   └──────────────────────┘                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 关键布局规则

| 区域 | 规则 |
|------|------|
| 标题 | 不使用 `<label>` + `<Input>` 分行，改为单行大号可编辑文本，`font-size: var(--font-size-xl)`，`font-weight: 600`，无边框，hover 时出现底部分割线 |
| 描述 | 紧跟标题下方，小号灰色可编辑文本。空值时显示淡色占位符"添加描述..."，点击进入编辑，失焦自动保存 |
| 元信息栏 | 水平排列的胶囊式选择器（SegmentedControl / Chip 风格），不换行，不堆叠 |
| 步骤区 | 保留现有纵向 Pipeline 连线，但步骤卡片改为"行内编辑"风格 |
| 参数区 | 从横排 Grid 改为独立卡片，每张卡片是一个参数 |

---

## A2. 行内编辑（Inline Editing）— 去表单化的核心

### 原则
- **无 Label 行**：不写 `<label>` 标签，用 placeholder 充当语义提示
- **无恒定边框**：输入框默认无边框（transparent border），hover 时显示 `border-color: var(--color-border)`，focus 时显示 `border-color: var(--color-border-focus)` + `box-shadow: var(--shadow-focus-ring)`
- **即占即编**：文字区域看起来像普通文本，点击后变成可编辑态

### 标题组件

```tsx
// 替换原有 <label> + <Input> 分行结构
<input
  value={draft.title}
  onChange={(e) => onChange({ ...draft, title: e.target.value })}
  placeholder="输入宏名称"
  className="w-full border-none bg-transparent text-[var(--font-size-xl)] font-semibold
             text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]
             focus:outline-none focus:ring-0"
/>
```

### 描述组件

```tsx
<input
  value={draft.description}
  onChange={(e) => onChange({ ...draft, description: e.target.value })}
  placeholder="添加描述..."
  className="w-full border-none bg-transparent text-[var(--font-size-sm)]
             text-[var(--color-text-secondary)] placeholder:text-[var(--color-text-muted)]
             focus:outline-none focus:ring-0"
/>
```

### 元信息栏（分组 + 目标主机）

不再用两列 `<label>` + `<Select>` 下拉框，改为**胶囊式水平布局**：

```tsx
<div className="flex items-center gap-3 mt-4">
  {/* 分组选择器 - 胶片式 Chip */}
  <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)]
                  bg-[var(--color-bg-elevated)] px-3 py-1.5 text-[var(--font-size-xs)]
                  hover:border-[var(--color-text-muted)] transition-colors cursor-pointer">
    <FolderOpen size={13} className="text-[var(--color-text-muted)]" />
    <Select value={draft.groupId ?? ""} onChange={...} options={[...]}
            className="border-none bg-transparent p-0 text-[var(--font-size-xs)]" />
  </div>

  {/* 目标主机选择器 - 同样风格 */}
  <div className="flex items-center gap-1.5 rounded-full ...">
    <Server size={13} />
    <Select ... />
  </div>
</div>
```

视觉呈现为水平排列的小胶囊，类似 Notion 的 Property Chips：
`[📁 未分组 ▾]  [🖥 未指定 ▾]`

---

## A3. 步骤卡片（Card Flow）升级

### 当前问题
- 每个 StepCard 内部仍有 `<Input>`（标题）和 `<textarea>`（命令）分离的表单结构
- 删除按钮始终占据空间
- 拖拽手柄虽已实现，但视觉上与卡片内容割裂

### 新设计

#### 卡片结构

```
┌──────────────────────────────────────────────┐
│  ⋮⋮   ①   Step Title (行内编辑)    ···     │
│                                              │
│  echo "Hello {{name}}"                       │
│  ↳ 预览: echo "Hello World"                 │
└──────────────────────────────────────────────┘
```

#### 操作按钮 — 悬停才显示

```tsx
<div className="absolute top-3 right-3 flex items-center gap-1
               opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-fast)]">
  <button className="h-6 w-6 rounded-md hover:bg-[var(--color-bg-hover)]
                    flex items-center justify-center">
    <Copy size={13} />
  </button>
  <button className="h-6 w-6 rounded-md hover:bg-[var(--color-error)]/10
                    hover:text-[var(--color-error)] flex items-center justify-center">
    <Trash2 size={13} />
  </button>
</div>
```

**规则**：
- 删除按钮：hover 才出现，默认隐藏
- 复制步骤按钮：hover 才出现（新增功能，便于快速复制步骤）
- 拖拽手柄：保留，但改为 hover 时颜色加深（当前 `opacity: 0.35` → hover `0.7`），整体更克制

#### 命令区 — 代码编辑风格

将 `<textarea>` 的样式强化为终端风格：

```css
.wf-command-editor {
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-control);
  font-family: "SF Mono", "Fira Code", "JetBrains Mono", Menlo, monospace;
  font-size: var(--font-size-sm);
  line-height: 1.6;
  padding: 12px 16px;
  resize: none;
  transition: border-color var(--duration-base) var(--ease-smooth),
              box-shadow var(--duration-base) var(--ease-smooth);
}

.wf-command-editor:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1),
              inset 0 0 0 1px var(--color-accent);
}

/* 变量高亮在代码区中的提示样式 */
.wf-command-editor::placeholder {
  color: var(--color-text-muted);
  opacity: 0.5;
}
```

#### 预览区 — 自动折叠

预览区默认折叠，仅在有变量替换时自动展开：

```tsx
{hasPreview && (
  <div className="drawer-wrapper expanded">
    <div className="drawer-inner">
      <div className="mt-3 rounded-[var(--radius-control)] ...">
        {/* 预览内容 */}
      </div>
    </div>
  </div>
)}
```

利用现有 `drawer-wrapper` CSS 实现平滑收折动画。

---

## A4. 参数区 — 卡片网格

### 当前问题
参数区采用 `grid-cols-[1fr_1fr_1fr_auto_auto]` 的横排 Grid，像 Excel 行，5 列挤在一起，扫视和操作都不方便。

### 新设计 — 卡片网格

每个参数是一张独立的小卡片，2 列网格排列：

```
┌─────────────────────────┐  ┌─────────────────────────┐
│  name                 ✕  │  │  + 添加参数              │
│  显示名: 用户名           │  │                         │
│  默认值: World    ☑ 必填  │  │                         │
└─────────────────────────┘  └─────────────────────────┘
```

#### 参数卡片组件

```tsx
function ParamCard({ param, index, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(!param.key || !param.label);
  // 新参数自动展开，已填好的参数折叠只显示 key

  return (
    <div className="group relative rounded-[var(--radius-card)] border
                    border-[var(--color-border)] bg-[var(--color-bg-surface)]
                    p-4 transition-all hover:border-[var(--color-text-muted)]/30
                    hover:shadow-[var(--shadow-floating)]">

      {/* 折叠态：只显示 key 名 + 必填标记 */}
      <div className="flex items-center justify-between cursor-pointer"
           onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[var(--font-size-sm)]
                           text-[var(--color-accent)]">
            {param.key || '未命名'}
          </span>
          {param.required && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full
                           bg-[var(--color-error)]/10 text-[var(--color-error)]
                           font-medium">必填</span>
          )}
          {param.defaultValue && (
            <span className="text-[var(--font-size-xs)]
                           text-[var(--color-text-muted)] truncate">
              = {param.defaultValue}
            </span>
          )}
        </div>
        {/* 悬停才显示的删除按钮 */}
        <button className="opacity-0 group-hover:opacity-100 ...">
          <Trash2 size={13} />
        </button>
      </div>

      {/* 展开态：完整编辑表单 */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border-subtle)]
                        space-y-2">
          <input value={param.key} placeholder="参数名 (key)"
                 className="w-full border-none bg-[var(--color-bg-base)]
                           rounded-[var(--radius-control)] px-3 py-2 ..." />
          <input value={param.label} placeholder="显示名"
                 className="w-full border-none ..." />
          <div className="flex items-center justify-between">
            <input value={param.defaultValue ?? ''} placeholder="默认值"
                   className="flex-1 border-none ..." />
            <label className="flex items-center gap-2 ml-3 ...">
              <ToggleSwitch checked={param.required} onChange={...} />
              <span>必填</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
```

#### 参数区整体布局

```tsx
<div className="grid grid-cols-2 gap-3">
  {draft.params.map((param, i) => (
    <ParamCard key={`${param.key}-${i}`} param={param} ... />
  ))}
  {/* 添加参数卡片 */}
  <button className="rounded-[var(--radius-card)] border-2 border-dashed
                    border-[var(--color-border)] p-4 text-[var(--color-text-muted)]
                    hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]
                    transition-colors">
    <Plus size={16} />
    <span className="ml-2 text-sm">添加参数</span>
  </button>
</div>
```

**关键改进**：
- 5 列 Grid → 2 列卡片网格
- 已填好的参数 **折叠只显示 key 名和必填标记**，点击展开编辑
- 删除按钮 hover 才出现
- Required 使用 `ToggleSwitch`（已有 CSS 组件 `.toggle-switch`）替代原生 checkbox

---

## A5. Cmd+K 聚光灯搜索

### 功能定义

用户在编辑器内按 `Cmd/Ctrl + K`，弹出居中浮层搜索框，可快速跳转/修改任意字段。

### 交互流程

```
1. 按 Cmd+K → 居中弹出搜索框
2. 输入关键词 → 实时过滤可操作项列表
3. 选择一项 → 跳转并聚焦到对应字段
```

### 可操作项菜单

```typescript
type SpotlightAction = {
  id: string;
  label: string;        // 显示文本
  section: string;      // 分类: "基础信息" | "步骤" | "参数" | "操作"
  icon: React.ReactNode;
  keywords: string[];   // 搜索关键词
  onSelect: () => void; // 执行动作
};

const actions: SpotlightAction[] = [
  // 基础信息
  { id: "edit-title", label: "修改宏名称", section: "基础信息", icon: <Type />, keywords: ["标题", "名称", "title"],
    onSelect: () => titleInputRef.current?.focus() },
  { id: "edit-desc", label: "修改描述", section: "基础信息", icon: <AlignLeft />, keywords: ["描述", "description"],
    onSelect: () => descInputRef.current?.focus() },
  { id: "set-group", label: "设置分组", section: "基础信息", icon: <FolderOpen />, keywords: ["分组", "group"],
    onSelect: () => groupSelectRef.current?.focus() },
  { id: "set-host", label: "设置目标主机", section: "基础信息", icon: <Server />, keywords: ["主机", "host"],
    onSelect: () => hostSelectRef.current?.focus() },

  // 步骤操作
  { id: "add-step", label: "添加步骤", section: "操作", icon: <Plus />, keywords: ["添加", "步骤", "step"],
    onSelect: () => addStep() },
  { id: "add-param", label: "添加参数", section: "操作", icon: <Variable />, keywords: ["添加", "参数", "param"],
    onSelect: () => addParam() },

  // 各步骤跳转
  ...draft.steps.map((step, i) => ({
    id: `goto-step-${i}`, label: `跳转到步骤 ${i + 1}: ${step.title || step.command?.slice(0, 20)}`,
    section: "步骤", icon: <Terminal />, keywords: [`步骤${i+1}`, step.title],
    onSelect: () => stepRefs.current.get(i)?.scrollIntoView({ behavior: 'smooth' }),
  })),

  // 全局操作
  { id: "save", label: "保存", section: "操作", icon: <Save />, keywords: ["保存", "save"],
    onSelect: () => onSave() },
  { id: "cancel", label: "取消编辑", section: "操作", icon: <X />, keywords: ["取消", "cancel"],
    onSelect: () => onCancel() },
];
```

### 组件实现要点

```tsx
function SpotlightOverlay({ actions, onClose }: SpotlightOverlayProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter(a =>
      a.label.toLowerCase().includes(q) ||
      a.keywords.some(k => k.toLowerCase().includes(q))
    );
  }, [query, actions]);

  // 分组渲染
  const grouped = useMemo(() => {
    const map = new Map<string, SpotlightAction[]>();
    for (const a of filtered) {
      const group = map.get(a.section) ?? [];
      group.push(a);
      map.set(a.section, group);
    }
    return map;
  }, [filtered]);

  // 键盘导航：上/下选择，Enter确认，Escape关闭
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
      if (e.key === "Enter") { e.preventDefault(); filtered[selectedIndex]?.onSelect(); onClose(); }
      if (e.key === "Escape") { onClose(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, selectedIndex, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]
                    bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[var(--radius-popover)]
                      bg-[var(--color-bg-surface)] border border-[var(--color-border)]
                      shadow-[var(--shadow-modal)] overflow-hidden"
           onClick={(e) => e.stopPropagation()}>
        {/* 搜索输入框 */}
        <div className="flex items-center border-b border-[var(--color-border)] px-4">
          <Search size={16} className="text-[var(--color-text-muted)]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="搜索命令或字段..."
                 className="flex-1 border-none bg-transparent px-3 py-3 ..."
                 autoFocus />
          <kbd className="text-[10px] ...">ESC</kbd>
        </div>

        {/* 结果列表 */}
        <div className="max-h-64 overflow-y-auto p-2">
          {[...grouped.entries()].map(([section, items]) => (
            <div key={section}>
              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider
                            text-[var(--color-text-muted)] font-medium">{section}</div>
              {items.map((action) => {
                const isActive = filtered.indexOf(action) === selectedIndex;
                return (
                  <div key={action.id}
                       className={cn("flex items-center gap-3 rounded-[8px] px-3 py-2
                                     cursor-pointer transition-colors",
                                    isActive ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                                             : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]")}
                       onClick={() => { action.onSelect(); onClose(); }}
                       onMouseEnter={() => setSelectedIndex(filtered.indexOf(action))}>
                    {action.icon}
                    <span className="text-[var(--font-size-sm)]">{action.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### 键盘监听注册

在 `WorkflowEditor` 组件中：

```tsx
useEffect(() => {
  const onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setSpotlightOpen(true);
    }
  };
  document.addEventListener("keydown", onKeydown);
  return () => document.removeEventListener("keydown", onKeydown);
}, []);
```

### 入口提示

在页面顶部操作栏添加一个搜索/触发按钮：

```tsx
<button onClick={() => setSpotlightOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-[8px]
                   border border-[var(--color-border)] text-[var(--color-text-muted)]
                   text-[var(--font-size-xs)] hover:border-[var(--color-text-muted)]
                   transition-colors">
  <Search size={13} />
  <span>命令面板</span>
  <kbd className="ml-2 ...">⌘K</kbd>
</button>
```

---

## A6. 动画与微交互

| 交互 | 动画 | CSS |
|------|------|-----|
| 参数卡片展开/折叠 | `grid-template-rows` 从 `0fr` → `1fr` | 复用现有 `.drawer-wrapper` |
| 删除步骤/参数 | 向左滑出 + 高度收缩 | `transform: translateX(-20px); opacity: 0; max-height: 0` |
| 添加步骤/参数 | 从中心缩放弹入 | 复用 `@keyframes fade-in-up` |
| Focus 输入框 | 蓝色光环渐显 | `box-shadow: var(--shadow-focus-ring)` + `transition: 140ms` |
| 切换 Required | Toggle 弹性滑动 | 复用现有 `.toggle-switch` + `--ease-spring` |
| Spotlight 打开 | 从 0.95 缩放 + 20px 上移 | `@keyframes fade-in-up` |

### 删除步骤的退出动画

```css
@keyframes step-remove {
  0%   { opacity: 1; transform: translateX(0); max-height: 200px; }
  60%  { opacity: 0; transform: translateX(-20px); }
  100% { opacity: 0; transform: translateX(-20px); max-height: 0; padding: 0; margin: 0; }
}

.wf-step-removing {
  animation: step-remove 300ms var(--ease-smooth) forwards;
  overflow: hidden;
}
```

### 添加步骤的进入动画

```css
@keyframes step-add {
  0%   { opacity: 0; transform: translateY(10px) scale(0.97); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.wf-step-entering {
  animation: step-add 280ms var(--ease-spring) both;
}
```

---

## A7. 保存操作栏升级

当前底部的 `[取消] [创建/更新]` 按钮改为**浮动操作栏**：

```tsx
<div className="sticky bottom-0 z-10 border-t border-[var(--color-border)]
               bg-[var(--color-bg-surface)]/80 backdrop-blur-xl
               px-6 py-3 flex items-center justify-between">
  <Button variant="ghost" onClick={onCancel}>取消</Button>
  <div className="flex items-center gap-3">
    <span className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
      {isDraftDirty ? "有未保存的更改" : ""}
    </span>
    <Button onClick={onSave}>{savingLabel}</Button>
  </div>
</div>
```

**改进要点**：
- 底部 sticky 吸附，不随滚动消失
- 半透明毛玻璃背景（`backdrop-blur-xl`）
- 增加脏状态提示（draft 是否修改过）
- 取消按钮降级为 ghost 样式

---

## A8. 完整的文件修改清单

| 文件 | 修改范围 |
|------|----------|
| `WorkflowEditor.tsx` | 全面重写 JSX 结构：标题/描述改为行内编辑，参数区改为卡片网格，步骤卡片操作改为 hover 显示，添加 SpotlightOverlay 组件 |
| `styles.css` | 新增 `.wf-command-editor`、`.wf-step-removing`、`.wf-step-entering` 等样式 |
| `WorkflowsPage.tsx` | 添加 `Cmd+K` 监听，传递 `spotlightOpen` 状态 |
| `stores/workflows.ts` | 新增 `isDraftDirty()` 辅助函数（对比 draft 与原始 recipe），导出供编辑器使用 |

---

---

# 方案 B：斜杠命令编辑器

## B1. 核心理念

将宏的编辑过程从"填表"变为"写文档"。用户在一个干净的可编辑区域内，通过输入 `/` 逐步插入各种结构化 Block。

**灵感来源**：Notion 的 Block Editor、Linear 的新建 Issue 弹窗。

## B2. 整体布局

```
┌─────────────────────────────────────────────────────────┐
│  [← 返回]                [⌘K]   [▶ 试运行]   [💾 保存] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   输入宏名称...                                          │
│   ┌─────────────────────────────────────────────┐      │
│   │ (可编辑的宏标题，大号字体，无边框)              │      │
│   └─────────────────────────────────────────────┘      │
│                                                         │
│   ┌─────────────────────────────────────────────┐      │
│   │ (可编辑的描述，小号灰色，简约)                 │      │
│   └─────────────────────────────────────────────┘      │
│                                                         │
│   ── 属性 ──────────────────────────────────────       │
│   📁 未分组 ▾   🖥 未指定 ▾                              │
│                                                         │
│   ══ 流水线 ═════════════════════════════════════      │
│                                                         │
│   ┌─────────────────────────────────────────────┐      │
│   │ ①  检查磁盘空间                              │      │
│   │    df -h {{disk}}                            │      │
│   │    ↳ 预览: df -h /                           │      │
│   └─────────────────────────────────────────────┘      │
│                          │                              │
│                          ▼                              │
│   ┌─────────────────────────────────────────────┐      │
│   │ ②  清理临时文件                              │      │
│   │    rm -rf /tmp/{{path}}                      │      │
│   └─────────────────────────────────────────────┘      │
│                          │                              │
│                          ▼                              │
│   ┌─────────────────────────────────────────────┐      │
│   │  /  输入 / 添加步骤或配置...                  │      │
│   └─────────────────────────────────────────────┘      │
│                                                         │
│   ═─ 参数 ═══════════════════════════════════          │
│                                                         │
│   ┌──── name ──────────────────── ✕ ─────────┐       │
│   │  显示名: 用户名                               │       │
│   │  默认值: /        ☑ 必填                      │       │
│   └────────────────────────────────────────────┘       │
│                                                         │
│   ┌──── / 添加参数... ─────────────────────────┐       │
│   └────────────────────────────────────────────┘       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## B3. 斜杠菜单（/ Command Menu）

### 触发方式

在编辑区的**空白行**或**步骤末尾**输入 `/`，弹出斜杠菜单。

### 菜单项

```typescript
type SlashMenuItem = {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  keywords: string[];
};

const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  { id: "add-step",       label: "步骤",       description: "添加一个执行步骤",        icon: <Terminal size={18} />,     keywords: ["step", "命令", "执行"] },
  { id: "add-param",      label: "参数",       description: "添加一个运行时参数",      icon: <Variable size={18} />,      keywords: ["param", "变量", "参数"] },
  { id: "set-group",      label: "分组",       description: "设置宏所属分组",          icon: <FolderOpen size={18} />,    keywords: ["group", "分组", "分类"] },
  { id: "set-host",       label: "目标主机",    description: "设置执行的目标主机",       icon: <Server size={18} />,        keywords: ["host", "主机", "服务器"] },
  { id: "set-desc",       label: "描述",       description: "设置宏的描述信息",        icon: <AlignLeft size={18} />,    keywords: ["desc", "描述", "说明"] },
];
```

### 菜单组件

```tsx
function SlashMenu({ position, onSelect, onClose }: SlashMenuProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!query) return SLASH_MENU_ITEMS;
    const q = query.toLowerCase();
    return SLASH_MENU_ITEMS.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.some(k => k.toLowerCase().includes(q))
    );
  }, [query]);

  return (
    <div className="absolute z-50 w-64 rounded-[var(--radius-popover)]
                    border border-[var(--color-border)] bg-[var(--color-bg-elevated)]
                    shadow-[var(--shadow-floating)] overflow-hidden"
         style={{ top: position.top, left: position.left }}>
      {/* 搜索/过滤 */}
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder="过滤..."
               className="w-full border-none bg-transparent text-[var(--font-size-sm)] ..."
               autoFocus />
      </div>

      {/* 选项列表 */}
      <div className="max-h-48 overflow-y-auto p-1">
        {filtered.map((item, i) => (
          <div key={item.id}
               className={cn("flex items-center gap-3 rounded-[8px] px-3 py-2 cursor-pointer ...",
                              i === selectedIndex ? "bg-[var(--color-accent-subtle)]" : "hover:bg-[var(--color-bg-hover)]")}
               onClick={() => onSelect(item.id)}
               onMouseEnter={() => setSelectedIndex(i)}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg
                           bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]">
              {item.icon}
            </div>
            <div>
              <div className="text-[var(--font-size-sm)] font-medium text-[var(--color-text-primary)]">
                {item.label}
              </div>
              <div className="text-[var(--font-size-xs)] text-[var(--color-text-muted)]">
                {item.description}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### `/` 输入检测

```tsx
// 在步骤末尾的"添加步骤"输入框中
function AddStepInput({ onAddStep }) {
  const [value, setValue] = useState("");
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "/") {
      const rect = e.target.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 4, left: rect.left });
      setShowSlashMenu(true);
      return;
    }
    setValue(val);
  };

  const handleSlashSelect = (id: string) => {
    setShowSlashMenu(false);
    setValue("");
    switch (id) {
      case "add-step": onAddStep(); break;
      case "add-param": onAddParam(); break;
      case "set-group": setGroupSelectOpen(true); break;
      case "set-host": setHostSelectOpen(true); break;
      // ...
    }
  };

  return (
    <div className="relative">
      <input value={value} onChange={handleChange}
             placeholder="/ 添加步骤或配置..."
             className="w-full rounded-[var(--radius-control)] border border-dashed
                        border-[var(--color-border)] bg-[var(--color-bg-surface)]
                        px-4 py-3 text-[var(--font-size-sm)] ..." />
      {showSlashMenu && (
        <SlashMenu position={menuPosition}
                   onSelect={handleSlashSelect}
                   onClose={() => { setShowSlashMenu(false); setValue(""); }} />
      )}
    </div>
  );
}
```

## B4. Block 化的参数编辑

与方案 A 的卡片折叠不同，方案 B 的参数以 **Notion Block 风格**呈现：

```
┌─ Ⓥ name ─────────────────────────────── ✕ ──────────┐
│                                                        │
│  标签   [  用户名          ]                            │
│  默认值 [  /               ]                            │
│  必填   [━━━━●]  (Toggle)                              │
│                                                        │
└────────────────────────────────────────────────────────┘
```

每个参数 Block：
- 标题行：左侧是变量图标 `Ⓥ` + key 名（行内可编辑），右侧是悬停显示的删除按钮
- 内容行：平级排列的 Label / Default / Required 字段，使用行内编辑风格（无显式 `<label>`）

### 参数 Block 组件

```tsx
function ParamBlock({ param, index, onChange, onRemove }) {
  return (
    <div className="group relative rounded-[var(--radius-card)]
                    border border-[var(--color-border)] bg-[var(--color-bg-surface)]
                    p-4 mb-3 transition-all hover:border-[var(--color-text-muted)]/30">
      {/* 标题行 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-5 w-5 items-center justify-center rounded
                         bg-[var(--color-accent-subtle)]">
            <Variable size={12} className="text-[var(--color-accent)]" />
          </div>
          <input value={param.key} onChange={...}
                 placeholder="参数名"
                 className="border-none bg-transparent font-mono
                           text-[var(--font-size-sm)] text-[var(--color-accent)] ..." />
          {param.required && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full
                           bg-[var(--color-error)]/10 text-[var(--color-error)]
                           font-medium">必填</span>
          )}
        </div>
        <button onClick={onRemove}
                className="opacity-0 group-hover:opacity-100 transition-opacity ...">
          <Trash2 size={13} className="text-[var(--color-text-muted)]" />
        </button>
      </div>

      {/* 属性行 */}
      <div className="flex items-center gap-4 pl-7">
        <input value={param.label} placeholder="显示名"
               className="w-28 border-none bg-[var(--color-bg-base)]
                         rounded-[var(--radius-control)] px-2 py-1 ..." />
        <span className="text-[var(--color-text-muted)]">=</span>
        <input value={param.defaultValue ?? ''} placeholder="默认值"
               className="flex-1 border-none bg-[var(--color-bg-base)]
                         rounded-[var(--radius-control)] px-2 py-1 ..." />
        <ToggleSwitch checked={param.required} onChange={...} />
      </div>
    </div>
  );
}
```

## B5. 斜杠命令与方案 A 的 Cmd+K 可以共存

方案 B 的 `/` 斜杠菜单专注于**在光标位置插入新的 Block（步骤、参数）**，
方案 A 的 Cmd+K 专注于**全局快速跳转和操作**。两者角色不冲突：

| 功能 | 方案 A Cmd+K | 方案 B `/` 菜单 |
|------|-------------|----------------|
| 触发方式 | 键盘快捷键 | 输入 `/` 字符 |
| 使用场景 | 快速跳转、全局操作 | 在光标处插入内容 |
| 交互位置 | 居中浮层 | 原地弹出 |
| 可操作性 | 所有字段 + 操作 | 仅限添加新 Block |

**建议**：如果资源允许，两种方案可以同时实现，提供最完整的体验。

## B6. 方案 B 独有的交互细节

### 步骤间的 `/` 触发行

在最后一个步骤之后，始终显示一个默认的 `/ 触发行`：

```tsx
<div className="wf-pipeline-step">
  <div className="wf-pipeline-dot" style={{ borderStyle: 'dashed', borderColor: 'var(--color-text-muted)' }} />
  <input placeholder="/ 添加步骤..."
         className="border-none bg-transparent text-[var(--font-size-sm)]
                    text-[var(--color-text-muted)] placeholder:text-[var(--color-text-muted)]/50 ..."
         onKeyDown={handleStepInputKeyDown} />
</div>
```

这个输入行继承 Pipeline 的连线样式（虚线圆点 + 连线），视觉上与步骤卡片自然衔接。

### 键盘快捷操作

| 快捷键 | 作用 |
|--------|------|
| `/` | 在 `/` 触发行中弹出斜杠菜单 |
| `Enter` | 在 `/` 触发行中直接添加新步骤（跳过菜单） |
| `Cmd+K` | 全局命令面板（可选，与方案 A 共享） |
| `Cmd+Enter` | 保存宏 |
| `Escape` | 关闭斜杠菜单 / 退出编辑 |
| `Tab` | 在步骤卡片的标题和命令输入框之间切换 |

---

## B7. 方案 B 的文件修改清单

| 文件 | 修改范围 |
|------|----------|
| `WorkflowEditor.tsx` | 全面重写：标题/描述行内编辑，步骤区末尾添加 `/` 触发行，新增 `SlashMenu` 组件，参数区改为 `ParamBlock` 组件 |
| `styles.css` | 新增 `.wf-slash-menu`、`.wf-param-block`、`.wf-command-editor` 样式 |
| `WorkflowsPage.tsx` | 如需 Cmd+K 支持则需添加全局监听 |

---

# 两种方案对比

| 维度 | 方案 A（沉浸式画布） | 方案 B（斜杠命令） |
|------|---------------------|-------------------|
| **交互复杂度** | 中 — 主要是现有组件的视觉升级 | 高 — 需要实现斜杠菜单的定位、过滤、键盘导航 |
| **学习成本** | 低 — 接近现有交互，只是视觉更现代 | 中 — 用户需要发现 `/` 功能 |
| **开发工时** | 中（约 3-4 天） | 高（约 5-7 天） |
| **可扩展性** | 好 — 参数区卡片可以轻松加字段 | 优秀 — 新 Block 类型只需加菜单项 |
| **键盘效率** | 中（有 Cmd+K 加持后为高） | 高 — `/` + 键盘导航全键盘操作 |
| **视觉冲击力** | 高 — 去表单化效果显著 | 高 — Notion 级别的现代感 |
| **数据兼容性** | 100% — 数据模型不变 | 100% — 数据模型不变 |

**两种方案的数据模型完全一致**，都是操作 `WorkflowRecipeDraft`，区别仅在 UI 呈现和交互方式。
可以**先实施方案 A 作为基础层**，再**在方案 A 的基础上叠加方案 B 的斜杠菜单**，最终达到最佳体验。

---

# 公共基础改进（两种方案共享）

以下改进无论选择哪个方案都应该实施：

## 1. ToggleSwitch 替换原生 Checkbox

参数区的 `required` 字段当前使用原生 `<input type="checkbox">`，替换为已有 CSS 组件 `.toggle-switch`：

```tsx
<button className="toggle-switch" data-state={param.required ? "on" : "off"}
        onClick={() => { ... }}>
  <span className="toggle-thumb" />
</button>
```

## 2. 键盘快捷键增强

```typescript
// 在 WorkflowEditor 或 WorkflowsPage 中注册
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    // Cmd+Enter 保存
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSave();
    }
    // Escape 取消
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [onSave, onCancel]);
```

## 3. 脏状态检测与提示

在 `WorkflowsPage.tsx` 中增加 draft 与原始 recipe 的对比：

```typescript
function isDraftDirty(draft: WorkflowRecipeDraft, original: WorkflowRecipe | null): boolean {
  if (!original) return true; // create mode
  const originalDraft = workflowRecipeToDraft(original);
  return JSON.stringify(draft) !== JSON.stringify(originalDraft);
}
```

在保存按钮旁显示脏状态指示器，在取消时如果脏状态为 true 则弹出确认对话框（复用 `confirm()` from `stores/confirm`）。

## 4. 步骤卡片的复制功能

新增"复制步骤"按钮（hover 才显示），避免用户需要反复手动输入相似步骤：

```tsx
const handleDuplicateStep = (index: number) => {
  const step = draft.steps[index];
  const newStep: WorkflowRecipeStep = {
    id: crypto.randomUUID(),
    title: step.title ? `${step.title} (副本)` : "",
    command: step.command,
  };
  const next = [...draft.steps];
  next.splice(index + 1, 0, newStep);
  onChange({ ...draft, steps: next });
};
```

## 5. 变量高亮提示

在命令输入区，当用户输入 `{{` 时，显示已有参数列表作为自动补全提示：

```tsx
function CommandTextarea({ value, onChange, params, placeholder }) {
  const [showHints, setShowHints] = useState(false);
  const [cursorInVar, setCursorInVar] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursorPos = e.target.selectionStart;
    // 检测光标是否在 {{ }} 内
    const beforeCursor = val.slice(0, cursorPos);
    const lastOpenBraces = beforeCursor.lastIndexOf("{{");
    const lastCloseBraces = beforeCursor.lastIndexOf("}}");
    setCursorInVar(lastOpenBraces > lastCloseBraces && lastOpenBraces !== -1);
    setShowHints(val.slice(cursorPos - 2, cursorPos) === "{{");
    onChange(e);
  };

  return (
    <div className="relative">
      <textarea value={value} onChange={handleChange} placeholder={placeholder}
                className="wf-command-editor ..." />
      {showHints && params.length > 0 && (
        <div className="absolute left-4 bottom-12 z-10 w-48 rounded-[var(--radius-popover)]
                        border border-[var(--color-border)] bg-[var(--color-bg-elevated)]
                        shadow-[var(--shadow-floating)] p-1">
          {params.map((p) => (
            <button key={p.key} className="w-full text-left px-3 py-1.5 rounded-[6px] ..."
                    onClick={() => insertVariable(p.key)}>
              <span className="font-mono text-[var(--color-accent)]">{{p.key}}</span>
              <span className="ml-2 text-[var(--color-text-muted)] text-xs">{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```