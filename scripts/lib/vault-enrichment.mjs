import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"

export const ENRICHMENT_START = "<!-- vault-enrichment:start -->"
export const ENRICHMENT_END = "<!-- vault-enrichment:end -->"
const MEDIA_START = "<!-- onenote-media:start -->"
const MEDIA_END = "<!-- onenote-media:end -->"
const FOLDER_INDEX_START = "<!-- vault-folder-index:start -->"
const FOLDER_INDEX_END = "<!-- vault-folder-index:end -->"
const WORKING_ROOTS = ["index.md", "settings", "running-the-game", "GM-thoughts"]
const MAX_RELATED = 8

function posix(value) {
  return value.split(path.sep).join("/")
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function normalize(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en")
}

async function walkMarkdown(target) {
  if (!fs.existsSync(target)) return []
  const stat = await fsp.stat(target)
  if (stat.isFile()) return target.endsWith(".md") ? [target] : []
  const result = []
  for (const entry of await fsp.readdir(target, { withFileTypes: true })) {
    const file = path.join(target, entry.name)
    if (entry.isDirectory()) result.push(...(await walkMarkdown(file)))
    else if (entry.isFile() && file.endsWith(".md")) result.push(file)
  }
  return result
}

export function parseNote(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { frontmatter: {}, body: raw }
  return {
    frontmatter: YAML.parse(match[1]) ?? {},
    body: raw.slice(match[0].length),
  }
}

function removeOwnedBlock(body, start, end) {
  const pattern = new RegExp(
    `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\r?\\n)?`,
    "g",
  )
  return body.replace(pattern, "")
}

function contentBody(body) {
  return removeOwnedBlock(
    removeOwnedBlock(removeOwnedBlock(body, MEDIA_START, MEDIA_END), FOLDER_INDEX_START, FOLDER_INDEX_END),
    ENRICHMENT_START,
    ENRICHMENT_END,
  )
}

function cleanProse(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) =>
      alias ? alias : target.split("/").at(-1),
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>|[-*+] |\d+[.)] )\s*/gm, "")
    .replace(/[|*_~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function extractDescription(body, limit = 200) {
  const candidates = contentBody(body)
    .split(/\r?\n\s*\r?\n/)
    .map(cleanProse)
    .filter((value) => value && !/^https?:\/\//i.test(value))
  const selected = candidates.find((value) => value.length >= 40) ?? candidates[0]
  if (!selected) return undefined
  if (selected.length <= limit) return selected
  const prefix = selected.slice(0, limit + 1)
  const sentence = prefix.match(/^(.{40,}?[.!?])(?:\s|$)/)?.[1]
  if (sentence) return sentence
  const cut = prefix
    .slice(0, limit - 1)
    .replace(/\s+\S*$/, "")
    .trimEnd()
  return `${cut || prefix.slice(0, limit - 1).trimEnd()}…`
}

function categoryFor(relative) {
  const parts = relative.split("/")
  if (parts[0] === "index.md") return "Wiki"
  if (parts[0] === "settings") return parts.length <= 3 ? "Setting" : parts[2]
  if (parts[0] === "running-the-game") return parts.length > 2 ? parts[1] : "Running the Game"
  if (parts[0] === "GM-thoughts") return "GM Thoughts"
  return undefined
}

function isPublic(relative) {
  return relative === "index.md" || /^(?:settings|running-the-game|references)\//.test(relative)
}

function pathWithoutExtension(relative) {
  return relative.replace(/\.md$/i, "")
}

function sourceAlias(note) {
  const source = note.frontmatter.onenote_source
  if (!source) return undefined
  const candidate = String(source)
    .split("/")
    .at(-1)
    ?.replace(/^\s*-+\s*|\s*-+\s*$/g, "")
    .trim()
  return candidate && normalize(candidate) !== normalize(note.title) ? candidate : undefined
}

function readWikilinks(body) {
  return [...contentBody(body).matchAll(/(?<!!)\[\[([^\]]+)\]\]/g)].map((match) => {
    const [target] = match[1].split("|")
    return target.split("#")[0].trim()
  })
}

function createResolver(notes) {
  const byPath = new Map()
  const byTitle = new Map()
  const byBasename = new Map()
  for (const note of notes) {
    byPath.set(normalize(pathWithoutExtension(note.relative)), note)
    for (const [map, key] of [
      [byTitle, normalize(note.title)],
      [byBasename, normalize(path.posix.basename(pathWithoutExtension(note.relative)))],
    ]) {
      const values = map.get(key) ?? []
      values.push(note)
      map.set(key, values)
    }
  }
  return (source, target) => {
    if (!target) return undefined
    const noExtension = target.replace(/\.md$/i, "").replace(/^\//, "")
    const direct = byPath.get(normalize(noExtension))
    if (direct) return direct
    const relative = path.posix.normalize(
      path.posix.join(path.posix.dirname(source.relative), noExtension),
    )
    const nearby = byPath.get(normalize(relative))
    if (nearby) return nearby
    const sameFolder = byPath.get(
      normalize(
        path.posix.join(path.posix.dirname(source.relative), path.posix.basename(noExtension)),
      ),
    )
    if (sameFolder) return sameFolder
    const titled = byTitle.get(normalize(noExtension)) ?? byBasename.get(normalize(noExtension))
    if (titled?.length === 1) return titled[0]
    const settingRoot = source.relative.match(/^settings\/[^/]+/)?.[0]
    const withinSetting = settingRoot
      ? titled?.filter((note) => note.relative.startsWith(`${settingRoot}/`))
      : undefined
    return withinSetting?.length === 1 ? withinSetting[0] : undefined
  }
}

function relatedBlock(note, related) {
  if (related.length === 0) return ""
  const links = related.map(
    (target) => `- [[${pathWithoutExtension(target.relative)}|${target.title}]]`,
  )
  return `${ENRICHMENT_START}\n## Related\n\n${links.join("\n")}\n${ENRICHMENT_END}`
}

function renderNote(frontmatter, body, block) {
  const clean = removeOwnedBlock(body, ENRICHMENT_START, ENRICHMENT_END)
    .replace(/^(?:\r?\n)+/, "")
    .trimEnd()
  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd()
  const sections = [clean, block].filter(Boolean)
  return `---\n${yaml}\n---\n${sections.length > 0 ? `\n${sections.join("\n\n")}` : ""}\n`
}

function uniqueNotes(values, current) {
  const seen = new Set([current.relative])
  return values.filter((note) => {
    if (!note || seen.has(note.relative)) return false
    seen.add(note.relative)
    return true
  })
}

async function writeAtomic(destination, content) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.vault-enrichment-${process.pid}.tmp`
  await fsp.writeFile(temporary, content)
  await fsp.rename(temporary, destination)
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

export async function enrichVault({ vaultRoot, apply = false }) {
  const files = (
    await Promise.all(WORKING_ROOTS.map((root) => walkMarkdown(path.join(vaultRoot, root))))
  )
    .flat()
    .sort()
  const notes = await Promise.all(
    files.map(async (file) => {
      const raw = await fsp.readFile(file, "utf8")
      const { frontmatter, body } = parseNote(raw)
      const relative = posix(path.relative(vaultRoot, file))
      return {
        file,
        relative,
        raw,
        frontmatter,
        body,
        title: String(frontmatter.title ?? path.basename(file, ".md")),
        public: isPublic(relative),
      }
    }),
  )
  const resolve = createResolver(notes)
  const byRelative = new Map(notes.map((note) => [note.relative, note]))
  const outgoing = new Map()
  const backlinks = new Map(notes.map((note) => [note.relative, []]))
  const unresolved = []
  for (const note of notes) {
    const targets = []
    for (const link of readWikilinks(note.body)) {
      const target = resolve(note, link)
      if (!target) {
        unresolved.push({ note: note.relative, link })
        continue
      }
      targets.push(target)
      backlinks.get(target.relative).push(note)
    }
    outgoing.set(note.relative, uniqueNotes(targets, note))
  }

  const proposed = []
  let descriptionsAdded = 0
  let aliasesAdded = 0
  let relatedLinksAdded = 0
  for (const note of notes) {
    if (note.body.includes(FOLDER_INDEX_START)) continue
    const frontmatter = { ...note.frontmatter }
    frontmatter.category ??= categoryFor(note.relative)
    frontmatter.visibility ??= note.public ? "public" : "private"
    if (!frontmatter.description) {
      const description = extractDescription(note.body)
      if (description) {
        frontmatter.description = description
        descriptionsAdded += 1
      }
    }
    const alias = sourceAlias(note)
    if (alias) {
      const aliases = Array.isArray(frontmatter.aliases)
        ? frontmatter.aliases
        : frontmatter.aliases
          ? [frontmatter.aliases]
          : []
      if (!aliases.some((value) => normalize(value) === normalize(alias))) {
        aliases.push(alias)
        aliasesAdded += 1
      }
      frontmatter.aliases = aliases
    }

    const directory = path.posix.dirname(note.relative)
    const parentIndex = byRelative.get(`${directory}/index.md`)
    const settingRoot = note.relative.match(/^settings\/[^/]+/)?.[0]
    const settingIndex = settingRoot ? byRelative.get(`${settingRoot}/index.md`) : undefined
    const children =
      path.posix.basename(note.relative) === "index.md"
        ? notes.filter((candidate) => {
            if (candidate.relative === note.relative) return false
            const candidateDirectory = path.posix.dirname(candidate.relative)
            return (
              candidateDirectory === directory ||
              (path.posix.basename(candidate.relative) === "index.md" &&
                path.posix.dirname(candidateDirectory) === directory)
            )
          })
        : []
    const candidates = uniqueNotes(
      [
        parentIndex,
        settingIndex,
        ...(backlinks.get(note.relative) ?? []),
        ...(outgoing.get(note.relative) ?? []),
        ...children.sort((left, right) => left.title.localeCompare(right.title)),
      ],
      note,
    ).filter((target) => !note.public || target.public)
    const related = candidates.slice(0, MAX_RELATED)
    if (related.length > 0) {
      frontmatter.related = related.map((target) => pathWithoutExtension(target.relative))
      relatedLinksAdded += related.length
    } else {
      delete frontmatter.related
    }
    const output = renderNote(frontmatter, note.body, relatedBlock(note, related))
    if (output !== note.raw) proposed.push({ ...note, output })
  }

  const report = {
    applied: apply,
    notesScanned: notes.length,
    notesChanged: proposed.length,
    publicNotes: notes.filter((note) => note.public).length,
    privateNotes: notes.filter((note) => !note.public).length,
    descriptionsAdded,
    aliasesAdded,
    relatedLinksAdded,
    unresolvedExistingLinks: unresolved.length,
    unresolvedPublicLinks: unresolved.filter(({ note }) => byRelative.get(note)?.public).length,
    unresolvedPublicExamples: unresolved
      .filter(({ note }) => byRelative.get(note)?.public)
      .slice(0, 30),
    unresolvedExamples: unresolved.slice(0, 20),
  }
  if (!apply) return report

  const backupRelative = `private/vault-enrichment-backup/${timestampId()}`
  const backupRoot = path.join(vaultRoot, backupRelative)
  for (const note of proposed) {
    const current = await fsp.readFile(note.file, "utf8")
    if (sha256(current) !== sha256(note.raw))
      throw new Error(`Note changed during enrichment: ${note.relative}`)
    const backup = path.join(backupRoot, note.relative)
    await fsp.mkdir(path.dirname(backup), { recursive: true })
    await fsp.writeFile(backup, note.raw)
    await writeAtomic(note.file, note.output)
  }
  const reportRelative = "private/vault-enrichment-report.json"
  Object.assign(report, { backupRoot: backupRelative, report: reportRelative })
  await writeAtomic(path.join(vaultRoot, reportRelative), `${JSON.stringify(report, null, 2)}\n`)
  return report
}
