// Markdown bullet-list export: each nested FigJam section becomes a
// bullet, its sub-sections and containers are indented one level deeper (2
// spaces, valid nested-list syntax in any Markdown renderer), and a
// container's outgoing relations go one level below it. All user text is
// escaped so names containing Markdown syntax don't break the structure.
// A colored shape is tagged with its color's purpose (`colorPurposes`, from
// buildColorPurposes); colors without a known purpose add nothing.
function toBulletOutline(containers, relations, sections, colorPurposes) {
    const nameById = new Map(containers.map((c) => [c.id, c.name]));
    const byId = new Map(containers.map((c) => [c.id, c]));
    const outgoing = new Map();
    relations.forEach((r) => {
        if (!outgoing.has(r.source)) outgoing.set(r.source, []);
        outgoing.get(r.source).push(r);
    });

    // Tree of sections keyed by name; containers hang off the deepest one.
    const root = { children: new Map(), containers: [] };
    // Sections first (canvas order), so empty sections still get a bullet and
    // sibling sections keep their canvas order.
    (sections || []).forEach((path) => {
        let node = root;
        path.forEach((name) => {
            if (!node.children.has(name)) {
                node.children.set(name, { children: new Map(), containers: [] });
            }
            node = node.children.get(name);
        });
    });
    containers.forEach((c) => {
        let node = root;
        (c.sectionPath || []).forEach((name) => {
            if (!node.children.has(name)) {
                node.children.set(name, { children: new Map(), containers: [] });
            }
            node = node.children.get(name);
        });
        node.containers.push(c);
    });

    const oneLine = (text) =>
        String(text)
            .replace(/\s+/g, " ")
            .trim()
            .replace(/([\\`*_{}\[\]<>#|])/g, "\\$1");
    const indent = (depth) => "  ".repeat(depth);

    const out = [];
    const metaOf = (c) => {
        const color = c.elementType ? null : colorPurposeOf(c, colorPurposes);
        const kind = color ? color.purpose : c.elementType;
        return [kind, c.technology].filter(Boolean).map(oneLine);
    };
    function relationLines(c, depth) {
        const seen = new Set();
        (outgoing.get(c.id) || []).forEach((r) => {
            const target = nameById.get(r.target) || r.targetName;
            const detail = [r.label, r.technology].filter(Boolean).map(oneLine);
            const line =
                `${indent(depth)}- ${oneLine(target)}` +
                (detail.length ? ` (${detail.join(" · ")})` : "");
            if (seen.has(line)) return;
            seen.add(line);
            out.push(line);
        });
    }

    function containerLines(c, depth) {
        const meta = metaOf(c);
        let line = `${indent(depth)}- ${oneLine(c.name)}`;
        if (meta.length) line += ` (${meta.join(" · ")})`;
        if (c.description) line += `: ${oneLine(c.description)}`;
        out.push(line);
        relationLines(c, depth + 1);
    }

    function walk(node, depth, path) {
        // A container drawn next to a section with the same name is that
        // section's stand-in card (the "reference" box you wire connectors
        // to) - listing both would print the system twice. Fold the card
        // into the section: its type/description go on the section bullet
        // and its relations become the section's first children.
        const absorbed = new Map();
        node.children.forEach((_, name) => {
            const key = dedupeKey(name);
            const twins = node.containers.filter((c) => dedupeKey(c.name) === key);
            if (twins.length) absorbed.set(name, twins);
        });
        const absorbedIds = new Set();
        absorbed.forEach((twins) => twins.forEach((c) => absorbedIds.add(c.id)));

        node.containers
            .filter((c) => !absorbedIds.has(c.id))
            .forEach((c) => containerLines(c, depth));

        node.children.forEach((child, name) => {
            const twins = absorbed.get(name) || [];
            const first = twins.find((c) => metaOf(c).length || c.description);
            const meta = first ? metaOf(first) : [];
            let line = `${indent(depth)}- ${oneLine(name)}`;
            if (meta.length) line += ` (${meta.join(" · ")})`;
            if (first && first.description) line += `: ${oneLine(first.description)}`;
            out.push(line);
            // Relations to elements inside the section are kept too: the
            // connector carries its own label/technology, which the nesting
            // alone doesn't show.
            twins.forEach((c) => relationLines(c, depth + 1));
            walk(child, depth + 1, [...path, name]);
        });
    }
    walk(root, 0, []);
    return out.join("\n") + "\n";
}
