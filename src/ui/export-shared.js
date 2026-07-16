function esc(str) {
    return String(str || "").replace(/"/g, '\\"');
}

function slugify(name, used) {
    let base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!base) base = "node";
    if (/^[0-9]/.test(base)) base = "n_" + base;
    let id = base;
    let i = 1;
    while (used.has(id)) {
        id = base + "_" + i++;
    }
    used.add(id);
    return id;
}

function buildIdMap(containers) {
    const used = new Set();
    const idMap = new Map();
    containers.forEach((c) => idMap.set(c.id, slugify(c.name, used)));
    return idMap;
}
