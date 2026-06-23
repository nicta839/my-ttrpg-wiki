#!/usr/bin/env node

import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { simplifySlug, slugifyFilePath } from "@quartz-community/utils"
import YAML from "yaml"

const DEFAULT_ROOT = "content"
const MAX_CLOUDFLARE_ASSET_BYTES = 25 * 1024 * 1024
const IGNORED_DIRS = new Set([".git", ".obsidian", ".quartz", "node_modules", "private"])

function posix(value) {
  return value.split(path.sep).join("/")
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, maxAssetBytes: MAX_CLOUDFLARE_ASSET_BYTES }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--root") {
      const value = argv[++index]
      if (!value || value.startsWith("--")) throw new Error("--root requires a path")
      options.root = value
    } else if (arg === "--max-asset-bytes") {
      const value = argv[++index]
      if (!value || value.startsWith("--")) throw new Error("--max-asset-bytes requires a number")
      options.maxAssetBytes = Number(value)
      if (!Number.isFinite(options.maxAssetBytes) || options.maxAssetBytes <= 0) {
        throw new Error("--max-asset-bytes must be a positive number")
      }
    } else if (arg === "--help" || arg === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return options
}

async function walkMarkdown(root) {
  const files = []
  async function visit(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(path.join(directory, entry.name))
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.join(directory, entry.name))
      }
    }
  }
  if (fs.existsSync(root)) await visit(root)
  return files
}

function findZoomMapBlocks(markdown) {
  const blocks = []
  const pattern = /^```zoommap[^\n]*\n([\s\S]*?)^```/gm
  for (const match of markdown.matchAll(pattern)) {
    blocks.push({
      yamlText: match[1],
      line: markdown.slice(0, match.index).split(/\r?\n/).length,
    })
  }
  return blocks
}

function resolveReadableFile(root, sourceFile, relative) {
  if (!relative || path.isAbsolute(relative)) return undefined
  const candidates = [
    path.resolve(path.dirname(sourceFile), relative),
    path.resolve(root, relative),
  ]
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile()
    } catch {
      return false
    }
  })
}

function mapImagePaths(config, markerData) {
  const paths = []
  if (typeof config.image === "string") paths.push(config.image)
  if (Array.isArray(config.imageBases)) {
    for (const base of config.imageBases) {
      if (typeof base === "string") paths.push(base)
      else if (typeof base?.path === "string") paths.push(base.path)
    }
  }
  if (Array.isArray(markerData?.bases)) {
    for (const base of markerData.bases) {
      if (typeof base === "string") paths.push(base)
      else if (typeof base?.path === "string") paths.push(base.path)
    }
  }
  if (Array.isArray(config.imageOverlays)) {
    for (const overlay of config.imageOverlays) {
      if (typeof overlay?.path === "string") paths.push(overlay.path)
    }
  }
  if (Array.isArray(markerData?.overlays)) {
    for (const overlay of markerData.overlays) {
      if (typeof overlay?.path === "string") paths.push(overlay.path)
    }
  }
  return [...new Set(paths)]
}

function encodePathForQuartz(link) {
  const slug = simplifySlug(slugifyFilePath(`${link}.md`))
  return slug === "/" ? "/" : `/${slug}`
}

function validateMarker({
  marker,
  markerIndex,
  layers,
  root,
  sourceFile,
  errors,
  warnings,
}) {
  const prefix = `${posix(path.relative(root, sourceFile))} marker ${markerIndex + 1}`
  if (!marker || typeof marker !== "object") {
    errors.push(`${prefix}: marker must be an object`)
    return
  }
  if (typeof marker.id !== "string" || marker.id.trim() === "") {
    errors.push(`${prefix}: marker id is required`)
  }
  if (typeof marker.x !== "number" || marker.x < 0 || marker.x > 1) {
    errors.push(`${prefix}: marker x must be a number from 0 to 1`)
  }
  if (typeof marker.y !== "number" || marker.y < 0 || marker.y > 1) {
    errors.push(`${prefix}: marker y must be a number from 0 to 1`)
  }
  if (typeof marker.layer !== "string" || !layers.has(marker.layer)) {
    errors.push(`${prefix}: marker layer must reference an existing layer`)
  }
  if (typeof marker.tooltip !== "string" || marker.tooltip.trim() === "") {
    warnings.push(`${prefix}: marker has no tooltip text`)
  }
  if (typeof marker.link === "string" && marker.link.trim() !== "") {
    const target = path.resolve(root, `${marker.link}.md`)
    if (!fs.existsSync(target)) {
      errors.push(`${prefix}: marker link does not resolve to a Markdown note: ${marker.link}`)
    }
    if (typeof marker.resolvedHref !== "string" || marker.resolvedHref.trim() === "") {
      errors.push(`${prefix}: marker with link must include resolvedHref`)
    } else {
      const expectedHref = encodePathForQuartz(marker.link)
      if (marker.resolvedHref !== expectedHref) {
        errors.push(
          `${prefix}: resolvedHref should be ${expectedHref} but found ${marker.resolvedHref}`,
        )
      }
    }
  }
  if (typeof marker.resolvedHref === "string" && /\s/.test(marker.resolvedHref)) {
    errors.push(`${prefix}: resolvedHref contains raw whitespace: ${marker.resolvedHref}`)
  }
}

async function validateMapBlock({ root, sourceFile, block, maxAssetBytes, errors, warnings }) {
  const relativeSource = posix(path.relative(root, sourceFile))
  let config
  try {
    config = YAML.parse(block.yamlText) ?? {}
  } catch (error) {
    errors.push(`${relativeSource}:${block.line}: invalid zoommap YAML: ${error.message}`)
    return
  }
  if (!config || Array.isArray(config) || typeof config !== "object") {
    errors.push(`${relativeSource}:${block.line}: zoommap block must be a YAML object`)
    return
  }

  const primaryImage = config.imageBases?.[0]?.path ?? config.image
  const markersRel = config.markers ?? (primaryImage ? `${primaryImage}.markers.json` : undefined)
  if (typeof markersRel !== "string" || markersRel.trim() === "") {
    errors.push(`${relativeSource}:${block.line}: zoommap block must reference marker data`)
    return
  }

  const markerFile = resolveReadableFile(root, sourceFile, markersRel)
  if (!markerFile) {
    errors.push(`${relativeSource}:${block.line}: marker sidecar not found: ${markersRel}`)
    return
  }

  let markerData
  try {
    markerData = JSON.parse(await fsp.readFile(markerFile, "utf8"))
  } catch (error) {
    errors.push(`${relativeSource}:${block.line}: invalid marker JSON ${markersRel}: ${error.message}`)
    return
  }

  const layers = new Set(
    Array.isArray(markerData.layers)
      ? markerData.layers
          .map((layer) => (typeof layer?.id === "string" ? layer.id : undefined))
          .filter(Boolean)
      : [],
  )
  if (layers.size === 0) errors.push(`${relativeSource}:${block.line}: marker data must define layers`)

  if (!Array.isArray(markerData.markers)) {
    errors.push(`${relativeSource}:${block.line}: marker data must define markers`)
  } else {
    markerData.markers.forEach((marker, markerIndex) =>
      validateMarker({
        marker,
        markerIndex,
        layers,
        root,
        sourceFile,
        errors,
        warnings,
      }),
    )
  }

  for (const imagePath of mapImagePaths(config, markerData)) {
    const imageFile = resolveReadableFile(root, sourceFile, imagePath)
    if (!imageFile) {
      errors.push(`${relativeSource}:${block.line}: map asset not found: ${imagePath}`)
      continue
    }
    const stat = await fsp.stat(imageFile)
    if (stat.size >= maxAssetBytes) {
      errors.push(
        `${relativeSource}:${block.line}: map asset is ${stat.size} bytes, at/above limit ${maxAssetBytes}: ${imagePath}`,
      )
    }
  }
}

export async function validateMaps({ root, maxAssetBytes = MAX_CLOUDFLARE_ASSET_BYTES } = {}) {
  const resolvedRoot = path.resolve(root ?? DEFAULT_ROOT)
  const errors = []
  const warnings = []
  let mapBlocks = 0

  for (const file of await walkMarkdown(resolvedRoot)) {
    const markdown = await fsp.readFile(file, "utf8")
    const blocks = findZoomMapBlocks(markdown)
    mapBlocks += blocks.length
    for (const block of blocks) {
      await validateMapBlock({
        root: resolvedRoot,
        sourceFile: file,
        block,
        maxAssetBytes,
        errors,
        warnings,
      })
    }
  }

  return {
    root: resolvedRoot,
    mapBlocks,
    errors,
    warnings,
    ok: errors.length === 0,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(`Usage: npm run validate:maps -- [--root <path>] [--max-asset-bytes <bytes>]`)
    return
  }

  const report = await validateMaps(options)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`validate-maps: ${error.message}`)
    process.exitCode = 1
  })
}
