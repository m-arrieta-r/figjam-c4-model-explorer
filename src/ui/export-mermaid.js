// Picks the Mermaid C4 boundary macro from the boundary label's own bracket
// annotation (e.g. "Wink [Software System]"), mirroring how containers'
// elementType text already drives categorization elsewhere - falls back to
// Container_Boundary, the most generic of the three, when the label carries
// no recognizable type.
function mermaidBoundaryMacro(boundary) {
    const type = normalizeSearch(boundary.elementType || "");
    if (/enterprise/.test(type)) return "Enterprise_Boundary";
    if (/system|sistema/.test(type)) return "System_Boundary";
    return "Container_Boundary";
}

function toMermaidC4(containers, relations, boundaries) {
    const idMap = buildIdMap(containers, boundaries);
    const { groups, ungrouped } = groupByBoundary(containers, boundaries);

    function containerLine(c) {
        const id = idMap.get(c.id);
        const args = ['"' + esc(c.name) + '"'];
        if (c.description) {
            args.push(
                '"' + esc(c.technology) + '"',
                '"' + esc(c.description) + '"',
            );
        } else if (c.technology) {
            args.push('"' + esc(c.technology) + '"');
        }
        return "Container(" + id + ", " + args.join(", ") + ")";
    }

    const lines = ["C4Container", ""];
    groups.forEach(({ boundary, containers: grouped }) => {
        const macro = mermaidBoundaryMacro(boundary);
        lines.push(
            macro + "(" + idMap.get(boundary.id) + ', "' + esc(boundary.name) + '") {',
        );
        grouped.forEach((c) => lines.push("  " + containerLine(c)));
        lines.push("}");
    });
    ungrouped.forEach((c) => lines.push(containerLine(c)));
    lines.push("");
    relations.forEach((r) => {
        const s = idMap.get(r.source);
        const t = idMap.get(r.target);
        if (!s || !t) return;
        const macro = r.bidirectional ? "BiRel" : "Rel";
        const label = esc(r.label);
        const tech = r.technology ? esc(r.technology) : "";
        if (tech) {
            lines.push(
                macro + "(" + s + ", " + t + ', "' + label + '", "' + tech + '")',
            );
        } else {
            lines.push(macro + "(" + s + ", " + t + ', "' + label + '")');
        }
    });
    return lines.join("\n");
}
