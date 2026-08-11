const CATEGORY_TO_LIKEC4_KIND = {
    person: "person",
    agent: "agent",
    "software-system": "softwareSystem",
    "external-system": "externalSystem",
    ui: "ui",
    backend: "backend",
    database: "database",
    container: "container",
    component: "component",
};

// Default LikeC4 style per element kind, so the generated specification
// renders each C4 kind distinctly instead of relying on LikeC4's own
// defaults. Kinds not listed here (component, and any ad-hoc kind derived
// from an unrecognized elementType via toCamelIdentifier) are declared with
// no style block and fall back to LikeC4's defaults.
const LIKEC4_KIND_STYLE = {
    person: { shape: "person", color: "green" },
    agent: { shape: "person", color: "green" },
    softwareSystem: { shape: "rectangle", color: "amber" },
    externalSystem: { shape: "rectangle", color: "red" },
    ui: { shape: "browser", color: "sky" },
    backend: { shape: "rectangle", color: "blue" },
    database: { shape: "cylinder", color: "indigo" },
    container: { shape: "rectangle", color: "muted" },
};

// Turns an arbitrary element-type string (e.g. "Message Queue") into a
// valid LikeC4 kind identifier ("messageQueue"). Only reached for
// containers whose category doesn't map to a known C4 kind.
function toCamelIdentifier(raw, fallback) {
    const words = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) return fallback;
    return (
        words[0] +
        words
            .slice(1)
            .map((w) => w[0].toUpperCase() + w.slice(1))
            .join("")
    );
}

// Reuses the same categorization the Containers tab's type filter uses (see
// containerCategory in export-shared.js) so icon-detected databases and
// color-detected external systems export as `database`/`externalSystem`
// instead of collapsing into the generic `container` kind carried by their
// raw elementType text (this shape kit labels every non-Person/System
// container "[Container: ...]" regardless of what it actually is).
function likeC4KindFor(container) {
    const category = containerCategory(container);
    const known = CATEGORY_TO_LIKEC4_KIND[category];
    if (known) return known;
    const raw = (container.elementType || "").trim();
    return raw ? toCamelIdentifier(raw, "component") : "component";
}

// Boundaries reuse the softwareSystem/container kinds already declared for
// containers - a boundary is really just a coarser-grained element in the
// same C4 hierarchy, not a distinct concept LikeC4 needs a new kind for.
function likeC4KindForBoundary(boundary) {
    const type = normalizeSearch(boundary.elementType || "");
    return /system|sistema/.test(type) ? "softwareSystem" : "container";
}

// includeSpecification defaults to true; pass false to omit the
// specification {} block, e.g. when pasting model+views into a LikeC4
// workspace that already declares its own element kinds elsewhere.
function toLikeC4Dsl(containers, relations, boundaries, includeSpecification) {
    if (includeSpecification === undefined) includeSpecification = true;
    const idMap = buildIdMap(containers, boundaries);
    const containerById = new Map(containers.map((c) => [c.id, c]));
    const boundaryById = new Map((boundaries || []).map((b) => [b.id, b]));
    const kindFor = new Map(containers.map((c) => [c.id, likeC4KindFor(c)]));
    const boundaryKindFor = new Map(
        (boundaries || []).map((b) => [b.id, likeC4KindForBoundary(b)]),
    );

    const lines = [];
    if (includeSpecification) {
        const kindsUsed = Array.from(
            new Set([...kindFor.values(), ...boundaryKindFor.values()]),
        ).sort();
        lines.push("specification {");
        kindsUsed.forEach((k) => {
            const style = LIKEC4_KIND_STYLE[k];
            if (!style) {
                lines.push("  element " + k);
                return;
            }
            lines.push("  element " + k + " {");
            lines.push("    style {");
            lines.push("      shape " + style.shape);
            lines.push("      color " + style.color);
            lines.push("    }");
            lines.push("  }");
        });
        lines.push("}", "");
    }
    lines.push("model {");

    function containerLines(c, indent) {
        const id = idMap.get(c.id);
        const kind = kindFor.get(c.id);
        const hasBody = Boolean(c.technology || c.description);
        if (!hasBody) {
            return [indent + kind + " " + id + ' "' + esc(c.name) + '"'];
        }
        return [
            indent + kind + " " + id + ' "' + esc(c.name) + '" {',
            ...(c.technology
                ? [indent + '  technology "' + esc(c.technology) + '"']
                : []),
            ...(c.description
                ? [indent + '  description "' + esc(c.description) + '"']
                : []),
            indent + "}",
        ];
    }

    // Containers enclosed by a detected boundary box (see findContainerBoundary
    // in code.ts) nest inside that boundary's element block, giving them a
    // qualified id (boundary.child) - matching how the board actually groups
    // them, instead of a flat list that loses the grouping.
    const { groups, ungrouped } = groupByBoundary(containers, boundaries);
    groups.forEach(({ boundary, containers: grouped }) => {
        const bId = idMap.get(boundary.id);
        const bKind = boundaryKindFor.get(boundary.id);
        lines.push("  " + bKind + " " + bId + ' "' + esc(boundary.name) + '" {');
        grouped.forEach((c) => lines.push(...containerLines(c, "    ")));
        lines.push("  }");
    });
    ungrouped.forEach((c) => lines.push(...containerLines(c, "  ")));

    lines.push("");

    function qualifiedId(containerId) {
        const c = containerById.get(containerId);
        if (!c) return null;
        const id = idMap.get(c.id);
        if (c.boundaryId && boundaryById.has(c.boundaryId)) {
            return idMap.get(c.boundaryId) + "." + id;
        }
        return id;
    }

    // LikeC4 relationships are always directional, so a bidirectional
    // connector is represented as a pair of opposing relationships.
    relations.forEach((r) => {
        const s = qualifiedId(r.source);
        const t = qualifiedId(r.target);
        if (!s || !t) return;
        const relLabel = r.label ? ' "' + esc(r.label) + '"' : "";
        const pairs = r.bidirectional ? [[s, t], [t, s]] : [[s, t]];
        pairs.forEach(([from, to]) => {
            if (r.technology) {
                lines.push("  " + from + " -> " + to + relLabel + " {");
                lines.push('    technology "' + esc(r.technology) + '"');
                lines.push("  }");
            } else {
                lines.push("  " + from + " -> " + to + relLabel);
            }
        });
    });

    lines.push(
        "}",
        "",
        "views {",
        "  view index {",
        '    title "Landscape"',
        "    include *",
        "  }",
    );

    // Beyond the index/landscape view above, emit one System Context (N1) view
    // per software system and, for systems decomposed into containers on the
    // board (a boundary box, see groupByBoundary), a Container (N2) view too.
    // A plain "include *" inside a scoped view pulls in the element's nested
    // children (LikeC4's scoped-wildcard semantics) - exactly what a Container
    // view needs, but too much for a System Context view, which should show
    // the system as a single box plus only its direct neighbors.
    const viewIdsUsed = new Set(["index"]);

    function pushContextView(id, name) {
        const viewId = slugify(name + " context", viewIdsUsed);
        lines.push(
            "",
            "  view " + viewId + " of " + id + " {",
            '    title "' + esc(name) + ' - System Context"',
            "    include " + id,
            "    include " + id + " ->",
            "    include -> " + id,
            "  }",
        );
    }

    function pushContainerView(id, name) {
        const viewId = slugify(name + " containers", viewIdsUsed);
        lines.push(
            "",
            "  view " + viewId + " of " + id + " {",
            '    title "' + esc(name) + ' - Containers"',
            "    include *",
            "  }",
        );
    }

    groups.forEach(({ boundary }) => {
        if (boundaryKindFor.get(boundary.id) !== "softwareSystem") return;
        const bId = idMap.get(boundary.id);
        pushContextView(bId, boundary.name);
        pushContainerView(bId, boundary.name);
    });

    containers.forEach((c) => {
        if (containerCategory(c) !== "software-system") return;
        if (c.boundaryId && boundaryById.has(c.boundaryId)) return;
        pushContextView(idMap.get(c.id), c.name);
    });

    lines.push("}");

    return lines.join("\n");
}

// Flat catalog of just the software systems seen on the current board -
// no containers, no relations, no boundaries, no views. Meant to be pasted
// into (or merged with) a separate "systems catalog" file shared across every
// per-system index.c4, instead of leaving each board's stub declarations of
// systems it merely references (e.g. "CRM", "Plataforma Acme") scattered
// across whichever file happened to draw a connector to them.
function toSoftwareSystemsDsl(containers, boundaries, includeSpecification) {
    if (includeSpecification === undefined) includeSpecification = true;
    const systems = collectSoftwareSystems(containers, boundaries);
    const used = new Set(LIKEC4_RESERVED_WORDS);
    const idFor = new Map(systems.map((s) => [s.id, slugify(s.name, used)]));

    const lines = [];
    if (includeSpecification) {
        const style = LIKEC4_KIND_STYLE.softwareSystem;
        lines.push(
            "specification {",
            "  element softwareSystem {",
            "    style {",
            "      shape " + style.shape,
            "      color " + style.color,
            "    }",
            "  }",
            "}",
            "",
        );
    }
    lines.push("model {");
    systems.forEach((s) => {
        const id = idFor.get(s.id);
        const hasBody = Boolean(s.technology || s.description);
        if (!hasBody) {
            lines.push('  softwareSystem ' + id + ' "' + esc(s.name) + '"');
            return;
        }
        lines.push('  softwareSystem ' + id + ' "' + esc(s.name) + '" {');
        if (s.technology) lines.push('    technology "' + esc(s.technology) + '"');
        if (s.description) lines.push('    description "' + esc(s.description) + '"');
        lines.push("  }");
    });
    lines.push("}");

    return lines.join("\n");
}
