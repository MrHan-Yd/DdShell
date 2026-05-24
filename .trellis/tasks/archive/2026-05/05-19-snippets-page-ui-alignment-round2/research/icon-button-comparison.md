# Research: Icon/Button Usage Comparison — Snippets Page vs Design Draft

- **Query**: Find all button/icon usage in SnippetsPage.tsx and snippets.html, compare current vs design draft
- **Scope**: Internal (code + design draft)
- **Date**: 2026-05-19

## Findings

### 1. Lucide Icons Imported in SnippetsPage.tsx

| Line | Icon | Size |
|------|------|------|
| 3 | `Plus` | used at 14 |
| 4 | `Search` | used at 13 |
| 5 | `Code2` | used at 14, 28, 48 |
| 6 | `Trash2` | used at 14 |
| 7 | `Pencil` | used at 14 |
| 8 | `Copy` | used at 12 |
| 9 | `FolderPlus` | used at 16 |
| 10 | `Folder` | used at 14, 16, 24 |
| 11 | `ClipboardCopy` | used at 14 |
| 12 | `FolderInput` | used at 14 |
| 13 | `FolderX` | used at 14, 16 |
| 14 | `X` | used at 14 |
| 15 | `Check` | used at 10, 14 |
| 16 | `ListChecks` | used at 14 |

---

### 2. All Icon Usages in SnippetsPage.tsx (by UI location)

#### Page Header (no icons in current implementation, see comparison below)

None — the page header in the current implementation has no icons.

#### Left Aside — Search Toolbar

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 756 | `Search` | 13 | `<Search size={13} />` | Search input icon |
| 770 | `FolderPlus` | 16 | `<FolderPlus size={16} />` | New group button |

#### Left Aside — Navigation Items

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 777 | `Code2` | 14 | `<Code2 size={14} />` | "All snippets" nav item icon |
| 827 | `Folder` | 14 | `<Folder size={14} />` | Group nav item icon |
| 844 | `FolderX` | 14 | `<FolderX size={14} />` | "Ungrouped" nav item icon |

#### Middle List — Header Actions

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 868 | `X` / `ListChecks` | 14 | Conditional: selectionMode ? `<X>` : `<ListChecks>` | Toggle selection mode |
| 879 | `Plus` | 14 | `<Plus size={14} />` | New snippet button |

#### Middle List — Empty State

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 891 | `Code2` | 28 | `<Code2 size={28} className="mx-auto mb-3 opacity-60" />` | Empty state illustration |

#### Middle List — Batch Delete Bar

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 927 | `Trash2` | 14 | `<Trash2 size={14} />` | Batch delete button |

#### Snippet Card (SnippetCard component)

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 180 | `Check` | 10 | `<Check size={10} />` | Checkbox (selection mode only) |

#### Snippet Detail (SnippetDetail component)

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 237 | `Pencil` | 14 | `<Pencil size={14} />` | Edit button |
| 240 | `Trash2` | 14 | `<Trash2 size={14} className="text-[var(--color-error)]" />` | Delete button |
| 248 | `Copy` | 12 | `<Copy size={12} />` | Copy button in command block |

#### Group Detail (GroupDetail component)

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 410 | `Folder` | 24 | `<Folder size={24} className="text-[var(--color-accent)]" />` | Group detail header icon |
| 415 | `Pencil` | 14 | `<Pencil size={14} />` | Rename group button |
| 418 | `Trash2` | 14 | `<Trash2 size={14} className="text-[var(--color-error)]" />` | Delete group button |

#### Move To Group Modal

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 346 | `X` | 14 | `<X size={14} />` | Close modal button |
| 364 | `FolderX` | 16 | `<FolderX size={16} className=.../>` | "No group" option icon |
| 379 | `Folder` | 16 | `<Folder size={16} className=.../>` | Group option icon |
| 382 | `Check` | 14 | `<Check size={14} className="text-[var(--color-accent)]" />` | Selected group checkmark |

#### Context Menu — Snippet

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 561 | `Pencil` | 14 | `icon: <Pencil size={14} />` | Edit snippet |
| 566 | `Trash2` | 14 | `icon: <Trash2 size={14} />` | Delete group |
| 584 | `Pencil` | 14 | `icon: <Pencil size={14} />` | Edit snippet |
| 593 | `ClipboardCopy` | 14 | `icon: <ClipboardCopy size={14} />` | Copy snippet |
| 604 | `FolderInput` | 14 | `icon: <FolderInput size={14} />` | Move to group |
| 612 | `Trash2` | 14 | `icon: <Trash2 size={14} />` | Delete snippet |

#### Context Menu — Group

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 561 | `Pencil` | 14 | `icon: <Pencil size={14} />` | Rename group |
| 566 | `Trash2` | 14 | `icon: <Trash2 size={14} />` | Delete group |

#### Right Detail — Empty State

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 1019 | `Code2` | 48 | `<Code2 size={48} className="mx-auto mb-4 text-[var(--color-text-muted)]" />` | Empty state illustration |

#### Drag Ghost

| Line | Current Icon | Size | Component | Role |
|------|-------------|------|-----------|------|
| 1049 | `Code2` | 14 | `<Code2 size={14} className="text-[var(--color-accent)]" />` | Drag ghost icon |

---

### 3. All Icon/SVG Usages in Design Draft (snippets.html)

#### Page Overlay — Back Button

| Line | SVG Path Keywords | Inferred Lucide Icon | Size | stroke-width |
|------|-------------------|---------------------|------|-------------|
| 20 | `line 19,12→5,12` + `polyline 12 19 5 12 12 5` | **ArrowLeft** | 14×14 | 2 |

#### Theme Toggle

| Line | SVG Path Keywords | Inferred Lucide Icon | Size | stroke-width |
|------|-------------------|---------------------|------|-------------|
| 24 | `path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"` | **Moon** | 12×12 | 2 |
| 25 | `circle cx=12 cy=12 r=4` + rays | **Sun** | 12×12 | 2 |

#### Sidebar Brand Logo

| Line | SVG Path Keywords | Inferred Lucide Icon | Size | stroke-width |
|------|-------------------|---------------------|------|-------------|
| 40 | `polyline 4 17 10 11 4 5` + `line 12,19→20,19` | **Terminal** | 16×16 | 2.4 |

#### Sidebar Nav Items

| Line | SVG Path Keywords | Inferred Lucide Icon | Label | Size | stroke-width |
|------|-------------------|---------------------|-------|------|-------------|
| 44 | `rect` + dots | **Server** | Connections | 16×16 | 1.8 |
| 45 | `polyline 4 17 10 11 4 5` + `line` | **Terminal** | Terminal | 16×16 | 1.8 |
| 46 | `path d="M22 19a2 2 0 0 1-2 2H4..."` | **Folder** | SFTP | 16×16 | 1.8 |
| 47 | `polyline 22 12 18 12 15 21 9 3 6 12 2 12` | **Activity** | Monitor | 16×16 | 1.8 |
| 48 | `polyline 16 18 22 12 16 6` + `8 6 2 12 8 18` | **Code2** | Snippets | 16×16 | 1.8 |
| 49 | `rect` grid 2×2 | **LayoutGrid** | Workflows | 16×16 | 1.8 |
| 53 | `circle r=3` + gear path | **Settings** | Settings | 16×16 | 1.8 |

#### Page Header Actions

| Line | SVG Path Keywords | Inferred Lucide Icon | Label | Size | stroke-width |
|------|-------------------|---------------------|-------|------|-------------|
| 66 | `path M21 15v4a2` + `polyline 17 8 12 3 7 8` + `line 12,3→12,15` | **Upload** | Import | 13×13 | 2 |
| 70 | `line x1=12,y1=5 x2=12,y2=19` + `line x1=5,y1=12 x2=19,y2=12` | **Plus** | New snippet | 13×13 | 2.2 |

#### Left Aside — Search Toolbar

| Line | SVG Path Keywords | Inferred Lucide Icon | Role | Size | stroke-width |
|------|-------------------|---------------------|------|------|-------------|
| 82 | `circle cx=11 cy=11 r=8` + `line 21,21→16.65,16.65` | **Search** | Input icon | 13×13 | 2 |

#### Left Aside — Library Navigation Items

| Line | SVG Path Keywords | Inferred Lucide Icon | Label | Size | stroke-width |
|------|-------------------|---------------------|-------|------|-------------|
| 89 | `polyline 16 18 22 12 16 6` + `8 6 2 12 8 18` | **Code2** | All snippets | 14×14 | 1.8 |
| 94 | `polygon points="12 2 15 8 22 9 17 14 18 21 12 17 6 21 7 14 2 9 9 8 12 2"` | **Star** | Favorites | 14×14 | 1.8 |
| 99 | `polyline 1 4 1 10 7 10` + `path M3.51 15a9 9 0 1 0...` | **RotateCcw** | Recent | 14×14 | 1.8 |

#### Left Aside — Group Navigation Items

| Line | SVG Path Keywords | Inferred Lucide Icon | Label | Size | stroke-width |
|------|-------------------|---------------------|-------|------|-------------|
| 106, 111, 116, 121 | `path d="M22 19a2 2 0 0 1-2 2H4..."` | **Folder** | Group item | 14×14 | 1.8 |

#### Snippet Card — Favorite Star

| Line | SVG Path Keywords | Inferred Lucide Icon | Role | Size | fill |
|------|-------------------|---------------------|------|------|------|
| 142 | `polygon points="12 2 15.09 8.26 22 9.27..."` | **Star** (filled) | Card favorite indicator | 11×11 | currentColor (var(--warning)) |

#### Snippet Detail — Action Buttons

| Line | SVG Path Keywords | Inferred Lucide Icon | Title | Size | stroke-width |
|------|-------------------|---------------------|-------|------|-------------|
| 219 | `polygon points="12 2 15.09 8.26..."` | **Star** (filled) | Favorite | 14×14 | fill=currentColor |
| 220 | `path d="M11 4H4a2..."` + `path d="M18.5 2.5a2.121..."` | **Pencil** (Lucide: Edit3/Edit2 → Pencil) | Edit | 14×14 | 1.8 |
| 221 | `polyline 3 6 5 6 21 6` + `path d="M19 6l-1 14a2..."` | **Trash2** | Delete | 14×14 | 1.8 |

#### Command Block — Copy Button

| Line | SVG Path Keywords | Inferred Lucide Icon | Label | Size | stroke-width |
|------|-------------------|---------------------|-------|------|-------------|
| 231 | `rect x=9 y=9 w=13 h=13 rx=2` + `path d="M5 15H4a2..."` | **Copy** | Copy | 12×12 | 1.8 |

#### Run Section — Buttons

| Line | SVG Path Keywords | Inferred Lucide Icon | Label | Size | stroke-width |
|------|-------------------|---------------------|-------|------|-------------|
| 258 | `polygon points="5 3 19 12 5 21 5 3"` | **Play** | Run on... | 14×14 | 2.2 |
| 263 | `polyline 4 17 10 11 4 5` + `line 12,19→20,19` | **Terminal** | Insert into terminal | 14×14 | 2 |

#### Run Section — Info Hint

| Line | SVG Path Keywords | Inferred Lucide Icon | Role | Size | stroke-width |
|------|-------------------|---------------------|------|------|-------------|
| 267 | `circle cx=12 cy=12 r=10` + `line 12,16→12,12` + `line 12,8→12.01,8` | **Info** | Read-only hint | 13×13 | 2 |

---

### 4. Structured Comparison Table

| UI Location | Design Draft Icon | Design Line | Current Icon | Current Line | Match? | Notes |
|---|---|---|---|---|---|---|
| **Page header — Import button** | **Upload** | 66 | *(not present)* | — | ❌ MISSING | Design has Import/Upload button; current has no import button in page header |
| **Page header — New snippet** | **Plus** (size 13, stroke-width 2.2) | 70 | **Plus** (size 14) | 879 | ⚠️ SIZE | Icon matches; size differs (13→14), stroke-width differs (2.2 vs default 2) |
| **Left aside — Search input** | **Search** (size 13, stroke-width 2) | 82 | **Search** (size 13) | 756 | ✅ | Exact match |
| **Left aside — New group button** | *(not present in design)* | — | **FolderPlus** (size 16) | 770 | ⚠️ EXTRA | Design draft doesn't show a "new group" button in aside toolbar |
| **Left aside — "All snippets" nav** | **Code2** (size 14, stroke-width 1.8) | 89 | **Code2** (size 14) | 777 | ⚠️ STROKE | Icon matches; stroke-width differs (1.8 vs default 2) |
| **Left aside — "Favorites" nav** | **Star** (size 14, stroke-width 1.8) | 94 | *(not present)* | — | ❌ MISSING | Design has Favorites nav item; current doesn't have it |
| **Left aside — "Recent" nav** | **RotateCcw** (size 14, stroke-width 1.8) | 99 | *(not present)* | — | ❌ MISSING | Design has Recent nav item; current doesn't have it |
| **Left aside — Group nav items** | **Folder** (size 14, stroke-width 1.8) | 106–121 | **Folder** (size 14) | 827 | ⚠️ STROKE | Icon matches; stroke-width differs (1.8 vs default 2) |
| **Left aside — "Ungrouped" nav** | *(not present in design)* | — | **FolderX** (size 14) | 844 | ⚠️ EXTRA | Not in design draft |
| **Middle list — Selection mode toggle** | *(not present in design)* | — | **ListChecks** / **X** (size 14) | 868 | ⚠️ EXTRA | Not in design draft (feature-specific, ok) |
| **Middle list — Seg control** | *(text only, no icons)* | 133–135 | *(text only)* | — | ✅ | No icons on either side |
| **Snippet card — Favorite star** | **Star** filled (size 11, fill=currentColor) | 142 | *(not present)* | — | ❌ MISSING | Design shows filled star on favorited cards; current doesn't |
| **Snippet card — Checkbox** | *(not present in design)* | — | **Check** (size 10) | 180 | ⚠️ EXTRA | Feature-specific, ok |
| **Snippet detail — Favorite button** | **Star** filled (size 14, fill=currentColor) | 219 | *(not present)* | — | ❌ MISSING | Design has Favorite/Star button; current detail only has Edit+Delete |
| **Snippet detail — Edit button** | **Pencil** (size 14, stroke-width 1.8) | 220 | **Pencil** (size 14) | 237 | ⚠️ STROKE | Icon matches; stroke-width differs (1.8 vs default 2) |
| **Snippet detail — Delete button** | **Trash2** (size 14, stroke-width 1.8) | 221 | **Trash2** (size 14) | 240 | ⚠️ STROKE | Icon matches; stroke-width differs (1.8 vs default 2) |
| **Command block — Copy button** | **Copy** (size 12, stroke-width 1.8) | 231 | **Copy** (size 12) | 248 | ⚠️ STROKE | Icon matches; stroke-width differs (1.8 vs default 2) |
| **Run section — Run button** | **Play** (size 14, stroke-width 2.2) | 258 | *(not present)* | — | ❌ MISSING | Design has Play/Run button; current doesn't have run section |
| **Run section — Insert into terminal** | **Terminal** (size 14, stroke-width 2) | 263 | *(not present)* | — | ❌ MISSING | Design has "Insert into terminal" button; current doesn't |
| **Run section — Info hint** | **Info** (size 13, stroke-width 2) | 267 | *(not present)* | — | ❌ MISSING | Design has info hint; current doesn't |
| **Snippet detail empty state** | *(not in static design)* | — | **Code2** (size 48) | 1019 | N/A | Dynamic state, not in static design |
| **Context menus** | *(not in static design)* | — | Pencil, Trash2, ClipboardCopy, FolderInput | 561–612 | N/A | Not in static HTML design |
| **Move to group modal** | *(not in static design)* | — | X, FolderX, Folder, Check | 346–382 | N/A | Not in static HTML design |
| **Drag ghost** | *(not in static design)* | — | **Code2** (size 14) | 1049 | N/A | Not in static HTML design |

---

### 5. Icon-Related Styles

#### From `ui/styles/pages/snippets.css`

| Line(s) | Selector | Description |
|---------|----------|-------------|
| 102 | `.snip-card-fav` | `display: inline-flex;` — container for favorited star SVG on cards |
| 168 | `.snip-detail-actions` | `display: inline-flex; gap: var(--space-1); flex-shrink: 0;` — detail action buttons container |
| 238 | `.snip-run .btn-lg` | `gap: var(--space-2);` — gap between icon and label in Run buttons |
| 242–248 | `.snip-run-hint` | `display: inline-flex; align-items: center; gap: 6px;` — icon + text alignment for info hint |

#### From `ui/styles/components.css`

| Line(s) | Selector | Description |
|---------|----------|-------------|
| 51–55 | `.btn-icon` | `width: 28px; height: 28px; padding: 0; border-radius: var(--radius-sm);` — icon-only button sizing |
| 56–57 | `.btn-icon.btn-ghost` | `color: var(--fg-muted);` → hover `color: var(--fg-primary);` — ghost icon button styling |
| 82–86 | `.input-with-icon` / `.input-icon` | `padding-left: 32px;` — input with left icon offset |
| 203–204 | `.list-item .icon` | `color: var(--fg-muted); flex-shrink: 0;` — nav list item icon color |
| 204 | `.list-item.is-active .icon` | `color: var(--accent);` — active nav item icon color |

#### From `ui/styles/layout.css`

| Line(s) | Selector | Description |
|---------|----------|-------------|
| 126 | `.nav-item .icon` | Sidebar nav icon sizing/alignment |
| 131 | `.nav-item.is-active .icon` | `color: var(--accent);` — active sidebar nav icon |

---

### 6. Summary of Key Differences

#### Missing in Current (Present in Design)

1. **Star/Favorite icon on snippet cards** (line 142 in design — filled star, size 11)
2. **Star/Favorite button in snippet detail** (line 219 in design — filled star, size 14)
3. **Upload/Import button in page header** (line 66 in design)
4. **"Favorites" nav item** with Star icon (line 94 in design)
5. **"Recent" nav item** with RotateCcw icon (line 99 in design)
6. **Run/Play button** (line 258 in design)
7. **"Insert into terminal" button** with Terminal icon (line 263 in design)
8. **Info hint icon** (line 267 in design)

#### Extra in Current (Not in Design)

1. **FolderPlus** button for creating groups (line 770)
2. **FolderX** for "Ungrouped" nav (line 844)
3. **ListChecks / X** for selection mode toggle (line 868)
4. **ClipboardCopy** in context menu (line 593)
5. **FolderInput** for "Move to group" in context menu (line 604)

#### Stroke-Width Mismatches

Design draft consistently uses `stroke-width: 1.8` for 14px icons in the left aside and detail actions, while lucide-react defaults to `strokeWidth: 2`. The design also uses `stroke-width: 2.2` for Plus and Play buttons.

| Icon Size | Design stroke-width | Lucide default | Affected Locations |
|-----------|---------------------|----------------|-------------------|
| 14px (aside nav, detail actions) | 1.8 | 2 | Code2, Star, RotateCcw, Folder, Pencil, Trash2, Copy |
| 13px (header, search) | 2 | 2 | Search, Upload, Plus — mostly aligned |
| 14px (Run/Play) | 2.2 | 2 | Play button |
| 13px (Plus "New snippet") | 2.2 | 2 | Plus button in page header |
| 16px (sidebar nav) | 1.8 | 2 | All sidebar nav icons |

---

### Related Specs

- `.trellis/spec/frontend/index.md` — frontend guidelines (may contain icon conventions)

## Caveats / Not Found

1. Design draft is a **static HTML mockup** — it doesn't represent all dynamic states (context menus, modals, drag ghost, selection mode, empty states). Missing those in the design is expected, not a problem.
2. Some "extra" icons in current (FolderPlus, FolderX, ListChecks, etc.) are **feature additions beyond the design scope**. These should only be aligned if the PRD explicitly calls for it.
3. The design draft's `snippets.html` includes sidebar nav items and page overlay (Back button, theme toggle) that may be shared layout components, not snippet-page-specific.
4. Lucide `strokeWidth` prop defaults to 2; the design uses 1.8 for many 14px icons — this requires explicit `strokeWidth={1.8}` on each icon component to match the design.