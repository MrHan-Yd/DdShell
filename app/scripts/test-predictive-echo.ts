/**
 * Predictive Echo 自动化测试 runner
 *
 * 用途：在 dev / CI 环境一行命令跑完 selfCheck（T1-T39），
 *       替代手测场景 A/B/C/D。
 *
 * 用法：
 *   cd app && npm run test:predictive-echo
 *   或：cd app && npx tsx scripts/test-predictive-echo.ts
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 有 assertion 失败（输出会列出失败项）
 */

import { selfCheck } from "../src/features/terminal/predictiveEcho";

const result = selfCheck();

const total = result.results.length;
const failed = result.results.filter((r) => r.startsWith("✗"));

if (result.passed) {
  console.log(`\n✅ Predictive Echo selfCheck PASS — ${total} assertions, 0 failures`);
  process.exit(0);
} else {
  console.error(
    `\n❌ Predictive Echo selfCheck FAIL — ${total} assertions, ${failed.length} failures:`,
  );
  for (const f of failed) {
    console.error(`  ${f}`);
  }
  process.exit(1);
}
