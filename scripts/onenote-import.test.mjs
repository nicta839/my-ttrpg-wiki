import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import sharp from "sharp"
import YAML from "yaml"

import {
  MEDIA_END,
  MEDIA_START,
  approveAllReview,
  cleanTitle,
  detectMagicType,
  htmlToMarkdown,
  normalizeTitle,
  safeFilename,
  safeAssetSlug,
  stageImport,
  textSimilarity,
  promoteImport,
  removeMediaBlock,
  upsertMediaBlock,
} from "./lib/onenote-import.mjs"

test("normalizes OneNote separator titles and Unicode", () => {
  assert.equal(cleanTitle(" --The Frosted South-- "), "The Frosted South")
  assert.equal(normalizeTitle("Shaïdin — Shame made Flesh"), "shaidin shame made flesh")
  assert.equal(safeFilename("The Skal'ik Desert: Lyzykos?"), "The Skal'ik Desert- Lyzykos-")
  assert.equal(safeAssetSlug("Shaïdin / 王国 map #1"), "shaidin-map-1")
  assert.match(safeAssetSlug("王国"), /^asset-[a-f0-9]{10}$/)
})

test("converts representative OneNote HTML to Markdown", () => {
  const html = `<!doctype html><html><body>
    <div class="title"><span>Ignored title and date</span></div>
    <div class="container-outline" style="top: 100px; left: 48px">
      <p><span style="font-weight:bold"><b>Capital:</b></span> Junon</p>
      <ul><li>First</li><li><i>Second</i></li></ul>
      <table><tr><th>Name</th><th>Role</th></tr><tr><td>Nasreen</td><td>Queen</td></tr></table>
      <p><a href="https://example.com">Source</a></p>
    </div>
  </body></html>`
  const { markdown, unsupported } = htmlToMarkdown(html)
  assert.match(markdown, /\*\*Capital:\*\* Junon/)
  assert.match(markdown, /- First/)
  assert.match(markdown, /- \*Second\*/)
  assert.match(markdown, /\| Name \| Role \|/)
  assert.match(markdown, /\[Source\]\(https:\/\/example\.com\)/)
  assert.deepEqual(unsupported, [])
})

test("detects actual image type instead of trusting the extension", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb])
  assert.equal(detectMagicType(png), "png")
  assert.equal(detectMagicType(jpeg), "jpeg")
})

test("classifies exact and fuzzy text similarity", () => {
  assert.equal(textSimilarity("The queen rules Junon", "The queen rules Junon"), 1)
  assert.ok(textSimilarity("The queen rules Junon", "The young queen rules Junon wisely") > 0.4)
  assert.equal(textSimilarity("dragons", "accounting"), 0)
})

test("media block replacement is idempotent and preserves surrounding content", () => {
  const original = `---\ntitle: Queendom\n---\n\nOpening paragraph.\n\nClosing paragraph.\n`
  const first = upsertMediaBlock(original, "> [!onenote-hero]\n> image-one")
  const second = upsertMediaBlock(first, "> [!onenote-hero]\n> image-two")
  assert.equal((second.match(new RegExp(MEDIA_START, "g")) ?? []).length, 1)
  assert.equal((second.match(new RegExp(MEDIA_END, "g")) ?? []).length, 1)
  assert.match(second, /image-two/)
  assert.doesNotMatch(second, /image-one/)
  assert.match(second, /Opening paragraph\./)
  assert.match(second, /Closing paragraph\./)
  assert.equal(removeMediaBlock(second), original)
})

test("stages privately and promotes only approved notes and media", async (context) => {
  const vaultRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "onenote-import-test-"))
  context.after(() => fsp.rm(vaultRoot, { recursive: true, force: true }))
  await fsp.mkdir(path.join(vaultRoot, ".obsidian"), { recursive: true })
  await fsp.writeFile(path.join(vaultRoot, ".obsidian", "appearance.json"), "{}\n")
  const sourceImage = path.join(vaultRoot, "source-with-wrong-extension.jpg")
  await sharp({
    create: { width: 32, height: 24, channels: 3, background: { r: 40, g: 90, b: 140 } },
  })
    .png()
    .toFile(sourceImage)
  const page = {
    id: "test-page",
    notebook: "SOleria",
    setting: "Soleria",
    section: "World",
    title: "Test Region",
    sourceRelative: "SOleria/World/Test Region.html",
    destination: "settings/Soleria/Regions/Test Region.md",
    action: "new",
    markdown: "Opening paragraph.\n\nMore lore.",
    unsupported: [],
    images: [
      {
        sourcePath: sourceImage,
        sourceName: "source-with-wrong-extension.jpg",
        alt: "Blue test image",
        order: 0,
        top: 100,
        left: 20,
        renderedWidth: 320,
        renderedHeight: 240,
      },
    ],
  }
  await stageImport({
    inventory: { pages: [page], skippedNotebooks: [], vaultNotes: [] },
    vaultRoot,
  })
  const reviewFile = path.join(vaultRoot, "private", "onenote-import-review", "review.yaml")
  const review = YAML.parse(await fsp.readFile(reviewFile, "utf8"))
  assert.equal(review.media[0].detected_type, "png")
  assert.equal(review.pages[0].approved, false)
  const approval = await approveAllReview({ vaultRoot })
  assert.equal(approval.pagesApproved, 1)
  assert.equal(approval.mediaApproved, 1)
  const promotion = await promoteImport({ vaultRoot })
  assert.deepEqual(promotion.touched, ["settings/Soleria/Regions/Test Region.md"])
  const promoted = await fsp.readFile(path.join(vaultRoot, promotion.touched[0]), "utf8")
  assert.match(promoted, /onenote-media:start/)
  assert.match(promoted, /\[!onenote-hero\]/)
  assert.ok(promotion.copiedMedia.every((file) => file.endsWith(".webp")))
  const appearance = JSON.parse(
    await fsp.readFile(path.join(vaultRoot, ".obsidian", "appearance.json"), "utf8"),
  )
  assert.deepEqual(appearance.enabledCssSnippets, ["onenote-media"])
})
