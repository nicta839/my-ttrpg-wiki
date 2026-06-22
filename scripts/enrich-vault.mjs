#!/usr/bin/env node

import path from "node:path"

import { enrichVault } from "./lib/vault-enrichment.mjs"

const defaults = {
  vault: "/Users/nicolastababajeux/Documents/personal/obsidian/master-vault",
}

function usage() {
  return `Obsidian vault metadata and link enrichment

Usage:
  npm run enrich:vault                 # read-only preview
  npm run enrich:vault -- --apply      # back up and update working notes

Options:
  --vault <path>   Obsidian vault root
  --apply          Apply the proposed changes
  --help           Show this help`
}

function parseArgs(argv) {
  const options = { ...defaults, apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--apply") options.apply = true
    else if (arg === "--vault") {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error("--vault requires a path")
      options.vault = value
      index += 1
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const report = await enrichVault({ vaultRoot: path.resolve(options.vault), apply: options.apply })
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(`enrich-vault: ${error.message}`)
  process.exitCode = 1
})
