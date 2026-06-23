import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { validateMaps } from "./validate-maps.mjs"

test("validates a zoommap block with sidecar markers, links, and assets", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "validate-maps-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))

  await fsp.mkdir(path.join(root, "assets", "maps"), { recursive: true })
  await fsp.mkdir(path.join(root, "settings", "Example", "Maps"), { recursive: true })
  await fsp.mkdir(path.join(root, "settings", "Example", "Regions"), { recursive: true })
  await fsp.writeFile(path.join(root, "assets", "maps", "world.webp"), "tiny image")
  await fsp.writeFile(
    path.join(root, "settings", "Example", "Regions", "North.md"),
    "---\ntitle: North\n---\n# North\n",
  )
  await fsp.writeFile(
    path.join(root, "settings", "Example", "Maps", "index.md"),
    [
      "```zoommap",
      "imageBases:",
      "  - path: assets/maps/world.webp",
      "    name: World",
      "markers: settings/Example/Maps/world.markers.json",
      "```",
      "",
    ].join("\n"),
  )
  await fsp.writeFile(
    path.join(root, "settings", "Example", "Maps", "world.markers.json"),
    JSON.stringify(
      {
        layers: [{ id: "regions", name: "Regions", visible: true }],
        markers: [
          {
            id: "north",
            x: 0.5,
            y: 0.25,
            layer: "regions",
            tooltip: "North",
            link: "settings/Example/Regions/North",
            resolvedHref: "/settings/example/regions/north",
          },
        ],
      },
      null,
      2,
    ),
  )

  const report = await validateMaps({ root })
  assert.equal(report.ok, true)
  assert.equal(report.mapBlocks, 1)
  assert.deepEqual(report.errors, [])
})

test("reports bad marker links, hrefs, coordinates, and oversized assets", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "validate-maps-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))

  await fsp.mkdir(path.join(root, "assets"), { recursive: true })
  await fsp.mkdir(path.join(root, "settings", "Example", "Maps"), { recursive: true })
  await fsp.writeFile(path.join(root, "assets", "world.webp"), "too large")
  await fsp.writeFile(
    path.join(root, "settings", "Example", "Maps", "index.md"),
    [
      "```zoommap",
      "image: assets/world.webp",
      "markers: settings/Example/Maps/world.markers.json",
      "```",
      "",
    ].join("\n"),
  )
  await fsp.writeFile(
    path.join(root, "settings", "Example", "Maps", "world.markers.json"),
    JSON.stringify(
      {
        layers: [{ id: "regions", name: "Regions", visible: true }],
        markers: [
          {
            id: "bad",
            x: 1.2,
            y: 0.5,
            layer: "regions",
            link: "settings/Example/Regions/Missing Place",
            resolvedHref: "/settings/Example/Regions/Missing Place",
          },
        ],
      },
      null,
      2,
    ),
  )

  const report = await validateMaps({ root, maxAssetBytes: 4 })
  assert.equal(report.ok, false)
  assert.match(report.errors.join("\n"), /marker x must be a number from 0 to 1/)
  assert.match(report.errors.join("\n"), /marker link does not resolve/)
  assert.match(report.errors.join("\n"), /resolvedHref should be/)
  assert.match(report.errors.join("\n"), /at\/above limit/)
})
