import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

import { parse as parseHtml, serialize } from "parse5"
import sharp from "sharp"
import YAML from "yaml"

export const ONE2HTML = Object.freeze({
  version: "1.3.1",
  platform: "darwin-arm64",
  url: "https://github.com/msiemens/one2html/releases/download/v1.3.1/one2html-aarch64-apple-darwin.tar.gz",
  sha256: "28628daa44efe2d2293f36b94d1e7b2f2f2290280481ce9b6903358a7b183d08",
})

export const MEDIA_START = "<!-- onenote-media:start -->"
export const MEDIA_END = "<!-- onenote-media:end -->"
export const MAX_CLOUDFLARE_ASSET_BYTES = 25 * 1024 * 1024

export const NOTEBOOK_ROUTES = Object.freeze({
  "Worldbuilding 1": { setting: "Aylbyia", root: "settings/Aylbyia", mode: "media-only" },
  SOleria: { setting: "Soleria", root: "settings/Soleria", mode: "full" },
  "Spine of the world": {
    setting: "Spine of the World",
    root: "settings/Spine of the World",
    mode: "full",
  },
  "Worldbuilding 2": { setting: "Middleworld", root: "settings/Middleworld", mode: "full" },
  "In the ashes": { setting: "In the Ashes", root: "settings/In the Ashes", mode: "full" },
  "Tales of Fate": { setting: "Tales of Fate", root: "settings/Tales of Fate", mode: "full" },
  "My Notebook": { setting: "GM Thoughts", root: "GM-thoughts", mode: "mixed" },
  "Winter campaign": {
    setting: "Winter Campaign",
    root: "GM-thoughts/Winter Campaign",
    mode: "skip-empty",
  },
})

const CANONICAL_RULES = new Map(
  Object.entries({
    "pf2 char creation": "running-the-game/Homebrew/Character creation/PF2e variant.md",
    "falling to 0 hp": "running-the-game/Homebrew/Falling to 0HP.md",
    "variant attack rules": "running-the-game/Homebrew/Attacking with variants.md",
    shields: "running-the-game/Homebrew/Shields.md",
    feats: "running-the-game/Homebrew/Feats extra.md",
    "experience points": "running-the-game/Homebrew/Experience points.md",
    goals: "running-the-game/Homebrew/Goals.md",
    background: "running-the-game/Homebrew/Character creation/Backgrounds.md",
    flanking: "running-the-game/Homebrew/Flanking.md",
    resurrection: "running-the-game/Homebrew/Resurrection.md",
    "agency in the game": "running-the-game/DM-ing/Agency.md",
    "about the dm": "running-the-game/DM-ing/Dm-ing.md",
  }).map(([title, destination]) => [normalizeTitle(title), destination]),
)

const AYLBYIA_ALIASES = new Map(
  Object.entries({
    map: "settings/Aylbyia/index.md",
    "the orcs and goblinoids": "settings/Aylbyia/Factions/Orcs and Goblinoids.md",
    "shaidin shame made flesh": "settings/Aylbyia/Factions/Shaïdin.md",
    "the crystal smiths": "settings/Aylbyia/Organizations/Crystalsmith.md",
    "the delvers": "settings/Aylbyia/Organizations/Delvers.md",
    "founding myth of the world": "settings/Aylbyia/History/Founding myth.md",
    "an ordered society": "settings/Aylbyia/Society/A rigid society.md",
    "races of the world": "settings/Aylbyia/Society/Ancestries/Ancestries.md",
    "redsteel and silksteel": "settings/Aylbyia/Society/Redsteel.md",
    "the great houses of man": "settings/Aylbyia/Factions/The Great Houses of Humanity.md",
    "younger brother": "settings/Aylbyia/Regions/The Younger Brother.md",
    "the twilight": "settings/Aylbyia/Regions/Twilight.md",
  }).map(([title, destination]) => [normalizeTitle(title), destination]),
)

const GENERIC_SEPARATORS = new Map([
  ["introduction", "root"],
  ["history", "History"],
  ["geography", "Regions"],
  ["society", "Society"],
  ["the people", "Society"],
  ["people", "Society"],
  ["magic", "Cosmology"],
  ["metaphysics", "Cosmology"],
  ["religion", "Cosmology"],
  ["organizations", "Organizations"],
  ["organisation", "Organizations"],
  ["factions", "Factions"],
  ["threats", "Factions/Threats"],
  ["character creation", "Society/Character Creation"],
  ["homebrew", "canonical"],
  ["about the dm", "canonical"],
])

const TYPE_BY_FOLDER = new Map([
  ["History", "history"],
  ["Regions", "region"],
  ["Cosmology", "cosmology"],
  ["Society", "lore"],
  ["Factions", "faction"],
  ["Organizations", "organization"],
  ["NPCs", "npc"],
  ["Items", "item"],
  ["Campaign", "campaign"],
])

function posix(value) {
  return value.split(path.sep).join("/")
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

export function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file))
}

export function normalizeTitle(value = "") {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/^\s*-+\s*|\s*-+\s*$/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en")
}

export function cleanTitle(value = "") {
  return value
    .replace(/^\s*-+\s*|\s*-+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function safeFilename(value, fallback = "untitled") {
  const cleaned = cleanTitle(value)
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim()
  return cleaned || fallback
}

export function slug(value) {
  return normalizeTitle(value).replace(/\s+/g, "-") || "untitled"
}

export function safeAssetSlug(value) {
  const ascii = String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return ascii || `asset-${sha256Buffer(Buffer.from(String(value))).slice(0, 10)}`
}

function normalizeBody(value = "") {
  return value
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en")
}

function tokens(value) {
  return new Set(
    normalizeBody(value)
      .split(/\s+/)
      .filter((word) => word.length > 2),
  )
}

export function textSimilarity(left, right) {
  const a = tokens(left)
  const b = tokens(right)
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

export function splitFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { data: {}, body: markdown, raw: "" }
  let data = {}
  try {
    data = YAML.parse(match[1]) ?? {}
  } catch {
    data = {}
  }
  return { data, body: markdown.slice(match[0].length), raw: match[0] }
}

function getAttr(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value
}

function hasClass(node, className) {
  return (getAttr(node, "class") ?? "").split(/\s+/).includes(className)
}

function findAll(node, predicate, result = []) {
  if (predicate(node)) result.push(node)
  for (const child of node.childNodes ?? []) findAll(child, predicate, result)
  if (node.content) findAll(node.content, predicate, result)
  return result
}

function findOne(node, predicate) {
  if (predicate(node)) return node
  for (const child of node.childNodes ?? []) {
    const result = findOne(child, predicate)
    if (result) return result
  }
  return node.content ? findOne(node.content, predicate) : undefined
}

function textContent(node) {
  if (node.nodeName === "#text") return node.value ?? ""
  return (node.childNodes ?? []).map(textContent).join("")
}

function styleNumber(node, property) {
  const style = getAttr(node, "style") ?? ""
  const match = style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(-?[0-9.]+)px`, "i"))
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY
}

function collapseMarkdown(value) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
}

function renderInline(node, context) {
  if (node.nodeName === "#text") return (node.value ?? "").replace(/\u00a0/g, " ")
  const name = node.tagName ?? node.nodeName
  const content = (node.childNodes ?? []).map((child) => renderInline(child, context)).join("")
  if (["strong", "b"].includes(name)) return content.trim() ? `**${content.trim()}**` : content
  if (["em", "i"].includes(name)) return content.trim() ? `*${content.trim()}*` : content
  if (name === "s" || name === "del") return content.trim() ? `~~${content.trim()}~~` : content
  if (name === "code") return `\`${content.replace(/`/g, "\\`")}\``
  if (name === "br") return "\n"
  if (name === "a") {
    const href = getAttr(node, "href") ?? ""
    const label = content.trim() || href
    if (!href) return label
    const resolved = context.resolveLink?.(href)
    if (resolved) return `[[${resolved}|${label}]]`
    if (/^(https?:|mailto:)/i.test(href)) return `[${label}](${href})`
    return label
  }
  if (name === "img") return ""
  if (name === "math") return serialize(node)
  return content
}

function listMarkdown(node, context, depth = 0) {
  const ordered = node.tagName === "ol"
  const lines = []
  let index = 1
  for (const item of (node.childNodes ?? []).filter((child) => child.tagName === "li")) {
    const nested = (item.childNodes ?? []).filter((child) => ["ul", "ol"].includes(child.tagName))
    const inlineNodes = (item.childNodes ?? []).filter(
      (child) => !["ul", "ol"].includes(child.tagName),
    )
    const content = collapseMarkdown(
      inlineNodes.map((child) => renderInline(child, context)).join(""),
    )
    const prefix = ordered ? `${index}.` : "-"
    lines.push(`${"  ".repeat(depth)}${prefix} ${content}`.trimEnd())
    for (const child of nested) lines.push(listMarkdown(child, context, depth + 1))
    index += 1
  }
  return lines.join("\n")
}

function tableMarkdown(node, context) {
  const rows = findAll(node, (child) => child.tagName === "tr").map((row) =>
    (row.childNodes ?? [])
      .filter((cell) => ["td", "th"].includes(cell.tagName))
      .map((cell) => collapseMarkdown(renderInline(cell, context)).replace(/\|/g, "\\|")),
  )
  if (rows.length === 0) return ""
  const width = Math.max(...rows.map((row) => row.length))
  const padded = rows.map((row) => [...row, ...Array(width - row.length).fill("")])
  const line = (row) => `| ${row.join(" | ")} |`
  return [line(padded[0]), line(Array(width).fill("---")), ...padded.slice(1).map(line)].join("\n")
}

function blockMarkdown(node, context) {
  if (node.nodeName === "#text") return renderInline(node, context)
  const name = node.tagName ?? node.nodeName
  if (name === "img" || name === "script" || name === "style") return ""
  if (/^h[1-6]$/.test(name))
    return `${"#".repeat(Number(name[1]))} ${collapseMarkdown(renderInline(node, context))}\n\n`
  if (name === "p") return `${collapseMarkdown(renderInline(node, context))}\n\n`
  if (["ul", "ol"].includes(name)) return `${listMarkdown(node, context)}\n\n`
  if (name === "table") return `${tableMarkdown(node, context)}\n\n`
  if (name === "pre") return `\`\`\`\n${textContent(node).trim()}\n\`\`\`\n\n`
  if (name === "blockquote") {
    return `${collapseMarkdown(
      (node.childNodes ?? []).map((child) => blockMarkdown(child, context)).join(""),
    )
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`
  }
  if (["svg", "canvas"].includes(name)) {
    context.unsupported.add(name)
    return ""
  }
  const children = (node.childNodes ?? []).map((child) => blockMarkdown(child, context)).join("")
  return name === "div" ? `${children}\n` : children || renderInline(node, context)
}

export function htmlToMarkdown(html, options = {}) {
  const document = parseHtml(html)
  const body = findOne(document, (node) => node.tagName === "body")
  const unsupported = new Set()
  if (!body) return { markdown: "", unsupported: [] }
  const contentNodes = (body.childNodes ?? [])
    .filter(
      (node) =>
        !["script", "style"].includes(node.tagName) &&
        !(node.tagName === "div" && hasClass(node, "title")) &&
        node.nodeName !== "#text",
    )
    .sort(
      (a, b) =>
        styleNumber(a, "top") - styleNumber(b, "top") ||
        styleNumber(a, "left") - styleNumber(b, "left"),
    )
  const context = { resolveLink: options.resolveLink, unsupported }
  const markdown = collapseMarkdown(
    contentNodes.map((node) => blockMarkdown(node, context)).join("\n"),
  )
  return { markdown, unsupported: [...unsupported] }
}

export function extractImages(html, htmlPath) {
  const document = parseHtml(html)
  const images = findAll(document, (node) => node.tagName === "img")
  return images.map((node, order) => {
    const encodedSrc = getAttr(node, "src") ?? ""
    let src = encodedSrc
    try {
      src = decodeURIComponent(encodedSrc)
    } catch {
      // Keep the literal path when the HTML contains malformed percent encoding.
    }
    const sourcePath = path.resolve(path.dirname(htmlPath), src)
    return {
      order,
      sourcePath,
      sourceName: path.basename(src),
      alt: sanitizeAlt(getAttr(node, "alt") ?? "", path.basename(src)),
      top: styleNumber(node, "top"),
      left: styleNumber(node, "left"),
      renderedWidth: styleNumber(node, "max-width"),
      renderedHeight: styleNumber(node, "max-height"),
    }
  })
}

export function sanitizeAlt(value, filename) {
  const normalized = value.replace(/\s+/g, " ").trim()
  const suspicious = normalized.length > 160 || /[^\p{L}\p{N}\p{P}\p{Zs}]/u.test(normalized)
  if (normalized && !suspicious) return normalized
  return (
    cleanTitle(path.basename(filename, path.extname(filename)).replace(/[_-]+/g, " ")) ||
    "Imported illustration"
  )
}

function parseLinks(html) {
  const document = parseHtml(html)
  return findAll(document, (node) => node.tagName === "a").map((node) => ({
    href: getAttr(node, "href") ?? "",
    title: getAttr(node, "title") ?? textContent(node).trim(),
    level: Number((getAttr(node, "class") ?? "l1").match(/l([1-9])/)?.[1] ?? 1),
  }))
}

async function walkFiles(root, predicate = () => true) {
  const result = []
  if (!fs.existsSync(root)) return result
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await walkFiles(file, predicate)))
    else if (entry.isFile() && predicate(file)) result.push(file)
  }
  return result
}

async function download(url, destination, redirects = 5) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location &&
        redirects > 0
      ) {
        response.resume()
        download(new URL(response.headers.location, url).href, destination, redirects - 1).then(
          resolve,
          reject,
        )
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`))
        return
      }
      const output = fs.createWriteStream(destination, { mode: 0o600 })
      response.pipe(output)
      output.on("finish", () => output.close(resolve))
      output.on("error", reject)
    })
    request.on("error", reject)
  })
}

export async function ensureOne2html(repoRoot, explicitBinary) {
  const supplied = explicitBinary || process.env.ONE2HTML_BIN
  if (supplied) {
    const resolved = path.resolve(supplied)
    if (!fs.existsSync(resolved)) throw new Error(`ONE2HTML_BIN does not exist: ${resolved}`)
    return resolved
  }
  if (`${process.platform}-${process.arch}` !== ONE2HTML.platform) {
    throw new Error(
      `Automatic one2html bootstrap supports ${ONE2HTML.platform}; set ONE2HTML_BIN for this platform.`,
    )
  }
  const cache = path.join(repoRoot, ".quartz-cache", "one2html", `v${ONE2HTML.version}`)
  const binary = path.join(cache, "one2html")
  if (fs.existsSync(binary)) return binary
  const archive = path.join(cache, "one2html.tar.gz")
  await download(ONE2HTML.url, archive)
  const actual = sha256File(archive)
  if (actual !== ONE2HTML.sha256)
    throw new Error(`one2html checksum mismatch: expected ${ONE2HTML.sha256}, got ${actual}`)
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", cache], { encoding: "utf8" })
  if (extracted.status !== 0) throw new Error(`Could not extract one2html: ${extracted.stderr}`)
  await fsp.chmod(binary, 0o755)
  return binary
}

export async function convertNotebooks({ sourceRoot, repoRoot, binary, extractionRoot }) {
  const notebooks = Object.keys(NOTEBOOK_ROUTES).filter((name) =>
    fs.existsSync(path.join(sourceRoot, name, "Open Notebook.onetoc2")),
  )
  const tocFiles = notebooks.map((name) => path.join(sourceRoot, name, "Open Notebook.onetoc2"))
  if (tocFiles.length === 0)
    throw new Error(`No active notebook table-of-contents files found in ${sourceRoot}`)
  const one2html = await ensureOne2html(repoRoot, binary)
  await fsp.mkdir(extractionRoot, { recursive: true })
  const result = spawnSync(one2html, ["--input", ...tocFiles, "--output", extractionRoot], {
    encoding: "utf8",
    env: { ...process.env, RUST_LOG: "error" },
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`one2html failed:\n${result.stdout}\n${result.stderr}`)
  return { notebooks, stdout: result.stdout, stderr: result.stderr }
}

export async function readVaultNotes(vaultRoot) {
  const files = await walkFiles(
    vaultRoot,
    (file) => file.endsWith(".md") && !file.includes(`${path.sep}private${path.sep}`),
  )
  return files.map((file) => {
    const raw = fs.readFileSync(file, "utf8")
    const { data, body } = splitFrontmatter(raw)
    const relative = posix(path.relative(vaultRoot, file))
    const title = String(data.title ?? path.basename(file, ".md"))
    return {
      file,
      relative,
      raw,
      body,
      title,
      normalizedTitle: normalizeTitle(title),
      normalizedBody: normalizeBody(body),
      sha256: sha256Buffer(Buffer.from(raw)),
    }
  })
}

function resolveHtmlLink(href, fromFile) {
  if (!href) return undefined
  const clean = href.split(/[?#]/)[0]
  let decoded = clean
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    // Use the encoded href when decoding fails.
  }
  if (!/\.html$/i.test(decoded)) return undefined
  return path.resolve(path.dirname(fromFile), decoded)
}

export async function inventoryExtraction({ extractionRoot, vaultRoot }) {
  const vaultNotes = await readVaultNotes(vaultRoot)
  const pages = []
  const skippedNotebooks = []
  for (const [notebook, route] of Object.entries(NOTEBOOK_ROUTES)) {
    const notebookIndex = path.join(extractionRoot, `${notebook}.html`)
    if (!fs.existsSync(notebookIndex)) {
      skippedNotebooks.push({ notebook, reason: "no converted notebook index" })
      continue
    }
    const sectionCandidates = parseLinks(await fsp.readFile(notebookIndex, "utf8"))
    const sections = [
      ...new Map(sectionCandidates.map((section) => [section.href, section])).values(),
    ]
    if (sections.length === 0) {
      skippedNotebooks.push({ notebook, reason: "no active sections or pages" })
      continue
    }
    for (const sectionLink of sections) {
      const sectionFile = resolveHtmlLink(sectionLink.href, notebookIndex)
      if (!sectionFile || !fs.existsSync(sectionFile)) continue
      const section = cleanTitle(sectionLink.title)
      const pageLinks = parseLinks(await fsp.readFile(sectionFile, "utf8"))
      let context = { category: undefined, region: undefined, separator: undefined }
      for (let order = 0; order < pageLinks.length; order += 1) {
        const link = pageLinks[order]
        const htmlPath = resolveHtmlLink(link.href, sectionFile)
        if (!htmlPath || !fs.existsSync(htmlPath)) continue
        const title = cleanTitle(link.title || path.basename(htmlPath, ".html"))
        const normalizedTitle = normalizeTitle(title)
        const separator = isSeparatorTitle(link.title)
        if (separator) context = updateContext(context, normalizedTitle, section)
        const html = await fsp.readFile(htmlPath, "utf8")
        const converted = htmlToMarkdown(html)
        const images = extractImages(html, htmlPath).filter((image) =>
          fs.existsSync(image.sourcePath),
        )
        const id = sha256Buffer(
          Buffer.from(`${notebook}\0${section}\0${posix(path.relative(extractionRoot, htmlPath))}`),
        ).slice(0, 16)
        pages.push({
          id,
          notebook,
          setting: route.setting,
          mode: route.mode,
          section,
          level: link.level,
          order,
          title,
          originalTitle: link.title,
          normalizedTitle,
          separator,
          context: { ...context },
          htmlPath,
          sourceRelative: posix(path.relative(extractionRoot, htmlPath)),
          markdown: converted.markdown,
          unsupported: converted.unsupported,
          images,
        })
      }
    }
  }

  for (const page of pages) proposePage(page, pages, vaultNotes)
  const destinationByHtml = new Map(
    pages
      .filter((page) => page.destination)
      .map((page) => [path.resolve(page.htmlPath), page.destination]),
  )
  for (const page of pages) {
    const html = await fsp.readFile(page.htmlPath, "utf8")
    page.markdown = htmlToMarkdown(html, {
      resolveLink: (href) => {
        const linked = resolveHtmlLink(href, page.htmlPath)
        const destination = linked ? destinationByHtml.get(path.resolve(linked)) : undefined
        return destination ? destination.replace(/\.md$/i, "") : undefined
      },
    }).markdown
    classifyPage(page, vaultNotes)
  }
  reconcileImportedDuplicates(pages)
  return { pages, vaultNotes, skippedNotebooks }
}

export function isSeparatorTitle(title) {
  return /^\s*-{1,}.*-{1,}\s*$/.test(title ?? "")
}

function updateContext(previous, normalizedTitle, section) {
  const generic = GENERIC_SEPARATORS.get(normalizedTitle)
  if (generic === "root") return { category: "root", region: undefined, separator: normalizedTitle }
  if (generic && generic !== "canonical")
    return { category: generic, region: undefined, separator: normalizedTitle }
  if (generic === "canonical")
    return { category: "canonical", region: undefined, separator: normalizedTitle }
  if (/world|geography/i.test(section)) {
    return {
      category: "Regions",
      region: cleanTitle(normalizedTitle).replace(/\b\w/g, (letter) => letter.toUpperCase()),
      separator: normalizedTitle,
    }
  }
  return previous
}

function inferFolder(page) {
  const section = normalizeTitle(page.section)
  const title = page.normalizedTitle
  if (/factions?/.test(section)) return "Factions"
  if (/organi[sz]ation/.test(section)) return "Organizations"
  if (/items?/.test(section)) return "Items"
  if (/characters met|npcs?/.test(section)) return "NPCs"
  if (/players?/.test(section)) return "Campaign/Players"
  if (/session|campaign/.test(section)) return "Campaign"
  if (/character creation/.test(section)) return "Society/Character Creation"
  if (/general ideas|articulating ideas|high level concept/.test(section)) return "GM-thoughts"
  if (/religion|magic|planes?|pantheon|metaphysics/.test(title)) return "Cosmology"
  if (/histor|story so far|origin myth|founding myth|timeline/.test(title)) return "History"
  if (/ancestr|language|society|people|culture/.test(title)) return "Society"
  if (/map|geograph/.test(title)) return "Regions"
  return page.context.category && page.context.category !== "root" ? page.context.category : "World"
}

function privateGmDestination(setting, title) {
  return `GM-thoughts/${safeFilename(setting)}/${safeFilename(title)}.md`
}

function routeMixedNotebook(page) {
  const source = normalizeTitle(`${page.section} ${page.title}`)
  if (source.includes("stuff for spine of the world"))
    return `GM-thoughts/Spine of the World/${safeFilename(page.title)}.md`
  if (source.includes("some stuff for worldbuilding 1"))
    return `GM-thoughts/Aylbyia/${safeFilename(page.title)}.md`
  if (source.includes("the middleworld") && page.normalizedTitle.includes("founding myth")) {
    return `settings/Middleworld/History/${safeFilename(page.title)}.md`
  }
  return `GM-thoughts/${safeFilename(page.section)}/${safeFilename(page.title)}.md`
}

function proposePage(page, allPages, vaultNotes) {
  const route = NOTEBOOK_ROUTES[page.notebook]
  const canonical = CANONICAL_RULES.get(page.normalizedTitle)
  if (canonical) {
    page.destination = canonical
    page.proposedAction = "canonical-link"
    return
  }
  if (route.mode === "media-only") {
    const alias = AYLBYIA_ALIASES.get(page.normalizedTitle)
    const exact = vaultNotes.find(
      (note) =>
        note.relative.startsWith("settings/Aylbyia/") &&
        note.normalizedTitle === page.normalizedTitle,
    )
    const withoutThe = page.normalizedTitle.replace(/^the /, "")
    const loose = vaultNotes.find(
      (note) =>
        note.relative.startsWith("settings/Aylbyia/") &&
        note.normalizedTitle.replace(/^the /, "") === withoutThe,
    )
    page.destination = alias ?? exact?.relative ?? loose?.relative
    page.proposedAction =
      page.images.length > 0 ? (page.destination ? "media-only" : "conflict") : "skip"
    return
  }
  if (route.mode === "mixed") {
    page.destination = routeMixedNotebook(page)
    page.proposedAction = "new"
    return
  }
  const folder = inferFolder(page)
  if (folder === "canonical") {
    page.proposedAction = "skip"
    return
  }
  if (folder === "GM-thoughts") {
    page.destination = privateGmDestination(route.setting, page.title)
    page.proposedAction = "new"
    return
  }
  const base = route.root
  const cleaned = safeFilename(page.title)
  if (page.separator && GENERIC_SEPARATORS.get(page.normalizedTitle) === "root") {
    page.destination = `${base}/index.md`
  } else if (page.separator && GENERIC_SEPARATORS.has(page.normalizedTitle)) {
    page.destination = `${base}/${folder}/index.md`
  } else if (page.context.region && /world|geography/i.test(page.section)) {
    const region = safeFilename(page.context.region)
    page.destination = page.separator
      ? `${base}/Regions/${region}.md`
      : `${base}/Regions/${region}/${cleaned}.md`
  } else {
    page.destination = `${base}/${folder}/${cleaned}.md`
  }
  page.proposedAction = "new"
}

function classifyPage(page, vaultNotes) {
  const noContent = !normalizeBody(page.markdown) && page.images.length === 0
  if (noContent) {
    page.action = "skip"
    page.reason = "empty page"
    return
  }
  if (page.mode === "media-only") {
    page.action = page.images.length === 0 ? "skip" : page.destination ? "media-only" : "conflict"
    page.reason =
      page.action === "conflict" ? "Aylbyia image page has no unambiguous existing note" : undefined
    return
  }
  const destinationNote = page.destination
    ? vaultNotes.find((note) => note.relative === page.destination)
    : undefined
  const normalized = normalizeBody(page.markdown)
  if (destinationNote) {
    const exact = normalized && normalized === destinationNote.normalizedBody
    const similarity = textSimilarity(page.markdown, destinationNote.body)
    page.similarity = similarity
    if (exact) {
      page.action = page.proposedAction === "canonical-link" ? "canonical-link" : "duplicate"
      page.reason = "exact normalized body match"
    } else if (page.proposedAction === "canonical-link" && similarity >= 0.9) {
      page.action = "canonical-link"
      page.reason = `canonical rule match (${similarity.toFixed(2)})`
    } else {
      page.action = "conflict"
      page.reason = `destination exists with different content (${similarity.toFixed(2)})`
    }
    page.targetSha256 = destinationNote.sha256
    return
  }
  if (page.proposedAction === "canonical-link") {
    page.action = "conflict"
    page.reason = "canonical destination is missing"
    return
  }
  const sameTitle = vaultNotes.filter((note) => note.normalizedTitle === page.normalizedTitle)
  const exactElsewhere = sameTitle.find(
    (note) => note.normalizedBody && note.normalizedBody === normalized,
  )
  if (exactElsewhere) {
    page.action = "duplicate"
    page.destination = exactElsewhere.relative
    page.reason = "exact duplicate at another vault path"
    return
  }
  const probableElsewhere = sameTitle
    .map((note) => ({ note, similarity: textSimilarity(page.markdown, note.body) }))
    .filter((candidate) => candidate.similarity >= 0.65)
  if (probableElsewhere.length > 0 && !["index", "timeline"].includes(page.normalizedTitle)) {
    page.action = "conflict"
    page.reason = `probable duplicate content: ${probableElsewhere
      .map((candidate) => `${candidate.note.relative} (${candidate.similarity.toFixed(2)})`)
      .join(", ")}`
    return
  }
  page.action = page.proposedAction ?? "new"
}

function reconcileImportedDuplicates(pages) {
  const active = pages.filter((page) => !["skip", "duplicate"].includes(page.action))
  const byDestination = Map.groupBy(
    active.filter((page) => page.destination),
    (page) => page.destination,
  )
  for (const group of byDestination.values()) {
    if (group.length < 2) continue
    if (group.every((page) => page.action === "media-only")) continue
    const [first, ...rest] = group
    const firstBody = normalizeBody(first.markdown)
    const firstImages = first.images
      .map((image) => sha256File(image.sourcePath))
      .sort()
      .join(":")
    for (const page of rest) {
      const sameBody = firstBody === normalizeBody(page.markdown)
      const sameImages =
        firstImages ===
        page.images
          .map((image) => sha256File(image.sourcePath))
          .sort()
          .join(":")
      if (sameBody && sameImages) {
        page.action = "duplicate"
        page.reason = `exact duplicate of ${first.notebook}/${first.section}/${first.title}`
      } else {
        first.action = "conflict"
        first.reason = `multiple source pages propose ${first.destination}`
        page.action = "conflict"
        page.reason = `multiple source pages propose ${page.destination}`
      }
    }
  }

  const contentCandidates = pages.filter(
    (page) => page.action === "new" && normalizeBody(page.markdown).length >= 80,
  )
  const exactGroups = Map.groupBy(contentCandidates, (page) => {
    const bodyHash = sha256Buffer(Buffer.from(normalizeBody(page.markdown)))
    const imageHash = page.images
      .map((image) => sha256File(image.sourcePath))
      .sort()
      .join(":")
    return `${bodyHash}:${imageHash}`
  })
  for (const group of exactGroups.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => {
      const aScore = a.destination?.startsWith("running-the-game/")
        ? 0
        : a.destination?.startsWith("GM-thoughts/")
          ? 2
          : 1
      const bScore = b.destination?.startsWith("running-the-game/")
        ? 0
        : b.destination?.startsWith("GM-thoughts/")
          ? 2
          : 1
      return aScore - bScore || a.sourceRelative.localeCompare(b.sourceRelative)
    })
    const [canonical, ...duplicates] = sorted
    for (const page of duplicates) {
      page.action = "duplicate"
      page.destination = canonical.destination
      page.reason = `exact imported duplicate of ${canonical.notebook}/${canonical.section}/${canonical.title}`
    }
  }

  const titleGroups = Map.groupBy(
    pages.filter((page) => page.action === "new" && page.normalizedTitle.length > 3),
    (page) => page.normalizedTitle,
  )
  for (const group of titleGroups.values()) {
    if (group.length < 2) continue
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const a = group[left]
        const b = group[right]
        const similarity = textSimilarity(a.markdown, b.markdown)
        if (similarity < 0.65) continue
        a.action = "conflict"
        b.action = "conflict"
        a.reason = `probable imported duplicate of ${b.notebook}/${b.section}/${b.title} (${similarity.toFixed(2)})`
        b.reason = `probable imported duplicate of ${a.notebook}/${a.section}/${a.title} (${similarity.toFixed(2)})`
      }
    }
  }
}

export function detectMagicType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "png"
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg"
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "webp"
  if (
    buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
    buffer.subarray(0, 6).toString("ascii") === "GIF89a"
  )
    return "gif"
  return "unknown"
}

export function buildFrontmatter(page) {
  const relative = page.destination ?? ""
  const route = NOTEBOOK_ROUTES[page.notebook]
  const setting = relative.startsWith("settings/") ? relative.split("/")[1] : route.setting
  const folder = relative.split("/").find((part) => TYPE_BY_FOLDER.has(part))
  const type =
    TYPE_BY_FOLDER.get(folder) ?? (relative.startsWith("GM-thoughts/") ? "gm-note" : "lore")
  return {
    title: page.title,
    type,
    ...(relative.startsWith("settings/") ? { setting } : {}),
    tags: [
      ...(relative.startsWith("settings/") ? [`setting/${slug(setting)}`] : ["gm-thoughts"]),
      `type/${type}`,
    ],
    onenote_source: `${page.notebook}/${page.section}/${page.title}`,
  }
}

export function renderNewNote(page, mediaBlock = "") {
  const frontmatter = YAML.stringify(buildFrontmatter(page)).trimEnd()
  const body = page.markdown.trim()
  const withMedia = mediaBlock
    ? insertAfterFirstParagraph(body, `${MEDIA_START}\n${mediaBlock}\n${MEDIA_END}`)
    : body
  return `---\n${frontmatter}\n---\n${withMedia ? `\n${withMedia}\n` : ""}`
}

function insertAfterFirstParagraph(markdown, block) {
  if (!markdown.trim()) return block
  const lines = markdown.split(/\r?\n/)
  let start = 0
  while (start < lines.length && (!lines[start].trim() || /^#\s/.test(lines[start]))) start += 1
  let end = start
  while (end < lines.length && lines[end].trim()) end += 1
  lines.splice(end, 0, "", block, "")
  return lines.join("\n").replace(/\n{3,}/g, "\n\n")
}

export function upsertMediaBlock(markdown, mediaBlock) {
  const replacement = `${MEDIA_START}\n${mediaBlock.trim()}\n${MEDIA_END}`
  const start = markdown.indexOf(MEDIA_START)
  const end = markdown.indexOf(MEDIA_END)
  if (start >= 0 && end > start) {
    return `${markdown.slice(0, start)}${replacement}${markdown.slice(end + MEDIA_END.length)}`
  }
  const { raw, body } = splitFrontmatter(markdown)
  const paragraphBreak = body.search(/\r?\n\r?\n/)
  if (paragraphBreak >= 0) {
    const firstNewlineLength = body[paragraphBreak] === "\r" ? 2 : 1
    const insertion = paragraphBreak + firstNewlineLength
    const newline = firstNewlineLength === 2 ? "\r\n" : "\n"
    return `${raw}${body.slice(0, insertion)}${replacement}${newline}${body.slice(insertion)}`
  }
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n"
  return `${markdown}${markdown.endsWith(newline) ? "" : newline}${replacement}${newline}`
}

export function removeMediaBlock(markdown) {
  const pattern = new RegExp(
    `${MEDIA_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${MEDIA_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\r?\\n)?`,
    "g",
  )
  return markdown.replace(pattern, "")
}

export async function repairExistingMediaFromBackup({ vaultRoot }) {
  const reportFile = path.join(
    vaultRoot,
    "private",
    "onenote-import-review",
    "promotion-report.json",
  )
  if (!fs.existsSync(reportFile)) throw new Error(`Promotion report not found: ${reportFile}`)
  const report = JSON.parse(await fsp.readFile(reportFile, "utf8"))
  const backupRoot = path.join(vaultRoot, report.backupRoot)
  const backupFiles = await walkFiles(backupRoot, (file) => file.endsWith(".md"))
  let repaired = 0
  for (const backupFile of backupFiles) {
    const relative = path.relative(backupRoot, backupFile)
    const destination = path.join(vaultRoot, relative)
    const current = await fsp.readFile(destination, "utf8")
    const start = current.indexOf(MEDIA_START)
    const end = current.indexOf(MEDIA_END)
    if (start < 0 || end <= start) continue
    const mediaBlock = current.slice(start + MEDIA_START.length, end).trim()
    const original = await fsp.readFile(backupFile, "utf8")
    await writeAtomic(destination, upsertMediaBlock(original, mediaBlock))
    repaired += 1
  }
  return { repaired, backupRoot: report.backupRoot }
}

export async function relocatePrivateGmThoughts({ vaultRoot }) {
  const reviewRoot = path.join(vaultRoot, "private", "onenote-import-review")
  const reviewFile = path.join(reviewRoot, "review.yaml")
  const review = YAML.parse(await fsp.readFile(reviewFile, "utf8"))
  const relocations = []

  for (const page of review.pages) {
    const match = String(page.destination ?? "").match(/^settings\/([^/]+)\/GM-thoughts\/(.+\.md)$/)
    if (!match) continue
    const sourceRelative = page.destination
    const destinationRelative = `GM-thoughts/${match[1]}/${match[2]}`
    const source = path.join(vaultRoot, sourceRelative)
    const destination = path.join(vaultRoot, destinationRelative)
    let materialized = fs.existsSync(destination)
    if (fs.existsSync(source)) {
      if (fs.existsSync(destination)) {
        const [sourceBody, destinationBody] = await Promise.all([
          fsp.readFile(source),
          fsp.readFile(destination),
        ])
        if (!sourceBody.equals(destinationBody)) {
          throw new Error(`GM-thoughts relocation collision: ${destinationRelative}`)
        }
        await fsp.unlink(source)
      } else {
        await fsp.mkdir(path.dirname(destination), { recursive: true })
        await fsp.rename(source, destination)
      }
      materialized = true
    } else if (!materialized && page.approved && ["new", "media-only"].includes(page.action)) {
      throw new Error(`GM-thoughts source is missing: ${sourceRelative}`)
    }
    page.destination = destinationRelative
    page.publish = false
    if (materialized) relocations.push({ from: sourceRelative, to: destinationRelative })
  }

  await writeAtomic(reviewFile, YAML.stringify(review, { lineWidth: 0 }))
  const promotionReportFile = path.join(reviewRoot, "promotion-report.json")
  if (fs.existsSync(promotionReportFile)) {
    const promotionReport = JSON.parse(await fsp.readFile(promotionReportFile, "utf8"))
    const moved = new Map(relocations.map(({ from, to }) => [from, to]))
    promotionReport.touched = promotionReport.touched.map(
      (relative) => moved.get(relative) ?? relative,
    )
    promotionReport.privateRelocations = relocations
    await writeAtomic(promotionReportFile, `${JSON.stringify(promotionReport, null, 2)}\n`)
  }

  for (const { from } of relocations) {
    const directory = path.dirname(path.join(vaultRoot, from))
    try {
      await fsp.rmdir(directory)
    } catch (error) {
      if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error
    }
  }
  return { relocated: relocations.length, relocations }
}

function relativeMarkdownPath(fromVaultRelative, toVaultRelative) {
  const relative = posix(path.relative(path.dirname(fromVaultRelative), toVaultRelative))
  return encodeURI(relative || path.basename(toVaultRelative)).replace(/#/g, "%23")
}

function chooseHero(associations, mediaById, pageTitle) {
  if (associations.length === 0) return undefined
  const mapCandidate = associations.find((item) => /map/i.test(`${pageTitle} ${item.sourceName}`))
  if (mapCandidate) return mapCandidate.id
  return [...associations].sort((left, right) => {
    const a = mediaById.get(left.id)
    const b = mediaById.get(right.id)
    const leftArea = Number.isFinite(left.renderedWidth * left.renderedHeight)
      ? left.renderedWidth * left.renderedHeight
      : (a?.width ?? 0) * (a?.height ?? 0)
    const rightArea = Number.isFinite(right.renderedWidth * right.renderedHeight)
      ? right.renderedWidth * right.renderedHeight
      : (b?.width ?? 0) * (b?.height ?? 0)
    return rightArea - leftArea || left.top - right.top || left.order - right.order
  })[0]?.id
}

function renderImageLink(association, media, noteRelative, staged) {
  const variants = staged
    ? (media.stagedVariants ?? media.staged_variants)
    : (media.finalVariants ?? media.final_variants)
  const preview = variants[association.role === "hero" ? "1600" : "800"] ?? variants.full
  const full = variants.full ?? preview
  const previewHref = relativeMarkdownPath(noteRelative, preview)
  const fullHref = relativeMarkdownPath(noteRelative, full)
  const alt = association.alt.replace(/[\[\]]/g, "")
  return `[![${alt}](${previewHref})](${fullHref})`
}

export function renderMediaBlock(pageEntry, mediaById, noteRelative, staged = false) {
  const approved = pageEntry.media.filter((association) => {
    const media = mediaById.get(association.id)
    return media && (staged || media.approved)
  })
  if (approved.length === 0) return ""
  const hero = approved.find((association) => association.role === "hero")
  const gallery = approved.filter((association) => association.role !== "hero")
  const blocks = []
  if (hero) {
    blocks.push(
      `> [!onenote-hero]\n> ${renderImageLink(hero, mediaById.get(hero.id), noteRelative, staged)}`,
    )
  }
  if (gallery.length > 0) {
    const lines = gallery.flatMap((association, index) => [
      `> ${renderImageLink(association, mediaById.get(association.id), noteRelative, staged)}`,
      ...(index < gallery.length - 1 ? [">"] : []),
    ])
    blocks.push(`> [!onenote-gallery]\n${lines.join("\n")}`)
  }
  return blocks.join("\n\n")
}

async function optimizeMedia(sourcePath, outputRoot, hash, sourceName) {
  const image = sharp(sourcePath, { failOn: "warning" }).rotate()
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height)
    throw new Error(`Could not read image dimensions: ${sourcePath}`)
  const mapLike =
    /map|world|middleworld|campaign/i.test(sourceName) ||
    metadata.width > 3000 ||
    metadata.height > 3000
  const widths = [
    ...new Set(
      [800, 1600, Math.min(4096, metadata.width)].filter((width) => width <= metadata.width),
    ),
  ].sort((a, b) => a - b)
  if (widths.length === 0) widths.push(metadata.width)
  const variantRoot = path.join(outputRoot, hash)
  await fsp.mkdir(variantRoot, { recursive: true })
  const variants = {}
  for (const width of widths) {
    const label = width === widths.at(-1) ? "full" : String(width)
    const destination = path.join(variantRoot, `${label}.webp`)
    let quality = mapLike ? 90 : 86
    let result
    while (quality >= 70) {
      result = await sharp(sourcePath)
        .rotate()
        .resize({ width, fit: "inside", withoutEnlargement: true })
        .webp({ quality, effort: 6, smartSubsample: true, nearLossless: mapLike })
        .toFile(destination)
      if (result.size < MAX_CLOUDFLARE_ASSET_BYTES) break
      quality -= 5
    }
    if (!result || result.size >= MAX_CLOUDFLARE_ASSET_BYTES) {
      throw new Error(`Optimized asset still exceeds Cloudflare's 25 MiB limit: ${destination}`)
    }
    variants[label] = destination
  }
  if (!variants["800"]) variants["800"] = variants[Object.keys(variants)[0]]
  if (!variants["1600"]) variants["1600"] = variants.full ?? variants[Object.keys(variants).at(-1)]
  if (!variants.full) variants.full = variants[Object.keys(variants).at(-1)]
  return {
    width: metadata.width,
    height: metadata.height,
    sourceFormat: metadata.format,
    variants,
    mapLike,
  }
}

function proposedAssetRoot(page, image, hash) {
  const noteSlug = safeAssetSlug(path.basename(page.destination ?? page.title, ".md"))
  const imageSlug = safeAssetSlug(path.basename(image.sourceName, path.extname(image.sourceName)))
  if ((page.destination ?? "").startsWith("GM-thoughts/")) {
    return `GM-thoughts/assets/onenote/${noteSlug}/${imageSlug}-${hash.slice(0, 10)}`
  }
  return `assets/${safeAssetSlug(page.setting)}/${noteSlug}/${imageSlug}-${hash.slice(0, 10)}`
}

export async function prepareMedia({ pages, vaultRoot, reviewRelative }) {
  const mediaRootRelative = `${reviewRelative}/media`
  const mediaRoot = path.join(vaultRoot, mediaRootRelative)
  const mediaByHash = new Map()
  const pageAssociations = new Map()
  for (const page of pages) {
    const associations = []
    for (const image of page.images) {
      const sourceBuffer = await fsp.readFile(image.sourcePath)
      const hash = sha256Buffer(sourceBuffer)
      let media = mediaByHash.get(hash)
      if (!media) {
        const magicType = detectMagicType(sourceBuffer)
        media = {
          id: hash.slice(0, 16),
          sha256: hash,
          sourcePath: image.sourcePath,
          sourceName: image.sourceName,
          detectedType: magicType,
          associations: [],
          approved: false,
        }
        mediaByHash.set(hash, media)
      }
      const association = {
        id: media.id,
        alt: image.alt,
        sourceName: image.sourceName,
        order: image.order,
        top: image.top,
        left: image.left,
        renderedWidth: image.renderedWidth,
        renderedHeight: image.renderedHeight,
      }
      media.associations.push({ pageId: page.id, source: page.sourceRelative })
      associations.push(association)
    }
    pageAssociations.set(page.id, associations)
  }

  const mediaById = new Map()
  for (const media of mediaByHash.values()) {
    const optimized = await optimizeMedia(
      media.sourcePath,
      mediaRoot,
      media.sha256,
      media.sourceName,
    )
    Object.assign(media, optimized)
    media.stagedVariants = Object.fromEntries(
      Object.entries(optimized.variants).map(([name, file]) => [
        name,
        posix(path.relative(vaultRoot, file)),
      ]),
    )
    const ownerAssociation = media.associations
      .map((association) => pages.find((page) => page.id === association.pageId))
      .find((page) => page?.destination)
    const ownerPage =
      ownerAssociation ??
      pages.find((page) => page.images.some((image) => image.sourcePath === media.sourcePath))
    const ownerImage = ownerPage?.images.find(
      (image) => sha256File(image.sourcePath) === media.sha256,
    ) ?? {
      sourceName: media.sourceName,
    }
    const assetRoot = proposedAssetRoot(ownerPage, ownerImage, media.sha256)
    media.finalVariants = Object.fromEntries(
      Object.keys(media.stagedVariants).map((name) => [name, `${assetRoot}-${name}.webp`]),
    )
    mediaById.set(media.id, media)
  }

  for (const page of pages) {
    const associations = pageAssociations.get(page.id) ?? []
    const heroId = chooseHero(associations, mediaById, page.title)
    page.media = associations
      .sort((a, b) => a.top - b.top || a.left - b.left || a.order - b.order)
      .map((association) => ({
        ...association,
        role: association.id === heroId ? "hero" : "gallery",
      }))
  }
  return mediaById
}

function summaryFor(pages, mediaById, skippedNotebooks) {
  const actions = {}
  for (const page of pages) actions[page.action] = (actions[page.action] ?? 0) + 1
  return {
    generatedAt: new Date().toISOString(),
    pages: pages.length,
    actions,
    mediaReferences: pages.reduce((total, page) => total + page.images.length, 0),
    uniqueMedia:
      mediaById?.size ??
      new Set(pages.flatMap((page) => page.images.map((image) => sha256File(image.sourcePath))))
        .size,
    skippedNotebooks,
  }
}

function csvCell(value) {
  const string = String(value ?? "")
  return /[",\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string
}

function buildReport(summary, pageEntries, mediaEntries) {
  const lines = [
    "# OneNote import review",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "Nothing in this directory is published by Quartz. Edit `review.yaml`, setting `approved: true` only after reviewing an entry.",
    "",
    "## Inventory",
    "",
    `- Source page artifacts: ${summary.pages}`,
    `- Media references: ${summary.mediaReferences}`,
    `- Unique media files: ${summary.uniqueMedia}`,
    ...Object.entries(summary.actions).map(([action, count]) => `- ${action}: ${count}`),
    "",
    "## Conflicts",
    "",
  ]
  const conflicts = pageEntries.filter((page) => page.action === "conflict")
  if (conflicts.length === 0) lines.push("No conflicts detected.")
  else
    for (const page of conflicts)
      lines.push(`- **${page.source}** → ${page.destination ?? "unmapped"}: ${page.reason}`)
  lines.push("", "## Skipped notebooks", "")
  if (summary.skippedNotebooks.length === 0) lines.push("None.")
  else for (const item of summary.skippedNotebooks) lines.push(`- ${item.notebook}: ${item.reason}`)
  lines.push(
    "",
    "## Promotion",
    "",
    "After editing approvals and resolving every approved conflict by changing its `action` and `destination`, run:",
    "",
    "```bash",
    "npm run import:onenote -- --promote",
    "```",
    "",
    `The media manifest contains ${mediaEntries.length} unique optimized images. Publication rights and attribution remain a human review decision.`,
    "",
  )
  return lines.join("\n")
}

export const OBSIDIAN_MEDIA_CSS = `/* Generated by the OneNote importer. Keep in sync with quartz/styles/custom.scss. */
.callout[data-callout="onenote-hero"],
.callout[data-callout="onenote-gallery"] {
  --callout-color: transparent;
  background: transparent;
  border: 0;
  box-shadow: none;
  margin: 1.5rem 0;
  padding: 0;
}
.callout[data-callout="onenote-hero"] > .callout-title,
.callout[data-callout="onenote-gallery"] > .callout-title { display: none; }
.callout[data-callout="onenote-hero"] > .callout-content > p { margin: 0; }
.callout[data-callout="onenote-hero"] img {
  border-radius: 12px;
  display: block;
  max-height: 70vh;
  object-fit: cover;
  width: 100%;
}
.callout[data-callout="onenote-gallery"] > .callout-content {
  display: grid;
  gap: 0.8rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
}
.callout[data-callout="onenote-gallery"] > .callout-content > p { margin: 0; }
.callout[data-callout="onenote-gallery"] img {
  aspect-ratio: 4 / 3;
  border-radius: 10px;
  height: 100%;
  object-fit: cover;
  width: 100%;
}
`

async function installObsidianStyles(vaultRoot) {
  const snippetRoot = path.join(vaultRoot, ".obsidian", "snippets")
  await fsp.mkdir(snippetRoot, { recursive: true })
  await fsp.writeFile(path.join(snippetRoot, "onenote-media.css"), OBSIDIAN_MEDIA_CSS)
  const appearanceFile = path.join(vaultRoot, ".obsidian", "appearance.json")
  const appearance = fs.existsSync(appearanceFile)
    ? JSON.parse(await fsp.readFile(appearanceFile, "utf8"))
    : {}
  appearance.enabledCssSnippets = [
    ...new Set([...(appearance.enabledCssSnippets ?? []), "onenote-media"]),
  ]
  await fsp.writeFile(appearanceFile, `${JSON.stringify(appearance, null, 2)}\n`)
}

export async function stageImport({ inventory, vaultRoot, force = false }) {
  const reviewRelative = "private/onenote-import-review"
  const reviewRoot = path.join(vaultRoot, reviewRelative)
  if (fs.existsSync(reviewRoot) && !force) {
    throw new Error(
      `Review area already exists: ${reviewRoot}. Use --force-stage to replace importer-owned staging data.`,
    )
  }
  if (fs.existsSync(reviewRoot)) await fsp.rm(reviewRoot, { recursive: true, force: true })
  await fsp.mkdir(path.join(reviewRoot, "notes"), { recursive: true })
  const mediaById = await prepareMedia({ pages: inventory.pages, vaultRoot, reviewRelative })
  const pageEntries = []
  for (const page of inventory.pages) {
    const stagedRelative = `${reviewRelative}/notes/${page.id}.md`
    const mediaBlock = renderMediaBlock(page, mediaById, stagedRelative, true)
    const stagedNote = renderNewNote(page, mediaBlock)
    await fsp.writeFile(path.join(vaultRoot, stagedRelative), stagedNote)
    pageEntries.push({
      id: page.id,
      approved: false,
      action: page.action,
      source: `${page.notebook}/${page.section}/${page.title}`,
      source_html: page.sourceRelative,
      destination: page.destination,
      reason: page.reason,
      similarity: page.similarity,
      target_sha256: page.targetSha256,
      staged_note: stagedRelative,
      publish: !String(page.destination ?? "").startsWith("GM-thoughts/"),
      unsupported: page.unsupported,
      media: page.media.map(({ id, alt, order, role, sourceName }) => ({
        id,
        alt,
        order,
        role,
        source_name: sourceName,
      })),
    })
  }
  const mediaEntries = [...mediaById.values()].map((media) => ({
    id: media.id,
    approved: false,
    source: media.sourcePath,
    source_name: media.sourceName,
    detected_type: media.detectedType,
    sha256: media.sha256,
    width: media.width,
    height: media.height,
    map_like: media.mapLike,
    staged_variants: media.stagedVariants,
    final_variants: media.finalVariants,
    referenced_by: [...new Set(media.associations.map((item) => item.source))],
  }))
  const summary = summaryFor(inventory.pages, mediaById, inventory.skippedNotebooks)
  const review = {
    schema_version: 1,
    summary,
    instructions:
      "Set approved: true only after review. Approved conflicts must also be changed to action: new or media-only and given a valid destination.",
    pages: pageEntries,
    media: mediaEntries,
  }
  await fsp.writeFile(
    path.join(reviewRoot, "review.yaml"),
    YAML.stringify(review, { lineWidth: 0 }),
  )
  await fsp.writeFile(
    path.join(reviewRoot, "inventory.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  )
  await fsp.writeFile(
    path.join(reviewRoot, "report.md"),
    buildReport(summary, pageEntries, mediaEntries),
  )
  const mediaCsv = [
    [
      "id",
      "approved",
      "source_name",
      "detected_type",
      "width",
      "height",
      "sha256",
      "referenced_by",
    ],
    ...mediaEntries.map((media) => [
      media.id,
      media.approved,
      media.source_name,
      media.detected_type,
      media.width,
      media.height,
      media.sha256,
      media.referenced_by.join("; "),
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")
  await fsp.writeFile(path.join(reviewRoot, "media-manifest.csv"), `${mediaCsv}\n`)
  await installObsidianStyles(vaultRoot)
  return { reviewRoot, summary, review }
}

async function copyAtomic(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.onenote-import-${process.pid}.tmp`
  await fsp.copyFile(source, temporary)
  await fsp.rename(temporary, destination)
}

async function writeAtomic(destination, content) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.onenote-import-${process.pid}.tmp`
  await fsp.writeFile(temporary, content)
  await fsp.rename(temporary, destination)
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

function mergePageMedia(group) {
  const merged = new Map()
  for (const association of group.flatMap((page) => page.media)) {
    const previous = merged.get(association.id)
    merged.set(association.id, previous?.role === "hero" ? previous : association)
  }
  return [...merged.values()]
}

function stagedBody(vaultRoot, page) {
  const raw = fs.readFileSync(path.join(vaultRoot, page.staged_note), "utf8")
  return splitFrontmatter(removeMediaBlock(raw)).body
}

function conflictArchiveDestination(page) {
  const parts = String(page.source).split("/")
  const notebook = safeFilename(parts.shift() ?? "OneNote")
  const title = safeFilename(parts.pop() ?? "Untitled")
  const section = safeFilename(parts.join(" - ") || "Notes")
  return `GM-thoughts/Rule variants/${notebook}/${section}/${title}.md`
}

function assertSafeMediaPath(relative) {
  if (
    path.isAbsolute(relative) ||
    relative.split("/").includes("..") ||
    !/^[A-Za-z0-9._/-]+$/.test(relative) ||
    !relative.endsWith(".webp")
  ) {
    throw new Error(`Unsafe generated media path: ${relative}`)
  }
}

export async function approveAllReview({ vaultRoot }) {
  const reviewRoot = path.join(vaultRoot, "private", "onenote-import-review")
  const reviewFile = path.join(reviewRoot, "review.yaml")
  if (!fs.existsSync(reviewFile)) throw new Error(`Review manifest not found: ${reviewFile}`)
  const raw = await fsp.readFile(reviewFile, "utf8")
  const review = YAML.parse(raw)
  const resolutions = { canonical: 0, archivedVariants: 0, direct: 0 }

  for (const media of review.media) {
    media.approved = true
    for (const relative of Object.values(media.final_variants)) assertSafeMediaPath(relative)
  }

  for (const page of review.pages) {
    page.approved = true
    if (page.action !== "conflict") continue
    if (String(page.destination ?? "").startsWith("running-the-game/")) {
      const target = path.join(vaultRoot, page.destination)
      const targetBody = fs.existsSync(target)
        ? splitFrontmatter(await fsp.readFile(target, "utf8")).body
        : ""
      const similarity = textSimilarity(stagedBody(vaultRoot, page), targetBody)
      page.resolution_similarity = Number(similarity.toFixed(3))
      if (similarity >= 0.7) {
        page.action = "canonical-link"
        page.reason = `approved automatically; existing canonical note retained (${similarity.toFixed(2)})`
        resolutions.canonical += 1
      } else {
        page.action = "new"
        page.destination = conflictArchiveDestination(page)
        page.publish = false
        page.target_sha256 = undefined
        page.reason = `approved as a vault-only rule variant (${similarity.toFixed(2)} similarity to canonical)`
        resolutions.archivedVariants += 1
      }
      continue
    }

    const normalized = normalizeTitle(page.source.split("/").at(-1))
    if (normalized === "threats" && page.source.startsWith("Worldbuilding 2/")) {
      page.action = "new"
      page.destination = "settings/Middleworld/Factions/Threats/index.md"
      page.reason = "approved and routed to the Middleworld threats index"
      resolutions.direct += 1
    } else if (normalized === "homebrew") {
      page.action = "new"
      page.destination = conflictArchiveDestination(page)
      page.publish = false
      page.target_sha256 = undefined
      page.reason = "approved as a vault-only homebrew overview"
      resolutions.archivedVariants += 1
    } else {
      page.action = "new"
      page.reason = "approved for the proposed destination"
      resolutions.direct += 1
    }
  }

  const writable = review.pages.filter(
    (page) => page.approved && ["new", "media-only"].includes(page.action) && page.destination,
  )
  const collisions = Map.groupBy(writable, (page) => page.destination)
  for (const group of collisions.values()) {
    if (group.length < 2 || group.every((page) => page.action === "media-only")) continue
    const [first, ...rest] = group
    for (const page of rest) {
      page.action = "new"
      page.destination = conflictArchiveDestination(page)
      page.publish = false
      page.target_sha256 = undefined
      page.reason = `approved as a vault-only variant; ${first.source} keeps the shared destination`
      resolutions.archivedVariants += 1
    }
  }

  const backup = path.join(reviewRoot, "review.before-approve-all.yaml")
  if (!fs.existsSync(backup)) await fsp.writeFile(backup, raw)
  review.approved_all_at = new Date().toISOString()
  review.approval_resolutions = resolutions
  await writeAtomic(reviewFile, YAML.stringify(review, { lineWidth: 0 }))
  return {
    pagesApproved: review.pages.length,
    mediaApproved: review.media.length,
    resolutions,
    reviewFile,
  }
}

export async function promoteImport({ vaultRoot }) {
  const reviewRelative = "private/onenote-import-review"
  const reviewRoot = path.join(vaultRoot, reviewRelative)
  const reviewFile = path.join(reviewRoot, "review.yaml")
  if (!fs.existsSync(reviewFile)) throw new Error(`Review manifest not found: ${reviewFile}`)
  const review = YAML.parse(await fsp.readFile(reviewFile, "utf8"))
  const mediaById = new Map(review.media.map((media) => [media.id, media]))
  const rawApprovedPages = review.pages.filter((page) => page.approved)
  const groupedMediaOnly = Map.groupBy(
    rawApprovedPages.filter((page) => page.action === "media-only"),
    (page) => page.destination,
  )
  const approvedPages = [
    ...rawApprovedPages.filter((page) => page.action !== "media-only"),
    ...[...groupedMediaOnly.values()].map((group) => ({
      ...group[0],
      source: group.map((page) => page.source).join("; "),
      media: mergePageMedia(group),
    })),
  ]
  for (const page of approvedPages) {
    if (page.action === "conflict")
      throw new Error(`Approved page is still a conflict: ${page.source}`)
    if (["new", "media-only"].includes(page.action) && !page.destination) {
      throw new Error(`Approved page has no destination: ${page.source}`)
    }
  }
  const backupRoot = path.join(vaultRoot, "private", "onenote-import-backup", timestampId())
  const touched = []
  const copiedMedia = new Set()
  for (const page of approvedPages) {
    if (["skip", "duplicate", "canonical-link"].includes(page.action)) continue
    const destination = path.join(vaultRoot, page.destination)
    if (fs.existsSync(destination)) {
      const currentHash = sha256File(destination)
      if (page.target_sha256 && currentHash !== page.target_sha256) {
        throw new Error(`Destination changed after staging: ${page.destination}`)
      }
      await copyAtomic(destination, path.join(backupRoot, page.destination))
    } else if (page.target_sha256) {
      throw new Error(`Expected destination is missing: ${page.destination}`)
    }
    const approvedMedia = page.media.filter(
      (association) => mediaById.get(association.id)?.approved,
    )
    for (const association of approvedMedia) {
      const media = mediaById.get(association.id)
      for (const [variant, stagedRelative] of Object.entries(media.staged_variants)) {
        const finalRelative = media.final_variants[variant]
        const stagedFile = path.join(vaultRoot, stagedRelative)
        const finalFile = path.join(vaultRoot, finalRelative)
        if (
          fs.statSync(stagedFile).size >= MAX_CLOUDFLARE_ASSET_BYTES &&
          !finalRelative.startsWith("GM-thoughts/")
        ) {
          throw new Error(`Public asset exceeds Cloudflare's 25 MiB limit: ${stagedRelative}`)
        }
        if (!copiedMedia.has(finalRelative)) {
          await copyAtomic(stagedFile, finalFile)
          copiedMedia.add(finalRelative)
        }
      }
    }
    const mediaBlock = renderMediaBlock(
      { media: approvedMedia },
      mediaById,
      page.destination,
      false,
    )
    let output
    if (page.action === "media-only") {
      const existing = await fsp.readFile(destination, "utf8")
      output = upsertMediaBlock(existing, mediaBlock)
    } else {
      const staged = await fsp.readFile(path.join(vaultRoot, page.staged_note), "utf8")
      output = removeMediaBlock(staged)
      if (mediaBlock) output = upsertMediaBlock(output, mediaBlock)
    }
    await writeAtomic(destination, output)
    touched.push(page.destination)
  }
  const report = {
    promotedAt: new Date().toISOString(),
    touched,
    copiedMedia: [...copiedMedia],
    backupRoot: posix(path.relative(vaultRoot, backupRoot)),
  }
  await fsp.writeFile(
    path.join(reviewRoot, "promotion-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  return report
}

export function summarizeDryRun(inventory) {
  return summaryFor(inventory.pages, undefined, inventory.skippedNotebooks)
}
