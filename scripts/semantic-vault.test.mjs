import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { organizeVault } from "./lib/semantic-vault.mjs"

test("adds precise inline links while protecting existing links", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "semantic-vault-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))
  const setting = path.join(root, "settings", "Example")
  await fsp.mkdir(path.join(setting, "NPCs"), { recursive: true })
  await fsp.mkdir(path.join(setting, "History"), { recursive: true })
  await fsp.writeFile(
    path.join(setting, "NPCs", "Mara.md"),
    "---\ntitle: Mara\ntype: npc\nsetting: Example\ntags: []\n---\nMara is a scout.\n",
  )
  await fsp.writeFile(
    path.join(setting, "History", "The Return.md"),
    "---\ntitle: The Return\ntype: history\nsetting: Example\ntags: []\n---\nMara returned during [[The Return]].\n",
  )
  const applied = await organizeVault({ vaultRoot: root, apply: true })
  assert.equal(applied.inlineLinksAdded, 1)
  const history = await fsp.readFile(path.join(setting, "History", "The Return.md"), "utf8")
  assert.match(history, /\[\[settings\/Example\/NPCs\/Mara\|Mara\]\]/)
  assert.match(history, /\[\[settings\/Example\/History\/The Return\|The Return\]\]/)
  const repeated = await organizeVault({ vaultRoot: root })
  assert.equal(repeated.notesChanged, 0)
  assert.equal(repeated.inlineLinksAdded, 0)
})

test("canonicalizes existing short wikilinks for unique generic folder notes", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "semantic-vault-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))
  const setting = path.join(root, "settings", "Example")
  await fsp.mkdir(path.join(setting, "History"), { recursive: true })
  await fsp.mkdir(path.join(setting, "Factions"), { recursive: true })
  await fsp.writeFile(
    path.join(setting, "History", "History.md"),
    "---\ntitle: History\ntype: history\nsetting: Example\ntags: []\n---\nKnown history.\n",
  )
  await fsp.writeFile(
    path.join(setting, "Factions", "Kingdom.md"),
    "---\ntitle: Kingdom\ntype: faction\nsetting: Example\ntags: []\n---\nThe realm.\n",
  )
  await fsp.writeFile(
    path.join(setting, "index.md"),
    "---\ntitle: Example\ntype: setting\nsetting: Example\ntags: []\n---\nRead [[History]] and [[Kingdom]].\n",
  )

  const applied = await organizeVault({ vaultRoot: root, apply: true })
  assert.equal(applied.existingLinksCanonicalized, 2)
  const index = await fsp.readFile(path.join(setting, "index.md"), "utf8")
  assert.match(index, /\[\[settings\/Example\/History\/History\|History\]\]/)
  assert.match(index, /\[\[settings\/Example\/Factions\/Kingdom\|Kingdom\]\]/)
  const repeated = await organizeVault({ vaultRoot: root })
  assert.equal(repeated.notesChanged, 0)
  assert.equal(repeated.existingLinksCanonicalized, 0)
})
