# Research: Border/Border-Style Comparison — Design Draft vs Current Implementation

- **Query**: Thorough border/border-style comparison between design draft and current implementation for ALL snippet components
- **Scope**: Internal (design draft `ui/` vs current `app/src/`)
- **Date**: 2026-05-19

---

## Token Reference

### Design Draft Tokens (`ui/styles/tokens.css`)

| Token | Dark Value | Light Value |
|-------|-----------|-------------|
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | `rgba(20, 21, 27, 0.06)` |
| `--border-default` | `rgba(255, 255, 255, 0.10)` | `rgba(20, 21, 27, 0.10)` |
| `--border-strong` | `rgba(255, 255, 255, 0.16)` | `rgba(20, 21, 27, 0.18)` |
| `--radius-xs` | `4px` | same |
| `--radius-sm` | `6px` | same |
| `--radius-md` | `8px` | same |
| `--radius-lg` | `12px` | same |
| `--radius-xl` | `16px` | same |
| `--radius-pill` | `999px` | same |

### Current App Tokens (`app/src/styles.css`)

| Token | Dark Value | Light Value |
|-------|-----------|-------------|
| `--color-border` | `#22283A` | `#E5E7EB` |
| `--color-border-subtle` | `#1A1F2E` | `#F0F1F3` |
| `--color-border-focus` | `#3B82F6` | `#3B82F6` |
| `--radius-tiny` | `8px` | same |
| `--radius-control` | `10px` | `12px` (aurora) |
| `--radius-card` | `12px` | `18px` (aurora) |
| `--radius-popover` | `14px` | same |
| `--radius-sm` | (from aurora) `6px` | same |

**Key observation**: The design draft uses semantic token names (`--border-subtle`, `--border-default`, `--border-strong`) with rgba values. The current app uses semantic tokens (`--color-border`, `--color-border-subtle`) with opaque hex values. The actual visual values differ significantly:
- `--border-subtle` (draft dark) = `rgba(255,255,255,0.06)` ≈ subtle semi-transparent white
- `--color-border-subtle` (app dark) = `#1A1F2E` ≈ very dark semi-opaque blue-gray

---

## Complete Comparison Table

### 1. Page Overlay / Floating Buttons

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.page-overlay .btn` | `border` | `1px solid var(--border-subtle)` | *(not present — no page-overlay in snippets page)* | ❌ MISSING | snippets.css:14 | — |

**Note**: Page overlay is not implemented in the current snippets page; it only exists in the design draft HTML for the back button + theme toggle.

---

### 2. Left Aside (`snip-aside`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-aside` | `border-right` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | snippets.css:28 | styles.css:4243 |
| `.snip-aside .aside-toolbar` | `border-bottom` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | snippets.css:36 | styles.css:4254 |

**Assessment**: Border widths and styles match (`1px solid`). Token names differ (`--border-subtle` vs `--color-border-subtle`) and their resolved values differ. Design draft uses semi-transparent rgba; current app uses opaque hex. Visually similar but technically different.

---

### 3. Left Aside — Navigation Items (`snip-nav-item` / `list-item`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.list-item` | `border-radius` | `var(--radius-md)` = `8px` | N/A (uses `.snip-nav-item`) | — | components.css:195 | — |
| `.snip-nav-item` | `border` | Not specified (list-item has no border) | `1px solid transparent` | ⚠️ EXTRA BORDER | — | styles.css:4319 |
| `.snip-nav-item` | `border-radius` | `var(--radius-md)` = `8px` | `8px` (was `var(--radius-control)` = 10px, updated in PRD req #10) | ✅ FIXED | — | styles.css:4321 |
| `.snip-nav-item:hover` | `border-color` | N/A | N/A | — | — | — |
| `.snip-nav-item.is-active` | `border-color` | N/A | N/A | — | — | — |
| `.snip-nav-item.is-drop-target` | `border-color` | N/A | `var(--color-accent)` | EXTRA | — | styles.css:4341 |
| `.snip-nav-item.is-drop-target` | `border-style` | N/A | `dashed` | EXTRA | — | styles.css:4342 |

**Assessment**: Design draft `list-item` has NO border (uses background highlight only). Current implementation adds a transparent border that becomes visible on drop-target. This is feature-specific (drag-and-drop), not a visual mismatch with design.

---

### 4. Middle List (`snip-list`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-list` | `border-right` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | snippets.css:50 | styles.css:4384 |
| `.snip-list-head` | `border-bottom` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | snippets.css:61 | styles.css:4399 |
| `.snip-list-head .seg-control` | `border` | `1px solid var(--border-default)` | *(not implemented — seg-control not in current)* | ❌ MISSING | snippets.css:274 | — |
| `.snip-list-head .seg-control` | `border-radius` | `var(--radius-md)` = `8px` | *(not implemented)* | ❌ MISSING | snippets.css:275 | — |
| `.snip-list-head .seg` | `border-radius` | `var(--radius-sm)` = `6px` | *(not implemented)* | ❌ MISSING | snippets.css:283 | — |

---

### 5. Snippet Card (`snip-card`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-card` | `border` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | snippets.css:77 | styles.css:4445 |
| `.snip-card` | `border-radius` | `var(--radius-md)` = `8px` | `8px` (was `var(--radius-card)` = 12px, PRD req #11 pending) | ⏳ PENDING | snippets.css:78 | styles.css:4446 |
| `.snip-card:hover` | `border-color` | `var(--border-strong)` = `rgba(255,255,255,0.16)` | `var(--color-border)` = `#22283A` | ❌ DIFFERENT | snippets.css:84 | styles.css:4454 |
| `.snip-card.is-active` | `border-color` | `var(--accent)` = `#A78BFA` | `var(--color-accent)` = `#3B82F6` | ❌ DIFFERENT ACCENT | snippets.css:88 | styles.css:4459 |
| `.snip-card.is-active` | `box-shadow` | `0 0 0 1px var(--accent-subtle), 0 0 18px rgba(167,139,250,0.10)` | `0 0 0 1px var(--color-accent-subtle), 0 0 18px rgba(167,139,250,0.10)` | ⚠️ TOKEN | snippets.css:90 | styles.css:4461 |

**Critical differences**:
1. **Hover border**: Design uses `rgba(255,255,255,0.16)` (semi-transparent white). Current uses `#22283A` (opaque dark blue). These are **visually very different** — the design draft border is much more subtle/transparent.
2. **Active border accent color**: Design uses violet (`#A78BFA`), current uses blue (`#3B82F6`). This is a system-wide accent color difference, not snippet-specific.
3. **Active box-shadow**: The `rgba(167,139,250,0.10)` in current is hardcoded to the design's violet accent, not matching current app's blue accent (`rgba(59,130,246,...)`). This creates an inconsistency within the current app itself.
4. **Border-radius**: PRD #11 requires changing from 12px to 8px to match design draft.

---

### 6. Snippet Card Preview (`snip-card-preview`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-card-preview` | `border` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | snippets.css:111 | styles.css:4541 |
| `.snip-card-preview` | `border-radius` | `var(--radius-sm)` = `6px` | `var(--radius-sm)` = `6px` | ✅ | snippets.css:110 | styles.css:4542 |
| `.snip-card.is-active .snip-card-preview` | `border-color` | `transparent` | `transparent` | ✅ | snippets.css:119 | styles.css:4551 |

---

### 7. Snippet Card Tag (`snip-card-tag` / `.tag`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.tag` (in `.snip-card-meta`) | `border` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | components.css:166 | styles.css:4569 |
| `.tag` | `border-radius` | `var(--radius-sm)` = `6px` | `var(--radius-sm)` = `6px` | ✅ | components.css:164 | styles.css:4567 |

---

### 8. Detail Panel (`snip-detail`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-detail-shell` | `border` | None | None | ✅ | — | — |
| `.snip-detail-shell` | `background` | `radial-gradient(ellipse 60% 30% at 80% 0%, var(--accent-subtle), transparent 70%), var(--bg-base)` | `radial-gradient(ellipse 60% 30% at 80% 0%, var(--color-accent-subtle), transparent 70%), var(--color-bg-base)` | ⏳ PENDING (PRD #16) | snippets.css:136-138 | styles.css:4580-4582 |
| `.snip-detail-scroll` | `padding` | `var(--space-7)` = `32px` | `32px` (was `28px`, PRD #12 pending) | ⏳ PENDING | snippets.css:140 | styles.css:4588 |

---

### 9. Detail — Title & Head

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-title` / `.snip-detail-title` | `font-size` | `var(--fs-2xl)` = `26px` | `22px` (PRD #9: should be `26px`) | ⏳ PENDING | snippets.css:151 | styles.css:4600 |
| `.snip-detail-head` | `margin-bottom` | `var(--space-5)` = `20px` | `20px` (was `24px`, PRD #13) | ⏳ PENDING | snippets.css:148 | styles.css:4597 |

---

### 10. Command Block (`snip-cmd-block`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-cmd-block` | `border-radius` | Implicitly from `card-glow` = `var(--radius-lg)` = `12px` | `8px` | ❌ DIFFERENT | components.css:118-119 (card-glow) | styles.css:4644 |
| `.snip-cmd-block` | border strategy | `card-glow`: `padding: 1px; background: var(--accent-gradient-soft);` (gradient border sim) | `padding: 1px; background: linear-gradient(135deg, rgba(167,139,250,0.18), rgba(103,232,249,0.18));` | ⏳ PENDING (PRD #15) | snippets.css:226 (HTML), components.css:115-121 | styles.css:4645-4646 |
| `.snip-cmd-block` | `box-shadow` | Implicit from `card-glow` — uses `var(--shadow-card)` | `0 0 0 1px rgba(167,139,250,0.08), 0 12px 36px rgba(0,0,0,0.32)` | ⚠️ CUSTOM | components.css:110 | styles.css:4647 |
| `.snip-cmd-block-head` | `border-bottom` | `1px solid rgba(255,255,255,0.06)` | `1px solid rgba(255,255,255,0.06)` | ✅ | snippets.css:181 | styles.css:4656 |
| `.snip-cmd-block pre` | `border` | None | None | ✅ | — | — |

**Critical differences**:
1. **Border-radius**: Design draft `card-glow` uses `var(--radius-lg)` = `12px`. Current implementation used `8px`. These differ by 4px but both are reasonable for a code block; the 8px rounds closer to the design's `--radius-md`.
2. **Gradient border**: PRD #15 requires switching from `border: 1px solid` to `padding: 1px + background-image` gradient pattern. Current code already uses `padding: 1px` + gradient background, so this is **already partially implemented**. The gradient values match exactly.
3. **box-shadow**: Design draft `card-glow` doesn't explicitly define box-shadow (it inherits from `.card` which has `var(--shadow-card)`). Current uses a custom accent-colored shadow + deep drop shadow. This is an intentional enhancement beyond the draft.

---

### 11. Command Block — Light Theme Overrides

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `[data-theme="light"] .snip-cmd-block` | `background` | Not explicitly specified (card-glow pattern) | `linear-gradient(135deg, rgba(124,58,237,0.10) 0%, rgba(14,165,233,0.10) 100%)` | N/A | — | styles.css:4691 |
| `[data-theme="light"] .snip-cmd-block-head` | `background` | Not specified | `#14151B` | N/A | — | styles.css:4696 |
| `[data-theme="light"] .snip-cmd-block pre` | `background` | Not specified | `#14151B` | N/A | — | styles.css:4696 |

**Note**: Design draft doesn't have explicit light theme variant CSS for command block. Current implementation forces terminal-bg (#14151B) in light theme, which is consistent with the design intent (terminal always dark).

---

### 12. Snippet Card — Active State Preview (Light Theme Override)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `[data-theme="light"] .snip-card.is-active .snip-card-preview` | `background` | Not specified | `rgba(0,0,0,0.18)` | N/A | — | styles.css:4700 |

---

### 13. Variables Section

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-vars` | `border-top` | `1px dashed var(--border-subtle)` | *(not implemented — OOS in app)* | ❌ MISSING | snippets.css:208 | — |
| `.var-row` | `border` | `1px solid var(--border-subtle)` | *(not implemented — OOS in app)* | ❌ MISSING | snippets.css:223 | — |
| `.var-row` | `border-radius` | `var(--radius-md)` = `8px` | *(not implemented — OOS in app)* | ❌ MISSING | snippets.css:224 | — |

**Note**: Variables section is OOS per PRD — store doesn't support it.

---

### 14. Activity Section

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-activity` | `border-top` | `1px dashed var(--border-subtle)` | *(not implemented — OOS in app)* | ❌ MISSING | snippets.css:252 | — |

**Note**: Activity section is OOS per PRD.

---

### 15. Detail — Meta Section (Current Implementation Only)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-detail-meta` | `border-top` | Not in design (OOS: variables/activity in design) | `1px dashed var(--color-border-subtle)` | N/A | — | styles.css:4675 |

---

### 16. Batch Bar (Current Implementation Only)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-batch-bar` | `border-top` | Not in design | `1px solid var(--color-border-subtle)` | N/A | — | styles.css:4685 |

---

### 17. Snippet Form (`snip-form`)

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-form-cmd-glow` | `border-radius` | Implicitly from `card-glow` = `var(--radius-lg)` = `12px` | `8px` | ❌ DIFFERENT | components.css:118 | styles.css:4731 |
| `.snip-form-cmd-glow` | gradient border | `padding: 1px; background: var(--accent-gradient-soft)` | `padding: 1px; background: linear-gradient(135deg, rgba(167,139,250,0.18), rgba(103,232,249,0.18))` | ✅ | components.css:115-120 | styles.css:4729-4732 |
| `.snip-form-cmd-glow` | `box-shadow` | `var(--shadow-card)` (from card) | `0 0 0 1px rgba(167,139,250,0.08), 0 12px 36px rgba(0,0,0,0.32)` | ⚠️ CUSTOM | — | styles.css:4733 |
| `.snip-form-cmd` | `border` | `0` (inner of card-glow) | `none` | ✅ | — | styles.css:4742 |
| `.snip-form-cmd` | `border-radius` | `calc(var(--radius-lg) - 1px)` = `11px` | `7px` | ❌ DIFFERENT | components.css:124 | styles.css:4743 |
| `.snip-form-actions` | `border-top` | Not in design (form not in design) | `1px dashed var(--color-border-subtle)` | N/A | — | styles.css:4769 |

**Critical differences**:
1. **Form cmd-glow border-radius**: `8px` in current vs `12px` in design (card-glow uses `--radius-lg`). The inner textarea is `7px` vs `11px`.
2. **Form box-shadow**: Custom accent shadow + deep shadow vs design's generic `--shadow-card`.

---

### 18. Snippet Form — Focus State

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.snip-form-cmd-glow:focus-within` | `background` | Not specified (card-glow doesn't have focus) | `linear-gradient(135deg, rgba(167,139,250,0.32), rgba(103,232,249,0.32))` | N/A | — | styles.css:4760 |
| `.snip-form-cmd-glow:focus-within` | `box-shadow` | Not specified | `0 0 0 2px rgba(167,139,250,0.08), 0 12px 36px rgba(0,0,0,0.32)` | N/A | — | styles.css:4761 |

---

### 19. Snippet Form — Light Theme

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `[data-theme="light"] .snip-form-cmd-glow` | `background` | Not specified | `linear-gradient(135deg, rgba(124,58,237,0.10), rgba(14,165,233,0.10))` | N/A | — | styles.css:4774 |
| `[data-theme="light"] .snip-form-cmd` | `background` | Not specified | `#14151B` | N/A | — | styles.css:4778 |
| `[data-theme="light"] .snip-form-cmd-glow:focus-within` | `background` | Not specified | `linear-gradient(135deg, rgba(124,58,237,0.18), rgba(14,165,233,0.18))` | N/A | — | styles.css:4782 |
| `[data-theme="light"] .snip-form-cmd-glow:focus-within` | `box-shadow` | Not specified | `0 0 0 2px rgba(124,58,237,0.08), 0 12px 36px rgba(0,0,0,0.32)` | N/A | — | styles.css:4783 |

---

### 20. Shared Components Used in Snippets

| CSS Selector | Property | Design Draft Value | Current Value | Match? | Design Line | Current Line |
|---|---|---|---|---|---|---|
| `.btn` | `border-radius` | `var(--radius-md)` = `8px` | N/A (uses tailwind `rounded-lg` or custom) | — | components.css:14 | — |
| `.btn-secondary` | `border` | `1px solid var(--border-default)` | Tailwind class | — | components.css:35 | — |
| `.input` | `border` | `1px solid var(--border-default)` | Tailwind class | — | components.css:68 | — |
| `.input` | `border-radius` | `var(--radius-md)` = `8px` | `var(--radius-control)` = `10px` | ❌ 10px vs 8px | components.css:69 | — |
| `.input:focus` | `box-shadow` | `0 0 0 3px var(--accent-subtle)` | Tailwind class | — | components.css:79 | — |
| `.card-glow` | `border-radius` | `var(--radius-lg)` = `12px` | `8px` (snip-cmd-block) | ❌ 8px vs 12px | components.css:118 | styles.css:4644 |
| `.card-glow > .inner` | `border-radius` | `calc(var(--radius-lg) - 1px)` = `11px` | `7px` (snip-form-cmd) | ❌ 7px vs 11px | components.css:124 | styles.css:4743 |
| `.toolbar` | `border-bottom` | `1px solid var(--border-subtle)` | `1px solid var(--color-border-subtle)` | ⚠️ TOKEN | components.css:177 | styles.css:4254 |
| `.page-header` | `border-bottom` | `1px solid var(--border-subtle)` | *(not implemented)* | ❌ MISSING | layout.css:183 | — |
| `.popover` | `border` | `1px solid var(--border-default)` | Tailwind class | — | components.css:210 | — |
| `.popover` | `border-radius` | `var(--radius-lg)` = `12px` | Tailwind class | — | components.css:211 | — |

---

## Summary of Border-Related Mismatches

### Confirmed Mismatches (Need Fixing)

| # | Component | Property | Design Value | Current Value | Priority |
|---|-----------|----------|-------------|--------------|----------|
| 1 | `.snip-card` | `border-radius` | `8px` (--radius-md) | `8px` (was 12px, PRD #11 pending) | ⏳ PRD |
| 2 | `.snip-card:hover` | `border-color` | `rgba(255,255,255,0.16)` (--border-strong) | `#22283A` (--color-border) | ❌ HIGH |
| 3 | `.snip-card.is-active` | `box-shadow` rgba | Design: `rgba(167,139,250,0.10)` | Same hardcode but app accent is blue | ⚠️ INCONSISTENT |
| 4 | `.snip-cmd-block` | `border-radius` | `12px` (--radius-lg from card-glow) | `8px` | ❌ MEDIUM |
| 5 | `.snip-form-cmd-glow` | `border-radius` | `12px` (--radius-lg) | `8px` | ❌ MEDIUM |
| 6 | `.snip-form-cmd` | `border-radius` | `11px` (calc(radius-lg - 1px)) | `7px` | ❌ MEDIUM |
| 7 | `.snip-detail-title` | `font-size` | `26px` (--fs-2xl) | `22px` | ⏳ PRD #9 |
| 8 | `.snip-detail-shell` | `background` | true radial gradient | was color-mix, PRD #16 | ⏳ PRD |
| 9 | `.snip-detail-scroll` | `padding` | `32px` (--space-7) | was `28px`, PRD #12 | ⏳ PRD |
| 10 | `.snip-detail-head` | `margin-bottom` | `20px` (--space-5) | was `24px`, PRD #13 | ⏳ PRD |

### Token-Level Differences (Systemic)

| # | Design Token | Design Dark Value | Current Token | Current Dark Value | Visual Effect |
|---|------------|-----------------|-------------|-------------------|--------------|
| 1 | `--border-subtle` | `rgba(255,255,255,0.06)` | `--color-border-subtle` | `#1A1F2E` | Very similar on dark bg |
| 2 | `--border-default` | `rgba(255,255,255,0.10)` | `--color-border` | `#22283A` | Design slightly more transparent |
| 3 | `--border-strong` | `rgba(255,255,255,0.16)` | no direct equivalent | N/A | Current hover uses `--color-border` instead |
| 4 | `--accent` | `#A78BFA` (violet) | `--color-accent` | `#3B82F6` (blue) | System-wide color difference |
| 5 | `--accent-subtle` | `rgba(167,139,250,0.14)` | `--color-accent-subtle` | `rgba(59,130,246,0.15)` | Violet vs blue |

**Assessment**: The token system difference is **not snippet-specific** — it's a fundamental design-system choice difference between the design draft (violet-accent) and the current app (blue-accent). The border tokens use different naming conventions and slightly different resolved values, but produce visually similar results in dark mode. The main visual mismatch that's snippet-specific is the hover border-color.

### Already Aligned

| Component | Property | Value |
|-----------|----------|-------|
| `.snip-card` default | `border` | 1px solid (token diff only) |
| `.snip-card-preview` | `border` | 1px solid (token diff only) |
| `.snip-card-preview` | `border-radius` | `6px` (--radius-sm) ✅ |
| `.snip-card-preview .is-active` | `border-color: transparent` ✅ |
| `.snip-card-tag` | `border-radius` | `6px` (--radius-sm) ✅ |
| `.snip-cmd-block-head` | `border-bottom` | `1px solid rgba(255,255,255,0.06)` ✅ |
| `.snip-nav-item` | `border-radius` | `8px` (per PRD #10) ✅ |
| `.snip-form-actions` | `border-top` | `1px dashed` ✅ |

---

## Files Found

| File Path | Description |
|---|---|
| `ui/styles/pages/snippets.css` | Design draft snippets page CSS (288 lines) |
| `ui/styles/components.css` | Design draft shared component CSS (275 lines) |
| `ui/styles/layout.css` | Design draft layout CSS (211 lines) |
| `ui/styles/tokens.css` | Design draft design tokens (189 lines) |
| `ui/snippets.html` | Design draft HTML mockup (316 lines) |
| `app/src/styles.css` L1-60 | App design tokens (dark theme) |
| `app/src/styles.css` L324-358 | App design tokens (light theme) |
| `app/src/styles.css` L4234-4784 | App snippets page styles |

## Related Specs

- `.trellis/tasks/05-19-snippets-page-ui-alignment-round2/research/icon-button-comparison.md` — icon/button comparison
- `.trellis/tasks/05-19-snippets-page-ui-alignment-round2/prd.md` — task requirements (17 items)

## Caveats / Not Found

1. **Accent color system difference**: The design draft uses violet (`#A78BFA`) as accent while current app uses blue (`#3B82F6`). This is a system-wide design decision, not snippet-specific. The `.snip-card.is-active` box-shadow hardcodes the violet rgba which is inconsistent with the blue accent.
2. **card-glow border-radius ambiguity**: Design draft `card-glow` uses `var(--radius-lg)` = `12px`, but the snippets page cmd-block is a more compact element where `8px` might look better. PRD #15 focuses on gradient-border structure, not border-radius.
3. **page-overlay**: Design draft includes a floating page-overlay with border on its `.btn`, but this is not part of the snippets page proper — it's a navigation/theme toggle accessory.
4. **Light theme**: Design draft doesn't have explicit light-theme CSS overrides for many snippet components. Current implementation adds light-theme handling for cmd-block and form-cmd that preserves the "terminal always dark" principle.
5. **OOS components**: Variables section (`.snip-vars`, `.var-row`), Activity section (`.snip-activity`), Run section (`.snip-run`), and seg-control are not implemented in the current app and are marked OOS in the PRD.