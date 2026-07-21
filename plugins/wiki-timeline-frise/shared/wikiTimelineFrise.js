;(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory()
  } else {
    root.WikiTimelineFrise = factory()
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const OWNED_BLOCKS = [
    ["<!-- vault-enrichment:start -->", "<!-- vault-enrichment:end -->"],
    ["<!-- curated-index:start -->", "<!-- curated-index:end -->"],
    ["<!-- vault-folder-index:start -->", "<!-- vault-folder-index:end -->"],
    ["<!-- wiki-explore:start -->", "<!-- wiki-explore:end -->"],
  ]

  function cleanMarkdown(value) {
    return String(value || "")
      .replace(/!\[\[[^\]]+\]\]/g, " ")
      .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g, function (_match, target, alias) {
        return alias || String(target).split("/").pop()
      })
      .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  function removeBlock(markdown, start, end) {
    const escapedStart = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const escapedEnd = end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return markdown.replace(new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, "g"), "")
  }

  function stripFrontmatter(markdown) {
    return String(markdown || "").replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
  }

  function bodyForTimeline(markdown) {
    let body = stripFrontmatter(markdown)
    for (const pair of OWNED_BLOCKS) body = removeBlock(body, pair[0], pair[1])
    body = body.replace(/```wiki-timeline[\s\S]*?```/g, "")
    return body
  }

  function slugFromTarget(target) {
    return String(target || "")
      .trim()
      .replace(/\.md$/i, "")
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .map((part) =>
        part
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      )
      .filter(Boolean)
      .join("/")
  }

  function extractWikiLinks(value) {
    const links = []
    const seen = new Set()
    for (const match of String(value || "").matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/g)) {
      const slug = slugFromTarget(match[1])
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      links.push(slug)
    }
    return links
  }

  function eventLabelSort(label) {
    const text = String(label || "")
    const match = text.match(/-?\d+/)
    if (!match) return undefined
    const value = Number(match[0])
    if (!Number.isFinite(value)) return undefined
    return /years?\s+ago/i.test(text) ? -Math.abs(value) : value
  }

  function isDateBullet(text) {
    return /^year\s+-?\d+/i.test(text) || /^-?\d{1,5}(?:\s*(?:b\.?c\.?|a\.?c\.?|years?\s+ago))?$/i.test(text)
  }

  function isProseDateLine(text) {
    return text.length <= 120 && /^(some short time|it is almost|before |after |during |at the start|campaign start)/i.test(text)
  }

  function inlineDateEvent(text) {
    const match = String(text || "").match(/^(year\s+-?\d+|\d{1,5}\s+years?\s+ago|-?\d{1,5})\s+(.+)$/i)
    if (!match) return undefined
    const label = cleanMarkdown(match[1])
    const summary = cleanMarkdown(match[2])
    if (!label || !summary) return undefined
    return { label, summary }
  }

  function indentationWidth(raw) {
    return (String(raw || "").match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length
  }

  function parseStructuredValue(value) {
    const trimmed = String(value || "").trim()
    if (!trimmed) return undefined
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
    return trimmed
  }

  function parseStructuredTimelineEvents(markdown) {
    const match = String(markdown || "").match(/<!-- timeline-events:start -->([\s\S]*?)<!-- timeline-events:end -->/)
    if (!match) return []
    const lines = match[1].split(/\r?\n/)
    const events = []
    let current = null
    function commit() {
      if (!current) return
      const label = current.label || current.date || current.year || "Event"
      const summary = current.summary || current.text || current.title || label
      const index = events.length + 1
      events.push({
        id: `structured-${index}`,
        label: String(label),
        title: cleanMarkdown(current.title || summary),
        summary: cleanMarkdown(summary),
        sort: typeof current.sort === "number" ? current.sort : eventLabelSort(label),
        order: index,
        links: Array.isArray(current.links) ? current.links.map(slugFromTarget) : [],
      })
      current = null
    }
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      const item = line.match(/^-\s+([a-zA-Z][\w-]*):\s*(.*)$/)
      if (item) {
        commit()
        current = {}
        current[item[1]] = parseStructuredValue(item[2])
        continue
      }
      const prop = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/)
      if (prop && current) {
        const value = prop[2].replace(/^["']|["']$/g, "")
        if (prop[1] === "links") current.links = []
        else current[prop[1]] = parseStructuredValue(value)
      } else if (/^-\s+/.test(line) && current && Array.isArray(current.links)) {
        current.links.push(line.replace(/^-\s+/, ""))
      }
    }
    commit()
    return events.filter((event) => event.summary)
  }

  function parseTimelineEvents(markdown) {
    const structured = parseStructuredTimelineEvents(markdown)
    if (structured.length) return structured

    const events = []
    const lines = bodyForTimeline(markdown).split(/\r?\n/)
    let currentLabel = ""
    let currentLabelFromBullet = false
    let order = 0

    for (const raw of lines) {
      const trimmed = raw.trim()
      if (!trimmed || /^#{1,6}\s+/.test(trimmed)) continue

      const bullet = trimmed.match(/^[-*]\s+(.+)$/)
      if (bullet) {
        const text = bullet[1].trim()
        const indent = indentationWidth(raw)
        const inline = inlineDateEvent(text)
        if (inline) {
          order += 1
          events.push({
            id: `event-${order}`,
            label: inline.label,
            title: inline.summary,
            summary: inline.summary,
            sort: eventLabelSort(inline.label),
            order,
            links: extractWikiLinks(text),
          })
          continue
        }
        if (isDateBullet(text)) {
          currentLabel = text
          currentLabelFromBullet = true
          continue
        }
        if (currentLabel && (currentLabelFromBullet || indent === 0)) {
          const summary = cleanMarkdown(text.replace(/:\s*$/, ""))
          if (summary) {
            order += 1
            events.push({
              id: `event-${order}`,
              label: currentLabel,
              title: summary,
              summary,
              sort: eventLabelSort(currentLabel),
              order,
              links: extractWikiLinks(text),
            })
          }
        }
        continue
      }

      const inline = inlineDateEvent(trimmed)
      if (inline) {
        order += 1
        events.push({
          id: `event-${order}`,
          label: inline.label,
          title: inline.summary,
          summary: inline.summary,
          sort: eventLabelSort(inline.label),
          order,
          links: extractWikiLinks(trimmed),
        })
        continue
      }

      if (isProseDateLine(trimmed)) {
        currentLabel = cleanMarkdown(trimmed)
        currentLabelFromBullet = false
      }
    }

    return sortEvents(events)
  }

  function sortEvents(events) {
    return [...(events || [])].sort((left, right) => {
      if (left.sort !== undefined && right.sort !== undefined && left.sort !== right.sort) {
        return left.sort - right.sort
      }
      return (left.order || 0) - (right.order || 0)
    })
  }

  function groupEvents(events) {
    const sorted = sortEvents(events)
    const groups = []
    const byKey = new Map()
    for (const event of sorted) {
      const label = event.label || event.sortLabel || "Event"
      const key = `${label}::${event.sort ?? "prose"}`
      let group = byKey.get(key)
      if (!group) {
        group = {
          id: `group-${groups.length + 1}`,
          label,
          sort: typeof event.sort === "number" ? event.sort : undefined,
          order: groups.length,
          events: [],
        }
        byKey.set(key, group)
        groups.push(group)
      }
      group.events.push(event)
    }

    const numeric = groups.filter((group) => typeof group.sort === "number")
    const min = numeric.length ? Math.min(...numeric.map((group) => group.sort)) : undefined
    const max = numeric.length ? Math.max(...numeric.map((group) => group.sort)) : undefined
    const range = min !== undefined && max !== undefined && max !== min ? max - min : 0
    const step = groups.length > 1 ? 100 / (groups.length - 1) : 0

    return groups.map((group, index) => {
      const rawPosition =
        typeof group.sort === "number" && min !== undefined && range > 0
          ? ((group.sort - min) / range) * 100
          : groups.length === 1
            ? 50
            : index * step
      return {
        ...group,
        position: groups.length === 1 ? 50 : 4 + rawPosition * 0.92,
      }
    })
  }

  function layoutGroups(groups, options) {
    const minGap = Math.max(80, Number(options?.minGap) || 124)
    const leftPad = Math.max(36, Number(options?.leftPad) || 58)
    const rightPad = Math.max(36, Number(options?.rightPad) || 58)
    const baseWidth = Math.max(920, groups.length * minGap)
    const positions = []
    let previous = leftPad - minGap

    for (const group of groups) {
      const baseX = Math.max(leftPad, Math.min(((group.position || 0) / 100) * baseWidth, baseWidth - rightPad))
      const x = Math.max(baseX, previous + minGap)
      positions.push(x)
      previous = x
    }

    const lastPosition = positions.length ? positions[positions.length - 1] : 0
    const railWidth = Math.ceil(Math.max(baseWidth, lastPosition + rightPad))
    return {
      railWidth,
      groups: groups.map((group, index) => ({
        ...group,
        x: positions[index] || leftPad,
      })),
    }
  }

  function parseOptions(value) {
    const options = {}
    for (const raw of String(value || "").split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith("#")) continue
      const match = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/)
      if (match) options[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
    return options
  }

  function createEl(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function render(root, timeline, options) {
    const events = sortEvents(timeline?.events || [])
    root.innerHTML = ""
    root.classList.add("wiki-timeline-frise")
    root.dataset.timelineMode = "frise"
    if (!events.length) {
      root.hidden = true
      return
    }
    root.hidden = false

    const groups = groupEvents(events)
    const layout = layoutGroups(groups)
    const laidOutGroups = layout.groups
    let activeIndex = 0
    let openIndex = -1

    const header = createEl("div", "timeline-frise-header")
    const kicker = createEl("p", "wiki-explore-kicker", timeline?.setting ? `${timeline.setting} Timeline` : "Timeline")
    const desc = createEl(
      "p",
      "wiki-explore-description",
      "Drag through the chronology, then hover or focus a pin to inspect what happened.",
    )
    header.append(kicker, desc)

    const controls = createEl("div", "timeline-controls")
    const prev = createEl("button", "explore-chip timeline-control", "Earlier")
    const next = createEl("button", "explore-chip timeline-control", "Later")
    prev.type = "button"
    next.type = "button"
    controls.append(prev, next)

    const viewport = createEl("div", "timeline-viewport")
    viewport.tabIndex = 0
    const rail = createEl("div", "timeline-rail")
    const line = createEl("div", "timeline-rail-line")
    const arrow = createEl("div", "timeline-rail-arrow")
    const pins = createEl("div", "timeline-pins")
    rail.append(line, arrow, pins)
    viewport.appendChild(rail)

    const popover = createEl("aside", "timeline-popover")
    popover.hidden = true
    const status = createEl("p", "timeline-status", `${groups.length} date markers · ${events.length} events`)

    root.append(header, controls, viewport, popover, status)

    const railWidth = layout.railWidth
    rail.style.width = `${railWidth}px`

    function resolveLink(link) {
      if (typeof options?.resolveLink === "function") return options.resolveLink(link)
      return { href: "#", title: String(link || "").split("/").pop() || "Link" }
    }

    function setOpen(index, persist) {
      openIndex = index
      const group = laidOutGroups[index]
      if (!group) {
        popover.hidden = true
        return
      }
      popover.hidden = false
      popover.innerHTML = ""
      popover.dataset.persist = persist ? "true" : "false"
      popover.appendChild(createEl("p", "timeline-popover-date", group.label))
      const list = createEl("div", "timeline-popover-events")
      for (const event of group.events) {
        const card = createEl("article", "timeline-popover-event")
        card.appendChild(createEl("strong", "", event.title || event.summary || group.label))
        if (event.summary && event.summary !== event.title) {
          card.appendChild(createEl("p", "wiki-explore-description", event.summary))
        }
        const links = Array.isArray(event.links) ? event.links : []
        if (links.length) {
          const chips = createEl("div", "wiki-explore-actions")
          for (const link of links.slice(0, 5)) {
            const resolved = resolveLink(link)
            const chip = createEl("a", "explore-chip", resolved.title)
            chip.href = resolved.href || "#"
            if (typeof options?.onLinkClick === "function") {
              chip.addEventListener("click", (event) => {
                event.preventDefault()
                options.onLinkClick(link, resolved)
              })
            }
            chips.appendChild(chip)
          }
          card.appendChild(chips)
        }
        list.appendChild(card)
      }
      popover.appendChild(list)
    }

    function scrollToIndex(index) {
      activeIndex = Math.max(0, Math.min(laidOutGroups.length - 1, index))
      const group = laidOutGroups[activeIndex]
      const x = group.x
      viewport.scrollTo({ left: Math.max(0, x - viewport.clientWidth / 2), behavior: prefersReducedMotion() ? "auto" : "smooth" })
      setOpen(activeIndex, true)
    }

    laidOutGroups.forEach((group, index) => {
      const pin = createEl("button", "timeline-pin")
      pin.type = "button"
      pin.style.left = `${group.x}px`
      pin.setAttribute("aria-label", `${group.label}: ${group.events.length} event${group.events.length === 1 ? "" : "s"}`)
      pin.innerHTML = `<span class="timeline-pin-dot"></span><span class="timeline-pin-label"></span>`
      pin.querySelector(".timeline-pin-label").textContent = group.label
      if (group.events.length > 1) {
        const count = createEl("span", "timeline-pin-count", String(group.events.length))
        pin.appendChild(count)
      }
      pin.addEventListener("mouseenter", () => setOpen(index, false))
      pin.addEventListener("focus", () => setOpen(index, false))
      pin.addEventListener("click", () => scrollToIndex(index))
      pins.appendChild(pin)
    })

    prev.addEventListener("click", () => scrollToIndex(activeIndex - 1))
    next.addEventListener("click", () => scrollToIndex(activeIndex + 1))
    viewport.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        scrollToIndex(activeIndex - 1)
      } else if (event.key === "ArrowRight") {
        event.preventDefault()
        scrollToIndex(activeIndex + 1)
      }
    })

    let dragging = false
    let dragStartX = 0
    let dragStartLeft = 0
    viewport.addEventListener("pointerdown", (event) => {
      dragging = true
      dragStartX = event.clientX
      dragStartLeft = viewport.scrollLeft
      viewport.setPointerCapture?.(event.pointerId)
      viewport.classList.add("is-dragging")
    })
    viewport.addEventListener("pointermove", (event) => {
      if (!dragging) return
      viewport.scrollLeft = dragStartLeft - (event.clientX - dragStartX)
    })
    const stopDrag = (event) => {
      if (!dragging) return
      dragging = false
      viewport.releasePointerCapture?.(event.pointerId)
      viewport.classList.remove("is-dragging")
    }
    viewport.addEventListener("pointerup", stopDrag)
    viewport.addEventListener("pointercancel", stopDrag)
    viewport.addEventListener("pointerleave", stopDrag)

    setOpen(0, false)
  }

  function prefersReducedMotion() {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  }

  return {
    cleanMarkdown,
    eventLabelSort,
    parseOptions,
    parseTimelineEvents,
    groupEvents,
    layoutGroups,
    render,
  }
})
