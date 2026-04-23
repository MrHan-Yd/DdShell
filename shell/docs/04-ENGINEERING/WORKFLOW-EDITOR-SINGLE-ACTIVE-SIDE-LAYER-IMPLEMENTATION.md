# 命令宏编辑器：单活跃侧边层实现细节

## 1. 背景
- 当前编辑器左侧已经是可开关的步骤导航抽屉（Step Navigator）。
- 若直接新增右侧参数抽屉，并允许左右同时展开，会造成主内容注意力分裂与交互负担上升。
- 目标是保留现有布局优势，同时让参数编辑位置更合理、现代，不再依赖页面底部参数区。

## 2. 设计结论（最终推荐）
- 采用 **单活跃侧边层（Single Active Side Layer）**：同一时刻只允许左侧或右侧其中一个侧边层打开。
- 左侧层：`Step Navigator`（步骤选择与排序入口）。
- 右侧层：`Param Inspector`（参数编辑入口）。
- 中央主区始终优先，不被双侧同时挤压。

## 3. 布局与断点规则
- `< 1200px`：严格单活跃侧边层；默认都关闭；按需打开。
- `1200px - 1599px`：仍默认单活跃；允许用户固定左侧（可选），右侧保持抽屉。
- `>= 1600px`：允许左侧常驻（可选）+ 右侧抽屉；仍不建议左右同时抽屉态展开。

建议宽度：
- 左侧导航层：`280px` 内容宽 + `tab` 触发条。
- 右侧参数层：默认 `380px`，可拖拽范围 `360px - 480px`。
- 中央主区最小可视宽度：`900px`（低于该值时禁止固定双侧）。

## 4. 交互状态机

### 4.1 状态定义
```ts
type SideLayer = "none" | "steps" | "params";

interface EditorSideLayerState {
  active: SideLayer;              // 当前活跃侧边层
  pinnedLeft: boolean;            // 左侧是否固定（仅宽屏可用）
  paramWidth: number;             // 右侧参数层宽度
  lastActive: Exclude<SideLayer, "none">; // 用于恢复上次面板
}
```

### 4.2 事件优先级
- `OPEN_STEPS`：
  - 若 `active === "params"`，先关闭右侧，再打开左侧。
  - 结果：`active = "steps"`。
- `OPEN_PARAMS`：
  - 若 `active === "steps"`，先关闭左侧，再打开右侧。
  - 结果：`active = "params"`。
- `TOGGLE_STEPS` / `TOGGLE_PARAMS`：
  - 当前已开则关闭到 `none`，否则按上面规则切换。
- `ESC`：关闭当前活跃层（`active -> none`）。
- `SELECT_STEP`（在左层内选中步骤）：
  - 在 `<1200px` 下自动收起左层（减少遮挡）。
  - 在宽屏可保持打开。

## 5. 组件与文件改造建议

## 5.1 `WorkflowEditor.tsx`
- 新增状态：
  - `activeSideLayer: "none" | "steps" | "params"`
  - `paramDrawerWidth: number`
  - `leftPinned: boolean`（可选）
- 保留现有 `StepDrawerTab`，但点击逻辑改为状态机事件。
- 新增 `ParamDrawerTab`（与 Step Tab 视觉语言一致，但中性配色）。
- 将现有底部参数区替换为右侧 `ParamInspectorDrawer` 内容。
- 在移动端保留顶部/就近触发入口，行为一致（单活跃）。

## 5.2 样式（`app/src/styles.css`）
- 沿用当前抽屉命名风格，新增：
  - `.param-drawer-shell`
  - `.param-drawer-panel`
  - `.param-drawer-resizer`
- 保持无发光、无模糊、无高饱和渐变，避免再次出现 halo/glow。

## 5.3 i18n（`app/src/lib/i18n.ts`）
- 建议新增 key：
  - `workflows.showParamsInspector`
  - `workflows.hideParamsInspector`
  - `workflows.paramInspector`
  - `workflows.paramInspectorDesc`

## 6. 动效规范（对齐 animation-guide）
- 参考：`app/docs/animation-guide.md`。
- 侧边层采用双层动画：
  - `shell` 负责尺寸/占位过渡。
  - `panel` 负责位移（轻微）与细节过渡。
- 打开：
  - 位移使用 spring 风格（短距离，无夸张弹跳）。
  - 时长建议 `220ms - 280ms`。
- 关闭：
  - 平滑收束（ease-out / smooth），不做反向弹跳。
  - 时长建议比打开略长 `260ms - 320ms`，避免突兀。
- 禁止项：
  - 在宽度收起过程中叠加 panel opacity 淡出（容易闪烁）。
  - backdrop blur + 渐变叠加（容易产生“发光边缘”错觉）。

## 7. 参数 Inspector 内容结构
- 顶部：步骤名、步骤编号、简要说明。
- 搜索区：字段关键字过滤（字段多时可快速定位）。
- 参数分组（折叠）：
  - 必填参数（默认展开）
  - 常用参数（默认展开）
  - 高级参数（默认折叠）
- 底部固定操作：应用、重置、查看 JSON。
- 字段状态标记：已配置 / 缺失 / 类型不匹配。

## 8. 可访问性与键盘
- 快捷键：
  - `[` 打开步骤层。
  - `]` 打开参数层。
  - `Esc` 关闭当前活跃层。
- 焦点管理：
  - 打开层后焦点进入层内首个可交互控件。
  - 关闭层后焦点回到触发按钮。
- ARIA：
  - Tab 按钮带 `aria-expanded`、`aria-controls`。
  - 抽屉面板使用语义化 `region` 并绑定标题。

## 9. 持久化策略
- 本地持久化（localStorage）：
  - `workflow.editor.sideLayer.lastActive`
  - `workflow.editor.sideLayer.paramWidth`
  - `workflow.editor.sideLayer.leftPinned`
- 恢复规则：
  - 仅恢复用户偏好，不在进入编辑器时自动打开面板。
  - 避免首次进入被抽屉遮挡。

## 10. 实施步骤（建议顺序）
1. 抽离侧边层状态机（先不改 UI）。
2. 接入左侧导航逻辑，验证单活跃切换。
3. 新建右侧参数层骨架（先迁移现有参数编辑内容）。
4. 增加右侧拖拽宽度与持久化。
5. 完成快捷键、焦点管理与 ARIA。
6. 按断点联调并做视觉微调（无 glow）。

## 11. 验收标准（DoD）
- 任意时刻最多一个侧边层处于打开态。
- 中央步骤编辑区在常见分辨率下不被压缩到不可用。
- 参数编辑不再依赖滚动到底部，步骤选择与参数修改可在同一视线区域完成。
- 收起动画无闪烁；展开/收起节奏符合 `animation-guide`。
- 键盘与鼠标路径均可完整完成：选步骤 -> 改参数 -> 保存。

## 12. 风险与回滚
- 风险：状态切换条件复杂导致边界闪动。
  - 处理：先以纯状态机和单元测试覆盖事件转换。
- 风险：断点下布局冲突。
  - 处理：以 `900px` 主区最小宽做保护，超限自动回退抽屉模式。
- 回滚策略：
  - 保留旧参数区实现分支；若新抽屉体验不达标，可快速回滚到内联参数区。
