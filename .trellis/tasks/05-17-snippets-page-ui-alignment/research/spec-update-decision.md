# Research: Should this task produce new spec entries

- **Query**: 判断本任务整个生命周期有没有值得沉淀到 `.trellis/spec/` 的 executable contract / coding convention / anti-pattern
- **Scope**: internal (spec diff + task journals)
- **Date**: 2026-05-18

## Findings

### Existing diff in `.trellis/spec/frontend/quality-guidelines.md` (+21 lines)

Added section: **"Don't: `t(key) || \"fallback\"` to bypass i18n key typecheck"** at L49-68.

Content (paraphrased):
1. Names two anti-patterns: `t("foo.bar") || "fallback"` and `t("foo.bar" as DictKey)`.
2. Explains why: `DictKey = keyof typeof dict` is a literal union; the fallback / cast silently defeats the build-time missing-key check.
3. Prescribes the fix: register in `dict` (both zh+en) before use; call `t()` without fallback; for genuinely dynamic strings render plain text with a comment.

#### Verification against task facts

- **Real anti-pattern in this task**: yes. `check.jsonl` L14-15 records that round-1 build went red because `snippets.allSnippets / libraryHeading / groupsHeading` were not registered, and the implement-round had masked it with `|| "All snippets" / "Library" / "Groups"`. Fix recorded at `app/src/lib/i18n.ts:630-632` and SnippetsPage.tsx L687/L778/L781/L787 removed the fallbacks.
- **Examples match real code**: the two `Don't` snippets in spec L52-54 are paraphrases of the exact lines that were removed (`t("snippets.allSnippets") || "All snippets"`, `t("snippets.libraryHeading" as DictKey) || "Library"`). Faithful.
- **Type claim accuracy**: `DictKey = keyof typeof dict` — verified at i18n.ts L630-632; the dict file is the source of `DictKey`, so the typing claim is correct.
- **Prescription correctness**: round-2 check L24 explicitly grep-verified `t\(.+\)\s*\|\|` produces 0 hits in SnippetsPage.tsx, and the three keys exist at i18n.ts L630-632 with both zh+en. Spec prescription is operationally enforced.
- **Wording**: precise and bounded. Calls out two specific anti-patterns; gives the canonical fix; does not over-generalize. No fluff.

**Verdict on the existing diff**: accurate, grounded in this task's actual fix, no exaggeration or fabrication. Keep as-is.

### Round-2 (visual alignment) — does it produce any new spec?

Round-2 changes per `check.jsonl` L17-26:
- Removed 2 lucide `Tag` icons from SnippetsPage.tsx.
- Aligned 3 CSS class rules in `.snippets-shell` scope: `snip-card-tag / snip-detail-tag` chip shape (height/padding/radius/border/bg/font-size/color), `snip-aside-section / snip-list-title` letter-spacing 0.08em, `snip-cmd-block-head` padding.
- All 8 PRD AC pass; build green; no fixes needed this round.

This is pure visual alignment to the static draft `ui/snippets.html` / `ui/styles/pages/snippets.css`. Already covered by:
- `.trellis/spec/frontend/component-guidelines.md` L63-84 — "Static UI drafts are visual references, not feature contracts" (PRD explicitly invokes this convention; round-2 round 8 verifies zero OOS draft-only elements introduced).

No new convention, no new anti-pattern, no new executable contract emerged. The CSS rules themselves (specific px/em values, class names) are code facts, not spec material.

**Verdict on round-2**: no new spec needed.

### Files involved

| Path | Role |
|---|---|
| `.trellis/spec/frontend/quality-guidelines.md` L49-68 | New anti-pattern entry, already covers round-1 i18n lesson |
| `.trellis/spec/frontend/component-guidelines.md` L63-84 | Existing convention covering round-2 (static draft = visual reference only) |
| `app/src/lib/i18n.ts` L630-632 | The 3 keys registered for the i18n fix |
| `app/src/features/snippets/SnippetsPage.tsx` | Component receiving the layout + i18n cleanup |
| `.trellis/tasks/05-17-snippets-page-ui-alignment/check.jsonl` L14-15, L24 | Evidence trail for the i18n anti-pattern |

## Final spec change list

**Empty.** The existing +21-line diff in `quality-guidelines.md` is correct, faithful to task facts, and sufficient. Round-2 produces no new spec material — `component-guidelines.md` L63-84 already covers the "static draft = visual reference only" rule that governed this work.

Recommendation: keep `.trellis/spec/frontend/quality-guidelines.md` as currently staged. No additional edits.

## Caveats / Not Found

- None. Task journals (prd.md, check.jsonl) and the staged spec diff are mutually consistent.
