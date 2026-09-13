/**
 * opencode-context-meter — pure logic. No JSX, no rendering, no side effects.
 *
 * Kept separate from tui.tsx so the numbers can be tested directly.
 */

type Tokens = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

export const num = (n: number) => n.toLocaleString("en-US")

export function bytes(n: number) {
  if (!Number.isFinite(n)) return "-"
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return String(n)
}

/**
 * The same formula OpenCode's own sidebar uses, so the two can never disagree:
 * the token totals of the last assistant message.
 */
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

export const pct = (part: number, whole: number) => (whole ? part / whole : 0)

export function readUsage(ctx: any, sessionID: string) {
  const session = ctx.data.session.get(sessionID)
  if (!session) return null

  const messages = ctx.data.session.message.list(sessionID) ?? []
  if (!Array.isArray(messages)) return null

  let last: any = null
  for (const m of messages) {
    if (m?.type === "assistant" && m?.tokens && m?.model) last = m
  }
  if (!last) return null

  const total = totalTokens(last.tokens)
  if (total <= 0) return null

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

  return {
    total,
    limit,
    percent: limit ? Math.round((total / limit) * 100) : undefined,
    cacheRead: last.tokens.cache?.read ?? 0,
    input: last.tokens.input ?? 0,
    output: last.tokens.output ?? 0,
    reasoning: last.tokens.reasoning ?? 0,
  }
}
