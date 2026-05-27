# 对齐连接管理页面 UI 样式与布局

## Goal

将 ConnectionsPage 的 UI 尽量完整对齐 `ui/connections.html` 设计稿，包括样式、布局和新增设计稿中有但代码中缺失的 UI 元素。**只动样式和布局，保持所有功能逻辑不变。**

## What I already know

* 设计稿: `ui/connections.html` + `ui/styles/pages/connections.css`
* 实际代码: `app/src/features/connections/ConnectionsPage.tsx` + `app/src/styles/aurora/pages/connections.css`
* 设计稿使用 `data-page="connections"` 的纯 HTML，实际代码用 React + Tailwind + CSS variables

## Key Differences (Mockup vs Code)

### Aside toolbar
- Mockup: 3 buttons (search, new group, batch select)
- Code: 5 buttons (+ Import SSH, + New connection)
- **Decision**: Keep all 5 functional buttons, just align styling

### Detail header
- Mockup: has `badge badge-success` with `dot dot-success` showing "Connected" status
- Code: only title + favorite/edit/delete buttons, no status badge
- **Action**: Add status badge (green dot + "Connected" text)

### Detail card - Auth & Group fields
- Mockup: Auth and Group rendered as `tag` components with icons
- Code: plain text
- **Action**: Render Auth type and Group as tags with icons

### Tags section
- Mockup: has `detail-tags` row with tag labels
- Code: no tags section
- **Action**: Add detail-tags section (using host metadata or placeholder tags)

### Status hint
- Mockup: icon + "Password saved · last verified 12 min ago"
- Code: simple text
- **Action**: Add check-circle icon + styled hint text

### CTA buttons
- Mockup: 2-column grid with kbd shortcuts (⌘↵ for Connect)
- Code: vertical stacked buttons, no kbd
- **Action**: Change to 2-column grid, add kbd shortcut hints

### Recent activity
- Mockup: `detail-activity` section with `activity-list` showing timed events
- Code: no activity section
- **Action**: Add detail-activity section

## Acceptance Criteria

- [ ] Detail header shows status badge (green dot + "Connected")
- [ ] Auth and Group fields rendered as tag components
- [ ] detail-tags section present
- [ ] detail-hint styled with check-circle icon
- [ ] CTA buttons use 2-column grid layout with kbd shortcuts
- [ ] detail-activity section present
- [ ] Aside toolbar keeps all 5 buttons (functional unchanged)
- [ ] All existing functionality preserved: drag-and-drop, context menus, batch selection, create/edit forms, SSH import
- [ ] No behavioral changes, only style/layout additions

## Out of Scope

* Adding real activity data from backend (use placeholder data)
* Adding real tags data from backend (use placeholder data)
* Real-time connection status from backend
* Changing any store/API logic

## Technical Notes

* Files to modify: `ConnectionsPage.tsx`, `connections.css`
* The design mockup CSS uses bare class names (`.host-item`, `.detail-cta`), the prod CSS uses `[data-ui-theme="aurora"]` prefix
* The design mockup has a sidebar + titlebar shell that the real app handles separately
* Tags and activity data will need placeholder/mock data until backend supports them
* Must use `<svg>` inline icons from lucide-react, NOT design mockup's raw SVGs