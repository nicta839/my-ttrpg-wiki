# My TTRPG Wiki

This repository publishes a collection of tabletop role-playing game notes as a searchable website. It is built on [Quartz](https://quartz.jzhao.xyz/), a static-site generator for Markdown and Obsidian-style notes.

The project has two content layers:

- **External source of truth:** the Obsidian vault at `/Users/nicolastababajeux/Documents/personal/obsidian/master-vault`.
- **Website and build code:** this repository. The Quartz configuration, custom components, styles, map plugin, helper scripts, and generated `content/` directory live here.

The website currently contains worldbuilding and campaign material such as Aylbyia, Middleworld, Soleria, Spine of the World, Tales of Fate, and running-the-game rules and notes.

## Requirements

- Node.js 22 or newer
- npm 10.9.2 or newer
- Access to the external Obsidian vault when synchronizing content

Install dependencies after cloning the repository:

```sh
npm install
```

## How the project works

The normal publishing flow is:

```text
Obsidian vault -> sync:content -> content/ -> Quartz -> public/
```

`content/` is the input directory that Quartz publishes. The sync script copies only the public parts of the external vault:

- `index.md`
- `settings/`
- `running-the-game/`
- `assets/`
- `references/`

It intentionally excludes Obsidian configuration and private material, including `.obsidian/`, `templates/`, `private/`, `.git/`, and `.DS_Store`. The destination is replaced atomically through a temporary directory, so a sync removes files that are no longer present in the selected source areas.

The main project elements are:

- `content/` — generated website content; do not treat it as the primary authoring location.
- `quartz.config.yaml` — site title, URL, theme, Markdown features, navigation, search, graph, maps, and other Quartz plugins.
- `quartz/` — Quartz build system plus project-specific components, emitters, loaders, and styles.
- `plugins/` — local Quartz plugins, including the TTRPG map integration.
- `scripts/sync-content.mjs` — copies the publishable areas from the Obsidian vault into `content/`.
- `scripts/` — optional vault import, indexing, enrichment, organization, map-validation, and related utilities.
- `public/` — generated static output; it is ignored by Git.

## Synchronizing from Obsidian

From the repository root, run:

```sh
npm run sync:content
```

The default source is:

```text
/Users/nicolastababajeux/Documents/personal/obsidian/master-vault
```

To use another vault, set `OBSIDIAN_VAULT` for that command:

```sh
OBSIDIAN_VAULT="/path/to/your/vault" npm run sync:content
```

To use another content directory inside this repository, set `QUARTZ_CONTENT_DIR`:

```sh
QUARTZ_CONTENT_DIR="content" npm run sync:content
```

The sync command must be run again whenever the source vault changes. It is automatically included by the two normal wiki commands below.

## Running the wiki locally

Build the site once:

```sh
npm run build:wiki
```

This synchronizes the external vault and creates the static site in `public/`.

Start a local development server with rebuild/watch behavior:

```sh
npm run serve:wiki
```

Quartz will print the local URL in the terminal, normally `http://localhost:8080`. Stop it with `Ctrl-C`.

If the content has already been synchronized and you only want to build or serve the current checkout, use the underlying Quartz commands:

```sh
npx quartz build
npx quartz build --serve
```

## Validation and tests

Useful checks before publishing are:

```sh
npm test
npm run check
npm run validate:maps
```

`npm test` runs the repository’s JavaScript and TypeScript tests. `npm run check` runs TypeScript checking and Prettier verification. `npm run validate:maps` checks map blocks, marker sidecars, links, and asset limits in `content/`.

The build also installs configured Quartz plugins automatically through the `prebuild` hook. If a plugin needs to be installed or refreshed explicitly, run:

```sh
npm run install-plugins
```

## Optional vault utilities

These commands operate on the configured external vault and should be reviewed before using them:

```sh
npm run import:onenote
npm run enrich:vault
npm run index:vault
npm run organize:vault
```

They are not required for the normal website build. In particular, `organize:vault` and `enrich:vault` can modify vault files when run with their apply options; back up or commit the vault first.

## Publishing the project to GitHub

The repository is already configured with these remotes:

```text
origin  git@github.com:nicta839/my-ttrpg-wiki.git
upstream https://github.com/jackyzha0/quartz.git
```

Before committing, review the generated content and make sure private notes have not been copied into the publishable paths. A typical update from the source vault is:

```sh
git status
npm run sync:content
npm test
npm run check
npm run validate:maps
npm run build:wiki
git diff --check
git diff --stat
```

Then stage, commit, and push the intended changes:

```sh
git add README.md content quartz.config.yaml quartz plugins scripts
git status
git commit -m "docs: update project workflow"
git push origin main
```

If only selected files should be published, replace the broad `git add` command with explicit paths, for example:

```sh
git add README.md quartz.config.yaml quartz/styles/custom.scss
```

For a new GitHub repository with no remote yet, create the empty repository on GitHub first, then configure and push it:

```sh
git remote add origin git@github.com:<github-user>/<repository>.git
git branch -M main
git add .
git commit -m "Initial commit"
git push -u origin main
```

Do not commit `node_modules/`, `public/`, `.quartz-cache/`, `.content-sync-tmp/`, or private vault content. These are ignored or intentionally kept outside the repository.
