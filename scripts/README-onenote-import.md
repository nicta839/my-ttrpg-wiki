# OneNote importer

The importer converts OneDrive-downloaded OneNote notebooks into a private Obsidian review bundle before anything can reach Quartz.

## Commands

```bash
# Read-only inventory (default)
npm run import:onenote

# Build private/onenote-import-review in the vault
npm run import:onenote -- --stage

# Replace only importer-owned staging data
npm run import:onenote -- --force-stage

# Approve everything, keeping existing notes canonical and archiving variants
npm run import:onenote -- --approve-all

# Promote entries explicitly approved in review.yaml
npm run import:onenote -- --promote

# Repair exact media-block preservation and enforce private GM routing
npm run import:onenote -- --finalize

# Back up and enrich frontmatter plus related-note navigation
npm run import:onenote -- --enrich-vault
```

Use `--source`, `--vault`, or `--one2html` to override the configured local paths. The first run downloads `one2html` v1.3.1 for Apple silicon into `.quartz-cache` and verifies its SHA-256 checksum. Set `ONE2HTML_BIN` on another platform.

## Review contract

- All page and media approvals default to `false`.
- `conflict` entries cannot be promoted until their `action` and `destination` are resolved.
- Existing files are hashed during staging; promotion aborts if they changed.
- Existing files touched during promotion are backed up under `private/onenote-import-backup`.
- `GM-thoughts` and `private` remain outside the Quartz content sync.
- Re-running promotion replaces importer-owned media blocks instead of appending duplicates.
- Generated media paths use ASCII-only, URL-safe names with content hashes.

The generated `report.md`, `review.yaml`, and `media-manifest.csv` are the review interface. Public image variants are WebP files capped below Cloudflare Pages' 25 MiB per-asset limit.
