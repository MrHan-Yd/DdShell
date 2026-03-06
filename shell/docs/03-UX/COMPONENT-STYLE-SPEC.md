# Component Style Spec (macOS Feel)

## 1. Goal
- Define implementation-level visual and interaction tokens for macOS-like quality.
- Ensure controls have consistent texture, hierarchy, and motion across pages.

## 2. Surface System
- Window background:
  - Light: `rgba(246, 247, 249, 0.78)`
  - Dark: `rgba(30, 31, 34, 0.72)`
- Card background:
  - Light: `rgba(255, 255, 255, 0.72)`
  - Dark: `rgba(44, 46, 50, 0.64)`
- Glass blur:
  - Base blur: `18px`
  - Overlay blur: `24px` (modal/popover only)
- Hairline border:
  - Light: `rgba(255, 255, 255, 0.65)` inner + `rgba(26, 26, 26, 0.08)` outer
  - Dark: `rgba(255, 255, 255, 0.16)` inner + `rgba(0, 0, 0, 0.35)` outer
- Noise layer:
  - 2% opacity monochrome grain on glass surfaces.

## 3. Shadow System
- Card: `0 6px 20px rgba(15, 23, 42, 0.10)`
- Floating panel: `0 14px 34px rgba(15, 23, 42, 0.16)`
- Modal: `0 24px 48px rgba(2, 6, 23, 0.22)`
- Focus ring (global): `0 0 0 3px rgba(10, 132, 255, 0.28)`

## 4. Corner Radius
- Tiny controls: `8px`
- Inputs/buttons: `10px`
- Cards: `12px`
- Popovers/modals: `14px`

## 5. Control Specs
- Primary button:
  - Default: gradient `#0A84FF -> #0066E0`, text `#FFFFFF`
  - Hover: +6% brightness
  - Active: -8% brightness, press depth `translateY(1px)`
  - Disabled: 45% opacity, no shadow
- Secondary button:
  - Background: translucent surface
  - Border: hairline
  - Hover: background alpha +0.06
- Input:
  - Background: card surface
  - Border: hairline
  - Focus: blue ring + subtle inner glow
  - Error: border `#FF453A`, ring `rgba(255,69,58,0.22)`
- Segmented control:
  - Track glass surface, selected segment with elevated fill and mini shadow
- Switch:
  - On color: `#34C759`
  - Thumb uses strong highlight and tiny shadow

## 6. Typography
- Preferred fonts:
  - macOS: `SF Pro Text`, `SF Pro Display`, `SF Mono`
  - Fallback: `PingFang SC`, `Segoe UI`, `sans-serif`
- Sizes:
  - body: `13px`
  - compact label: `12px`
  - section title: `16px`
- Numeric dashboard values should use tabular figures when available.

## 7. Motion
- Base transition: `140ms cubic-bezier(0.2, 0.8, 0.2, 1)`
- Panel open/close: `180ms`
- Tooltip/popover: fade + scale from `0.98 -> 1.00`
- Avoid springy animations for core terminal interactions.

## 8. States & Feedback
- `GOOD`: `#34C759`
- `FAIR`: `#FF9F0A`
- `POOR`: `#FF453A`
- Toast:
  - Glass panel + hairline border + icon-led status
  - Auto-dismiss 2.5s (except error)

## 9. Accessibility Gate
- Text contrast: >= 4.5:1 for body text
- Interactive target: min `32x32`
- Keyboard focus must be visible on all controls.

## 10. Implementation Notes
- Use CSS variables for all colors/shadows/radii/timing.
- Keep one token file as the only style source for this spec.
- Any new control must define default/hover/active/focus/disabled before merge.
