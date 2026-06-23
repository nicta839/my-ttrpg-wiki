import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

import { parseNote } from "./vault-enrichment.mjs"

const FOLDER_INDEX_START = "<!-- vault-folder-index:start -->"

const MOVE_PLAN = new Map(
  Object.entries({
    "settings/Godshand/Culture/Culture.md": "settings/Godshand/Society/Culture.md",
    "settings/Godshand/Culture/Showing the Hand.md":
      "settings/Godshand/Society/Showing the Hand.md",
    "settings/Godshand/Quests/wildsheep chase.md":
      "settings/Godshand/Campaign/Quests/wildsheep chase.md",
    "settings/Godshand/Rumors/Eclipse.md": "settings/Godshand/Campaign/Rumors/Eclipse.md",
    "settings/Godshand/Rumors/Shape of a Hand.md":
      "settings/Godshand/Campaign/Rumors/Shape of a Hand.md",
    "settings/Spine of the World/Factions/Center.md":
      "settings/Spine of the World/Regions/Center.md",
    "settings/Spine of the World/Factions/North.md": "settings/Spine of the World/Regions/North.md",
    "settings/Spine of the World/Factions/West.md": "settings/Spine of the World/Regions/West.md",
    "settings/Spine of the World/Factions/Tar Valon.md":
      "settings/Spine of the World/Settlements/Tar Valon.md",
    "settings/Spine of the World/Factions/The Grey Glove.md":
      "settings/Spine of the World/Organizations/The Grey Glove.md",
    "settings/Spine of the World/Factions/Whisper road.md":
      "settings/Spine of the World/Organizations/Whisper road.md",
    "settings/Spine of the World/World/Structure of the Empire.md":
      "settings/Spine of the World/Society/Structure of the Empire.md",
    "settings/Tales of Fate/Regions/Cèpe.md": "settings/Tales of Fate/Settlements/Cèpe.md",
    "settings/Tales of Fate/Regions/Granalin.md": "settings/Tales of Fate/Settlements/Granalin.md",
    "settings/Tales of Fate/Regions/Grimbergen.md":
      "settings/Tales of Fate/Settlements/Grimbergen.md",
    "settings/Tales of Fate/Regions/Hoegarden Oasis.md":
      "settings/Tales of Fate/Settlements/Hoegarden Oasis.md",
    "settings/Tales of Fate/Regions/Kriek.md": "settings/Tales of Fate/Settlements/Kriek.md",
    "settings/Tales of Fate/Regions/Pelfort.md": "settings/Tales of Fate/Settlements/Pelfort.md",
  }),
)

const TYPE_BY_CATEGORY = new Map([
  ["Campaign", "campaign"],
  ["Cosmology", "cosmology"],
  ["Factions", "faction"],
  ["History", "history"],
  ["Items", "item"],
  ["NPCs", "npc"],
  ["Organizations", "organization"],
  ["Regions", "region"],
  ["Settlements", "settlement"],
  ["Society", "lore"],
])

const GENERIC_ALIASES = new Set(
  [
    "ancestry",
    "campaign",
    "center",
    "class",
    "culture",
    "hill",
    "history",
    "index",
    "introduction",
    "kingdom",
    "language",
    "magic",
    "map",
    "mountain",
    "north",
    "pantheon",
    "people",
    "planes",
    "region",
    "religion",
    "season 1",
    "season 2",
    "society",
    "south",
    "the people",
    "timeline",
    "west",
    "world map",
  ].map(normalize),
)

const MANUAL_ALIASES = new Map([
  ["settings/Soleria/History/Aftermath of the War.md", ["Alera's rampage"]],
  [
    "settings/Tales of Fate/Organizations/Council of Great Wizards.md",
    ["Council of the Great Wizards"],
  ],
  ["settings/Tales of Fate/Organizations/Church of Spiral.md", ["Spiral Church"]],
])

const FOLDER_NOTE_REDIRECTS = new Map([
  ["settings/Godshand/History/index.md", "settings/Godshand/History/History.md"],
  [
    "settings/Spine of the World/History/index.md",
    "settings/Spine of the World/History/History.md",
  ],
  [
    "settings/Spine of the World/Society/index.md",
    "settings/Spine of the World/Society/Society.md",
  ],
])

function posix(value) {
  return value.split(path.sep).join("/")
}

function normalize(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en")
}

function slug(value) {
  return normalize(value).replace(/\s+/g, "-")
}

function withoutExtension(value) {
  return value.replace(/\.md$/i, "")
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

async function walkMarkdown(root) {
  const result = []
  if (!fs.existsSync(root)) return result
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await walkMarkdown(file)))
    else if (entry.isFile() && file.endsWith(".md")) result.push(file)
  }
  return result
}

function settingOf(relative) {
  return relative.match(/^settings\/([^/]+)\//)?.[1]
}

function finalRelative(relative) {
  return MOVE_PLAN.get(relative) ?? relative
}

function aliasesFor(note) {
  if (note.body.includes(FOLDER_INDEX_START)) return []
  const aliases = new Set([note.title])
  if (/^The\s+/i.test(note.title)) aliases.add(note.title.replace(/^The\s+/i, ""))
  const configured = MANUAL_ALIASES.get(note.finalRelative) ?? []
  for (const alias of configured) aliases.add(alias)
  const existing = note.frontmatter.aliases
  for (const alias of Array.isArray(existing) ? existing : existing ? [existing] : []) {
    aliases.add(String(alias))
  }
  return [...aliases].filter(
    (alias) => alias.length >= 4 && !GENERIC_ALIASES.has(normalize(alias)) && !/^\d+$/.test(alias),
  )
}

function createResolver(notes) {
  const pathMap = new Map()
  const aliasMap = new Map()
  const basenameMap = new Map()
  for (const note of notes) {
    for (const relative of [note.relative, note.finalRelative]) {
      pathMap.set(normalize(withoutExtension(relative)), note)
    }
    const basenameKey = `${note.setting}\0${normalize(path.posix.basename(note.finalRelative, ".md"))}`
    const basenameValues = basenameMap.get(basenameKey) ?? []
    basenameValues.push(note)
    basenameMap.set(basenameKey, basenameValues)
    for (const alias of aliasesFor(note)) {
      const key = `${note.setting}\0${normalize(alias)}`
      const values = aliasMap.get(key) ?? []
      values.push(note)
      aliasMap.set(key, values)
    }
  }
  for (const [redirect, destination] of FOLDER_NOTE_REDIRECTS) {
    const target = notes.find((note) => note.finalRelative === destination)
    if (target) pathMap.set(normalize(withoutExtension(redirect)), target)
  }
  return (source, target) => {
    let decoded = target
    try {
      decoded = decodeURI(target)
    } catch {}
    decoded = decoded.replace(/\.md$/i, "").replace(/^\//, "")
    const direct = pathMap.get(normalize(decoded))
    if (direct) return direct
    const relative = path.posix.normalize(
      path.posix.join(path.posix.dirname(source.relative), decoded),
    )
    const nearby = pathMap.get(normalize(relative))
    if (nearby) return nearby
    const basename = path.posix.basename(decoded)
    const basenameCandidates = basenameMap.get(`${source.setting}\0${normalize(basename)}`)
    if (basenameCandidates?.length === 1) return basenameCandidates[0]
    const candidates = aliasMap.get(`${source.setting}\0${normalize(basename)}`)
    return candidates?.length === 1 ? candidates[0] : undefined
  }
}

function canonicalizeLinks(body, note, resolve, counters) {
  let output = body.replace(
    /(?<!!)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (whole, rawTarget, anchor = "", alias) => {
      if (!rawTarget.includes("/") && normalize(rawTarget) === "index") return whole
      const target = resolve(note, rawTarget.trim())
      if (!target) return whole
      const display = alias ?? rawTarget.trim().split("/").at(-1)
      const canonical = `[[${withoutExtension(target.finalRelative)}${anchor}|${display}]]`
      if (canonical !== whole) counters.canonicalized += 1
      return canonical
    },
  )
  output = output.replace(
    /(?<!!)\[([^\]]+)\]\(([^)]+\.md)(?:#[^)]+)?\)/gi,
    (whole, label, rawTarget) => {
      const target = resolve(note, rawTarget)
      if (!target) return whole
      counters.repairedMarkdown += 1
      return `[[${withoutExtension(target.finalRelative)}|${label}]]`
    },
  )
  return output
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function protectAndLink(body, note, settingNotes, counters) {
  const aliases = new Map()
  for (const target of settingNotes) {
    if (target.finalRelative === note.finalRelative) continue
    for (const alias of aliasesFor(target)) {
      const key = normalize(alias)
      const existing = aliases.get(key)
      aliases.set(key, existing === undefined ? { alias, target } : null)
    }
  }
  const usable = [...aliases.values()]
    .filter(Boolean)
    .sort((left, right) => right.alias.length - left.alias.length)
  if (usable.length === 0) return body
  const byAlias = new Map(usable.map((item) => [normalize(item.alias), item.target]))
  const byPath = new Map(
    settingNotes.flatMap((target) =>
      [target.relative, target.finalRelative].map((relative) => [
        normalize(withoutExtension(relative)),
        target,
      ]),
    ),
  )
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${usable.map((item) => escapeRegex(item.alias)).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
  )
  const protectedPattern =
    /<!--[^]*?-->|```[^]*?```|`[^`]*`|!\[\[[^\]]+\]\]|\[\[[^\]]+\]\]|!?(?:\[[^\]]*\])\([^)]+\)|https?:\/\/\S+|^#{1,6}\s.*$/gm
  const linked = new Set(
    [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
      .map((match) => byPath.get(normalize(match[1].trim()))?.finalRelative)
      .filter(Boolean),
  )
  let cursor = 0
  let output = ""
  for (const match of body.matchAll(protectedPattern)) {
    output += linkSegment(body.slice(cursor, match.index), pattern, byAlias, linked, counters)
    output += match[0]
    cursor = match.index + match[0].length
  }
  output += linkSegment(body.slice(cursor), pattern, byAlias, linked, counters)
  return output
}

function linkSegment(segment, pattern, byAlias, linked, counters) {
  return segment.replace(pattern, (visible) => {
    const target = byAlias.get(normalize(visible))
    if (!target || linked.has(target.finalRelative)) return visible
    linked.add(target.finalRelative)
    counters.inline += 1
    counters.bySetting.set(target.setting, (counters.bySetting.get(target.setting) ?? 0) + 1)
    counters.examples.push({ text: visible, target: target.finalRelative })
    return `[[${withoutExtension(target.finalRelative)}|${visible}]]`
  })
}

function updateMovedFrontmatter(frontmatter, relative) {
  const output = { ...frontmatter }
  const category = relative.split("/")[2]
  const type = TYPE_BY_CATEGORY.get(category)
  output.category = category
  if (type) {
    output.type = type
    const tags = Array.isArray(output.tags) ? output.tags : output.tags ? [output.tags] : []
    output.tags = [
      ...new Set([...tags.filter((tag) => !String(tag).startsWith("type/")), `type/${type}`]),
    ]
  }
  return output
}

function renderNote(frontmatter, body) {
  const clean = body
    .replace(/^(?:\r?\n)+/, "")
    .replace(/[ \t]+$/gm, "")
    .trimEnd()
  return `---\n${YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()}\n---\n${clean ? `\n${clean}` : ""}\n`
}

function indexNote(setting, category, notes) {
  const settingSlug = slug(setting)
  const title = category ? `${setting} — ${category}` : setting
  const type = category ? "index" : "setting"
  const related = notes.map((note) => withoutExtension(note.finalRelative))
  const frontmatter = {
    title,
    type,
    setting,
    tags: [
      `setting/${settingSlug}`,
      `type/${type}`,
      ...(category ? [`category/${slug(category)}`] : []),
    ],
    category: category ?? "Setting",
    visibility: "public",
    description: category
      ? `Index of ${category.toLocaleLowerCase("en")} material for the ${setting} setting.`
      : `Index for the ${setting} setting.`,
    related: related.slice(0, 8),
  }
  const links = notes.map((note) => `- [[${withoutExtension(note.finalRelative)}|${note.title}]]`)
  return renderNote(frontmatter, `# ${title}\n\n${links.join("\n")}`)
}

async function writeAtomic(destination, content) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.semantic-vault-${process.pid}.tmp`
  await fsp.writeFile(temporary, content)
  await fsp.rename(temporary, destination)
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

export async function organizeVault({ vaultRoot, apply = false }) {
  const settingsRoot = path.join(vaultRoot, "settings")
  const files = (await walkMarkdown(settingsRoot)).sort()
  const loadedNotes = await Promise.all(
    files.map(async (file) => {
      const relative = posix(path.relative(vaultRoot, file))
      const raw = await fsp.readFile(file, "utf8")
      const parsed = parseNote(raw)
      const destination = finalRelative(relative)
      return {
        file,
        relative,
        finalRelative: destination,
        raw,
        body: parsed.body,
        frontmatter: parsed.frontmatter,
        title: String(parsed.frontmatter.title ?? path.basename(file, ".md")),
        setting: settingOf(destination),
      }
    }),
  )
  const removals = loadedNotes.filter(
    (note) => note.setting && FOLDER_NOTE_REDIRECTS.has(note.relative),
  )
  const notes = loadedNotes.filter(
    (note) => note.setting && !FOLDER_NOTE_REDIRECTS.has(note.relative),
  )
  const resolve = createResolver(notes)
  const counters = {
    inline: 0,
    canonicalized: 0,
    repairedMarkdown: 0,
    bySetting: new Map(),
    examples: [],
  }
  const transformed = []
  for (const note of notes) {
    let frontmatter = { ...note.frontmatter }
    const manualAliases = MANUAL_ALIASES.get(note.finalRelative)
    if (manualAliases) {
      frontmatter.aliases = [
        ...new Set([
          ...(Array.isArray(frontmatter.aliases)
            ? frontmatter.aliases
            : frontmatter.aliases
              ? [frontmatter.aliases]
              : []),
          ...manualAliases,
        ]),
      ]
    }
    if (note.relative !== note.finalRelative) {
      frontmatter = updateMovedFrontmatter(frontmatter, note.finalRelative)
    }
    let body = canonicalizeLinks(note.body, note, resolve, counters)
    body = protectAndLink(
      body,
      note,
      notes.filter((candidate) => candidate.setting === note.setting),
      counters,
    )
    const output = renderNote(frontmatter, body)
    transformed.push({ ...note, frontmatter, output })
  }

  const finalPaths = new Set(transformed.map((note) => note.finalRelative))
  const generated = []
  for (const setting of [...new Set(notes.map((note) => note.setting))].sort()) {
    if (setting === "Aylbyia") continue
    const settingNotes = transformed.filter((note) => note.setting === setting)
    const categories = [
      ...new Set(
        settingNotes
          .map((note) => {
            const parts = note.finalRelative.split("/")
            return parts.length > 3 ? parts[2] : undefined
          })
          .filter(Boolean),
      ),
    ]
    for (const category of categories.sort()) {
      const relative = `settings/${setting}/${category}/index.md`
      const folderNote = `settings/${setting}/${category}/${category}.md`
      if (finalPaths.has(folderNote)) continue
      if (finalPaths.has(relative)) continue
      const categoryNotes = settingNotes
        .filter((note) => note.finalRelative.startsWith(`settings/${setting}/${category}/`))
        .sort((left, right) => left.title.localeCompare(right.title))
      generated.push({
        relative,
        output: indexNote(setting, category, categoryNotes),
        title: `${setting} — ${category}`,
      })
      finalPaths.add(relative)
    }
    const rootIndex = `settings/${setting}/index.md`
    if (!finalPaths.has(rootIndex)) {
      const categoryPattern = new RegExp(`^settings/${escapeRegex(setting)}/[^/]+/index\\.md$`)
      const folderNotePattern = new RegExp(`^settings/${escapeRegex(setting)}/([^/]+)/\\1\\.md$`)
      const categoryIndices = [
        ...transformed.filter(
          (note) =>
            categoryPattern.test(note.finalRelative) || folderNotePattern.test(note.finalRelative),
        ),
        ...generated
          .filter((note) => categoryPattern.test(note.relative))
          .map((note) => ({ ...note, finalRelative: note.relative })),
      ].sort((left, right) => left.title.localeCompare(right.title))
      generated.push({
        relative: rootIndex,
        output: indexNote(setting, undefined, categoryIndices),
      })
      finalPaths.add(rootIndex)
    }
  }

  const pendingMoves = transformed.filter((note) => note.relative !== note.finalRelative)
  const changed = transformed.filter(
    (note) => note.output !== note.raw || note.relative !== note.finalRelative,
  )
  const report = {
    applied: apply,
    notesScanned: notes.length,
    notesChanged: changed.length,
    changedFiles: changed.map(({ relative, finalRelative }) =>
      relative === finalRelative ? relative : `${relative} -> ${finalRelative}`,
    ),
    moves: pendingMoves.map(({ relative, finalRelative }) => ({
      from: relative,
      to: finalRelative,
    })),
    indicesCreated: generated.map(({ relative }) => relative),
    indicesRemoved: removals.map(({ relative }) => relative),
    inlineLinksAdded: counters.inline,
    existingLinksCanonicalized: counters.canonicalized,
    markdownLinksRepaired: counters.repairedMarkdown,
    inlineLinksBySetting: Object.fromEntries(counters.bySetting),
    linkExamples: counters.examples.slice(0, 30),
  }
  if (!apply) return report

  const backupRelative = `private/semantic-vault-backup/${timestampId()}`
  const backupRoot = path.join(vaultRoot, backupRelative)
  for (const note of changed) {
    const current = await fsp.readFile(note.file, "utf8")
    if (sha256(current) !== sha256(note.raw)) throw new Error(`Note changed: ${note.relative}`)
    const backup = path.join(backupRoot, note.relative)
    await fsp.mkdir(path.dirname(backup), { recursive: true })
    await fsp.writeFile(backup, note.raw)
    const destination = path.join(vaultRoot, note.finalRelative)
    if (note.relative !== note.finalRelative && fs.existsSync(destination)) {
      throw new Error(`Move collision: ${note.finalRelative}`)
    }
    await writeAtomic(destination, note.output)
    if (note.relative !== note.finalRelative) await fsp.unlink(note.file)
  }
  for (const note of generated) {
    await writeAtomic(path.join(vaultRoot, note.relative), note.output)
  }
  for (const note of removals) {
    const current = await fsp.readFile(note.file, "utf8")
    if (sha256(current) !== sha256(note.raw)) throw new Error(`Note changed: ${note.relative}`)
    const backup = path.join(backupRoot, note.relative)
    await fsp.mkdir(path.dirname(backup), { recursive: true })
    await fsp.writeFile(backup, note.raw)
    await fsp.unlink(note.file)
  }
  for (const note of pendingMoves) {
    let directory = path.dirname(note.file)
    while (directory.startsWith(settingsRoot) && directory !== settingsRoot) {
      try {
        await fsp.rmdir(directory)
      } catch (error) {
        if (error.code === "ENOTEMPTY") break
        if (error.code !== "ENOENT") throw error
      }
      directory = path.dirname(directory)
    }
  }
  report.backupRoot = backupRelative
  report.report = "private/semantic-vault-report.json"
  await writeAtomic(path.join(vaultRoot, report.report), `${JSON.stringify(report, null, 2)}\n`)
  return report
}
