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

// LikeC4's grammar reserves a long list of bare words that can't be used as
// an element id - confirmed by testing each one against the actual `likec4`
// parser (there's no published exhaustive list). A container literally named
// one of these (e.g. a "Link" shortener service, a "Title"/"Notes" field, an
// "Import" job) would otherwise slugify to that exact keyword and break
// parsing of the *whole* exported file with a cascade of confusing "Expecting
// token of type '}'" errors, rather than the clean "duplicate name" error a
// same-name collision produces. Not guaranteed complete - if a new collision
// shows up, add the word here rather than treating it as a one-off.
const LIKEC4_RESERVED_WORDS = [
    "view", "views", "style", "tag", "extend", "include", "exclude",
    "global", "specification", "import", "notation", "link", "metadata",
    "description", "technology", "title", "icon", "shape", "color",
    "opacity", "border", "navigateTo", "autoLayout", "size", "padding",
    "instanceOf", "with", "where", "this", "it", "and", "true", "false",
    "likec4lib", "notes",
];

function buildIdMap(containers, boundaries) {
    const used = new Set(LIKEC4_RESERVED_WORDS);
    const idMap = new Map();
    (boundaries || []).forEach((b) => idMap.set(b.id, slugify(b.name, used)));
    containers.forEach((c) => idMap.set(c.id, slugify(c.name, used)));
    return idMap;
}

// Splits containers into per-boundary groups (in first-seen order) plus the
// leftover containers that aren't enclosed by any detected boundary box -
// shared by both exporters so a container's boundary grouping never
// disagrees between Mermaid and LikeC4 output.
function groupByBoundary(containers, boundaries) {
    const boundaryById = new Map((boundaries || []).map((b) => [b.id, b]));
    const order = [];
    const containersByBoundary = new Map();
    const ungrouped = [];
    containers.forEach((c) => {
        if (c.boundaryId && boundaryById.has(c.boundaryId)) {
            if (!containersByBoundary.has(c.boundaryId)) {
                containersByBoundary.set(c.boundaryId, []);
                order.push(c.boundaryId);
            }
            containersByBoundary.get(c.boundaryId).push(c);
        } else {
            ungrouped.push(c);
        }
    });
    const groups = order.map((id) => ({
        boundary: boundaryById.get(id),
        containers: containersByBoundary.get(id),
    }));
    return { groups, ungrouped };
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

// Software systems are more static than any single board - the same system
// shows up either as a plain childless container (a stand-in box on a board
// that only references it) or as a Boundary (a board that fully decomposes
// it into containers - see findContainerBoundary in code.ts). The Landscape
// tab and the "Software Systems" export both want just the identity of each
// system, flattened, regardless of which form it took on the current board -
// this is the single place that combines both shapes into one list so the
// tab and the export can never disagree on what counts as a system. No
// cross-entry dedup is done here (unlike mergeAcrossPages) since this only
// ever sees one page's worth of data at a time, same as every other
// per-page rendering in this UI.
function collectSoftwareSystems(containers, boundaries) {
    const fromContainers = containers
        .filter((c) => containerCategory(c) === "software-system")
        .map((c) => ({
            id: c.id,
            name: c.name,
            technology: c.technology,
            description: c.description,
            isFallback: c.labelSource === "node-name-fallback",
            decomposed: false,
        }));
    const fromBoundaries = (boundaries || [])
        .filter((b) => /system|sistema/.test(normalizeSearch(b.elementType || "")))
        .map((b) => ({
            id: b.id,
            name: b.name,
            technology: null,
            description: null,
            isFallback: false,
            decomposed: true,
        }));
    return [...fromBoundaries, ...fromContainers].sort((a, b) =>
        a.name.localeCompare(b.name),
    );
}

function dedupeKey(name) {
    return normalizeSearch(name).replace(/\s+/g, " ").trim();
}

// Collapses elements that represent the same logical system across multiple
// pages (see extractRelationsAllPages in code.ts) so a whole-file scan
// doesn't declare e.g. "Plataforma Acme" once per board that merely
// references it as a plain placeholder box, in addition to the one board
// that actually decomposes it into containers - the exact pattern that
// produced "Duplicate element name" errors when 5 separately-exported
// per-system files were combined into one LikeC4 workspace by hand.
//
// Two kinds of entity can carry the same name: a childless container (a
// stand-in box drawn on someone else's board) or a boundary (a system that's
// actually broken down into containers on its own board). A boundary always
// wins as canonical since it carries strictly more information; between two
// same-kind candidates, the one with more descriptive fields wins. Only
// exact name matches (after case/diacritic/whitespace folding) are merged -
// this is the only identity signal available across independently-drawn
// boards, so two distinct elements that happen to share a display name
// within the SAME page are never affected (mergeAcrossPages is only invoked
// for a whole-file scan, never for a single-page one).
//
// Returns an extra `issues` array (merged into the Errors tab's list by the
// caller) with one `conflicting-duplicate` entry per group where the
// dropped candidates' description/technology text doesn't match the
// canonical one's - the same real system re-typed slightly differently on
// each board it's referenced from.
function mergeAcrossPages(containers, relations, boundaries) {
    const childrenCount = new Map();
    containers.forEach((c) => {
        if (c.boundaryId) {
            childrenCount.set(
                c.boundaryId,
                (childrenCount.get(c.boundaryId) || 0) + 1,
            );
        }
    });

    const entities = [
        ...(boundaries || []).map((b) => ({
            key: dedupeKey(b.name),
            kind: "boundary",
            id: b.id,
            score: 100 + (childrenCount.get(b.id) || 0),
            ref: b,
        })),
        ...containers.map((c) => ({
            key: dedupeKey(c.name),
            kind: "container",
            id: c.id,
            score: (c.technology ? 2 : 0) + (c.description ? 1 : 0),
            ref: c,
        })),
    ];

    const groups = new Map();
    entities.forEach((e) => {
        if (!groups.has(e.key)) groups.set(e.key, []);
        groups.get(e.key).push(e);
    });

    const idRemap = new Map();
    const droppedContainerIds = new Set();
    const droppedBoundaryIds = new Set();
    const mergeIssues = [];
    groups.forEach((group) => {
        let canonical = group[0];
        group.forEach((e) => {
            if (e.score > canonical.score) canonical = e;
        });
        group.forEach((e) => {
            idRemap.set(e.id, canonical.id);
            if (e.id === canonical.id) return;
            if (e.kind === "container") droppedContainerIds.add(e.id);
            else droppedBoundaryIds.add(e.id);
        });

        // Re-typing the same element's card on every board it's referenced
        // from (instead of copying it) drifts: two boards end up disagreeing
        // on what "Vendor A" or "Colaboradores de Acme" actually is. Merging
        // silently keeps only the canonical wording - flag it so the
        // disagreement doesn't disappear unnoticed along with the losing
        // copies.
        if (group.length > 1) {
            const texts = (field) =>
                new Set(
                    group
                        .filter((e) => e.kind === "container")
                        .map((e) => (e.ref[field] || "").trim())
                        .filter(Boolean),
                );
            const conflicting = [...texts("description"), ...texts("technology")];
            if (conflicting.length > 1) {
                mergeIssues.push({
                    id: "merge-conflict-" + canonical.id,
                    connectorId: canonical.id,
                    connectorLabel: canonical.ref.name.slice(0, 60),
                    kind: "conflicting-duplicate",
                    message:
                        '"' +
                        canonical.ref.name +
                        '" is described differently across pages - kept one, check the others: ' +
                        conflicting.map((t) => '"' + t + '"').join(" vs. ") +
                        ".",
                });
            }
        }
    });

    function remap(id) {
        return idRemap.has(id) ? idRemap.get(id) : id;
    }

    const mergedContainers = containers
        .filter((c) => !droppedContainerIds.has(c.id))
        .map((c) =>
            c.boundaryId
                ? { ...c, boundaryId: remap(c.boundaryId) }
                : c,
        );

    const mergedBoundaries = (boundaries || []).filter(
        (b) => !droppedBoundaryIds.has(b.id),
    );

    // Remapping ids can turn what used to be two distinct cross-system
    // relations into either a self-loop (both ends collapsed onto the same
    // canonical element - dropped, LikeC4 forbids it) or an exact duplicate
    // of another relation (kept once).
    const seenRelations = new Set();
    const mergedRelations = [];
    relations.forEach((r) => {
        const source = remap(r.source);
        const target = remap(r.target);
        if (source === target) return;
        const relKey = [
            source,
            target,
            r.label || "",
            r.technology || "",
            r.bidirectional ? "1" : "0",
        ].join(" ");
        if (seenRelations.has(relKey)) return;
        seenRelations.add(relKey);
        mergedRelations.push({ ...r, source, target });
    });

    return {
        containers: mergedContainers,
        relations: mergedRelations,
        boundaries: mergedBoundaries,
        issues: mergeIssues,
    };
}
