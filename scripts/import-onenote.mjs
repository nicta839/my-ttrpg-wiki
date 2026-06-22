#!/usr/bin/env node

import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  approveAllReview,
  convertNotebooks,
  inventoryExtraction,
  promoteImport,
  relocatePrivateGmThoughts,
  repairExistingMediaFromBackup,
  stageImport,
  summarizeDryRun,
} from "./lib/onenote-import.mjs"
import { enrichVault } from "./lib/vault-enrichment.mjs"

const repoRoot = process.cwd()
const defaults = {
  source: "/Users/nicolastababajeux/Documents/personal/one_note_docs",
  vault: "/Users/nicolastababajeux/Documents/personal/obsidian/master-vault",
}

function usage() {
  return `OneNote → Obsidian migration

Usage:
  npm run import:onenote                         # read-only dry run
  npm run import:onenote -- --stage             # write private review bundle
  npm run import:onenote -- --approve-all       # approve and resolve review entries
  npm run import:onenote -- --promote           # promote approved review entries
  npm run import:onenote -- --finalize           # repair preservation and private routing
  npm run import:onenote -- --enrich-vault       # enrich metadata and related links

Options:
  --source <path>       OneNote notebook export root
  --vault <path>        Obsidian vault root
  --one2html <path>     Existing one2html v1.3.1 binary
  --stage               Generate private/onenote-import-review
  --force-stage         Replace importer-owned review staging data
  --approve-all         Approve all pages/media and resolve conflicts safely
  --promote             Promote approved review.yaml entries
  --finalize            Repair media blocks and relocate private GM notes
  --enrich-vault        Back up and enrich vault metadata and related links
  --keep-extraction     Keep temporary one2html output for debugging
  --help                Show this help

Dry-run is the default and never writes to the vault.`
}

function parseArgs(argv) {
  const options = {
    ...defaults,
    stage: false,
    approveAll: false,
    promote: false,
    finalize: false,
    enrichVault: false,
    forceStage: false,
    keepExtraction: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") options.help = true
    else if (arg === "--stage") options.stage = true
    else if (arg === "--approve-all") options.approveAll = true
    else if (arg === "--promote") options.promote = true
    else if (arg === "--finalize") options.finalize = true
    else if (arg === "--enrich-vault") options.enrichVault = true
    else if (arg === "--force-stage") {
      options.stage = true
      options.forceStage = true
    } else if (arg === "--keep-extraction") options.keepExtraction = true
    else if (["--source", "--vault", "--one2html"].includes(arg)) {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path`)
      options[arg.slice(2)] = value
      index += 1
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (
    [
      options.stage,
      options.approveAll,
      options.promote,
      options.finalize,
      options.enrichVault,
    ].filter(Boolean).length > 1
  ) {
    throw new Error(
      "Choose one of --stage, --approve-all, --promote, --finalize, or --enrich-vault",
    )
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  const vaultRoot = path.resolve(options.vault)
  if (!fs.existsSync(vaultRoot)) throw new Error(`Vault does not exist: ${vaultRoot}`)
  if (options.approveAll) {
    const report = await approveAllReview({ vaultRoot })
    console.log(JSON.stringify(report, null, 2))
    return
  }
  if (options.promote) {
    const report = await promoteImport({ vaultRoot })
    console.log(JSON.stringify(report, null, 2))
    return
  }
  if (options.finalize) {
    const repaired = await repairExistingMediaFromBackup({ vaultRoot })
    const relocated = await relocatePrivateGmThoughts({ vaultRoot })
    console.log(JSON.stringify({ repaired, relocated }, null, 2))
    return
  }
  if (options.enrichVault) {
    console.log(JSON.stringify(await enrichVault({ vaultRoot, apply: true }), null, 2))
    return
  }
  const sourceRoot = path.resolve(options.source)
  if (!fs.existsSync(sourceRoot)) throw new Error(`OneNote source does not exist: ${sourceRoot}`)
  const extractionRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "onenote-import-"))
  try {
    const conversion = await convertNotebooks({
      sourceRoot,
      repoRoot,
      binary: options.one2html,
      extractionRoot,
    })
    const inventory = await inventoryExtraction({ extractionRoot, vaultRoot })
    if (options.stage) {
      const result = await stageImport({ inventory, vaultRoot, force: options.forceStage })
      console.log(
        JSON.stringify({ reviewRoot: result.reviewRoot, summary: result.summary }, null, 2),
      )
    } else {
      console.log(
        JSON.stringify(
          { conversion: conversion.notebooks, summary: summarizeDryRun(inventory) },
          null,
          2,
        ),
      )
    }
  } finally {
    if (options.keepExtraction) console.error(`Kept extraction at ${extractionRoot}`)
    else await fsp.rm(extractionRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`import-onenote: ${error.message}`)
  process.exitCode = 1
})
