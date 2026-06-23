#!/usr/bin/env node

import path from "node:path"

import { indexVault } from "./lib/folder-indexes.mjs"

const defaults = {
  vault: "/Users/nicolastababajeux/Documents/personal/obsidian/master-vault",
}

function parseArgs(argv) {
  const options = { ...defaults, apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--apply") options.apply = true
    else if (arg === "--vault") {
      const value = argv[++index]
      if (!value || value.startsWith("--")) throw new Error("--vault requires a path")
      options.vault = value
    } else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(`Usage: npm run index:vault -- [--apply] [--vault <path>]`)
} else {
  indexVault({ vaultRoot: path.resolve(options.vault), apply: options.apply })
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(`index-vault: ${error.message}`)
      process.exitCode = 1
    })
}
