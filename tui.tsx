/**
 * opencode-context-meter — context diagnostics in a session panel.
 */
import { Plugin } from "@opencode/plugin/tui"
import { bytes, num, readUsage } from "./core.ts"

function Row(props: { ctx: any; label: string; value: string }) {
  const th = props.ctx.theme.text
  return (
    <box flexDirection="row">
      <text fg={th.muted}>{(props.label + " ").padEnd(14, " ")}</text>
      <text fg={th.base}>{props.value}</text>
    </box>
  )
}

function Stats(props: { ctx: any; panel: any }) {
  const th = props.ctx.theme.text
  const u = readUsage(props.ctx, props.panel.sessionID)
  if (!u) {
    return (
      <box flexDirection="column" padding={1}>
        <text fg={th.muted}>{"No context data yet for this session."}</text>
      </box>
    )
  }
  const width = Math.max(48, (props.panel.width ?? 70) - 4)
  return (
    <box flexDirection="column" padding={1}>
      <text fg={th.base}>{u.limit ? num(u.total) + " / " + num(u.limit) : num(u.total)}</text>
      <text fg={th.muted}>{u.percent === undefined ? "" : u.percent + "% of window"}</text>
      <text fg={th.action}>{"Window composition"}</text>
      <Row ctx={props.ctx} label="cache read" value={num(u.cacheRead)} />
      <Row ctx={props.ctx} label="fresh input" value={num(u.input)} />
      <Row ctx={props.ctx} label="output" value={num(u.output)} />
      <Row ctx={props.ctx} label="cumulative" value={bytes(u.total)} />
    </box>
  )
}

export default Plugin.define({
  id: "context-meter.cli",
  setup(context: any) {
    try {
      context.ui.slot({
        append: "session.panel",
        render: (panel: any) => {
          try {
            if (panel?.name !== "context-meter.stats") return null
            return <Stats ctx={context} panel={panel} />
          } catch {
            return null
          }
        },
      })
      context.keymap.layer(() => ({
        mode: "global",
        priority: 10,
        commands: [
          {
            id: "context-meter.stats",
            title: "Context: window diagnostics",
            group: "Context",
            bind: "ctrl+j",
            slash: { name: "context" },
            run: () => context.ui.panel.open("context-meter.stats"),
          },
        ],
        bindings: ["context-meter.stats"],
      }))
      return () => {}
    } catch {
      return () => {}
    }
  },
})
