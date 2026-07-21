const { Plugin } = require("obsidian")
const TimelineFrise = require("./shared/wikiTimelineFrise.js")

module.exports = class WikiTimelineFrisePlugin extends Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor("wiki-timeline", async (source, el, ctx) => {
      const options = TimelineFrise.parseOptions(source)
      const container = el.createDiv({ cls: "wiki-timeline-frise-host" })
      const sourcePath = ctx?.sourcePath
      if (!sourcePath) {
        container.setText("Timeline source could not be resolved.")
        return
      }

      const file = this.app.vault.getAbstractFileByPath(sourcePath)
      if (!file) {
        container.setText("Timeline source could not be loaded.")
        return
      }

      const markdown = await this.app.vault.read(file)
      const events = TimelineFrise.parseTimelineEvents(markdown)
      TimelineFrise.render(
        container,
        {
          title: file.basename,
          setting: inferSetting(sourcePath),
          events,
        },
        {
          resolveLink: (link) => ({
            href: "#",
            title: labelForLink(link),
          }),
          onLinkClick: (link) => {
            this.app.workspace.openLinkText(String(link), sourcePath)
          },
        },
      )
    })
  }
}

function inferSetting(sourcePath) {
  const parts = String(sourcePath || "").split("/")
  return parts[0] === "settings" && parts[1] ? parts[1] : undefined
}

function labelForLink(link) {
  return String(link || "")
    .split("/")
    .pop()
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
