#!/usr/bin/env node
// Keeps a GUIDE.md's version line on the project's version. Run it from a release script; run --check in CI.
//
// Usage: node sync_version.mjs <GUIDE.md> <manifest> [--check]
// The manifest is package.json, plugin.json, pyproject.toml, Cargo.toml or a plain VERSION file. Both the English line
// ("Version 1.2.3, updated 2026-10-12.") and the German one ("Version 1.2.3, Stand 2026-10-12.") are understood.
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

const [guide, manifest] = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (!guide || !manifest) {
  console.error('usage: node sync_version.mjs <GUIDE.md> <manifest> [--check]')
  process.exit(2)
}
const raw = readFileSync(manifest, 'utf8')
const name = basename(manifest)
const version = name.endsWith('.json')
  ? JSON.parse(raw).version
  : name.endsWith('.toml')
    ? raw.match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1]
    : raw.trim().split(/\s+/)[0]
if (!version) {
  console.error(`no version in ${manifest}`)
  process.exit(1)
}
const line = /^Version (\S+), (updated|Stand) (\d{4}-\d{2}-\d{2})\./m
const text = readFileSync(guide, 'utf8')
const found = text.match(line)
if (!found) {
  console.error(`${guide} has no version line ("Version x, updated yyyy-mm-dd." or "Version x, Stand yyyy-mm-dd.")`)
  process.exit(1)
}
if (process.argv.includes('--check')) {
  if (found[1] !== version) {
    console.error(`${guide} says ${found[1]}, ${manifest} says ${version}`)
    process.exit(1)
  }
  console.log(`${guide} matches ${version}`)
} else if (found[1] !== version) {
  writeFileSync(guide, text.replace(line, `Version ${version}, ${found[2]} ${new Date().toISOString().slice(0, 10)}.`))
  console.log(`${guide} set to ${version}`)
} else console.log(`${guide} already at ${version}`)
