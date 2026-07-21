import assert from "node:assert/strict"
import { createRequire } from "node:module"
import fsp from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { createWikiExploreData, parseTimelineEvents } from "../quartz/plugins/emitters/wikiExploreData.ts"
import { defaultProcessedContent } from "../quartz/plugins/vfile.ts"

const require = createRequire(import.meta.url)
const TimelineFrise = require("../plugins/wiki-timeline-frise/shared/wikiTimelineFrise.js")

function note({
  slug,
  relativePath,
  frontmatter = {},
  links = [],
  value = "",
  description,
  ttrpgMaps = [],
}) {
  const content = defaultProcessedContent({
    slug,
    relativePath,
    frontmatter,
    links,
    description,
    ttrpgMaps,
  })
  content[1].value = value
  return content
}

test("parses Aylbyia, Godshand, Middleworld, and structured timeline formats", () => {
  const aylbyia = parseTimelineEvents(`
- Year 0

- The [[settings/Aylbyia/Regions/Twilight|Twilight]] opens.
- A new empire rises.

- Year 100
- The border castles are built.
`)
  assert.equal(aylbyia.length, 3)
  assert.equal(aylbyia[0].label, "Year 0")
  assert.equal(aylbyia[2].sort, 100)

  const godshand = parseTimelineEvents(`
Some short time before the Festival of Master Debate
- [[settings/Godshand/Campaign/Quests/wildsheep chase|wildsheep chase]]:
\t- The party helps a transmuter.
\t- Everyone survives.

It is almost time for the Festival of Master Debate
- New One/two shot:
`)
  assert.deepEqual(
    godshand.map((event) => event.title),
    ["wildsheep chase", "New One/two shot"],
  )

  const middleworld = parseTimelineEvents(`
- -500
  - [[settings/Middleworld/Factions/Vallios|Vallios]] is rebuilt.
- 0
  - Cataclysm of Elderon.
`)
  assert.deepEqual(
    middleworld.map((event) => event.sort),
    [-500, 0],
  )

  const structured = parseTimelineEvents(`
<!-- timeline-events:start -->
- label: Year 12
  title: The Beacon Lights
  summary: A signal fire changes the war.
  links:
    - settings/Example/Regions/North
<!-- timeline-events:end -->
`)
  assert.equal(structured.length, 1)
  assert.equal(structured[0].title, "The Beacon Lights")
  assert.equal(structured[0].links.length, 1)

  const tales = parseTimelineEvents(`
800 years ago Ueli leaves the council.

50 years ago [[settings/Tales of Fate/Campaign/Players/Noita|Noita]] studies under him.
`)
  assert.deepEqual(
    tales.map((event) => [event.label, event.title, event.sort]),
    [
      ["800 years ago", "Ueli leaves the council.", -800],
      ["50 years ago", "Noita studies under him.", -50],
    ],
  )

  const campaignLog = parseTimelineEvents(`
After a night's rest, the party gathers materials and heads for the forest. This is a full recap paragraph, not a date heading.
- This should not become a timeline event.
`)
  assert.equal(campaignLog.length, 0)
})

test("shared frise core clusters dates and preserves prose ordering", () => {
  const events = TimelineFrise.parseTimelineEvents(`
- Year 0
- First event.
- Second event.

Some short time before the Festival
- Prose event.
`)
  assert.equal(events.length, 3)
  const groups = TimelineFrise.groupEvents(events)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].label, "Year 0")
  assert.equal(groups[0].events.length, 2)
  assert.equal(groups[1].label, "Some short time before the Festival")
  assert.equal(groups[1].events[0].title, "Prose event.")

  const denseEvents = TimelineFrise.parseTimelineEvents(`
- Year 1850
- One.
- Year 1851
- Two.
- Year 1852
- Three.
`)
  const denseGroups = TimelineFrise.groupEvents(denseEvents)
  const layout = TimelineFrise.layoutGroups(denseGroups, { minGap: 120 })
  const xs = layout.groups.map((group) => group.x)
  assert.equal(xs.length, 3)
  assert.ok(xs[1] - xs[0] >= 120)
  assert.ok(xs[2] - xs[1] >= 120)
})

test("generates static explorer pools, maps, timelines, and capped relationships", () => {
  const linkedPages = Array.from({ length: 14 }, (_, index) =>
    note({
      slug: `settings/example/regions/place-${index + 1}`,
      relativePath: `settings/Example/Regions/Place ${index + 1}.md`,
      frontmatter: {
        title: `Place ${index + 1}`,
        type: "region",
        setting: "Example",
        visibility: "public",
      },
    }),
  )

  const content = [
    note({
      slug: "settings/example",
      relativePath: "settings/Example/index.md",
      frontmatter: {
        title: "Example",
        type: "setting",
        setting: "Example",
        visibility: "public",
      },
    }),
    note({
      slug: "settings/example/lore/hub",
      relativePath: "settings/Example/Lore/Hub.md",
      frontmatter: {
        title: "Hub",
        type: "lore",
        setting: "Example",
        visibility: "public",
      },
      links: linkedPages.map(([, file]) => String(file.data.slug)),
    }),
    note({
      slug: "settings/example/people/bryn",
      relativePath: "settings/Example/People/Bryn.md",
      frontmatter: {
        title: "Bryn",
        type: "npc",
        setting: "Example",
        visibility: "public",
      },
    }),
    note({
      slug: "settings/example/factions/silver-guild",
      relativePath: "settings/Example/Factions/Silver Guild.md",
      frontmatter: {
        title: "Silver Guild",
        type: "faction",
        setting: "Example",
        visibility: "public",
      },
    }),
    note({
      slug: "settings/example/odd-archive",
      relativePath: "settings/Example/Odd Archive.md",
      frontmatter: {
        title: "Odd Archive",
        sectionKind: "references",
        setting: "Example",
        visibility: "public",
      },
    }),
    note({
      slug: "settings/example/maps",
      relativePath: "settings/Example/Maps/index.md",
      frontmatter: {
        title: "Maps",
        type: "index",
        category: "Maps",
        setting: "Example",
        visibility: "public",
      },
      ttrpgMaps: [
        {
          id: "world",
          data: {
            layers: [{ id: "settlements", name: "Settlements" }],
            markers: [
              {
                id: "northkeep",
                x: 0.5,
                y: 0.25,
                layer: "settlements",
                tooltip: "Northkeep",
                resolvedHref: "/settings/example/regions/place-1",
              },
            ],
          },
        },
      ],
    }),
    note({
      slug: "settings/example/timeline",
      relativePath: "settings/Example/Timeline.md",
      frontmatter: {
        title: "Timeline",
        type: "timeline",
        setting: "Example",
        visibility: "public",
      },
      value: "- Year 1\n- The first road opens.\n",
    }),
    note({
      slug: "settings/example/private",
      relativePath: "settings/Example/Private.md",
      frontmatter: {
        title: "Private",
        visibility: "private",
      },
    }),
    ...linkedPages,
  ]

  const data = createWikiExploreData(content)
  assert.equal(data.settings.length, 1)
  assert.equal(data.pages["settings/example/private"], undefined)
  assert.equal(data.pages["settings/example/odd-archive"].sectionKind, "references")
  assert.equal(data.pages["settings/example/odd-archive"].group, "References")
  assert.equal(data.maps.length, 1)
  assert.equal(data.maps[0].markers[0].name, "Place 1")
  assert.equal(data.timelines["settings/example/timeline"].events.length, 1)
  assert.ok(data.randomPools.bySetting.Example.locations.includes("settings/example/regions/place-1"))
  assert.ok(data.randomPools.bySetting.Example.mapMarkers[0].includes("northkeep"))
  assert.ok(data.randomPools.bySetting.Example.timelineEvents[0].includes("event-1"))

  const relationships = data.relationships["settings/example/lore/hub"]
  assert.equal(relationships.length, 12)
  assert.ok(relationships.every((relationship) => relationship.setting === "Example"))
  assert.ok(relationships.every((relationship) => relationship.group === "Places"))
})

test("client and map source keep the no-backend interaction contract", async () => {
  const root = path.resolve(import.meta.dirname, "..")
  const client = await fsp.readFile(
    path.join(root, "quartz", "components", "scripts", "wikiExplore.inline.ts"),
    "utf8",
  )
  assert.match(client, /wiki-explore\.json/)
  assert.match(client, /localStorage\.getItem/)
  assert.match(client, /recentSet\.has\(item\.key\)/)
  assert.match(client, /ttrpg-map:focus-marker/)
  assert.match(client, /language-wiki-timeline/)
  assert.match(client, /WikiTimelineFrise/)
  assert.match(client, /data-setting-theme|settingTheme/)
  assert.match(client, /data-section-kind|sectionKind/)
  assert.match(client, /aylbyia/)
  assert.match(client, /tales-of-fate/)
  assert.match(client, /maps/)
  assert.match(client, /geography/)
  assert.match(client, /people/)
  assert.match(client, /powers/)
  assert.match(client, /history/)
  assert.match(client, /campaign/)
  assert.match(client, /rules/)
  assert.match(client, /references/)

  const timelinePlugin = await fsp.readFile(
    path.join(root, "plugins", "wiki-timeline-frise", "main.js"),
    "utf8",
  )
  assert.match(timelinePlugin, /registerMarkdownCodeBlockProcessor\("wiki-timeline"/)
  assert.match(timelinePlugin, /parseTimelineEvents/)

  const exploreEmitter = await fsp.readFile(
    path.join(root, "quartz", "plugins", "emitters", "wikiExploreData.ts"),
    "utf8",
  )
  assert.match(exploreEmitter, /\$\{wikiTimelineFriseScript\};\\n\$\{wikiExploreScript\}/)

  const mapScript = await fsp.readFile(
    path.join(
      root,
      "plugins",
      "obsidian-plugin-ttrpg-tools-maps",
      "dist",
      "components",
      "index.js",
    ),
    "utf8",
  )
  assert.match(mapScript, /data-marker-id/)
  assert.match(mapScript, /ttrpg-map:focus-marker/)
  assert.match(mapScript, /focusMarker\(/)
  assert.match(mapScript, /new URLSearchParams\(window\.location\.search\)\.get\("marker"\)/)
})
