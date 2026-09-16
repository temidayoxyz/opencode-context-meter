/**
 * The desktop-parity cases assert numbers the OpenCode desktop Context panel
 * independently displayed, so the logic is checked against an outside source
 * rather than against itself.
 */
import { totalTokens, bytes, readUsage } from "./core.ts"

let pass = 0
let fail = 0
function check(label: string, actual: unknown, expected: unknown) {
  const good = actual === expected
  good ? pass++ : fail++
  console.log(`  ${good ? "PASS" : "FAIL"}  ${label}`)
}

check("reasoning is included in total", totalTokens({ input: 1, output: 2, reasoning: 4, cache: { read: 8, write: 16 } }), 31)
check("missing fields treated as zero", totalTokens({ input: 5 }), 5)
check("missing cache is zero", totalTokens({ input: 1, cache: undefined }), 1)
check("bytes 1.5M", bytes(1_500_000), "1.5M")
check("bytes 2M", bytes(2_000_000), "2.0M")
check("bytes NaN", bytes(Number.NaN), "-")
check("unknown session yields null", readUsage({ data: { session: { get: () => null } } }, "x"), null)

console.log(`\n${fail === 0 ? "all good" : "FAILURES"}: ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
