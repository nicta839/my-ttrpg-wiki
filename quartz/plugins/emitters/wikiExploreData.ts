import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import YAML from "yaml"
import { VFile } from "vfile"

import { QuartzComponent } from "../../components/types"
import { FilePath, FullSlug, joinSegments, simplifySlug, slugifyFilePath } from "../../util/path"
import { BuildCtx } from "../../util/ctx"
import { QuartzEmitterPlugin } from "../types"
import { ProcessedContent } from "../vfile"

const VERSION = 1
const wikiExploreScript = fsSync.readFileSync(
  path.join(process.cwd(), "quartz", "components", "scripts", "wikiExplore.inline.ts"),
  "utf8",
)
const wikiTimelineFriseScript = fsSync.readFileSync(
  path.join(process.cwd(), "plugins", "wiki-timeline-frise", "shared", "wikiTimelineFrise.js"),
  "utf8",
)
const TIMELINE_EVENTS_START = "<!-- timeline-events:start -->"
const TIMELINE_EVENTS_END = "<!-- timeline-events:end -->"
const OWNED_BLOCKS = [
  ["<!-- vault-enrichment:start -->", "<!-- vault-enrichment:end -->"],
  ["<!-- curated-index:start -->", "<!-- curated-index:end -->"],
  ["<!-- vault-folder-index:start -->", "<!-- vault-folder-index:end -->"],
]

type StringRecord = Record<string, unknown>

export interface ExplorePage {
  slug: string
  href: string
  title: string
  setting?: string
  category?: string
  group?: string
  type?: string
  sectionKind?: string
  description?: string
  tags: string[]
  links: string[]
  related: string[]
  isIndex: boolean
}

export interface ExploreMarker {
  id: string
  name: string
  tooltip?: string
  layer?: string
  x?: number
  y?: number
  href?: string
}

export interface ExploreMap {
  id: string
  slug: string
  href: string
  title: string
  setting?: string
  layers: { id: string; name: string }[]
  markers: ExploreMarker[]
}

export interface ExploreTimelineEvent {
  id: string
  label: string
  title: string
  summary: string
  sort?: number
  order: number
  links: string[]
}

export interface ExploreTimeline {
  id: string
  slug: string
  href: string
  title: string
  setting?: string
  events: ExploreTimelineEvent[]
}

export interface WikiExploreData {
  version: number
  generatedAt: string
  settings: ExplorePage[]
  pages: Record<string, ExplorePage>
  maps: ExploreMap[]
  timelines: Record<string, ExploreTimeline>
  relationships: Record<string, Array<Pick<ExplorePage, "slug" | "href" | "title" | "setting" | "group"> & { reason: string }>>
  randomPools: Record<string, unknown>
}

function asRecord(value: unknown): StringRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as StringRecord) : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === "string" && value.trim()) return [value.trim()]
  return []
}

function rawSlug(value: unknown): string {
  const slug = String(value ?? "")
  return slug === "" ? "index" : slug.replace(/^\/+|\/+$/g, "")
}

function hrefFromSlug(slug: string): string {
  const clean = slug === "" ? "index" : slug.replace(/^\/+|\/+$/g, "")
  if (clean === "index") return "/"
  if (clean.endsWith("/index")) return `/${clean.replace(/\/index$/, "")}/`
  return `/${clean}`
}

function keyWithoutExtension(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "")
}

function slugFromRelatedTarget(target: string): string {
  const withExtension = target.endsWith(".md") ? target : `${target}.md`
  return rawSlug(simplifySlug(slugifyFilePath(withExtension as FilePath)) as string)
}

function removeBlock(markdown: string, start: string, end: string): string {
  const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return markdown.replace(new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "g"), "")
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
}

function sourceMarkdown(file: VFile): string {
  return String(file.value ?? file.data.text ?? "")
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, (_match, target, alias) =>
      alias ? alias : String(target).split("/").at(-1),
    )
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function bodyForTimeline(markdown: string): string {
  let body = stripFrontmatter(markdown)
  for (const [start, end] of OWNED_BLOCKS) body = removeBlock(body, start, end)
  return body
}

function extractWikiLinks(value: string): string[] {
  const links = new Set<string>()
  for (const match of value.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?]]/g)) {
    links.add(slugFromRelatedTarget(match[1].trim()))
  }
  return [...links]
}

function eventLabelSort(label: string): number | undefined {
  const match = label.match(/-?\d+/)
  if (!match) return undefined
  const value = Number(match[0])
  if (!Number.isFinite(value)) return undefined
  return /years?\s+ago/i.test(label) ? -Math.abs(value) : value
}

function isDateBullet(text: string): boolean {
  return /^year\s+-?\d+/i.test(text) || /^-?\d{1,5}(?:\s*(?:b\.?c\.?|a\.?c\.?|years?\s+ago))?$/i.test(text)
}

function isProseDateLine(text: string): boolean {
  return text.length <= 120 && /^(some short time|it is almost|before |after |during |at the start|campaign start)/i.test(text)
}

function inlineDateEvent(text: string): { label: string; summary: string } | undefined {
  const match = text.match(/^(year\s+-?\d+|\d{1,5}\s+years?\s+ago|-?\d{1,5})\s+(.+)$/i)
  if (!match) return undefined
  const label = cleanMarkdown(match[1])
  const summary = cleanMarkdown(match[2])
  if (!label || !summary) return undefined
  return { label, summary }
}

function indentationWidth(raw: string): number {
  return (raw.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "    ").length
}

function parseStructuredTimelineEvents(markdown: string): ExploreTimelineEvent[] {
  const pattern = new RegExp(
    `${TIMELINE_EVENTS_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s\\S]*?)${TIMELINE_EVENTS_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  )
  const match = markdown.match(pattern)
  if (!match) return []
  const parsed = YAML.parse(match[1]) as unknown
  const events = Array.isArray(parsed) ? parsed : Array.isArray(asRecord(parsed).events) ? (asRecord(parsed).events as unknown[]) : []
  return events
    .map((event, index) => {
      const record = asRecord(event)
      const label = asString(record.label) ?? asString(record.date) ?? asString(record.year) ?? "Event"
      const summary = asString(record.summary) ?? asString(record.text) ?? asString(record.title) ?? label
      return {
        id: `structured-${index + 1}`,
        label,
        title: asString(record.title) ?? cleanMarkdown(summary),
        summary: cleanMarkdown(summary),
        sort: typeof record.sort === "number" ? record.sort : eventLabelSort(label),
        order: index,
        links: asStringArray(record.links).map(slugFromRelatedTarget),
      }
    })
    .filter((event) => event.summary)
}

export function parseTimelineEvents(markdown: string): ExploreTimelineEvent[] {
  const structured = parseStructuredTimelineEvents(markdown)
  if (structured.length > 0) return structured

  const body = bodyForTimeline(markdown)
  const events: ExploreTimelineEvent[] = []
  const lines = body.split(/\r?\n/)
  let currentLabel = ""
  let currentLabelFromBullet = false
  let order = 0

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ""
    const trimmed = raw.trim()
    if (!trimmed || /^#{1,6}\s+/.test(trimmed)) continue

    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      const text = bullet[1].trim()
      const indent = indentationWidth(raw)
      const inline = inlineDateEvent(text)
      if (inline) {
        order += 1
        events.push({
          id: `event-${order}`,
          label: inline.label,
          title: inline.summary,
          summary: inline.summary,
          sort: eventLabelSort(inline.label),
          order,
          links: extractWikiLinks(text),
        })
        continue
      }
      if (isDateBullet(text)) {
        currentLabel = text
        currentLabelFromBullet = true
        continue
      }
      if (currentLabel && (currentLabelFromBullet || indent === 0)) {
        const summary = cleanMarkdown(text.replace(/:\s*$/, ""))
        if (summary) {
          order += 1
          events.push({
            id: `event-${order}`,
            label: currentLabel,
            title: summary,
            summary,
            sort: eventLabelSort(currentLabel),
            order,
            links: extractWikiLinks(text),
          })
        }
      }
      continue
    }

    const inline = inlineDateEvent(trimmed)
    if (inline) {
      order += 1
      events.push({
        id: `event-${order}`,
        label: inline.label,
        title: inline.summary,
        summary: inline.summary,
        sort: eventLabelSort(inline.label),
        order,
        links: extractWikiLinks(trimmed),
      })
      continue
    }

    if (isProseDateLine(trimmed)) {
      currentLabel = cleanMarkdown(trimmed)
      currentLabelFromBullet = false
    }
  }

  return events.sort((left, right) => {
    if (left.sort !== undefined && right.sort !== undefined && left.sort !== right.sort) {
      return left.sort - right.sort
    }
    return left.order - right.order
  })
}

function groupForPage(page: Partial<ExplorePage>): string {
  const value = `${page.category ?? ""} ${page.type ?? ""} ${page.sectionKind ?? ""} ${page.slug ?? ""}`.toLowerCase()
  if (/maps|map-feature|\/maps\//.test(value)) return "Maps"
  if (/people|npcs|npc/.test(value)) return "People"
  if (/powers|factions|organizations|organization|faction/.test(value)) return "Powers"
  if (/geography|regions|settlements|location/.test(value)) return "Places"
  if (/campaign|quests|rumors/.test(value)) return "Campaign"
  if (/running-the-game|homebrew|rules|character creation|dm-ing/.test(value)) return "Rules"
  if (/references?/.test(value)) return "References"
  if (/cosmology|history|society|mysteries|lore|timeline/.test(value)) return "Lore"
  return "Links"
}

function pageType(frontmatter: StringRecord): string | undefined {
  return asString(frontmatter.type)
}

function pageSectionKind(frontmatter: StringRecord): string | undefined {
  return (
    asString(frontmatter.sectionKind) ??
    asString(frontmatter.section_kind) ??
    asString(frontmatter["section-kind"]) ??
    asString(frontmatter.section)
  )
}

function pageCategory(frontmatter: StringRecord, relativePath: string): string | undefined {
  return asString(frontmatter.category) ?? relativePath.split("/")[2] ?? relativePath.split("/")[0]
}

function isPublicPage(frontmatter: StringRecord, relativePath: string): boolean {
  if (frontmatter.unlisted === true) return false
  if (frontmatter.visibility === "private") return false
  return relativePath === "index.md" || /^(settings|running-the-game|references)\//.test(relativePath)
}

function settingFromRelative(relativePath: string): string | undefined {
  const parts = relativePath.split("/")
  return parts[0] === "settings" && parts.length > 1 ? parts[1] : undefined
}

function markerName(marker: StringRecord, pageByHrefMap: Map<string, ExplorePage>): string {
  const href = asString(marker.resolvedHref) ?? asString(marker.link)
  if (href) {
    const clean = href.replace(/^\/+|\/+$/g, "")
    const page = pageByHrefMap.get(clean)
    if (page) return page.title
  }
  const tooltip = asString(marker.tooltip)
  if (tooltip) return tooltip.split(/[—-]/)[0].trim()
  return asString(marker.id) ?? "Mapped location"
}

function poolsForPages(pages: Record<string, ExplorePage>) {
  const pools: Record<string, string[]> = {
    settings: [],
    locations: [],
    npcs: [],
    powers: [],
    maps: [],
  }
  const bySetting: Record<string, Record<string, string[]>> = {}

  function add(setting: string | undefined, key: string, slug: string) {
    pools[key].push(slug)
    if (setting) {
      bySetting[setting] ??= { locations: [], npcs: [], powers: [], maps: [], timelineEvents: [], mapMarkers: [] }
      bySetting[setting][key] ??= []
      bySetting[setting][key].push(slug)
    }
  }

  for (const page of Object.values(pages)) {
    if (page.type === "setting" || /^settings\/[^/]+\/index$/.test(page.slug)) {
      pools.settings.push(page.slug)
      continue
    }
    const group = page.group ?? groupForPage(page)
    if (group === "Places") add(page.setting, "locations", page.slug)
    else if (group === "People") add(page.setting, "npcs", page.slug)
    else if (group === "Powers") add(page.setting, "powers", page.slug)
    else if (group === "Maps") add(page.setting, "maps", page.slug)
  }

  return { pools, bySetting }
}

function sortPages(pages: ExplorePage[]): ExplorePage[] {
  return pages.sort((left, right) => left.title.localeCompare(right.title))
}

export function createWikiExploreData(content: ProcessedContent[]): WikiExploreData {
  const pages: Record<string, ExplorePage> = {}
  const slugByRelative = new Map<string, string>()

  for (const [, file] of content) {
    const data = asRecord(file.data)
    const relativePath = asString(data.relativePath) ?? asString(data.filePath)
    if (!relativePath || !relativePath.endsWith(".md")) continue
    const frontmatter = asRecord(data.frontmatter)
    if (!isPublicPage(frontmatter, relativePath)) continue

    const slug = rawSlug(data.slug)
    const title = asString(frontmatter.title) ?? path.basename(relativePath, ".md")
    const category = pageCategory(frontmatter, relativePath)
    const setting = asString(frontmatter.setting) ?? settingFromRelative(relativePath)
    const type = pageType(frontmatter)
    const sectionKind = pageSectionKind(frontmatter)
    const tags = asStringArray(frontmatter.tags)
    const links = asStringArray(data.links).map(rawSlug)
    const related = asStringArray(frontmatter.related).map(slugFromRelatedTarget)
    const page: ExplorePage = {
      slug,
      href: hrefFromSlug(slug),
      title,
      setting,
      category,
      group: groupForPage({ slug, category, type, sectionKind }),
      type,
      sectionKind,
      description: asString(data.description) ?? asString(frontmatter.description),
      tags,
      links,
      related,
      isIndex: /(?:^|\/)index\.md$/i.test(relativePath),
    }
    pages[slug] = page
    slugByRelative.set(keyWithoutExtension(relativePath), slug)
    if (relativePath.endsWith("/index.md")) {
      slugByRelative.set(keyWithoutExtension(relativePath).replace(/\/index$/, ""), slug)
    }
  }

  const pageByHrefMap = new Map(
    Object.values(pages).map((page) => [page.href.replace(/^\/+|\/+$/g, ""), page] as const),
  )

  const settings = sortPages(
    Object.values(pages).filter((page) => page.type === "setting" || /^settings\/[^/]+\/index$/.test(page.slug)),
  )

  const maps: ExploreMap[] = []
  for (const [, file] of content) {
    const data = asRecord(file.data)
    const slug = rawSlug(data.slug)
    const page = pages[slug]
    const ttrpgMaps = Array.isArray(data.ttrpgMaps) ? (data.ttrpgMaps as unknown[]) : []
    if (!page || ttrpgMaps.length === 0) continue
    for (const map of ttrpgMaps) {
      const record = asRecord(map)
      const mapData = asRecord(record.data)
      const layers = Array.isArray(mapData.layers)
        ? mapData.layers.map((layer) => {
            const layerRecord = asRecord(layer)
            return {
              id: asString(layerRecord.id) ?? "layer",
              name: asString(layerRecord.name) ?? asString(layerRecord.id) ?? "Layer",
            }
          })
        : []
      const markers = Array.isArray(mapData.markers)
        ? mapData.markers.map((marker) => {
            const markerRecord = asRecord(marker)
            return {
              id: asString(markerRecord.id) ?? `marker-${maps.length + 1}`,
              name: markerName(markerRecord, pageByHrefMap),
              tooltip: asString(markerRecord.tooltip),
              layer: asString(markerRecord.layer),
              x: typeof markerRecord.x === "number" ? markerRecord.x : undefined,
              y: typeof markerRecord.y === "number" ? markerRecord.y : undefined,
              href: asString(markerRecord.resolvedHref),
            }
          })
        : []
      maps.push({
        id: `${slug}#${asString(record.id) ?? `map-${record.index ?? maps.length}`}`,
        slug,
        href: page.href,
        title: page.title,
        setting: page.setting,
        layers,
        markers,
      })
    }
  }

  const timelines: Record<string, ExploreTimeline> = {}
  for (const [, file] of content) {
    const data = asRecord(file.data)
    const slug = rawSlug(data.slug)
    const page = pages[slug]
    if (!page) continue
    const raw = sourceMarkdown(file)
    const type = page.type?.toLowerCase()
    const isTimelineCandidate =
      type === "timeline" ||
      page.category?.toLowerCase() === "history" ||
      /(?:^|\/)(timeline|history)(?:\/|$)/i.test(page.slug)
    if (!isTimelineCandidate) continue
    const events = parseTimelineEvents(raw)
    if (events.length === 0) continue
    timelines[slug] = {
      id: slug,
      slug,
      href: page.href,
      title: page.title,
      setting: page.setting,
      events: events.map((event, index) => ({
        ...event,
        id: `${slug}#${event.id || index + 1}`,
      })),
    }
  }

  const backlinks = new Map<string, string[]>()
  for (const slug of Object.keys(pages)) backlinks.set(slug, [])
  for (const page of Object.values(pages)) {
    for (const link of page.links) {
      if (pages[link]) backlinks.get(link)?.push(page.slug)
    }
  }

  const relationships: WikiExploreData["relationships"] = {}
  for (const page of Object.values(pages)) {
    const selected = new Map<string, string>()
    for (const slug of page.related) if (pages[slug] && slug !== page.slug) selected.set(slug, "Related")
    for (const slug of page.links) {
      if (selected.size >= 12) break
      if (pages[slug] && slug !== page.slug && (!page.setting || pages[slug].setting === page.setting)) {
        selected.set(slug, "Linked")
      }
    }
    for (const slug of backlinks.get(page.slug) ?? []) {
      if (selected.size >= 12) break
      if (pages[slug] && slug !== page.slug && (!page.setting || pages[slug].setting === page.setting)) {
        selected.set(slug, "Backlink")
      }
    }
    if (selected.size > 0) {
      relationships[page.slug] = [...selected].map(([slug, reason]) => {
        const target = pages[slug]
        return {
          slug: target.slug,
          href: target.href,
          title: target.title,
          setting: target.setting,
          group: target.group,
          reason,
        }
      })
    }
  }

  const { pools, bySetting } = poolsForPages(pages)
  const markerPool: string[] = []
  for (const map of maps) {
    for (const marker of map.markers) {
      const key = `${map.id}::${marker.id}`
      markerPool.push(key)
      if (map.setting) {
        bySetting[map.setting] ??= { locations: [], npcs: [], powers: [], maps: [], timelineEvents: [], mapMarkers: [] }
        bySetting[map.setting].mapMarkers.push(key)
      }
    }
  }

  const timelinePool: string[] = []
  for (const timeline of Object.values(timelines)) {
    for (const event of timeline.events) {
      timelinePool.push(event.id)
      if (timeline.setting) {
        bySetting[timeline.setting] ??= { locations: [], npcs: [], powers: [], maps: [], timelineEvents: [], mapMarkers: [] }
        bySetting[timeline.setting].timelineEvents.push(event.id)
      }
    }
  }

  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    settings,
    pages,
    maps,
    timelines,
    relationships,
    randomPools: {
      ...pools,
      mapMarkers: markerPool,
      timelineEvents: timelinePool,
      bySetting,
    },
  }
}

const WikiExploreClient: QuartzComponent = () => null
WikiExploreClient.afterDOMLoaded = `${wikiTimelineFriseScript};\n${wikiExploreScript}`

async function writeJson(ctx: BuildCtx, data: WikiExploreData): Promise<FilePath> {
  const slug = joinSegments("static", "wiki-explore") as FullSlug
  const outputPath = joinSegments(ctx.argv.output, `${slug}.json`) as FilePath
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`)
  return outputPath
}

export const WikiExploreData: QuartzEmitterPlugin = () => {
  async function emit(ctx: BuildCtx, content: ProcessedContent[]): Promise<FilePath[]> {
    return [await writeJson(ctx, createWikiExploreData(content))]
  }

  return {
    name: "WikiExploreData",
    emit,
    partialEmit: emit,
    getQuartzComponents() {
      return [WikiExploreClient]
    },
  }
}
