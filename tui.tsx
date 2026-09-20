/**
 * opencode-context-meter — context diagnostics in the session sidebar.
 *
 * Replaces an earlier session.panel implementation. The host renders panel
 * content INTO the sidebar region, which blew the sidebar out to full width and
 * buried the built-in Context block. Do not reintroduce it.
 *
 * Additive only: this appends to sidebar.content and replaces no slot, so it
 * cannot displace anything OpenCode already draws.
 */
import { Plugin } from "@opencode/plugin/tui"
import { bytes, num, readUsage } from "./core.ts"

const synced = new Set<string>()

/** message.list() returns [] until the transcript is fetched. */
function ensureSynced(ctx: any, sessionID: string) {
  if (!sessionID || synced.has(sessionID)) return
  synced.add(sessionID)
  try {
    const p = ctx.data.session.message.sync(sessionID)
    if (p && typeof p.catch === "function") p.catch(() => synced.delete(sessionID))
  } catch {
    synced.delete(sessionID)
  }
}

function Meter(props: { ctx: any; sessionID: string }) {
  const th = props.ctx.theme.text
  const u = readUsage(props.ctx, props.sessionID)
  if (!u) return null
  return (
    <box flexDirection="column">
      <text fg={th.base}>{u.percent === undefined ? num(u.total) + " tokens" : "ctx " + u.percent + "%"}</text>
    </box>
  )
}

export default Plugin.define({
  id: "context-meter.cli",
  setup(context: any) {
    try {
      context.ui.slot({
        append: "sidebar.content",
        render(props: any) {
          try {
            const id = props?.sessionID
            if (!id) return null
            ensureSynced(context, id)
            return <Meter ctx={context} sessionID={id} />
          } catch {
            return null
          }
        },
      })
      return () => {}
    } catch {
      return () => {}
    }
  },
})
