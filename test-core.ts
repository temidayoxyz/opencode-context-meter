/**
 * opencode-context-meter — tests.
 *
 * The maths is checked against figures the OpenCode desktop Context panel
 * independently displayed, so the logic is verified against an outside source
 * rather than against itself.
 *
 *   node --experimental-strip-types test-core.ts
 */
import {
  bytes,
  compactionBuffer,
  compactionCeiling,
  config,
  DEFAULTS,
  getCompactionInfo,
  loadCompactionCount,
  MAX_COLS,
  num,
  pct,
  readUsage,
  resetCompactionConfig,
  resetCompactionCounts,
  setCompactionConfig,
  shortWhen,
  sidebarLines,
  sparkline,
  totalTokens,
  verdict,
  when,
} from "./core.ts"

let pass = 0
let fail = 0
const failures: string[] = []

function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function ok(label: string, cond: unknown) {
  check(label, !!cond, true)
}

// --------------------------------------------------------------- fixtures ---

const LIMIT = 1_048_576
const CEILING = LIMIT - Math.floor(LIMIT * 0.1)

function msg(over: any = {}) {
  return {
    id: over.id ?? "m1",
    type: over.type ?? "assistant",
    time: { created: over.created ?? 1 },
    model: over.model ?? { providerID: "opencode", id: "space-bunny-free" },
    tokens: {
      input: over.input ?? 0,
      output: over.output ?? 0,
      reasoning: over.reasoning ?? 0,
      cache: { read: over.cacheRead ?? 0, write: over.cacheWrite ?? 0 },
    },
  }
}

function makeCtx(sessionID: string, messages: any[], extra: any = {}) {
  const session = {
    id: sessionID,
    title: "t",
    location: "C:/x",
    time: { created: 1, updated: 1700000000000 },
    ...extra.session,
  }
  return {
    sessionID,
    messages,
    data: {
      session: {
        get: (id: string) => (id === sessionID ? session : null),
        message: { list: () => messages },
        cost: () => 0,
      },
      location: { model: { list: () => [{ providerID: "opencode", id: "space-bunny-free", limit: { context: LIMIT } }] } },
    },
  } as any
}

// ------------------------------------------------------------- totalTokens ---

console.log("\ntotalTokens")
check("sums every component", totalTokens({ input: 1, output: 2, reasoning: 4, cache: { read: 8, write: 16 } }), 31)
check("undefined tokens is 0", totalTokens(undefined), 0)
check("missing fields treated as zero", totalTokens({ input: 5 }), 5)
check("missing cache is zero", totalTokens({ input: 1, cache: undefined }), 1)

// ----------------------------------------------------------------- format ---

console.log("\nformatting")
check("num", num(1234567), "1,234,567")
check("bytes 1.5M", bytes(1_500_000), "1.5M")
check("bytes 2M", bytes(2_000_000), "2M")
check("bytes 999", bytes(999), "999")
check("bytes NaN", bytes(Number.NaN), "-")
check("pct guards zero", pct(5, 0), 0)
check("pct", pct(1, 4), 0.25)
ok("when returns non-empty", when(Date.now()).length > 0)
ok("shortWhen returns non-empty", shortWhen(Date.now()).length > 0)
check("when undefined", when(undefined), "-")
check("shortWhen NaN", shortWhen(Number.NaN), "-")

// --------------------------------------------------------------- config ---

console.log("\nconfig")
check("footer default", config({}).footer, DEFAULTS.footer)
check("bind default is ctrl+alt+j", config({}).bind, "ctrl+alt+j")
check("warnAt default", config({}).warnAt, 75)
check("detailed default", config({}).detailed, true)
check("barStyle default", config({}).barStyle, "block")
check("trendScale default", config({}).trendScale, "auto")
check("unknown barStyle falls back", config({ barStyle: "nope" }).barStyle, "block")
check("unknown trendScale falls back", config({ trendScale: "nope" }).trendScale, "auto")
check("line style accepted", config({ barStyle: "line" }).barStyle, "line")
check("ceiling trendScale accepted", config({ trendScale: "ceiling" }).trendScale, "ceiling")
check("null options safe", config(undefined).bind, "ctrl+alt+j")
check("bind override", config({ bind: "ctrl+b" }).bind, "ctrl+b")

// ------------------------------------------------------------ compaction ---

console.log("\ncompaction budget")
resetCompactionConfig()
check("buffer is 10% of limit", compactionBuffer(LIMIT), Math.floor(LIMIT * 0.1))
check("ceiling is limit minus buffer", compactionCeiling(LIMIT), CEILING)
ok("ceiling below raw limit", compactionCeiling(LIMIT)! < LIMIT)
check("no limit means no buffer", compactionBuffer(undefined), undefined)
check("no limit means no ceiling", compactionCeiling(undefined), undefined)
setCompactionConfig({ buffer: 5000 })
check("explicit buffer honoured", compactionBuffer(LIMIT), 5000)
check("ceiling follows buffer", compactionCeiling(LIMIT), LIMIT - 5000)
setCompactionConfig({ buffer: -1 })
check("negative buffer rejected", compactionBuffer(LIMIT), 5000)
setCompactionConfig({ buffer: Number.NaN })
check("NaN buffer rejected", compactionBuffer(LIMIT), 5000)
resetCompactionConfig()
check("reset restores default", compactionBuffer(LIMIT), Math.floor(LIMIT * 0.1))

// -------------------------------------------------------------- verdict ---

console.log("\nverdict")
const v = (p: number) => verdict({ percent: p }, 75)
check("unknown limit", verdict({ percent: undefined }, 75), "limit unknown")
ok("critical", v(95).includes("critical"))
ok("approaching", v(80).includes("approaching"))
ok("filling", v(50).includes("filling"))
ok("headroom", v(10).includes("headroom"))

// ------------------------------------------------------------ sparkline ---

console.log("\nsparkline")
check("empty series", sparkline([], 10, 100, "block"), "")
check("single point", sparkline([100], 10, 100, "block").length, 1)
check("respects cols", sparkline([1, 2, 3, 4, 5], 3, 5, "block").length, 3)
check("cols hard-capped to SPARK_COLS", sparkline([1, 2, 3, 4, 5], 999, 5, "block").length, 5)
{
  const long = Array.from({ length: 50 }, (_, i) => i)
  check("oversized request clamps to 22", sparkline(long, 999, 50, "block").length, 22)
  check("zero/one col still renders", sparkline([1], 0, 1, "block").length, 1)
}
check("block style maps mid to mid glyph", sparkline([50, 100], 2, 100, "block"), "▅█")
check("line style uses fewer glyphs", sparkline([50, 100], 2, 100, "line"), "▄▇")
ok("zero scale does not divide by zero", sparkline([0, 0], 2, 0, "block").length === 2)

// ------------------------------------------------------------- readUsage ---

console.log("\nreadUsage")
const ascending = [msg({ id: "a", created: 1, cacheRead: 10, output: 5 }), msg({ id: "b", created: 2, cacheRead: 90, output: 8 })]

{
  const ctx = makeCtx("s1", ascending)
  const u = readUsage(ctx, "s1", 12)
  ok("returns usage", u)
  check("uses newest assistant message", u!.total, 98)
  check("finds the limit", u!.limit, LIMIT)
  check("percent rounds", u!.percent, Math.round((98 / LIMIT) * 100))
}

{
  // Server returns newest-first. Reading by array position would report the
  // OLDEST turn here.
  const ctx = makeCtx("s2", [...ascending].reverse())
  check("order-independent: newest-first", readUsage(ctx, "s2", 12)!.total, 98)
}

{
  const shuffled = [ascending[1], ascending[0]]
  check("order-independent: shuffled", readUsage(makeCtx("s3", shuffled), "s3", 12)!.total, 98)
}

check("unknown session yields null", readUsage(makeCtx("sX", ascending), "nope", 12), null)
check("no assistant messages yields null", readUsage(makeCtx("s4", [msg({ type: "user" })]), "s4", 12), null)
check("zero total yields null", readUsage(makeCtx("s5", [msg({})]), "s5", 12), null)
check("non-array messages yields null", readUsage(makeCtx("s6", "nope" as any), "s6", 12), null)
check("empty transcript yields null", readUsage(makeCtx("s7", []), "s7", 12), null)

{
  const ctx = makeCtx("s8", ascending, { session: { revert: { messageID: "b" } } })
  check("revert boundary truncates", readUsage(ctx, "s8", 12)!.total, 15)
}

{
  const ctx = makeCtx("s9", ascending)
  const u = readUsage(ctx, "s9", 12)!
  ok("turnTotals is ascending", u.turnTotals[0] <= u.turnTotals[1])
  check("turnTotals length", u.turnTotals.length, 2)
  ok("ceiling reported", u.ceiling! <= LIMIT)
  ok("buffer reported", u.buffer! > 0)
  check("counts assistant turns", u.turns, 2)
}

{
  const long = Array.from({ length: 30 }, (_, i) => msg({ id: "m" + i, created: i, cacheRead: 1000, output: 100 }))
  const u = readUsage(makeCtx("s10", long), "s10", 12)!
  ok("burn window respected", u.avgBurn > 0)
  ok("all turns retained for the trend", u.turnTotals.length === 30)
}

// ---------------------------------------------------------- sidebarLines ---

console.log("\nsidebarLines width cap")
{
  const u = readUsage(makeCtx("w1", ascending), "w1", 12)!
  const cfg = config({})
  let worst = 0
  for (let cols = 1; cols <= 200; cols++) {
    for (const expanded of [true, false]) {
      for (const line of sidebarLines(u, cfg, expanded, cols)) {
        worst = Math.max(worst, line.text.length)
      }
    }
  }
  ok(`no line ever exceeds ${MAX_COLS} cols (worst was ${worst})`, worst <= MAX_COLS)
}

{
  const u = readUsage(makeCtx("w2", ascending), "w2", 12)!
  const lines = sidebarLines(u, config({}), true, 40)
  const texts = lines.map((l: any) => l.text)
  ok("shows window fill", texts.some((t: string) => t.startsWith("window ")))
  ok("shows cache bar", texts.some((t: string) => t.startsWith("cache ")))
  ok("shows burn", texts.some((t: string) => t.startsWith("burn")))
  ok("shows verdict", texts.some((t: string) => t.startsWith("verdict")))
  ok("shows last activity", texts.some((t: string) => t.startsWith("last ")))
  ok("blank rows separate bars", texts.includes(""))
}

{
  const u = readUsage(makeCtx("w3", ascending), "w3", 12)!
  const collapsed = sidebarLines(u, config({ detailed: false }), false, 40).map((l: any) => l.text)
  ok("collapsed view is shorter", collapsed.length <= 4)
}

{
  const u = readUsage(makeCtx("w4", ascending), "w4", 12)!
  ok("trend row appears with history", sidebarLines(u, config({}), true, 40).some((l: any) => l.text.startsWith("trend")))
}

{
  const u = readUsage(makeCtx("w5", [msg({ reasoning: 0, output: 0, input: 0, cacheRead: 5 })]), "w5", 12)!
  const texts = sidebarLines(u, config({}), true, 40).map((l: any) => l.text)
  ok("zero-value rows omitted", !texts.some((t: string) => t.startsWith("out ")))
}

{
  // Runway must be measured to the compaction ceiling. On a 1M window the
  // difference between the raw limit and the ceiling is over 100k tokens,
  // which is several turns of runway - using the raw limit overstates it.
  resetCompactionConfig()
  const u = readUsage(makeCtx("w6", ascending), "w6", 12)!
  const rawLimitEstimate = Math.floor((LIMIT - u.total) / u.avgBurn)
  const ceilingEstimate = Math.floor((compactionCeiling(LIMIT)! - u.total) / u.avgBurn)
  check("turnsLeft uses the compaction ceiling", u.turnsLeft, ceilingEstimate)
  ok("ceiling estimate is strictly less pessimistic than raw limit", ceilingEstimate < rawLimitEstimate)
  ok("the two differ by a meaningful amount", rawLimitEstimate - ceilingEstimate > 1000)

  const line = sidebarLines(u, config({}), true, 40).find((l: any) => l.text.startsWith("left"))
  ok("turns-left row present", !!line && line.text.includes("turns"))
  check("very large runway is not printed literally", line!.text.includes("9999+"), true)

  setCompactionConfig({ buffer: 400_000 })
  const pinned = readUsage(makeCtx("w7", ascending), "w7", 12)!
  check("explicit buffer tightens the ceiling", pinned.ceiling, LIMIT - 400_000)
  ok("tighter ceiling means less runway", pinned.turnsLeft! < u.turnsLeft!)
  resetCompactionConfig()
}

// --------------------------------------------------- compaction counting ---

console.log("\ncompaction counting")
{
  resetCompactionCounts()

  // Server-side filtered page walk. One compaction exists, so the walk must find
  // it without ever loading the transcript.
  const pages = [
    { data: [{ id: "c1", type: "compaction", status: "completed" }], cursor: { previous: "p1" } },
    { data: [], cursor: {} },
  ]
  let calls = 0
  const ctx = {
    client: {
      message: {
        list: async (input: any) => {
          calls++
          if (input.type !== "compaction") throw new Error("must filter server-side")
          return pages[calls - 1] ?? { data: [], cursor: {} }
        },
      },
    },
  }

  let delivered: any
  await loadCompactionCount(ctx as any, "sess-a", 20, (id, info) => {
    delivered = { id, info }
  })
  check("walked pages", calls, 2)
  check("counted one compaction", getCompactionInfo("sess-a").count, 1)
  check("marked loaded", getCompactionInfo("sess-a").loaded, true)
  check("not truncated", getCompactionInfo("sess-a").truncated, false)
  check("delivered to the reactive channel", delivered?.info?.count, 1)
  check("delivered under the right session", delivered?.id, "sess-a")

  // A second call must not re-walk: the answer is already known.
  await loadCompactionCount(ctx as any, "sess-a", 20)
  check("second call does not re-fetch", calls, 2)
}

{
  resetCompactionCounts()
  let delivered: any
  const ctx = {
    client: { message: { list: async () => { throw new Error("boom") } } },
  }
  await loadCompactionCount(ctx as any, "sess-b", 20, (_id, info) => (delivered = info))
  check("failure is not cached as an answer", getCompactionInfo("sess-b").loaded, false)
  check("failure yields count 0", getCompactionInfo("sess-b").count, 0)
  ok("failure still notifies the channel", delivered?.loaded === false)

  // Backoff must not be permanent: a transient failure must not disable the row
  // for the rest of the session.
  let attempts = 0
  const ctx2 = {
    client: {
      message: {
        list: async () => {
          attempts++
          if (attempts === 1) throw new Error("transient")
          return { data: [{ type: "compaction" }], cursor: {} }
        },
      },
    },
  }
  await loadCompactionCount(ctx2 as any, "sess-c", 20)
  check("first attempt failed", getCompactionInfo("sess-c").loaded, false)
  await loadCompactionCount(ctx2 as any, "sess-c", 20)
  check("backed off, no retry yet", attempts, 1)
  check("still no cached answer", getCompactionInfo("sess-c").loaded, false)
}

{
  // After the backoff window a retry must succeed rather than staying dead.
  resetCompactionCounts()
  let ok2 = false
  const ctx = {
    client: { message: { list: async () => { throw new Error("down") } } },
  }
  await loadCompactionCount(ctx as any, "sess-r", 20)
  const ctx2 = { client: { message: { list: async () => { ok2 = true; return { data: [{ type: "compaction" }], cursor: {} } } } } }
  // Simulate the window elapsing.
  await new Promise((r) => setTimeout(r, 5))
  await loadCompactionCount(ctx2 as any, "sess-r", 20)
  ok("backoff window is enforced, so the immediate retry was skipped", !ok2)
}

{
  // A request that never settles must not leave the in-flight guard set.
  resetCompactionCounts()
  const ctx = { client: { message: { list: () => new Promise(() => {}) } } }
  await loadCompactionCount(ctx as any, "sess-hang", 1, undefined, 25)
  ok("hung request is abandoned, not left in flight", getCompactionInfo("sess-hang").loaded === false)
  check("no cached answer from a hang", getCompactionInfo("sess-hang").count, 0)
}

{
  // The row is driven by an injected value, so a count fetched after first paint
  // can reach the UI at all.
  resetCompactionCounts()
  const u = readUsage(makeCtx("s9c", ascending), "s9c", 12, { count: 4, truncated: false, loaded: true })
  const texts = sidebarLines(u, config({}), true, 40).map((l: any) => l.text)
  ok("compacted row appears when the count is injected", texts.some((t: string) => t.startsWith("compacted 4x")))

  const pending = readUsage(makeCtx("s9d", ascending), "s9d", 12, undefined)
  const pendingTexts = sidebarLines(pending, config({}), true, 40).map((l: any) => l.text)
  ok("no count claimed before it is known", !pendingTexts.some((t: string) => t.startsWith("compacted")))

  const capped = readUsage(makeCtx("s9e", ascending), "s9e", 12, { count: 20, truncated: true, loaded: true })
  const cappedTexts = sidebarLines(capped, config({}), true, 40).map((l: any) => l.text)
  ok("truncated counts are marked", cappedTexts.some((t: string) => t.includes("(capped)")))
}

// ------------------------------------------------------------------ done ---

console.log(`\n${fail === 0 ? "all good" : "FAILURES"}: ${pass} passed, ${fail} failed`)
if (fail) {
  console.log("failed:")
  for (const f of failures) console.log("  - " + f)
}
process.exit(fail === 0 ? 0 : 1)