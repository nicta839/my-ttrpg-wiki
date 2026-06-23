import assert from "node:assert/strict"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { FOLDER_INDEX_START, indexVault } from "./lib/folder-indexes.mjs"

test("creates folder indexes that link to the next depth", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "folder-indexes-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.mkdir(path.join(root, "settings", "Aylbyia", "History"), { recursive: true })
  await fsp.mkdir(path.join(root, "settings", "Soleria"), { recursive: true })
  await fsp.mkdir(path.join(root, "running-the-game", "Homebrew"), { recursive: true })
  await fsp.writeFile(
    path.join(root, "index.md"),
    "---\ntitle: The Vault\n---\n# The Vault\n\nOld prose stays.\n",
  )
  await fsp.writeFile(
    path.join(root, "settings", "Aylbyia", "History", "Founding myth.md"),
    "---\ntitle: Founding myth\n---\nA myth.\n",
  )

  const applied = await indexVault({ vaultRoot: root, apply: true })
  assert.deepEqual(applied.indexesCreated.sort(), [
    "running-the-game/Homebrew/index.md",
    "running-the-game/index.md",
    "settings/Aylbyia/History/index.md",
    "settings/Aylbyia/index.md",
    "settings/Soleria/index.md",
    "settings/index.md",
  ])

  const vaultIndex = await fsp.readFile(path.join(root, "index.md"), "utf8")
  assert.match(vaultIndex, /Old prose stays/)
  assert.match(vaultIndex, /\[\[settings\/Aylbyia\/index\|Aylbyia\]\]/)
  assert.match(vaultIndex, /\[\[settings\/Soleria\/index\|Soleria\]\]/)
  assert.match(vaultIndex, /\[\[running-the-game\/index\|Running the game\]\]/)

  const settingsIndex = await fsp.readFile(path.join(root, "settings", "index.md"), "utf8")
  assert.match(settingsIndex, /\[\[settings\/Aylbyia\/index\|Aylbyia\]\]/)
  assert.match(settingsIndex, /\[\[settings\/Soleria\/index\|Soleria\]\]/)

  const aylbyiaIndex = await fsp.readFile(path.join(root, "settings", "Aylbyia", "index.md"), "utf8")
  assert.match(aylbyiaIndex, /\[\[settings\/Aylbyia\/History\/index\|History\]\]/)

  const historyIndex = await fsp.readFile(
    path.join(root, "settings", "Aylbyia", "History", "index.md"),
    "utf8",
  )
  assert.match(historyIndex, /\[\[settings\/Aylbyia\/History\/Founding myth\|Founding myth\]\]/)

  const repeated = await indexVault({ vaultRoot: root })
  assert.equal(repeated.indexesChanged, 0)
})

test("updates an existing owned folder index block idempotently", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "folder-indexes-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.mkdir(path.join(root, "settings", "Example", "NPCs"), { recursive: true })
  await fsp.writeFile(
    path.join(root, "settings", "Example", "index.md"),
    `---\ntitle: Example\n---\n# Example\n\n${FOLDER_INDEX_START}\nold\n<!-- vault-folder-index:end -->\n\nClosing text.\n`,
  )

  const applied = await indexVault({ vaultRoot: root, apply: true })
  assert.equal(applied.indexesUpdated.includes("settings/Example/index.md"), true)
  const index = await fsp.readFile(path.join(root, "settings", "Example", "index.md"), "utf8")
  assert.doesNotMatch(index, /\nold\n/)
  assert.match(index, /\[\[settings\/Example\/NPCs\/index\|NPCs\]\]/)
  assert.match(index, /Closing text/)
  const repeated = await indexVault({ vaultRoot: root })
  assert.equal(repeated.indexesChanged, 0)
})

test("uses an existing folder note as the index page to avoid Quartz folder-note collisions", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "folder-indexes-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.mkdir(path.join(root, "settings", "Example", "History"), { recursive: true })
  await fsp.writeFile(
    path.join(root, "settings", "Example", "History", "History.md"),
    "---\ntitle: History\ntype: history\n---\n# History\n",
  )
  await fsp.writeFile(
    path.join(root, "settings", "Example", "History", "First age.md"),
    "---\ntitle: First age\n---\nThe beginning.\n",
  )

  const applied = await indexVault({ vaultRoot: root, apply: true })
  assert.equal(applied.indexesCreated.includes("settings/Example/History/index.md"), false)
  assert.equal(applied.indexesUpdated.includes("settings/Example/History/History.md"), true)
  const history = await fsp.readFile(
    path.join(root, "settings", "Example", "History", "History.md"),
    "utf8",
  )
  assert.match(history, /\[\[settings\/Example\/History\/First age\|First age\]\]/)
  const settingIndex = await fsp.readFile(path.join(root, "settings", "Example", "index.md"), "utf8")
  assert.match(settingIndex, /\[\[settings\/Example\/History\/History\|History\]\]/)
  const repeated = await indexVault({ vaultRoot: root })
  assert.equal(repeated.indexesChanged, 0)
})

test("preserves the actual filename casing for folder notes", async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "folder-indexes-"))
  context.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.mkdir(path.join(root, "running-the-game", "DM-ing"), { recursive: true })
  await fsp.writeFile(
    path.join(root, "running-the-game", "DM-ing", "Dm-ing.md"),
    "---\ntitle: Dm-ing\n---\n# Dm-ing\n",
  )

  await indexVault({ vaultRoot: root, apply: true })
  const index = await fsp.readFile(path.join(root, "running-the-game", "index.md"), "utf8")
  assert.match(index, /\[\[running-the-game\/DM-ing\/Dm-ing\|DM-ing\]\]/)
  const dm = await fsp.readFile(path.join(root, "running-the-game", "DM-ing", "Dm-ing.md"), "utf8")
  assert.doesNotMatch(dm, /\[\[running-the-game\/DM-ing\/Dm-ing\|Dm-ing\]\]/)
  const repeated = await indexVault({ vaultRoot: root })
  assert.equal(repeated.indexesChanged, 0)
})
