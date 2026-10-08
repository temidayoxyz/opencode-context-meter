/**
 * Removes only this plugin's entry from cli.json. Leaves every other setting,
 * and every other plugin, exactly as found.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const PLUGIN_ID = "context-meter"
const here = dirname(fileURLToPath(import.meta.url))

const configDir = () => {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? join(xdg, "opencode") : join(homedir(), ".config", "opencode")
}
function fail(msg) {
  console.error(`\n  uninstall aborted: ${msg}\n`)
  process.exit(1)
}

const cliPath = join(configDir(), "cli.json")
// Already uninstalled. Report success rather than failing: the requested end
// state holds, and an error here only teaches people to ignore the script.
if (!existsSync(cliPath)) {
  console.log("\n  context-meter is not registered (no cli.json).\n")
  if (process.argv.includes("--purge")) {
    rmSync(here, { recursive: true, force: true })
    console.log("  plugin folder deleted.\n")
  }
  console.log("  Restart the TUI to apply.\n")
  process.exit(0)
}

let cfg
try {
  cfg = JSON.parse(readFileSync(cliPath, "utf8"))
} catch (e) {
  fail(`cli.json is not valid JSON (${e.message}); nothing was written`)
}

const existing = Array.isArray(cfg.plugins) ? cfg.plugins : []
const kept = existing.filter((p) => {
  const target = typeof p === "string" ? p : p?.package
  return typeof target !== "string" || !target.includes(PLUGIN_ID)
})
const removed = existing.length - kept.length

if (removed === 0) {
  console.log("\n  context-meter was not registered - nothing to do.\n")
} else {
  if (kept.length) cfg.plugins = kept
  else delete cfg.plugins
  const out = JSON.stringify(cfg, null, 2) + "\n"
  try {
    JSON.parse(out)
  } catch (e) {
    fail(`generated config would not parse (${e.message}); nothing was written`)
  }
  copyFileSync(cliPath, `${cliPath}.${PLUGIN_ID}.uninstall.bak`)
  writeFileSync(cliPath, out)
  console.log(`\n  context-meter removed from cli.json.\n`)
}

if (process.argv.includes("--purge")) {
  rmSync(here, { recursive: true, force: true })
  console.log("  plugin folder deleted.\n")
}
console.log("  Restart the TUI to apply.\n")
