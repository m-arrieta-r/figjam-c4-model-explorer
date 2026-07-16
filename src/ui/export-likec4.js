const LIKEC4_KNOWN_KINDS = {
    person: "person",
    "software system": "softwareSystem",
    "external system": "externalSystem",
    container: "container",
    component: "component",
    database: "database",
};

// Turns an arbitrary element-type string (e.g. "Message Queue") into a
// valid LikeC4 kind identifier ("messageQueue").
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

function likeC4KindFor(container) {
    const raw = (container.elementType || "").trim().toLowerCase();
    if (!raw) return "component";
    return LIKEC4_KNOWN_KINDS[raw] || toCamelIdentifier(raw, "component");
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
    relations.forEach((r) => {
        const s = idMap.get(r.source);
        const t = idMap.get(r.target);
        if (!s || !t) return;
        if (r.technology) {
            const relLabel = r.label ? ' "' + esc(r.label) + '"' : "";
            lines.push("  " + s + " -> " + t + relLabel + " {");
            lines.push('    technology "' + esc(r.technology) + '"');
            lines.push("  }");
        } else {
            const relLabel = r.label ? ' "' + esc(r.label) + '"' : "";
            lines.push("  " + s + " -> " + t + relLabel);
        }
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
