import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { enrichVault, extractDescription, parseNote } from "./lib/vault-enrichment.mjs"

test("extracts a concise description from existing prose", () => {
  const body = `# Region\n\n<!-- onenote-media:start -->\nimage\n<!-- onenote-media:end -->\n\nThe Frosted South is an isolated region beyond the mountains. Its people trade in amber.`
  assert.equal(
    extractDescription(body),
    "The Frosted South is an isolated region beyond the mountains. Its people trade in amber.",
  )
})

test("parses frontmatter without folding it into the body", () => {
  const note = parseNote("---\ntitle: Test\n---\nBody\n")
  assert.equal(note.frontmatter.title, "Test")
  assert.equal(note.body, "Body\n")
})

test("enriches public notes with unambiguous reciprocal links", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vault-enrichment-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.mkdir(path.join(root, "settings", "Example", "Regions"), { recursive: true })
  await fsp.writeFile(
    path.join(root, "settings", "Example", "index.md"),
    "---\ntitle: Example\ntype: setting\nsetting: Example\ntags: []\n---\nA setting overview with enough useful prose to become its description.\n",
  )
  await fsp.writeFile(
    path.join(root, "settings", "Example", "Regions", "North.md"),
    "---\ntitle: North\ntype: region\nsetting: Example\ntags: []\n---\nThe northern region points to [[South]] and contains windswept hills.\n",
  )
  await fsp.writeFile(
    path.join(root, "settings", "Example", "Regions", "South.md"),
    "---\ntitle: South\ntype: region\nsetting: Example\ntags: []\n---\nThe southern region contains quiet forests and old roads.\n",
  )
  const preview = await enrichVault({ vaultRoot: root })
  assert.equal(preview.notesScanned, 3)
  assert.ok(preview.relatedLinksAdded >= 3)
  const applied = await enrichVault({ vaultRoot: root, apply: true })
  assert.equal(applied.notesChanged, 3)
  const south = await fsp.readFile(
    path.join(root, "settings", "Example", "Regions", "South.md"),
    "utf8",
  )
  assert.match(south, /visibility: public/)
  assert.match(south, /\[\[settings\/Example\/Regions\/North\|North\]\]/)
  const repeated = await enrichVault({ vaultRoot: root })
  assert.equal(repeated.notesChanged, 0)
})
