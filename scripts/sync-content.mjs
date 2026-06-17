#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const repoRoot = process.cwd()
const defaultVault = "/Users/nicolastababajeux/Documents/personal/obsidian/master-vault"
const sourceRoot = path.resolve(process.env.OBSIDIAN_VAULT ?? defaultVault)
const destinationRoot = path.resolve(process.env.QUARTZ_CONTENT_DIR ?? "content")
const tempRoot = path.resolve(repoRoot, ".content-sync-tmp")

const publishRoots = ["index.md", "settings", "running-the-game", "assets", "references"]
const ignoredNames = new Set([".obsidian", "templates", "private", ".git", ".DS_Store"])

function fail(message) {
  console.error(`sync-content: ${message}`)
  process.exit(1)
}

function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function shouldCopy(src) {
  const name = path.basename(src)
  return !ignoredNames.has(name)
}

function copyRecursive(src, dest) {
  if (!shouldCopy(src)) return

  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry))
    }
    return
  }

  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(src, dest)
  }
}

function removePath(target) {
  fs.rmSync(target, { recursive: true, force: true })
}

if (!fs.existsSync(sourceRoot)) {
  fail(`source vault does not exist: ${sourceRoot}`)
}

if (!fs.statSync(sourceRoot).isDirectory()) {
  fail(`source vault is not a directory: ${sourceRoot}`)
}

if (!isInside(repoRoot, destinationRoot)) {
  fail(`destination must be inside this repository: ${destinationRoot}`)
}

if (fs.existsSync(tempRoot)) {
  removePath(tempRoot)
}

fs.mkdirSync(tempRoot, { recursive: true })

for (const publishRoot of publishRoots) {
  const src = path.join(sourceRoot, publishRoot)
  if (!fs.existsSync(src)) continue
  copyRecursive(src, path.join(tempRoot, publishRoot))
}

let destinationWasSymlink = false
if (fs.existsSync(destinationRoot)) {
  const stat = fs.lstatSync(destinationRoot)
  destinationWasSymlink = stat.isSymbolicLink()

  if (destinationWasSymlink) {
    fs.unlinkSync(destinationRoot)
  } else if (stat.isDirectory()) {
    removePath(destinationRoot)
  } else {
    fail(`destination exists but is not a directory or symlink: ${destinationRoot}`)
  }
}

fs.renameSync(tempRoot, destinationRoot)

const files = []
function collectFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(fullPath)
    else if (entry.isFile()) files.push(fullPath)
  }
}
collectFiles(destinationRoot)

console.log(
  [
    `Synced ${files.length} files from ${sourceRoot}`,
    `to ${path.relative(repoRoot, destinationRoot)}`,
    destinationWasSymlink ? "Replaced the previous content symlink with a real directory." : "",
  ]
    .filter(Boolean)
    .join("\n"),
)
