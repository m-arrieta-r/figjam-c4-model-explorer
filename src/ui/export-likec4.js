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

function toLikeC4Dsl(containers, relations, boundaries) {
    const idMap = buildIdMap(containers, boundaries);
    const containerById = new Map(containers.map((c) => [c.id, c]));
    const boundaryById = new Map((boundaries || []).map((b) => [b.id, b]));
    const kindFor = new Map(containers.map((c) => [c.id, likeC4KindFor(c)]));
    const boundaryKindFor = new Map(
        (boundaries || []).map((b) => [b.id, likeC4KindForBoundary(b)]),
    );
    const kindsUsed = Array.from(
        new Set([...kindFor.values(), ...boundaryKindFor.values()]),
    ).sort();

    const lines = ["specification {"];
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
    lines.push("}", "", "model {");

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
        "    include *",
        "  }",
        "}",
    );

    return lines.join("\n");
}
