function toMermaidC4(boxes, relations) {
    const idMap = buildIdMap(boxes);

    const lines = ["C4Container", ""];
    boxes.forEach((b) => {
        const id = idMap.get(b.id);
        const args = ['"' + esc(b.name) + '"'];
        if (b.description) {
            args.push(
                '"' + esc(b.technology) + '"',
                '"' + esc(b.description) + '"',
            );
        } else if (b.technology) {
            args.push('"' + esc(b.technology) + '"');
        }
        lines.push("Container(" + id + ", " + args.join(", ") + ")");
    });
    lines.push("");
    relations.forEach((r) => {
        const s = idMap.get(r.source);
        const t = idMap.get(r.target);
        if (!s || !t) return;
        const label = esc(r.label);
        const tech = r.technology ? esc(r.technology) : "";
        if (tech) {
            lines.push(
                "Rel(" + s + ", " + t + ', "' + label + '", "' + tech + '")',
            );
        } else {
            lines.push("Rel(" + s + ", " + t + ', "' + label + '")');
        }
    });
    return lines.join("\n");
}
