#!/usr/bin/env node
/**
 * CSS layer guard — runs after `vite build`.
 *
 * Asserts the invariants that the layer migration established:
 *  1. Every style rule in the bundled CSS lives inside an explicit @layer.
 *     (Top-level @property/@font-face/@charset/@keyframes are allowed — they
 *     are not cascade-ordered and Tailwind emits @property unlayered.)
 *  2. The layer precedence order is exactly:
 *     properties < vendor < theme < base < components < utilities < app
 *     so app/theme rules keep outranking Tailwind utilities (the historical,
 *     visually-validated behavior), and vendor stays at the bottom.
 *
 * If this script fails after adding CSS, the new rules are unlayered and
 * would silently outrank every layered rule — the exact bug class behind
 * the v0.3.2 fake-split-pane defect. Import them through src/styles.css
 * with an explicit layer(...) instead.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const assetsDir = join(process.cwd(), "dist", "assets");
const cssFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".css"));
if (cssFiles.length === 0) {
  console.error("check-css-layers: no CSS found in dist/assets — run vite build first");
  process.exit(1);
}

const EXPECTED_ORDER = ["properties", "vendor", "theme", "base", "components", "utilities", "app"];
const ALLOWED_UNLAYERED_AT = new Set([
  "@property", "@font-face", "@charset", "@keyframes", "@counter-style", "@import", "@layer",
]);

let failed = false;

for (const file of cssFiles) {
  const css = readFileSync(join(assetsDir, file), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

  // Walk the file tracking @layer nesting; collect unlayered top-level rules
  // and the first-appearance order of layer names.
  const layerOrder = [];
  const unlayered = [];
  const stack = []; // depth values where a @layer block opened
  let depth = 0;
  let segStart = 0;

  const noteLayers = (names) => {
    for (const raw of names.split(",")) {
      const name = raw.trim();
      if (name && !layerOrder.includes(name)) layerOrder.push(name);
    }
  };

  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") {
      const head = css.slice(segStart, i).trim().replace(/\s+/g, " ");
      const at = head.startsWith("@") ? head.split(/[\s(]/)[0] : null;
      if (at === "@layer") {
        noteLayers(head.slice(6).trim());
        stack.push(depth);
      } else if (stack.length === 0 && depth === 0 && !ALLOWED_UNLAYERED_AT.has(at ?? "")) {
        // top-level rule outside any layer
        if (at === "@media" || at === "@supports" || at === "@container") {
          unlayered.push(`${head.slice(0, 80)} (conditional group outside @layer)`);
        } else if (!at) {
          unlayered.push(head.slice(0, 80));
        }
      }
      depth++;
      segStart = i + 1;
    } else if (c === "}") {
      depth--;
      if (stack.length && stack[stack.length - 1] === depth) stack.pop();
      segStart = i + 1;
    } else if (c === ";" && depth === stack.length) {
      const stmt = css.slice(segStart, i).trim();
      if (stmt.startsWith("@layer ")) noteLayers(stmt.slice(6).trim());
      segStart = i + 1;
    }
  }

  if (unlayered.length > 0) {
    failed = true;
    console.error(`check-css-layers: ${file} has ${unlayered.length} unlayered top-level rule(s):`);
    for (const u of unlayered.slice(0, 10)) console.error(`  - ${u}`);
  }

  const relevant = layerOrder.filter((n) => EXPECTED_ORDER.includes(n));
  const expected = EXPECTED_ORDER.filter((n) => relevant.includes(n));
  if (relevant.join("<") !== expected.join("<")) {
    failed = true;
    console.error(
      `check-css-layers: ${file} layer order mismatch\n  actual:   ${relevant.join(" < ")}\n  expected: ${expected.join(" < ")}`,
    );
  }
}

if (failed) process.exit(1);
console.log(`check-css-layers: OK (${cssFiles.length} file(s), all rules layered, order verified)`);
