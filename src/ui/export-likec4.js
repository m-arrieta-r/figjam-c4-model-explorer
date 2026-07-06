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

function likeC4KindFor(box) {
    const raw = (box.elementType || "").trim().toLowerCase();
    if (!raw) return "component";
    return LIKEC4_KNOWN_KINDS[raw] || toCamelIdentifier(raw, "component");
}

function toLikeC4Dsl(boxes, relations) {
    const idMap = buildIdMap(boxes);
    const kindFor = new Map(boxes.map((b) => [b.id, likeC4KindFor(b)]));
    const kindsUsed = Array.from(new Set(kindFor.values())).sort();

    const lines = ["specification {"];
    kindsUsed.forEach((k) => lines.push("  element " + k));
    lines.push("}", "", "model {");

    boxes.forEach((b) => {
        const id = idMap.get(b.id);
        const kind = kindFor.get(b.id);
        const hasBody = Boolean(b.technology || b.description);
        if (!hasBody) {
            lines.push("  " + kind + " " + id + ' "' + esc(b.name) + '"');
            return;
        }
        lines.push("  " + kind + " " + id + ' "' + esc(b.name) + '" {');
        if (b.technology)
            lines.push('    technology "' + esc(b.technology) + '"');
        if (b.description)
            lines.push('    description "' + esc(b.description) + '"');
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
