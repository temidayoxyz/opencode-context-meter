/**
 * Idempotent installer. Backs up cli.json, refuses to write a config that would
 * not parse, and touches no key other than `plugins`.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs"
import { join, dirname, relative, isAbsolute as pathIsAbsolute, sep } from "node:path"
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
if (!existsSync(cliPath)) fail(`no cli.json at ${cliPath}`)

let cfg
try {
  cfg = JSON.parse(readFileSync(cliPath, "utf8"))
} catch (e) {
  fail(`cli.json is not valid JSON (${e.message}); nothing was written`)
}
if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
  fail("cli.json is not a JSON object; nothing was written")
}

const abs = here.split(sep).join("/")
const rel = relative(dir, here)
const specifier = pathIsAbsolute(rel) || /^[A-Za-z]:/.test(rel) ? `file:///${abs}` : rel.split(sep).join("/")

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

console.log(`\n  context-meter installed -> ${specifier}\n  backup: ${backup}\n`)
