// @ts-nocheck

(function () {
  const STATE = {
    dataPromise: null,
  };

  function basePath() {
    return document.body?.dataset?.basepath || "";
  }

  function dataUrl() {
    return `${basePath()}/static/wiki-explore.json`;
  }

  function currentSlug() {
    const slug = document.body?.dataset?.slug || "";
    return slug === "" ? "index" : slug.replace(/^\/+|\/+$/g, "");
  }

  async function loadData() {
    if (!STATE.dataPromise) {
      STATE.dataPromise = fetch(dataUrl(), { cache: "no-cache" }).then((response) => {
        if (!response.ok) throw new Error(`wiki explore data failed: ${response.status}`);
        return response.json();
      });
    }
    return STATE.dataPromise;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgEl(tag, className) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (className) node.setAttribute("class", className);
    return node;
  }

  function anchor(href, className, text) {
    const node = el("a", className, text);
    node.href = href || "#";
    return node;
  }

  function button(className, text) {
    const node = el("button", className, text);
    node.type = "button";
    return node;
  }

  function input(className, placeholder) {
    const node = el("input", className);
    node.type = "search";
    node.placeholder = placeholder;
    node.autocomplete = "off";
    return node;
  }

  function pageBySlug(data, slug) {
    return data.pages?.[slug] || data.pages?.[slug.replace(/\/index$/, "")];
  }

  const SETTING_THEME_KEYS = {
    Aylbyia: "aylbyia",
    Godshand: "godshand",
    "In the Ashes": "in-the-ashes",
    Middleworld: "middleworld",
    Soleria: "soleria",
    "Spine of the World": "spine-of-the-world",
    "Tales of Fate": "tales-of-fate",
  };

  const SECTION_KIND_KEYS = [
    "maps",
    "geography",
    "people",
    "powers",
    "history",
    "lore",
    "campaign",
    "rules",
    "references",
    "setting",
    "general",
  ];

  function settingThemeFromSlug(slug) {
    const match = String(slug || "").match(/^settings\/([^/]+)/);
    if (!match) return "";
    return SECTION_KIND_KEYS.includes(match[1]) ? "" : match[1];
  }

  function settingThemeForPage(page, slug) {
    if (page?.setting && SETTING_THEME_KEYS[page.setting]) return SETTING_THEME_KEYS[page.setting];
    const fromSlug = settingThemeFromSlug(slug);
    return Object.values(SETTING_THEME_KEYS).includes(fromSlug) ? fromSlug : "";
  }

  function normalizeSectionKind(value) {
    const text = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
    if (!text) return "";
    if (/\b(map|maps|atlas)\b/.test(text)) return "maps";
    if (/\b(history|timeline|chronology)\b/.test(text)) return "history";
    if (/\b(geography|region|regions|settlement|settlements|place|places|location|locations|map feature|map features)\b/.test(text)) return "geography";
    if (/\b(npc|npcs|people|person|players?)\b/.test(text)) return "people";
    if (/\b(faction|factions|organization|organizations|power|powers)\b/.test(text)) return "powers";
    if (/\b(campaign|quest|quests|rumor|rumors|session|sessions)\b/.test(text)) return "campaign";
    if (/\b(running the game|homebrew|rules?|dm ing|dm|character creation)\b/.test(text)) return "rules";
    if (/\b(reference|references)\b/.test(text)) return "references";
    if (/\b(cosmology|society|mystery|mysteries|lore|religion|magic|items?)\b/.test(text)) return "lore";
    if (/\b(setting|settings)\b/.test(text)) return "setting";
    return "";
  }

  function sectionKindForPage(page, slug) {
    const explicitKind = normalizeSectionKind(page?.sectionKind ?? page?.section_kind ?? page?.["section-kind"] ?? page?.section);
    if (explicitKind) return explicitKind;

    const pageType = normalizeSectionKind(page?.type);
    if (pageType && page?.type !== "index") return pageType;

    const routeKind = normalizeSectionKind(String(slug || "").replace(/\//g, " "));
    if (routeKind) return routeKind;

    if (page?.group === "Maps") return "maps";
    if (page?.group === "People") return "people";
    if (page?.group === "Powers") return "powers";
    if (page?.group === "Places") return "geography";
    if (page?.group === "Campaign") return "campaign";
    if (page?.group === "Rules") return "rules";
    if (page?.group === "References") return "references";
    if (page?.group === "Lore") return "lore";
    return "general";
  }

  function applyPageContext(data) {
    if (!document.body) return;
    const slug = currentSlug();
    const page = data ? pageBySlug(data, slug) : undefined;
    const settingTheme = settingThemeForPage(page, slug);
    if (settingTheme) {
      document.body.dataset.settingTheme = settingTheme;
    } else {
      delete document.body.dataset.settingTheme;
    }
    document.body.dataset.sectionKind = sectionKindForPage(page, slug);
  }

  function pageByHref(data, href) {
    const clean = (href || "").split("#")[0].split("?")[0].replace(/^\/+|\/+$/g, "");
    return Object.values(data.pages || {}).find((page) => {
      const pageHref = (page.href || "").replace(/^\/+|\/+$/g, "");
      return pageHref === clean || page.slug === clean;
    });
  }

  function markerKey(marker) {
    return `${marker.mapId}::${marker.id}`;
  }

  function allMarkers(data, setting) {
    return (data.maps || [])
      .filter((map) => !setting || map.setting === setting)
      .flatMap((map) =>
        (map.markers || []).map((marker) => ({
          ...marker,
          mapId: map.id,
          mapTitle: map.title,
          mapHref: map.href,
          setting: map.setting,
          layerName:
            (map.layers || []).find((layer) => layer.id === marker.layer)?.name || marker.layer,
        })),
      );
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function matchQuery(value, query) {
    return normalizeText(value).includes(normalizeText(query));
  }

  function renderFailure(root, message) {
    clear(root);
    root.classList.add("wiki-explore", "wiki-explore-empty");
    root.textContent = message || "Explorer data could not be loaded.";
  }

  function renderMarkerCard(marker, options) {
    const card = el("article", "wiki-explore-card atlas-marker-card");
    const meta = el("p", "wiki-explore-kicker", `${marker.setting} · ${marker.layerName}`);
    const title = el("strong", "", marker.name || marker.tooltip || marker.id);
    const desc = el("p", "wiki-explore-description", marker.tooltip || marker.mapTitle);
    const actions = el("div", "wiki-explore-actions");
    const mapHref = `${marker.mapHref}${marker.mapHref.includes("?") ? "&" : "?"}marker=${encodeURIComponent(marker.id)}`;
    actions.appendChild(anchor(mapHref, "explore-chip", "Map"));
    if (marker.href) actions.appendChild(anchor(marker.href, "explore-chip", "Article"));
    if (options?.canFocus) {
      const focus = button("explore-chip", "Focus");
      focus.addEventListener("click", () => focusMarker(marker.id));
      actions.appendChild(focus);
    }
    card.append(meta, title, desc, actions);
    return card;
  }

  function focusMarker(id) {
    const root = document.querySelector(".ttrpg-map-root");
    if (!root) return;
    root.dispatchEvent(
      new CustomEvent("ttrpg-map:focus-marker", {
        bubbles: true,
        detail: { id },
      }),
    );
  }

  function renderAtlas(root, data) {
    const setting = root.dataset.setting || "";
    const compact = root.dataset.compact === "true";
    const mapForPage = (data.maps || []).find((map) => map.slug === currentSlug());
    const markers = allMarkers(data, setting);
    if (!markers.length) {
      root.hidden = true;
      return;
    }

    root.hidden = false;
    root.classList.add("wiki-explore", "atlas-explorer");
    clear(root);

    const header = el("div", "wiki-explore-header");
    header.appendChild(el("p", "wiki-explore-kicker", setting ? `${setting} Atlas` : "World Atlas"));
    header.appendChild(
      el(
        "p",
        "wiki-explore-description",
        compact
          ? "Jump into a mapped place."
          : "Search mapped locations, filter by layer, and jump straight to the map or article.",
      ),
    );
    root.appendChild(header);

    if (compact) {
      const pick = markers[Math.floor(Math.random() * markers.length)];
      const wrap = el("div", "wiki-explore-card-grid");
      wrap.appendChild(renderMarkerCard(pick, { canFocus: Boolean(mapForPage) }));
      root.appendChild(wrap);
      return;
    }

    const controls = el("div", "wiki-explore-controls");
    const search = input("wiki-explore-search", "Search mapped places");
    controls.appendChild(search);
    const chips = el("div", "wiki-explore-chip-row");
    const layerNames = [...new Set(markers.map((marker) => marker.layerName).filter(Boolean))];
    let activeLayer = "";
    const allChip = button("explore-chip is-active", "All");
    chips.appendChild(allChip);
    const layerButtons = [];
    for (const name of layerNames) {
      const chip = button("explore-chip", name);
      layerButtons.push(chip);
      chips.appendChild(chip);
      chip.addEventListener("click", () => {
        activeLayer = activeLayer === name ? "" : name;
        update();
      });
    }
    allChip.addEventListener("click", () => {
      activeLayer = "";
      update();
    });
    controls.appendChild(chips);
    root.appendChild(controls);

    const results = el("div", "wiki-explore-card-grid");
    root.appendChild(results);

    function update() {
      allChip.classList.toggle("is-active", activeLayer === "");
      for (const chip of layerButtons) chip.classList.toggle("is-active", chip.textContent === activeLayer);
      clear(results);
      const query = search.value;
      const filtered = markers
        .filter((marker) => !activeLayer || marker.layerName === activeLayer)
        .filter((marker) =>
          matchQuery(
            `${marker.name} ${marker.tooltip} ${marker.setting} ${marker.layerName}`,
            query,
          ),
        )
        .slice(0, compact ? 1 : 24);
      if (!filtered.length) {
        results.appendChild(el("div", "wiki-explore-empty", "No mapped place matches that filter."));
        return;
      }
      for (const marker of filtered) {
        results.appendChild(renderMarkerCard(marker, { canFocus: Boolean(mapForPage) }));
      }
    }

    search.addEventListener("input", update);
    update();
  }

  function recentKey(scope) {
    return `wiki-explore-recent:${scope || "global"}`;
  }

  function pickRandom(items, scope) {
    if (!items.length) return undefined;
    const key = recentKey(scope);
    let recent = [];
    try {
      recent = JSON.parse(localStorage.getItem(key) || "[]");
    } catch {
      recent = [];
    }
    const recentSet = new Set(recent);
    const pool = items.filter((item) => !recentSet.has(item.key));
    const selected = (pool.length ? pool : items)[Math.floor(Math.random() * (pool.length || items.length))];
    const next = [selected.key, ...recent.filter((key) => key !== selected.key)].slice(0, Math.min(12, Math.max(3, items.length - 1)));
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
    return selected;
  }

  function randomItems(data, category, setting) {
    if (category === "mapMarkers") {
      return allMarkers(data, setting).map((marker) => ({
        key: `marker:${markerKey(marker)}`,
        title: marker.name || marker.tooltip || marker.id,
        description: marker.tooltip || marker.mapTitle,
        href: `${marker.mapHref}?marker=${encodeURIComponent(marker.id)}`,
        secondaryHref: marker.href,
        secondaryLabel: marker.href ? "Article" : "",
        meta: `${marker.setting} · ${marker.layerName}`,
      }));
    }
    if (category === "timelineEvents") {
      return Object.values(data.timelines || {})
        .filter((timeline) => !setting || timeline.setting === setting)
        .flatMap((timeline) =>
          (timeline.events || []).map((event) => ({
            key: `event:${event.id}`,
            title: event.title || event.label,
            description: event.summary,
            href: timeline.href,
            meta: `${timeline.setting} · ${event.label || "Timeline"}`,
          })),
        );
    }
    const ids = setting
      ? data.randomPools?.bySetting?.[setting]?.[category] || []
      : data.randomPools?.[category] || [];
    return ids
      .map((id) => {
        const page = pageBySlug(data, id);
        return page
          ? {
              key: `page:${page.slug}`,
              title: page.title,
              description: page.description,
              href: page.href,
              meta: [page.setting, page.group || page.category].filter(Boolean).join(" · "),
            }
          : undefined;
      })
      .filter(Boolean);
  }

  function renderRandom(root, data) {
    const setting = root.dataset.setting || "";
    const scoped = root.dataset.scope === "setting" || setting;
    root.classList.add("wiki-explore", "random-discovery");
    clear(root);

    const header = el("div", "wiki-explore-header");
    header.appendChild(el("p", "wiki-explore-kicker", scoped ? `${setting} Discovery` : "Random Discovery"));
    header.appendChild(el("p", "wiki-explore-description", "Roll a useful entry point without leaving the wiki flow."));
    root.appendChild(header);

    const categories = [
      ["settings", "Setting"],
      ["locations", "Location"],
      ["npcs", "NPC"],
      ["powers", "Power"],
      ["mapMarkers", "Map"],
      ["timelineEvents", "Timeline"],
    ].filter(([category]) => !(scoped && category === "settings"));

    const row = el("div", "wiki-explore-chip-row");
    const result = el("div", "wiki-explore-result");
    root.append(row, result);

    for (const [category, label] of categories) {
      const items = randomItems(data, category, scoped ? setting : "");
      if (!items.length) continue;
      const roll = button("explore-chip", label);
      roll.addEventListener("click", () => {
        const selected = pickRandom(items, `${setting || "global"}:${category}`);
        renderRandomResult(result, selected);
      });
      row.appendChild(roll);
    }

    if (!row.children.length) {
      root.hidden = true;
    } else {
      root.hidden = false;
    }
  }

  function renderRandomResult(root, item) {
    clear(root);
    if (!item) return;
    const card = el("article", "wiki-explore-card");
    if (item.meta) card.appendChild(el("p", "wiki-explore-kicker", item.meta));
    card.appendChild(anchor(item.href, "wiki-explore-title-link", item.title));
    if (item.description) card.appendChild(el("p", "wiki-explore-description", item.description));
    if (item.secondaryHref) {
      const actions = el("div", "wiki-explore-actions");
      actions.appendChild(anchor(item.secondaryHref, "explore-chip", item.secondaryLabel || "Open"));
      card.appendChild(actions);
    }
    root.appendChild(card);
  }

  function timelineByCurrentPage(data) {
    const slug = currentSlug();
    const timelines = data.timelines || {};
    if (timelines[slug]) return timelines[slug];
    if (timelines[`${slug}/index`]) return timelines[`${slug}/index`];
    const cleanPath = window.location.pathname.replace(/^\/+|\/+$/g, "");
    return Object.values(timelines).find((timeline) => {
      const href = (timeline.href || "").replace(/^\/+|\/+$/g, "");
      return href === cleanPath || `${href}.html` === cleanPath;
    });
  }

  function renderTimelineFriseHost(root, data) {
    const core = window.WikiTimelineFrise;
    const timeline = timelineByCurrentPage(data);
    if (!core || !timeline || !timeline.events?.length) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    core.render(root, timeline, {
      resolveLink(link) {
        const page = pageBySlug(data, String(link || ""));
        return {
          href: page?.href || "#",
          title: page?.title || String(link || "").split("/").pop()?.replace(/-/g, " ") || "Link",
        };
      },
    });
  }

  function renderTimelineFriseBlocks(data) {
    document
      .querySelectorAll(
        "pre > code.language-wiki-timeline, pre > code[class*='language-wiki-timeline'], pre[data-language='wiki-timeline'] > code, code[data-language='wiki-timeline']",
      )
      .forEach((code) => {
        const target = code.closest("figure[data-rehype-pretty-code-figure]") || code.closest("pre") || code.parentElement;
        if (!target) return;
        const host = el("div", "wiki-timeline-frise-host");
        host.dataset.timelineOptions = code.textContent || "";
        target.replaceWith(host);
      });
    document.querySelectorAll(".wiki-timeline-frise-host").forEach((root) => renderTimelineFriseHost(root, data));
  }

  function renderTimeline(root, data) {
    const setting = root.dataset.setting || "";
    const compact = root.dataset.compact === "true";
    const timelines = Object.values(data.timelines || {}).filter(
      (timeline) => !setting || timeline.setting === setting,
    );
    const events = timelines.flatMap((timeline) =>
      (timeline.events || []).map((event) => ({ ...event, timeline })),
    );
    if (!events.length) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.classList.add("wiki-explore", "timeline-explorer");
    clear(root);

    const header = el("div", "wiki-explore-header");
    header.appendChild(el("p", "wiki-explore-kicker", setting ? `${setting} Timeline` : "Timeline"));
    header.appendChild(
      el(
        "p",
        "wiki-explore-description",
        compact ? "A few chronological anchors." : "Search and scan timeline events across this part of the vault.",
      ),
    );
    root.appendChild(header);

    const results = el("div", "timeline-explorer-list");
    if (!compact) {
      const search = input("wiki-explore-search", "Search timeline");
      root.appendChild(search);
      search.addEventListener("input", () => update(search.value));
    }
    root.appendChild(results);

    function update(query) {
      clear(results);
      const filtered = events
        .filter((event) =>
          matchQuery(`${event.title} ${event.summary} ${event.label} ${event.timeline.setting}`, query || ""),
        )
        .slice(0, compact ? 4 : 80);
      for (const event of filtered) {
        const card = el("article", "timeline-event-card");
        card.appendChild(el("span", "timeline-event-date", event.label || event.sortLabel || "Event"));
        card.appendChild(anchor(event.timeline.href, "timeline-event-title", event.title || event.summary));
        if (event.summary && event.summary !== event.title) {
          card.appendChild(el("p", "wiki-explore-description", event.summary));
        }
        results.appendChild(card);
      }
    }

    update("");
  }

  function renderRelation(root, data) {
    const slug = root.dataset.slug || currentSlug();
    const relationships = data.relationships?.[slug] || [];
    if (!relationships.length) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.classList.add("wiki-explore", "relation-explorer");
    clear(root);

    const current = pageBySlug(data, slug);
    const header = el("div", "wiki-explore-header");
    header.appendChild(el("p", "wiki-explore-kicker", "Connections"));
    header.appendChild(
      el(
        "p",
        "wiki-explore-description",
        current ? `Curated links around ${current.title}.` : "Curated links around this page.",
      ),
    );
    root.appendChild(header);

    const constellation = el("div", "relation-constellation");
    const lines = svgEl("svg", "relation-lines");
    lines.setAttribute("viewBox", "0 0 100 100");
    lines.setAttribute("aria-hidden", "true");
    constellation.appendChild(lines);
    const center = el("div", "relation-node relation-node-center", current?.title || "Current");
    constellation.appendChild(center);
    const visibleRels = relationships.slice(0, 8);
    visibleRels.forEach((rel, index) => {
      const node = anchor(rel.href, "relation-node", rel.title);
      const angle = (-90 + (360 / visibleRels.length) * index) * (Math.PI / 180);
      const x = 50 + Math.cos(angle) * 36;
      const y = 50 + Math.sin(angle) * 34;
      node.style.setProperty("--relation-x", `${x}%`);
      node.style.setProperty("--relation-y", `${y}%`);
      node.dataset.group = rel.group || "Links";
      const line = svgEl("line", "");
      line.setAttribute("x1", "50");
      line.setAttribute("y1", "50");
      line.setAttribute("x2", String(x));
      line.setAttribute("y2", String(y));
      lines.appendChild(line);
      constellation.appendChild(node);
    });
    root.appendChild(constellation);

    const groups = el("div", "index-link-groups relation-groups");
    const grouped = new Map();
    relationships.forEach((rel) => {
      const group = rel.group || "Links";
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(rel);
    });
    for (const [group, items] of grouped) {
      const wrap = el("div", "index-link-group");
      wrap.appendChild(el("h3", "", group));
      const list = el("ul");
      items.slice(0, 8).forEach((item) => {
        const li = el("li");
        li.appendChild(anchor(item.href, "", item.title));
        list.appendChild(li);
      });
      wrap.appendChild(list);
      groups.appendChild(wrap);
    }
    root.appendChild(groups);
  }

  function mountImplicitRelationPanel(data) {
    if (document.querySelector(".relation-explorer")) return;
    const slug = currentSlug();
    const page = pageBySlug(data, slug);
    const rels = data.relationships?.[slug] || [];
    if (!page || page.type === "index" || slug === "index" || rels.length < 4) return;
    const article = document.querySelector("article.popover-hint, article");
    if (!article) return;
    const details = el("details", "wiki-explore relation-explorer relation-explorer-compact");
    const summary = el("summary", "", "Connections");
    const inner = el("div", "relation-explorer");
    details.append(summary, inner);
    article.appendChild(details);
    renderRelation(inner, data);
  }

  async function renderAll() {
    applyPageContext();

    let data;
    try {
      data = await loadData();
    } catch (error) {
      document
        .querySelectorAll(".atlas-explorer,.random-discovery,.timeline-explorer,.relation-explorer,.wiki-timeline-frise-host")
        .forEach((root) => renderFailure(root, "Explorer data could not be loaded."));
      return;
    }

    applyPageContext(data);
    renderTimelineFriseBlocks(data);
    document.querySelectorAll(".atlas-explorer").forEach((root) => renderAtlas(root, data));
    document.querySelectorAll(".random-discovery").forEach((root) => renderRandom(root, data));
    document.querySelectorAll(".timeline-explorer").forEach((root) => renderTimeline(root, data));
    document.querySelectorAll(".relation-explorer").forEach((root) => {
      if (!root.closest(".relation-explorer-compact")) renderRelation(root, data);
    });
    mountImplicitRelationPanel(data);
  }

  if (typeof document !== "undefined") {
    document.addEventListener("nav", renderAll);
    document.addEventListener("render", renderAll);
    renderAll();
  }
})();
