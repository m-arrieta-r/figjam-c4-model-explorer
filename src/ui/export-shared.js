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

var DIACRITIC_RE = new RegExp("[̀-ͯ]", "g");
function normalizeSearch(str) {
    return String(str || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(DIACRITIC_RE, "");
}

function hexHueSat(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    const num = parseInt(m[1], 16);
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const sat = max === 0 ? 0 : d / max;
    let hue = 0;
    if (d > 0) {
        if (max === r) hue = ((g - b) / d) % 6;
        else if (max === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
        hue = (hue * 60 + 360) % 360;
    }
    return { hue: hue, sat: sat };
}

// Red shapes mark external software systems on the canvas (internal ones are
// orange); hue splits them at ~20° so oranges don't classify as red.
function isRedFill(fillColor) {
    const hs = hexHueSat(fillColor);
    return !!hs && hs.sat > 0.25 && (hs.hue >= 335 || hs.hue <= 20);
}

// Indigo/purple shapes mark AI agents on the canvas (plain human actors are
// left at the shape kit's default fill), mirroring how isRedFill marks
// external systems.
function isIndigoFill(fillColor) {
    const hs = hexHueSat(fillColor);
    return !!hs && hs.sat > 0.25 && hs.hue >= 220 && hs.hue <= 280;
}

// Groups a container by C4 element kind, shared by the Containers tab's type
// filter and both exporters so they never disagree on what a container is.
// "ui"/"backend"/"database" come from the shape's detected icon
// (containerKind, extracted in code.ts) since this shape kit gives every
// non-Person/System container the same generic "Container" elementType text
// - that text alone can't tell a frontend, a service and a database apart.
function containerCategory(c) {
    const type = normalizeSearch(c.elementType || "");
    const isPersonShape = /person|persona|actor|user|usuario/.test(type);
    const isAgentText = /\bagente?\b/.test(type);
    if (isPersonShape || isAgentText) {
        return isAgentText || isIndigoFill(c.fillColor) ? "agent" : "person";
    }
    if (/system|sistema/.test(type)) {
        const external = /extern|\bext\b/.test(type) || isRedFill(c.fillColor);
        return external ? "external-system" : "software-system";
    }
    // Everything below (Container/Component/no element type) may carry an
    // icon-based kind detected from the shape's own children - see
    // extractContainerKind in code.ts. Prefer that over keyword guessing.
    if (c.containerKind === "ui") return "ui";
    if (c.containerKind === "backend") return "backend";
    if (c.containerKind === "database") return "database";
    if (/database|base de datos|\bdb\b/.test(type)) return "database";
    if (/component|componente/.test(type)) return "component";
    if (/container|contenedor/.test(type)) return "container";
    return "other";
}
