# opencode-context-meter

Context window diagnostics in the [OpenCode](https://opencode.ai) TUI sidebar.

OpenCode tells you how full your context window is. This tells you **why** it's
that full, how fast it's filling, how many turns you actually have left, and
what your token spend is going on.

```
window ████████░░░░░░░░░░░░  42%
cache  ██████████████████  94%
input  █░░░░░░░░░░░░░░░░░░   4%
out    █░░░░░░░░░░░░░░░░░░   2%

trend  ▁▂▃▄▅▅▆▆▇▇███
burn    +3.2k/turn
left    142 turns
verdict filling steadily
last    Oct 8, 2:14 PM
```

## What it shows

| Row | Meaning |
| --- | --- |
| `window` | Fill against the model's context limit |
| `cache` / `input` / `out` / `reason` | Composition of that window |
| `trend` | Context size per turn — compaction shows as a cliff |
| `burn` | Average tokens of *fresh* work per turn |
| `left` | Turns until auto-compaction fires |
| `verdict` | Plain-language read on the above |
| `compacted` | How many times this session has compacted |
| `total` | Cumulative session tokens and cost |
| `last` | Last activity |

## Install

```bash
git clone https://github.com/temidayoxyz/opencode-context-meter
cd opencode-context-meter
npm run install        # registers the plugin in ~/.config/opencode/cli.json
```

Restart the OpenCode TUI. The meter appears under the built-in Context block.

To remove:

```bash
npm run uninstall      # or: node uninstall.mjs --purge  (also deletes the folder)
```

## Requirements

OpenCode **v2.0.22+**. No dependencies.

## Configuration

Optional, in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "context-meter": {
    "bind": "ctrl+alt+j",
    "warnAt": 75,
    "burnWindow": 12,
    "detailed": true,
    "barStyle": "block",
    "trendScale": "auto"
  }
}
```

| Option | Default | Notes |
| --- | --- | --- |
| `bind` | `ctrl+alt+j` | Toggle detail. **Do not use `ctrl+j`** — that's OpenCode's next-tab binding and the collision fails silently. |
| `warnAt` | `75` | Percent at which `verdict` turns cautionary |
| `burnWindow` | `12` | Turns averaged for `burn` |
| `detailed` | `true` | Show the full stack rather than the 3-line summary |
| `barStyle` | `block` | `block` (`█░`) or `line` (`━─`) |
| `trendScale` | `auto` | Scale the sparkline to the series peak. `ceiling` scales to the compaction ceiling, which renders a flat row of glyphs for low-usage sessions. |

You can also toggle detail at runtime with the bound key, or via
`/contextmeter`.

## Design constraints

**Additive only.** The plugin appends to `sidebar.content` and replaces no slot.
An earlier version used `session.panel`; the host renders panel content *into*
the sidebar region, which blew the sidebar out to full width and buried the
built-in Context block. That approach is not used.

**Cannot widen the sidebar.** Every line is capped at `MAX_COLS` (30) inside
`sidebarLines()` — in the primitive, not at the call site, so a future caller
cannot lose the guarantee. Tests render every fixture at 200 widths and assert
no line ever exceeds the cap.

**Same numbers as the built-in block.** Usage is computed with OpenCode's own
formula (`input + output + reasoning + cache.read + cache.write` from the last
assistant message, honouring `session.revert`), so the two can never disagree.

**Runway is measured to the compaction ceiling**, not the raw model limit.
OpenCode compacts at roughly `limit - buffer` where `buffer` defaults to 10% of
the limit; on a 1M model that ceiling is 943,719. An explicit
`compaction.buffer` in your config is honoured.

**Order-independent.** The message endpoint returns newest-first and the TUI
data layer doesn't guarantee it reverses that, so messages are sorted by
creation time rather than read by array position.

**Never mutates the host.** Compaction counts come from `client.message.list()`
walked directly, so the TUI's own message store is never disturbed or
re-rendered.

## Tests

```bash
npm test        # 87 assertions, no network, no fixtures required
```

## Troubleshooting

`trace.log` is written next to the plugin whenever a code path swallows an
error, so a blank panel is diagnosable:

```bash
tail -20 trace.log
```

The file is capped at 256 KB and rotates automatically. It's gitignored.

## License

MIT