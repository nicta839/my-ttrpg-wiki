import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import { ENRICHMENT_END, ENRICHMENT_START, parseNote } from "./vault-enrichment.mjs"

export const FOLDER_INDEX_START = "<!-- vault-folder-index:start -->"
export const FOLDER_INDEX_END = "<!-- vault-folder-index:end -->"

const DEFAULT_ROOTS = ["settings", "running-the-game", "references"]
const IGNORED_DIRS = new Set([
  ".git",
  ".obsidian",
  ".trash",
  ".DS_Store",
  "assets",
  "GM-thoughts",
  "node_modules",
  "private",
  "templates",
])
const TAXONOMY_ORDER = [
  "History",
  "Regions",
  "Settlements",
  "Cosmology",
  "Society",
  "Factions",
  "Organizations",
  "NPCs",
  "Items",
  "Campaign",
  "Mysteries",
  "Quests",
  "Rumors",
]

function posix(value) {
  return value.split(path.sep).join("/")
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function slug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/g, "-")
}

function pathWithoutExtension(relative) {
  return relative.replace(/\.md$/i, "")
}

function titleFromName(name) {
  return name
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function titleForRelative(relative) {
  if (relative === "index.md") return "The Vault"
  if (relative === "settings/index.md") return "Settings"
  if (relative === "running-the-game/index.md") return "Running the game"
  if (relative === "references/index.md") return "References"
  const parts = pathWithoutExtension(relative).split("/")
  const leaf = parts.at(-1) === "index" ? parts.at(-2) : parts.at(-1)
  return titleFromName(leaf ?? "Index")
}

function settingFor(relative) {
  return relative.match(/^settings\/([^/]+)\//)?.[1]
}

function categoryFor(relative) {
  if (relative === "index.md") return "Wiki"
  if (relative === "settings/index.md") return "Settings"
  if (relative === "running-the-game/index.md") return "Running the Game"
  if (relative === "references/index.md") return "References"
  const parts = pathWithoutExtension(relative).split("/")
  if (parts[0] === "settings") return parts.length <= 3 ? "Setting" : parts[2]
  if (parts[0] === "running-the-game") return parts.length <= 2 ? "Running the Game" : parts[1]
  if (parts[0] === "references") return "References"
  return "Index"
}

function typeFor(relative, existingType) {
  if (relative === "index.md") return "index"
  if (relative === "settings/index.md") return "index"
  if (relative === "running-the-game/index.md") return "index"
  if (relative === "references/index.md") return "index"
  if (/^settings\/[^/]+\/index\.md$/.test(relative)) return existingType ?? "setting"
  return existingType ?? "index"
}

function tagsFor(relative, existingTags = []) {
  const setting = settingFor(relative)
  const tags = (Array.isArray(existingTags) ? existingTags : existingTags ? [existingTags] : [])
    .map(String)
    .filter((tag) => setting || !tag.startsWith("setting/"))
  const additions = []
  const category = categoryFor(relative)
  if (setting) additions.push(`setting/${slug(setting)}`)
  additions.push(`type/${typeFor(relative, undefined)}`)
  if (category && !["Wiki", "Setting", "Settings"].includes(category)) {
    additions.push(`category/${slug(category)}`)
  }
  return [...new Set([...tags, ...additions])]
}

function descriptionFor(relative, folderTitle) {
  if (relative === "index.md") return "Navigation hub for the public vault."
  if (relative === "settings/index.md") return "Index of the public campaign settings."
  if (relative === "running-the-game/index.md") return "Index of rules, table practices, and GM notes."
  if (relative === "references/index.md") return "Index of public reference material."
  const setting = settingFor(relative)
  if (setting && /^settings\/[^/]+\/index\.md$/.test(relative)) {
    return `Index for the ${setting} setting.`
  }
  return `Index for ${folderTitle}.`
}

function indexFileForDirectory(vaultRoot, directory) {
  const relativeDirectory = posix(path.relative(vaultRoot, directory))
  if (!relativeDirectory) {
    const file = path.join(directory, "index.md")
    return { file, relative: "index.md", exists: fs.existsSync(file) }
  }
  const explicitIndex = path.join(directory, "index.md")
  if (fs.existsSync(explicitIndex)) {
    return {
      file: explicitIndex,
      relative: `${relativeDirectory}/index.md`,
      exists: true,
    }
  }
  const desiredFolderNote = `${path.basename(directory)}.md`
  const actualFolderNote =
    fs
      .readdirSync(directory)
      .find((entry) => entry.toLocaleLowerCase("en") === desiredFolderNote.toLocaleLowerCase("en")) ??
    desiredFolderNote
  const folderNote = path.join(directory, actualFolderNote)
  if (fs.existsSync(folderNote)) {
    return {
      file: folderNote,
      relative: `${relativeDirectory}/${actualFolderNote}`,
      exists: true,
    }
  }
  return {
    file: explicitIndex,
    relative: `${relativeDirectory}/index.md`,
    exists: false,
  }
}

function indexTargetForDirectory(vaultRoot, directory) {
  return pathWithoutExtension(indexFileForDirectory(vaultRoot, directory).relative)
}

function linkLine(target, title) {
  return `- [[${target}|${title}]]`
}

function sortedByNavigation(left, right) {
  const leftOrder = TAXONOMY_ORDER.indexOf(left.title)
  const rightOrder = TAXONOMY_ORDER.indexOf(right.title)
  if (leftOrder !== -1 || rightOrder !== -1) {
    return (leftOrder === -1 ? 999 : leftOrder) - (rightOrder === -1 ? 999 : rightOrder)
  }
  return left.title.localeCompare(right.title, "en", { sensitivity: "base" })
}

function folderDepth(relative) {
  if (!relative) return 0
  return relative.split("/").filter(Boolean).length
}

function isIgnoredDirectoryName(name) {
  return IGNORED_DIRS.has(name)
}

function removeOwnedBlock(body, start, end) {
  const pattern = new RegExp(
    `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\r?\\n)?`,
    "g",
  )
  return body.replace(pattern, "")
}

function firstHeading(title) {
  return `# ${title}`
}

function ensureHeading(body, title) {
  const clean = body.replace(/^(?:\r?\n)+/, "").trimEnd()
  if (/^#\s+/m.test(clean)) return clean
  return [firstHeading(title), clean].filter(Boolean).join("\n\n")
}

function insertFolderBlock(body, title, block) {
  const clean = removeOwnedBlock(
    removeOwnedBlock(body, FOLDER_INDEX_START, FOLDER_INDEX_END),
    ENRICHMENT_START,
    ENRICHMENT_END,
  )
    .replace(/^(?:\r?\n)+/, "")
    .trimEnd()
  const withHeading = ensureHeading(clean, title)
  return [withHeading, block].filter(Boolean).join("\n\n")
}

function rootIndexBody(body, title, block) {
  const withoutFolderBlock = removeOwnedBlock(body, FOLDER_INDEX_START, FOLDER_INDEX_END)
  const withoutEnrichment = removeOwnedBlock(withoutFolderBlock, ENRICHMENT_START, ENRICHMENT_END)
  const withHeading = ensureHeading(withoutEnrichment, title)
  const heading = withHeading.match(/^#\s+.+$/m)?.[0] ?? firstHeading(title)
  const afterHeading = withHeading.slice(withHeading.indexOf(heading) + heading.length)
  const intro = afterHeading.split(/\n##\s+/)[0].trim()
  return [heading, intro, block].filter(Boolean).join("\n\n")
}

function renderFrontmatter(frontmatter) {
  return `---\n${YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---`
}

function renderNote(frontmatter, body) {
  return `${renderFrontmatter(frontmatter)}\n${body.trimEnd() ? `\n${body.trimEnd()}\n` : ""}`
}

function indexBlock({ childFolders, childPages, rootSettings, includeResources }) {
  const sections = []
  if (rootSettings?.length) {
    sections.push(["## Settings", rootSettings.map((item) => linkLine(item.target, item.title)).join("\n")])
  }
  if (includeResources?.length) {
    sections.push([
      "## Other public areas",
      includeResources.map((item) => linkLine(item.target, item.title)).join("\n"),
    ])
  }
  if (childFolders.length) {
    sections.push(["## Folders", childFolders.map((item) => linkLine(item.target, item.title)).join("\n")])
  }
  if (childPages.length) {
    sections.push(["## Pages", childPages.map((item) => linkLine(item.target, item.title)).join("\n")])
  }
  const content = sections.map(([heading, lines]) => `${heading}\n\n${lines}`).join("\n\n")
  return `${FOLDER_INDEX_START}\n${content}\n${FOLDER_INDEX_END}`
}

async function readMarkdownTitle(file, fallback) {
  try {
    const raw = await fsp.readFile(file, "utf8")
    const { frontmatter, body } = parseNote(raw)
    const heading = body.match(/^#\s+(.+?)\s*$/m)?.[1]
    return String(frontmatter.title ?? heading ?? fallback)
  } catch {
    return fallback
  }
}

async function walkDirectories(root) {
  const result = []
  async function visit(directory) {
    result.push(directory)
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || isIgnoredDirectoryName(entry.name)) continue
      await visit(path.join(directory, entry.name))
    }
  }
  if (fs.existsSync(root)) await visit(root)
  return result
}

async function childDirectoryEntries(vaultRoot, directory, directorySet) {
  const entries = []
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || isIgnoredDirectoryName(entry.name)) continue
    const child = path.join(directory, entry.name)
    if (!directorySet.has(child)) continue
    entries.push({
      title: titleFromName(entry.name),
      target: indexTargetForDirectory(vaultRoot, child),
    })
  }
  return entries.sort(sortedByNavigation)
}

async function childPageEntries(vaultRoot, directory, indexFile) {
  const pages = []
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (!entry.isFile() || !entry.name.endsWith(".md") || file === indexFile) continue
    const relative = posix(path.relative(vaultRoot, file))
    pages.push({
      title: await readMarkdownTitle(file, path.basename(entry.name, ".md")),
      target: pathWithoutExtension(relative),
    })
  }
  return pages.sort(sortedByNavigation)
}

function rootSettings(directories, vaultRoot) {
  return directories
    .filter((directory) => path.dirname(directory) === path.join(vaultRoot, "settings"))
    .map((directory) => {
      return {
        title: path.basename(directory),
        target: indexTargetForDirectory(vaultRoot, directory),
      }
    })
    .sort(sortedByNavigation)
}

function rootResources(vaultRoot) {
  return [
    { title: "Running the game", folder: "running-the-game", target: "running-the-game/index" },
    { title: "References", folder: "references", target: "references/index" },
  ]
    .filter((item) => fs.existsSync(path.join(vaultRoot, item.folder)))
    .map(({ title, target }) => ({ title, target }))
}

function frontmatterFor(relative, existing = {}, directTargets = []) {
  const title = existing.title ?? titleForRelative(relative)
  const setting = settingFor(relative)
  const frontmatter = {
    ...existing,
    title,
    type: typeFor(relative, existing.type),
    tags: tagsFor(relative, existing.tags),
    category: existing.category ?? categoryFor(relative),
    visibility: existing.visibility ?? "public",
    description: existing.description ?? descriptionFor(relative, title),
    related: directTargets.slice(0, 12),
  }
  if (setting) frontmatter.setting = setting
  else delete frontmatter.setting
  return frontmatter
}

async function proposalForDirectory(vaultRoot, directory, directorySet, directories) {
  const { file: indexPath, relative: indexRelative, exists } = indexFileForDirectory(
    vaultRoot,
    directory,
  )
  const raw = exists ? await fsp.readFile(indexPath, "utf8") : ""
  const parsed = exists ? parseNote(raw) : { frontmatter: {}, body: "" }
  const title = String(parsed.frontmatter.title ?? titleForRelative(indexRelative))
  const childFolders = await childDirectoryEntries(vaultRoot, directory, directorySet)
  const childPages = await childPageEntries(vaultRoot, directory, indexPath)
  const root = indexRelative === "index.md"
  const settings = root ? rootSettings(directories, vaultRoot) : []
  const resources = root ? rootResources(vaultRoot) : []
  const directTargets = [
    ...new Set(
      root
        ? [...settings.map((item) => item.target), ...resources.map((item) => item.target)]
        : [...childFolders.map((item) => item.target), ...childPages.map((item) => item.target)],
    ),
  ]
  const frontmatter = frontmatterFor(indexRelative, parsed.frontmatter, directTargets)
  const block = indexBlock({
    childFolders: root ? [] : childFolders,
    childPages: root ? [] : childPages,
    rootSettings: settings,
    includeResources: resources,
  })
  const baseBody = exists ? parsed.body : firstHeading(title)
  const body = root ? rootIndexBody(baseBody, title, block) : insertFolderBlock(baseBody, title, block)
  const output = renderNote(frontmatter, body)
  return {
    exists,
    file: indexPath,
    relative: indexRelative,
    raw,
    output,
    childFolderCount: childFolders.length,
    childPageCount: childPages.length,
    directTargets,
  }
}

async function writeAtomic(destination, content) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.folder-index-${process.pid}.tmp`
  await fsp.writeFile(temporary, content)
  await fsp.rename(temporary, destination)
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

export async function indexVault({ vaultRoot, apply = false, roots = DEFAULT_ROOTS } = {}) {
  const rootDirectories = [vaultRoot, ...roots.map((root) => path.join(vaultRoot, root))]
  const directories = (
    await Promise.all(rootDirectories.map((root) => walkDirectories(root)))
  )
    .flat()
    .filter((directory, index, values) => values.indexOf(directory) === index)
    .sort((left, right) => {
      const byDepth = folderDepth(posix(path.relative(vaultRoot, left))) - folderDepth(posix(path.relative(vaultRoot, right)))
      return byDepth || posix(path.relative(vaultRoot, left)).localeCompare(posix(path.relative(vaultRoot, right)))
    })
  const directorySet = new Set(directories)
  const proposals = await Promise.all(
    directories.map((directory) => proposalForDirectory(vaultRoot, directory, directorySet, directories)),
  )
  const changed = proposals.filter((proposal) => proposal.output !== proposal.raw)
  const created = changed.filter((proposal) => !proposal.exists)
  const updated = changed.filter((proposal) => proposal.exists)
  const report = {
    applied: apply,
    directoriesScanned: directories.length,
    indexesChanged: changed.length,
    indexesCreated: created.map((proposal) => proposal.relative),
    indexesUpdated: updated.map((proposal) => proposal.relative),
    totalDirectLinks: proposals.reduce((sum, proposal) => sum + proposal.directTargets.length, 0),
  }
  if (!apply) return report

  const backupRelative = `private/folder-index-backup/${timestampId()}`
  const backupRoot = path.join(vaultRoot, backupRelative)
  for (const proposal of changed) {
    if (proposal.exists) {
      const current = await fsp.readFile(proposal.file, "utf8")
      if (sha256(current) !== sha256(proposal.raw)) throw new Error(`Index changed: ${proposal.relative}`)
      const backup = path.join(backupRoot, proposal.relative)
      await fsp.mkdir(path.dirname(backup), { recursive: true })
      await fsp.writeFile(backup, proposal.raw)
    }
    await writeAtomic(proposal.file, proposal.output)
  }
  report.backupRoot = backupRelative
  report.report = "private/folder-index-report.json"
  await writeAtomic(path.join(vaultRoot, report.report), `${JSON.stringify(report, null, 2)}\n`)
  return report
}
