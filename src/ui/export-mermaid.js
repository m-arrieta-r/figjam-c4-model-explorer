function toMermaidC4(containers, relations) {
    const idMap = buildIdMap(containers);

    const lines = ["C4Container", ""];
    containers.forEach((c) => {
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
        lines.push("Container(" + id + ", " + args.join(", ") + ")");
    });
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
