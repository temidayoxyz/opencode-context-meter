/**
 * opencode-context-meter — pure logic. No JSX, no rendering, no side effects.
 *
 * Kept separate from tui.tsx so the numbers can be tested directly against
 * real session data. See test-core.ts.
 */

import { appendFileSync, statSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// ------------------------------------------------- diagnostics (opt-in-ish) ---

let traceCount = 0
const TRACE_LIMIT = 400
const TRACE_MAX_BYTES = 256 * 1024

function traceFile(): string {
  try {
    return fileURLToPath(new URL("./trace.log", import.meta.url))
  } catch {
    return ""
  }
}

/**
 * Every swallow-and-return-null path in this plugin records why, so a silent
 * blank panel is diagnosable instead of mysterious.
 */
export function trace(event: string, data?: unknown) {
  try {
    if (traceCount++ > TRACE_LIMIT) return
    const file = traceFile()
    if (!file) return
    if (traceCount % 25 === 1) {
      try {
        if (statSync(file).size > TRACE_MAX_BYTES) writeFileSync(file, "")
      } catch {
        /* first run: no file yet */
      }
    }
    let payload = ""
    try {
      payload = data === undefined ? "" : " " + JSON.stringify(data)?.slice(0, 400)
    } catch {
      payload = " <unserializable>"
    }
    appendFileSync(file, `${new Date().toISOString()} ${event}${payload}\n`)
  } catch {
    /* tracing must never break anything */
  }
}

// ------------------------------------------------------------------ config ---

export const DEFAULTS = {
  footer: false,
  bind: "ctrl+alt+j",
  warnAt: 75,
  burnWindow: 12,
  detailed: true,
  barStyle: "block",
  trendScale: "auto",
  spinner: "braille",
}

/**
 * The built-in sidebar already renders the session title at full width, so the
 * sidebar is at least this wide. Staying at or under it means this plugin can
 * never be the thing that widens the sidebar.
 */
export const MAX_COLS = 30
export const BAR_COLS = 18
export const SPARK_COLS = 22

export type Tone = "base" | "muted" | "action" | "warn"
export type SidebarLine = { text: string; tone: Tone }
export type Cfg = ReturnType<typeof config>

export function config(options: unknown) {
  const o = (options ?? {}) as Record<string, unknown>
  const num = (v: unknown, d: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
  return {
    footer: typeof o.footer === "boolean" ? o.footer : DEFAULTS.footer,
    bind: typeof o.bind === "string" && o.bind ? o.bind : DEFAULTS.bind,
    warnAt: typeof o.warnAt === "number" ? o.warnAt : DEFAULTS.warnAt,
    burnWindow: typeof o.burnWindow === "number" ? o.burnWindow : DEFAULTS.burnWindow,
    detailed: typeof o.detailed === "boolean" ? o.detailed : DEFAULTS.detailed,
    barStyle: o.barStyle === "line" ? "line" : (DEFAULTS.barStyle as "block"),
    trendScale: o.trendScale === "ceiling" ? "ceiling" : (DEFAULTS.trendScale as "auto"),
  }
}

// ------------------------------------------------------------- formatting ---

export const num = (n: number) => n.toLocaleString("en-US")

export function bytes(n: number) {
  if (!Number.isFinite(n)) return "-"
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M"
  if (Math.abs(n) >= 1_000)
    return (n / 1_000).toFixed(Math.abs(n) >= 100_000 || n % 1_000 === 0 ? 0 : 1) + "k"
  return String(n)
}

export const pct = (part: number, whole: number) => (whole ? part / whole : 0)

export function when(ms: number | undefined) {
  if (!ms || !Number.isFinite(ms)) return "-"
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  } catch {
    return "-"
  }
}

export function shortWhen(ms: number | undefined) {
  if (!ms || !Number.isFinite(ms)) return "-"
  try {
    const d = new Date(ms)
    const day = d.toLocaleString(undefined, { month: "short", day: "numeric" })
    const time = d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })
    return `${day} ${time}`
  } catch {
    return "-"
  }
}

export function tone(theme: any, percent: number | undefined, warnAt: number) {
  const th = theme?.text
  if (percent !== undefined && percent >= warnAt) return th?.feedback ?? th?.base
  return th?.base
}

// ------------------------------------------------- compaction budgeting ---

type Tokens = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

/**
 * OpenCode never lets a session fill to the raw model limit. Automatic
 * compaction fires once the context approaches `limit - buffer`, where
 * `buffer` defaults to 10% of the limit.
 *
 * Measuring runway against the raw limit overstates it: on a 1M model the real
 * ceiling is 943,719, not 1,048,576.
 */
const compaction: { buffer?: number; auto?: boolean } = {}

export function setCompactionConfig(next: { buffer?: number; auto?: boolean } | undefined) {
  if (!next) return
  // buffer is documented as a non-negative integer. Reject negatives rather
  // than trusting them: a negative buffer would push the ceiling ABOVE the
  // real model limit and re-introduce the over-optimistic runway.
  if (typeof next.buffer === "number" && Number.isFinite(next.buffer) && next.buffer >= 0) {
    compaction.buffer = next.buffer
  }
  if (typeof next.auto === "boolean") compaction.auto = next.auto
}

export function resetCompactionConfig() {
  delete compaction.buffer
  delete compaction.auto
}

export function compactionBuffer(limit: number | undefined): number | undefined {
  if (compaction.buffer !== undefined) return compaction.buffer
  if (limit === undefined) return undefined
  return Math.floor(limit * 0.1)
}

export function compactionCeiling(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  return Math.max(1, limit - (compactionBuffer(limit) ?? 0))
}

/**
 * Fetch the server's resolved `compaction` config so an explicit
 * `compaction.buffer` is honoured instead of the 10% default.
 * Best-effort: any failure leaves the documented defaults in place.
 */
export async function loadCompaction(ctx: any, location: any) {
  try {
    const client: any = ctx?.client
    if (!client) {
      trace("compaction:no-client")
      return
    }
    const cfgApi = client.config
    if (typeof cfgApi?.get !== "function") {
      trace("compaction:no-config-api", { clientKeys: Object.keys(client).slice(0, 30) })
      return
    }
    const res = await cfgApi.get({ location })
    const payload = res?.data ?? res
    // config.get returns an ARRAY of config documents, one per config source,
    // each shaped { type, path, info }. Later entries win (higher precedence).
    const docs = Array.isArray(payload) ? payload : [payload]
    let section: any
    for (const doc of docs) {
      const info = doc?.info ?? doc
      if (!info || typeof info !== "object") continue
      if (info.compaction) section = info.compaction
    }
    if (!section) {
      // Normal case: compaction is not configured, so the documented default
      // (10% of the model limit) applies. Not an error.
      trace("compaction:using-default", { docs: docs.length, defaultBufferPct: 10 })
      return
    }
    setCompactionConfig({ buffer: section.buffer ?? section.reserved, auto: section.auto })
    trace("compaction:loaded", {
      buffer: section.buffer ?? section.reserved,
      auto: section.auto,
      usingDefault: section.buffer === undefined && section.reserved === undefined,
    })
  } catch (e: any) {
    trace("compaction:fetch-failed", { err: String(e?.message ?? e) })
  }
}

// ---------------------------------------------------- compaction counting ---

/**
 * Count compactions across the WHOLE session.
 *
 * The server pages messages 50 at a time with a bidirectional cursor, and the
 * TUI only holds the newest page — so counting from the loaded window would
 * silently miss older compactions. Instead walk `type: "compaction"` pages,
 * which return only compaction rows: tiny payloads regardless of session size.
 *
 * Uses context.client directly rather than data.session.message.loadMore() so
 * the TUI's own message store is never disturbed or re-rendered.
 */
export type CompactionInfo = { count: number; truncated: boolean; loaded: boolean }

const compactionCounts = new Map<string, CompactionInfo>()
const compactionPending = new Set<string>()
/** When the last attempt failed, so retries are spaced instead of storming. */
const compactionFailedAt = new Map<string, number>()

/** Only a successful walk is treated as final. A failure is retried later. */
const RETRY_AFTER_MS = 30_000

export function getCompactionInfo(sessionID: string): CompactionInfo {
  return compactionCounts.get(sessionID) ?? { count: 0, truncated: false, loaded: false }
}

export function resetCompactionCounts() {
  compactionCounts.clear()
  compactionPending.clear()
  compactionFailedAt.clear()
}

function countCompactionRows(rows: any[]): number {
  if (!rows.length) return 0
  // A compaction only counts once it actually completed. Rows without a status
  // are treated as completed rather than discarded.
  return rows.filter((m) => m?.status === undefined || m?.status === "completed").length
}

const PAGE_TIMEOUT_MS = 5000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms (${label})`)), ms)
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/**
 * Fetch the count and hand it to `onResult`.
 *
 * The count MUST arrive through a reactive channel or the row never appears:
 * a plain Map is not observed by the host, so writing to one produces no
 * re-render and the sidebar keeps showing the pre-fetch value until something
 * unrelated happens to redraw. `onResult` is wired to context.storage.memory by
 * tui.tsx, which is verified reactive.
 *
 * The timeout is not defensive decoration. A request that never settles would
 * otherwise leave `compactionPending` set forever, and the guard would refuse
 * every retry for the life of the process - the feature would be permanently
 * dead with no error anywhere.
 */
export async function loadCompactionCount(
  ctx: any,
  sessionID: string,
  maxPages = 20,
  onResult?: (sessionID: string, info: CompactionInfo) => void,
  timeoutMs = PAGE_TIMEOUT_MS,
) {
  if (!sessionID) {
    trace("compactions:skip", { reason: "no sessionID" })
    return
  }
  if (compactionPending.has(sessionID)) {
    trace("compactions:skip", { sessionID, reason: "already in flight" })
    return
  }
  if (compactionCounts.has(sessionID)) {
    trace("compactions:skip", { sessionID, reason: "already counted" })
    return
  }
  const failedAt = compactionFailedAt.get(sessionID)
  if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS) {
    trace("compactions:skip", { sessionID, reason: "backing off after a failure" })
    return
  }

  compactionPending.add(sessionID)
  try {
    let cursor: any
    let count = 0
    let truncated = false
    for (let page = 0; page < maxPages; page++) {
      const res = await withTimeout(
        ctx.client.message.list({ sessionID, limit: 50, type: "compaction", cursor }),
        timeoutMs,
        `page ${page}`,
      )
      count += countCompactionRows(res?.data ?? [])
      const prev = res?.cursor?.previous
      if (!prev) break
      cursor = prev
      if (page === maxPages - 1) truncated = true
    }
    const info: CompactionInfo = { count, truncated, loaded: true }
    compactionCounts.set(sessionID, info)
    compactionFailedAt.delete(sessionID)
    onResult?.(sessionID, info)
    trace("compactions:counted", { sessionID, count, truncated })
  } catch (e: any) {
    trace("compactions:failed", { sessionID, err: String(e?.message ?? e) })
    // Deliberately NOT cached as an answer. Caching the failure would make the
    // guard refuse every retry and the row would be dead for the rest of the
    // session. Back off instead, and tell the UI we have no count yet so it
    // makes no claim rather than showing a stale one.
    compactionFailedAt.set(sessionID, Date.now())
    onResult?.(sessionID, { count: 0, truncated: false, loaded: false })
  } finally {
    compactionPending.delete(sessionID)
  }
}

// -------------------------------------------------------------- sparkline ---

const SPARK_BLOCK = "▁▂▃▄▅▆▇█"
const SPARK_LINE = "▁▄▇"

/**
 * One-line sparkline: one glyph per turn, height = context size relative to
 * `scale`. Compaction shows up as a drop, which is the point.
 *
 * `cols` is clamped to SPARK_COLS here rather than at the call site, so the
 * width guarantee cannot be lost by a caller that forgets.
 */
export function sparkline(values: number[], cols: number, scale: number, style: "line" | "block"): string {
  const glyphs = style === "line" ? SPARK_LINE : SPARK_BLOCK
  if (!Array.isArray(values) || !values.length) return ""
  const take = Math.max(1, Math.min(SPARK_COLS, Math.floor(cols) || 1))
  const slice = values.slice(-take)
  const denom = Math.max(1, scale)
  let out = ""
  for (const v of slice) {
    const f = Number.isFinite(v) ? Math.max(0, Math.min(1, v / denom)) : 0
    const idx = Math.min(glyphs.length - 1, Math.floor(f * glyphs.length))
    out += glyphs[idx]
  }
  return out
}

// ------------------------------------------------------------------- data ---

/** Same formula OpenCode's own sidebar uses, so the two can never disagree. */
export function totalTokens(t: Tokens | undefined) {
  if (!t) return 0
  return (
    (t.input ?? 0) +
    (t.output ?? 0) +
    (t.reasoning ?? 0) +
    (t.cache?.read ?? 0) +
    (t.cache?.write ?? 0)
  )
}

const tracedOrder = new Set<string>()

/**
 * Record message ordering once per session. Array position is not trustworthy
 * (see readUsage), and the loaded window matters for anything that walks
 * history: the endpoint pages at 50 per request with a cursor.
 */
function traceOrderOnce(sessionID: string, raw: any[], ordered: any[]) {
  if (tracedOrder.has(sessionID)) return
  tracedOrder.add(sessionID)
  const first = raw[0]?.time?.created
  const last = raw[raw.length - 1]?.time?.created
  const desc = typeof first === "number" && typeof last === "number" && first > last
  trace("messages:order", {
    sessionID,
    loaded: raw.length,
    asReturned: desc ? "descending (newest first)" : "ascending (oldest first)",
    oldest: ordered[0]?.time?.created,
    newest: ordered[ordered.length - 1]?.time?.created,
    pagination: "server pages 50/request with a cursor; list() holds what is loaded",
  })
}

/**
 * `compaction` is passed in rather than read from module state so the caller
 * controls reactivity: a plain Map is invisible to the host's observer, so a
 * count fetched after first paint would never trigger a redraw. tui.tsx reads it
 * from a context.storage.memory store, which is verified reactive.
 */
export function readUsage(ctx: any, sessionID: string, burnWindow: number, compaction?: CompactionInfo) {
  const session = ctx.data.session.get(sessionID)
  if (!session) {
    trace("readUsage:no-session", { sessionID })
    return null
  }

  let messages = ctx.data.session.message.list(sessionID) ?? []
  if (!Array.isArray(messages)) {
    trace("readUsage:messages-not-array", { type: typeof messages })
    return null
  }

  // The server's message endpoint returns NEWEST-first, and the TUI data layer
  // does not guarantee it reverses that. Never rely on array position.
  const ordered = [...messages].sort((a: any, b: any) => (a?.time?.created ?? 0) - (b?.time?.created ?? 0))
  traceOrderOnce(sessionID, messages, ordered)

  // Respect an undo: only consider messages before the revert boundary.
  const revertID = session.revert?.messageID
  let usable = ordered
  if (revertID) {
    const at = ordered.findIndex((m: any) => m?.id === revertID)
    if (at > 0) usable = ordered.slice(0, at)
  }

  const assistants: any[] = []
  for (const m of usable) {
    if (m?.type === "assistant" && m?.tokens && m?.model) assistants.push(m)
  }
  if (!assistants.length) {
    trace("readUsage:no-assistant-messages", { messages: messages.length })
    return null
  }

  const last = assistants[assistants.length - 1]
  const t: Tokens = last.tokens ?? {}
  const total = totalTokens(t)
  if (total <= 0) {
    trace("readUsage:zero-total", { tokens: t })
    return null
  }

  let limit: number | undefined
  try {
    const models = ctx.data.location.model.list(session.location) ?? []
    const match = models.find(
      (m: any) => m?.providerID === last.model?.providerID && m?.id === last.model?.id,
    )
    if (match?.limit?.context) limit = match.limit.context
  } catch {
    /* limit stays undefined; we render tokens without a percentage */
  }
  const percent = limit ? Math.round((total / limit) * 100) : undefined

  // Burn rate: tokens the model actually had to process fresh, averaged over the
  // last N turns. A turn's cache read is a prefix of the window, so the
  // meaningful "growth" figure is total - cacheRead.
  const recent = assistants.slice(-Math.max(1, burnWindow))
  const growth = recent.map((m: any) => Math.max(0, totalTokens(m.tokens) - (m.tokens?.cache?.read ?? 0)))
  const avgBurn = growth.length ? growth.reduce((a, b) => a + b, 0) / growth.length : 0

  // Full per-turn series (ascending) for the growth sparkline.
  const turnTotals = assistants.map((m: any) => totalTokens(m.tokens))

  // Runway is measured to the compaction ceiling, not the raw model limit.
  // Using the raw limit overstates how far the session can actually run.
  const ceiling = compactionCeiling(limit)
  const buffer = compactionBuffer(limit)
  let turnsLeft: number | undefined
  if (ceiling !== undefined && avgBurn > 0) {
    turnsLeft = Math.max(0, Math.floor((ceiling - total) / avgBurn))
  }

  let userCount = 0
  let assistantCount = 0
  for (const m of usable) {
    if (m?.type === "user") userCount++
    else if (m?.type === "assistant") assistantCount++
  }

  return {
    session,
    model: last.model ?? session.model,
    limit,
    percent,
    total,
    cacheRead: t.cache?.read ?? 0,
    cacheWrite: t.cache?.write ?? 0,
    input: t.input ?? 0,
    output: t.output ?? 0,
    reasoning: t.reasoning ?? 0,
    avgBurn,
    lastBurn: growth.length ? growth[growth.length - 1] : 0,
    turnTotals,
    compaction: compaction ?? getCompactionInfo(sessionID),
    turnsLeft,
    ceiling,
    buffer,
    userCount,
    assistantCount,
    sessionTokens: session.tokens ?? null,
    cost: ctx.data.session.cost(sessionID) ?? session.cost ?? 0,
    created: session.time?.created,
    updated: session.time?.updated ?? session.time?.idle,
    turns: assistants.length,
  }
}

function safe(fn: () => unknown) {
  try {
    const v = fn()
    if (v === null || v === undefined) return String(v)
    if (typeof v !== "object") return String(v)
    return Object.keys(v as object).slice(0, 12)
  } catch (e: any) {
    return `threw: ${String(e?.message ?? e)}`
  }
}

/**
 * Probe for the active session id.
 *
 * Measured on v2.0.25: only `ui.router.current().sessionID` and
 * `ui.tabs.list()[0].sessionID` are populated. `panel.current()` and the other
 * router shapes return undefined, and `props.sessionID` is NOT passed to
 * `sidebar.content` at all - only to the `prompt.*` slots.
 *
 * Returns undefined rather than guessing. A wrong id is worse than none: the
 * session lookup misses, `readUsage` returns null, and the sidebar renders
 * nothing at all with no error to explain it.
 */
export function currentSessionID(ctx: any): string | undefined {
  const probes: Array<[string, () => unknown]> = [
    ["router.sessionID", () => ctx.ui.router.current()?.sessionID],
    ["tabs.focused", () => (ctx.ui.tabs.list?.() ?? []).find((t: any) => t?.focused)?.sessionID],
    ["tabs.first", () => (ctx.ui.tabs.list?.() ?? [])[0]?.sessionID],
    ["most-recent", () => (ctx.data?.session?.list?.() ?? []).slice().sort((a: any, b: any) => (b?.time?.updated ?? 0) - (a?.time?.updated ?? 0))[0]?.id],
  ]
  for (const [via, fn] of probes) {
    try {
      const v = fn()
      if (typeof v === "string" && v) {
        trace("sessionID resolved", { via, v })
        return v
      }
    } catch (e: any) {
      trace("sessionID probe threw", { via, err: String(e?.message ?? e) })
    }
  }
  trace("sessionID unresolved", {
    router: safe(() => ctx.ui.router.current()),
    tabs: safe(() => ctx.ui.tabs.list?.()),
  })
  return undefined
}

export function verdict(u: any, warnAt: number) {
  if (u.percent === undefined) return "limit unknown"
  if (u.percent >= 90) return "critical - compact now"
  if (u.percent >= warnAt) return "compaction approaching"
  if (u.percent >= warnAt * 0.6) return "filling steadily"
  return "plenty of headroom"
}

// ------------------------------------------------------- sidebar rendering ---

const GLYPH = {
  line: { on: "━", off: "─" },
  block: { on: "█", off: "░" },
} as const

function makeBar(fraction: number, cols: number, style: "line" | "block") {
  const g = GLYPH[style] ?? GLYPH.line
  const w = Math.max(2, cols)
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
  const filled = Math.round(f * w)
  return g.on.repeat(filled) + g.off.repeat(Math.max(0, w - filled))
}

function turns(u: any) {
  if (u.turnsLeft === undefined) return "?"
  if (u.turnsLeft > 9999) return "9999+"
  return num(u.turnsLeft)
}

/**
 * Build every sidebar line as plain strings, hard-capped to `cols`.
 *
 * This is a pure function on purpose: test-core.ts asserts that no produced
 * line ever exceeds the cap, which is the guarantee that this plugin cannot
 * widen the sidebar.
 */
export function sidebarLines(u: any, cfg: Cfg, expanded: boolean, cols: number): SidebarLine[] {
  const width = Math.max(16, Math.min(MAX_COLS, Math.floor(cols) || MAX_COLS))
  const barW = Math.max(4, Math.min(BAR_COLS, width - 12))
  const sparkCols = Math.max(4, Math.min(SPARK_COLS, width - 8))
  const warn = u.percent !== undefined && u.percent >= cfg.warnAt
  const head: Tone = warn ? "warn" : "base"
  const out: SidebarLine[] = []

  const push = (text: string, tone: Tone = "muted") => {
    out.push({ text: text.length > width ? text.slice(0, width) : text, tone })
  }

  if (!expanded) {
    push(
      `cache ${Math.round(pct(u.cacheRead, u.total) * 100)}%  in ${Math.round(
        pct(u.input, u.total) * 100,
      )}%  out ${Math.round(pct(u.output, u.total) * 100)}%`,
      head,
    )
    push(`+${bytes(Math.round(u.avgBurn))}/turn  ${turns(u)} left`)
    push(verdict(u, cfg.warnAt))
    return out
  }

  // Window fill, then each bar separated by a blank row. Stacked bars with no
  // gap read as one solid block rather than distinct proportions.
  const bars: SidebarLine[] = []

  bars.push({
    text:
      "window " +
      makeBar(u.limit ? pct(u.total, u.limit) : 0, barW, cfg.barStyle) +
      (u.percent === undefined ? "" : ` ${u.percent}%`),
    tone: head,
  })

  const comp: Array<[string, number]> = [
    ["cache", u.cacheRead],
    ["input", u.input],
    ["out", u.output],
    ["reason", u.reasoning],
  ]
  if (u.cacheWrite > 0) comp.push(["cwrite", u.cacheWrite])
  for (const [label, value] of comp) {
    // A 0% bar is noise; omit the row entirely.
    if (value <= 0) continue
    bars.push({
      text:
        (label + " ").padEnd(7) +
        makeBar(pct(value, u.total), barW, cfg.barStyle) +
        ` ${String(Math.round(pct(value, u.total) * 100)).padStart(3)}%`,
      tone: "muted",
    })
  }

  // Growth trend: context size per turn. Scaled to the series peak by default,
  // because scaling to the absolute ceiling renders a flat row of empty glyphs
  // for any session below ~25% — hiding the trajectory it exists to show.
  const series = u.turnTotals ?? []
  let sparkScale = u.ceiling ?? u.limit ?? 0
  if (cfg.trendScale === "auto") {
    sparkScale = series.length ? Math.max(...series) : 0
  }
  const spark = series.length ? sparkline(series, sparkCols, sparkScale, cfg.barStyle) : ""
  if (spark) bars.push({ text: "trend  " + spark, tone: "muted" })

  // Interleave a blank row so no two bars are ever vertically adjacent.
  for (let i = 0; i < bars.length; i++) {
    push(bars[i].text, bars[i].tone)
    if (i < bars.length - 1) push("")
  }

  if (bars.length) push("")
  push("burn    +" + bytes(Math.round(u.avgBurn)) + "/turn")
  push("left    " + turns(u) + " turns")
  push("verdict " + verdict(u, cfg.warnAt))
  const ci = u.compaction
  // Only claim a count once the whole-session walk has actually answered.
  if (ci?.loaded) push("compacted " + num(ci.count) + "x" + (ci.truncated ? " (capped)" : ""))
  if (u.sessionTokens) {
    const cum =
      (u.sessionTokens.input ?? 0) +
      (u.sessionTokens.output ?? 0) +
      (u.sessionTokens.reasoning ?? 0) +
      (u.sessionTokens.cache?.read ?? 0)
    push("total   " + bytes(cum) + (u.cost > 0 ? " $ " + u.cost.toFixed(2) : " free"))
  }
  push("last    " + shortWhen(u.updated))
  return out
}