/**
 * opencode-context-meter — context diagnostics in the session sidebar.
 *
 * Additive only: this appends to `sidebar.content` and replaces no slot, so it
 * cannot displace anything OpenCode already draws.
 *
 * An earlier version used `session.panel`. The host renders panel content INTO
 * the sidebar region, which blew the sidebar out to full width and buried the
 * built-in Context block. Do not reintroduce it.
 */
import { Plugin } from "@opencode/plugin/tui"
import {
  bytes,
  config,
  DEFAULTS,
  loadCompaction,
  loadCompactionCount,
  num,
  readUsage,
  shortWhen,
  sidebarLines,
  trace,
  verdict,
} from "./core.ts"

/** Expanded view is per-session so two open tabs keep their own state. */
const expandedFor = new Set<string>()

/**
 * message.list() returns [] until the transcript is fetched. Kick off the sync
 * once per session so the sidebar has something to read.
 */
function ensureSynced(ctx: any, sessionID: string) {
  if (!sessionID) return
  const key = `synced:${sessionID}`
  if ((ctx as any).__cmSynced?.[key]) return
  try {
    ;(ctx as any).__cmSynced ??= {}
    ;(ctx as any).__cmSynced[key] = true
    const p = ctx.data.session.message.sync(sessionID)
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        try {
          ;(ctx as any).__cmSynced[key] = false
        } catch {}
      })
    }
  } catch (e: any) {
    trace("sync:failed", { sessionID, err: String(e?.message ?? e) })
  }
}

/**
 * Theme tokens are frequently state objects rather than colours. Pull a colour
 * out of whatever shape the token happens to have, falling back sensibly.
 */
function resolveColor(value: any, fallback?: string): string | undefined {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    for (const key of ["base", "value", "default", "primary"]) {
      const inner = (value as any)[key]
      if (typeof inner === "string") return inner
    }
  }
  return fallback
}

function Meter(props: { ctx: any; sessionID: string; expanded: boolean; cfg: any }) {
  const { ctx, sessionID, expanded, cfg } = props
  const u = readUsage(ctx, sessionID, cfg.burnWindow)
  if (!u) {
    trace("render:no-usage", { sessionID })
    return null
  }
  const th = ctx.theme?.text ?? {}
  const accent = resolveColor(th.feedback) ?? resolveColor(th.action) ?? "#f59e0b"
  const warn = u.percent !== undefined && u.percent >= cfg.warnAt

  return (
    <box flexDirection="column">
      <text fg={warn ? accent : resolveColor(th.base)}>
        {`${num(u.total)}${u.percent === undefined ? " tokens" : ` / ${num(u.limit)} (${u.percent}%)`}`}
      </text>
      {expanded ? (
        <>
          <text fg={resolveColor(th.muted)}>
            {`burn +${bytes(Math.round(u.avgBurn))}/turn  ${u.turnsLeft === undefined ? "?" : num(u.turnsLeft)} turns left`}
          </text>
          <text fg={warn ? accent : resolveColor(th.muted)}>{verdict(u, cfg.warnAt)}</text>
        </>
      ) : null}
    </box>
  )
}

/** The diagnostic stack, rendered as plain strings so it can be width-capped. */
function Detail(props: { ctx: any; sessionID: string; expanded: boolean; cfg: any; cols: number }) {
  const { ctx, sessionID, expanded, cfg, cols } = props
  const u = readUsage(ctx, sessionID, cfg.burnWindow)
  if (!u) return null
  const th = ctx.theme?.text ?? {}
  const toneColor: Record<string, string> = {
    base: resolveColor(th.base) ?? "#ffffff",
    muted: resolveColor(th.muted) ?? "#888888",
    action: resolveColor(th.action) ?? resolveColor(th.base) ?? "#ffffff",
    warn: resolveColor(th.feedback) ?? "#f59e0b",
  }
  const lines = sidebarLines(u, cfg, expanded, cols)
  return (
    <box flexDirection="column">
      {lines.map((line: any, i: number) =>
        line.text === "" ? (
          <text key={i}>{" "}</text>
        ) : (
          <text key={i} fg={toneColor[line.tone] ?? toneColor.muted}>
            {line.text}
          </text>
        ),
      )}
    </box>
  )
}

export default Plugin.define({
  id: "context-meter.cli",

  setup(context: any) {
    try {
      const cfg = config(context.options)

      // Resolve the server's compaction settings once, best effort.
      try {
        const p = loadCompaction(context, context.data?.session?.list?.()?.[0]?.location)
        if (p && typeof p.catch === "function") p.catch(() => {})
      } catch {}

      context.ui.slot({
        append: "sidebar.content",
        render(props: any) {
          try {
            const sessionID: string | undefined = props?.sessionID ?? props?.session?.id
            if (!sessionID) return null

            ensureSynced(context, sessionID)
            loadCompactionCount(context, sessionID)

            // keymap.layer() throws "Keymap.Provider is missing" when called
            // from setup(), so it must be registered from inside a slot render.
            if (!(context as any).__cmLayer) {
              try {
                context.keymap.layer(() => ({
                  mode: "global" as const,
                  priority: 10,
                  commands: [
                    {
                      id: "context-meter.toggle",
                      title: "Context meter: toggle detail",
                      group: "Context",
                      bind: cfg.bind,
                      slash: { name: "context" },
                      run: () => {
                        expandedFor.has(sessionID)
                          ? expandedFor.delete(sessionID)
                          : expandedFor.add(sessionID)
                      },
                    },
                  ],
                  bindings: ["context-meter.toggle"],
                }))
                ;(context as any).__cmLayer = true
              } catch (e: any) {
                trace("keymap:failed", { err: String(e?.message ?? e) })
              }
            }

            const expanded = cfg.detailed || expandedFor.has(sessionID)
            const cols = props?.width ?? props?.cols ?? DEFAULTS.warnAt
            return <Detail ctx={context} sessionID={sessionID} expanded={expanded} cfg={cfg} cols={cols} />
          } catch (e: any) {
            trace("render:failed", { err: String(e?.message ?? e) })
            return null
          }
        },
      })

      return () => {}
    } catch (e: any) {
      trace("setup:failed", { err: String(e?.message ?? e) })
      return () => {}
    }
  },
})

export { Meter, shortWhen }