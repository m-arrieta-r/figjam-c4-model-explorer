const CATEGORY_TO_LIKEC4_KIND = {
    person: "person",
    "software-system": "softwareSystem",
    "external-system": "externalSystem",
    ui: "ui",
    backend: "backend",
    database: "database",
    container: "container",
    component: "component",
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

function toLikeC4Dsl(containers, relations) {
    const idMap = buildIdMap(containers);
    const kindFor = new Map(containers.map((c) => [c.id, likeC4KindFor(c)]));
    const kindsUsed = Array.from(new Set(kindFor.values())).sort();

    const lines = ["specification {"];
    kindsUsed.forEach((k) => lines.push("  element " + k));
    lines.push("}", "", "model {");

    containers.forEach((c) => {
        const id = idMap.get(c.id);
        const kind = kindFor.get(c.id);
        const hasBody = Boolean(c.technology || c.description);
        if (!hasBody) {
            lines.push("  " + kind + " " + id + ' "' + esc(c.name) + '"');
            return;
        }
        lines.push("  " + kind + " " + id + ' "' + esc(c.name) + '" {');
        if (c.technology)
            lines.push('    technology "' + esc(c.technology) + '"');
        if (c.description)
            lines.push('    description "' + esc(c.description) + '"');
        lines.push("  }");
    });

    lines.push("");
    // LikeC4 relationships are always directional, so a bidirectional
    // connector is represented as a pair of opposing relationships.
    relations.forEach((r) => {
        const s = idMap.get(r.source);
        const t = idMap.get(r.target);
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
