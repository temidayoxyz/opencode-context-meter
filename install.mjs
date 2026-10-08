/**
 * Idempotent installer. Backs up cli.json, refuses to write a config that would
 * not parse, and touches no key other than `plugins`.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs"
import { join, dirname, sep } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const PLUGIN_ID = "context-meter"
const here = dirname(fileURLToPath(import.meta.url))

const configDir = () => {
  const xdg = process.env.XDG_CONFIG_HOME
  return xdg ? join(xdg, "opencode") : join(homedir(), ".config", "opencode")
}
function fail(msg) {
  console.error(`\n  install aborted: ${msg}\n`)
  process.exit(1)
}

const dir = configDir()
const cliPath = join(dir, "cli.json")

// A fresh OpenCode install may have no cli.json at all: it is created on first
// auth, not on first run. Aborting there would make installation impossible for
// exactly the users who have not set anything up yet, so bootstrap an empty one.
let bootstrapped = false
if (!existsSync(cliPath)) {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(cliPath, "{}\n", "utf8")
    bootstrapped = true
  } catch (e) {
    fail(`could not create ${cliPath} (${e.message}); nothing was written`)
  }
}

let cfg
try {
  cfg = JSON.parse(readFileSync(cliPath, "utf8"))
} catch (e) {
  fail(`cli.json is not valid JSON (${e.message}); nothing was written`)
}
if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
  fail("cli.json is not a JSON object; nothing was written")
}

// Always an absolute file:// URL.
//
// A relative specifier looks tidier but is resolved against an unspecified base
// (CWD in some hosts, the config dir in others), so a clone that is not a
// direct sibling of .config/opencode registers a path that silently points at
// nothing on the next start. Absolute is unambiguous everywhere.
const abs = here.split(sep).join("/")
const specifier = `file:///${abs}`

const existing = Array.isArray(cfg.plugins) ? cfg.plugins : []
const kept = existing.filter((p) => {
  const target = typeof p === "string" ? p : p?.package
  return typeof target !== "string" || !target.includes(PLUGIN_ID)
})
cfg.plugins = [...kept, { package: specifier, options: {} }]

const backup = `${cliPath}.${PLUGIN_ID}.bak`
copyFileSync(cliPath, backup)

const out = JSON.stringify(cfg, null, 2) + "\n"
try {
  JSON.parse(out)
} catch (e) {
  fail(`generated config would not parse (${e.message}); nothing was written`)
}
writeFileSync(cliPath, out)

console.log(`\n  context-meter installed -> ${specifier}`)
if (bootstrapped) console.log(`  created a new ${cliPath}`)
console.log(`  backup: ${backup}\n`)
