let currentContainers = [];
let currentRelations = [];
let currentBoundaries = [];
let currentIssues = [];
let selectedRelationId = null;
let selectedContainerId = null;
let searchQuery = "";
let exportFormat = "mermaid";
let includeLikeC4Specification = false;
let typeFilter = "all";

const relationsEl = document.getElementById("relations");
const containersEl = document.getElementById("containers");
const issuesEl = document.getElementById("issues");
const containerCountEl = document.getElementById("container-count");
const relationCountEl = document.getElementById("relation-count");
const issueCountEl = document.getElementById("issue-count");
const relationDetailEl = document.getElementById("relation-detail");
const containerDetailEl = document.getElementById("container-detail");
const mermaidOutput = document.getElementById("mermaid-output");
const copyBtn = document.getElementById("copy");
const copyStatus = document.getElementById("copy-status");
const searchBarEl = document.getElementById("search-bar");
const typeFilterEl = document.getElementById("type-filter");
const searchInputEl = document.getElementById("search-input");
const searchClearEl = document.getElementById("search-clear");
const formatButtons = document.querySelectorAll(".format-btn");
const likeC4SpecToggleEl = document.getElementById("likec4-spec-toggle");
const likeC4SpecCheckboxEl = document.getElementById("likec4-spec-checkbox");
const debugModeToggle = document.getElementById("debug-mode-toggle");
const scanAllPagesToggle = document.getElementById("scan-all-pages-toggle");
const scanScopeNoteEl = document.getElementById("scan-scope-note");

const tabButtons = document.querySelectorAll(".tab-btn");
const tabViews = {
    relations: document.getElementById("relations-view"),
    containers: document.getElementById("containers-view"),
    errors: document.getElementById("errors-view"),
    export: document.getElementById("export-view"),
    settings: document.getElementById("settings-view"),
};

function renderExportOutput() {
    mermaidOutput.value =
        exportFormat === "likec4"
            ? toLikeC4Dsl(
                  currentContainers,
                  currentRelations,
                  currentBoundaries,
                  includeLikeC4Specification,
              )
            : toMermaidC4(currentContainers, currentRelations, currentBoundaries);
    copyStatus.textContent = "";
}

function showTab(name) {
    tabButtons.forEach((btn) =>
        btn.classList.toggle("active", btn.dataset.tab === name),
    );
    Object.entries(tabViews).forEach(([key, el]) =>
        el.classList.toggle("hidden", key !== name),
    );
    searchBarEl.classList.toggle(
        "hidden",
        name === "export" || name === "settings" || name === "errors",
    );
    if (name === "export") {
        renderExportOutput();
    }
}

tabButtons.forEach((btn) => {
    btn.onclick = () => showTab(btn.dataset.tab);
});

formatButtons.forEach((btn) => {
    btn.onclick = () => {
        exportFormat = btn.dataset.format;
        formatButtons.forEach((b) => b.classList.toggle("active", b === btn));
        likeC4SpecToggleEl.classList.toggle("hidden", exportFormat !== "likec4");
        renderExportOutput();
    };
});

likeC4SpecCheckboxEl.addEventListener("change", () => {
    includeLikeC4Specification = likeC4SpecCheckboxEl.checked;
    renderExportOutput();
});

function matchesSearch(fields) {
    const query = normalizeSearch(searchQuery).trim();
    if (!query) return true;
    const haystack = normalizeSearch(fields.filter(Boolean).join(" "));
    return query.split(/\s+/).every((term) => haystack.includes(term));
}

function containerMatchesSearch(c) {
    return matchesSearch([c.name, c.description, c.technology, c.elementType]);
}

function relationMatchesSearch(r) {
    const sourceContainer = findContainer(r.source);
    const targetContainer = findContainer(r.target);
    return matchesSearch([
        r.sourceName,
        r.targetName,
        r.label,
        r.technology,
        sourceContainer && sourceContainer.description,
        sourceContainer && sourceContainer.technology,
        sourceContainer && sourceContainer.elementType,
        targetContainer && targetContainer.description,
        targetContainer && targetContainer.technology,
        targetContainer && targetContainer.elementType,
    ]);
}

searchInputEl.addEventListener("input", () => {
    searchQuery = searchInputEl.value;
    searchClearEl.style.display = searchQuery ? "inline-flex" : "none";
    renderContainers();
    renderRelations();
});

searchClearEl.onclick = () => {
    searchInputEl.value = "";
    searchQuery = "";
    searchClearEl.style.display = "none";
    renderContainers();
    renderRelations();
    searchInputEl.focus();
};

document.getElementById("refresh").onclick = () => {
    parent.postMessage({ pluginMessage: { type: "extract" } }, "*");
};

debugModeToggle.addEventListener("change", () => {
    parent.postMessage(
        {
            pluginMessage: {
                type: "set-debug",
                enabled: debugModeToggle.checked,
            },
        },
        "*",
    );
});

// Re-extracting across every page in the file is slower than the current
// page alone, so this is opt-in - toggling it re-runs the extraction
// immediately (see the "set-scan-all-pages" handler in code.ts) rather than
// waiting for the next manual Refresh.
scanAllPagesToggle.addEventListener("change", () => {
    updateScanScopeNote();
    parent.postMessage(
        {
            pluginMessage: {
                type: "set-scan-all-pages",
                enabled: scanAllPagesToggle.checked,
            },
        },
        "*",
    );
});

function updateScanScopeNote() {
    scanScopeNoteEl.textContent = scanAllPagesToggle.checked
        ? "Scanning every page - same-name elements across pages are merged automatically."
        : "Scanning only the current page.";
}

copyBtn.onclick = async () => {
    try {
        await navigator.clipboard.writeText(mermaidOutput.value);
        copyStatus.textContent = "Copied to clipboard.";
    } catch (e) {
        mermaidOutput.select();
        document.execCommand("copy");
        copyStatus.textContent = "Copied to clipboard.";
    }
};

function findBoundary(id) {
    return currentBoundaries.find((b) => b.id === id) || null;
}

const BOUNDARY_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-dasharray="3 3">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"></rect>' +
    "</svg>";

// Badge showing which detected boundary box (see findContainerBoundary in
// code.ts) a container is enclosed by, if any. Clickable like the locate
// icons - see the ".boundary-badge" handling in the containersEl/
// containerDetailEl click listeners - since its data-id is the boundary
// shape's own node id, not the container's.
function boundaryBadgeHtml(container) {
    if (!container || !container.boundaryId) return "";
    const boundary = findBoundary(container.boundaryId);
    if (!boundary) return "";
    return (
        '<span class="boundary-badge" data-id="' +
        escapeHtml(boundary.id) +
        '" title="Boundary: ' +
        escapeHtml(boundary.name) +
        ' — click to locate on canvas">' +
        BOUNDARY_ICON_SVG +
        escapeHtml(boundary.name) +
        "</span>"
    );
}

function fallbackWarningHtml(isFallback) {
    return isFallback
        ? '<span class="fallback-warning" title="Name taken from the Figma layer name (no text was detected); you may want to review this shape.">&#9888;</span>'
        : "";
}

function emptyStateHtml(iconSvg, title, hint) {
    return (
        '<div class="empty">' +
        iconSvg +
        '<span class="empty-title">' +
        title +
        "</span>" +
        '<span class="empty-hint">' +
        hint +
        "</span>" +
        "</div>"
    );
}

const EMPTY_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="11" cy="11" r="7"></circle>' +
    '<path d="M21 21l-4.3-4.3"></path>' +
    "</svg>";

// Chip row that splits the Containers list by C4 element kind (Person,
// System, Ext. System, Container...). Only categories present in the current
// (search-filtered) result get a chip; hidden entirely when everything falls
// in a single category.
function renderTypeFilter(searchFiltered) {
    const counts = {};
    searchFiltered.forEach((c) => {
        const cat = containerCategory(c);
        counts[cat] = (counts[cat] || 0) + 1;
    });
    const present = CATEGORY_ORDER.filter((cat) => counts[cat]);
    if (typeFilter !== "all" && !counts[typeFilter]) typeFilter = "all";
    typeFilterEl.innerHTML = "";
    typeFilterEl.classList.toggle("hidden", present.length <= 1);
    if (present.length <= 1) return;

    const chips = [["all", "All", searchFiltered.length]].concat(
        present.map((cat) => [cat, CATEGORY_LABELS[cat], counts[cat]]),
    );
    chips.forEach(([key, label, count]) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "type-chip" + (typeFilter === key ? " active" : "");
        const color = CATEGORY_COLORS[key];
        chip.innerHTML =
            (color
                ? '<span class="chip-dot" style="background: ' +
                  color.fg +
                  ';"></span>'
                : "") +
            escapeHtml(label) +
            '<span class="chip-count">' +
            count +
            "</span>";
        chip.onclick = () => {
            typeFilter = key;
            renderContainers();
        };
        typeFilterEl.appendChild(chip);
    });
}

function renderContainers() {
    const searchFiltered = currentContainers.filter(containerMatchesSearch);
    renderTypeFilter(searchFiltered);
    const filtered =
        typeFilter === "all"
            ? searchFiltered
            : searchFiltered.filter(
                  (c) => containerCategory(c) === typeFilter,
              );
    containerCountEl.textContent =
        filtered.length === currentContainers.length
            ? currentContainers.length
            : filtered.length + "/" + currentContainers.length;
    containersEl.innerHTML = "";
    if (currentContainers.length === 0) {
        containersEl.innerHTML = emptyStateHtml(
            EMPTY_ICON_SVG,
            "No containers yet",
            "Run Refresh to extract shapes from the FigJam canvas.",
        );
        hideContainerDetail();
        return;
    }
    if (filtered.length === 0) {
        containersEl.innerHTML = emptyStateHtml(
            EMPTY_ICON_SVG,
            "No matches",
            "No containers match your search.",
        );
        hideContainerDetail();
        return;
    }
    filtered.forEach((c) => {
        const item = document.createElement("div");
        item.className =
            "card container-card" +
            (c.id === selectedContainerId ? " selected" : "");
        item.setAttribute("data-id", c.id);
        const isFallback = c.labelSource === "node-name-fallback";

        const header = document.createElement("div");
        header.className = "container-card-header";
        header.innerHTML =
            '<span class="name">' +
            escapeHtml(c.name) +
            "</span>" +
            fallbackWarningHtml(isFallback) +
            '<span class="header-badges">' +
            boundaryBadgeHtml(c) +
            typeBadgeHtml(c) +
            "</span>";
        item.appendChild(header);

        const locateBtn = document.createElement("button");
        locateBtn.className = "icon-btn locate-corner";
        locateBtn.setAttribute("data-id", c.id);
        locateBtn.title = "Go to element on canvas";
        locateBtn.innerHTML = LOCATE_ICON_SVG;
        item.appendChild(locateBtn);

        if (c.technology || c.description) {
            item.appendChild(renderContainerMeta(c.technology, c.description));
        }

        containersEl.appendChild(item);
    });

    if (
        selectedContainerId &&
        filtered.some((c) => c.id === selectedContainerId)
    ) {
        renderContainerDetail(selectedContainerId);
    } else {
        hideContainerDetail();
    }
}

// Category keys group containers by C4 element kind for the type tabs and
// badge colors. Badge/dot colors mirror the canvas convention: internal
// software systems are orange, external ones red. "ui"/"backend"/"database"
// come from the container's detected icon (see containerCategory) since
// UI/backend/DB containers all carry the same generic "Container" element
// type and can't be told apart from that text alone.
const CATEGORY_ORDER = [
    "person",
    "agent",
    "software-system",
    "external-system",
    "ui",
    "backend",
    "database",
    "container",
    "component",
    "other",
];
const CATEGORY_LABELS = {
    person: "Person",
    agent: "Agent",
    "software-system": "System",
    "external-system": "Ext. System",
    ui: "UI",
    backend: "Backend",
    database: "Database",
    container: "Container",
    component: "Component",
    other: "Other",
};
const CATEGORY_COLORS = {
    person: { bg: "#f3e8ff", fg: "#7c3aed" },
    agent: { bg: "#e0e0fd", fg: "#4338ca" },
    "software-system": { bg: "#fff1e0", fg: "#c2410c" },
    "external-system": { bg: "#fde3e3", fg: "#c2273f" },
    ui: { bg: "#e0f2fe", fg: "#0369a1" },
    backend: { bg: "#e8f0fe", fg: "#1a56b0" },
    database: { bg: "#e3f6f6", fg: "#0d7a7a" },
    container: { bg: "#eef2f7", fg: "#475569" },
    component: { bg: "#ffe8ef", fg: "#c23163" },
};
const FALLBACK_TYPE_COLORS = [
    { bg: "#fff4e0", fg: "#b56a00" },
    { bg: "#e8f0fe", fg: "#1a56b0" },
    { bg: "#f3e8ff", fg: "#7c3aed" },
    { bg: "#e6f7ee", fg: "#1f9254" },
    { bg: "#ffe8ef", fg: "#c23163" },
    { bg: "#e3f6f6", fg: "#0d7a7a" },
];

function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
}


function typeBadgeHtml(container) {
    if (!container || !container.elementType) return "";
    const elementType = container.elementType;
    const category = containerCategory(container);
    const external = category === "external-system";
    const agent = category === "agent";
    const iconKind =
        category === "ui" || category === "backend" || category === "database";
    // "Container" alone isn't informative once UI/backend/DB are split out -
    // show the detected kind instead (database keeps "Database" either way).
    const label = external
        ? /extern/i.test(elementType)
            ? elementType
            : elementType + " (ext)"
        : agent
          ? /agente?/i.test(elementType)
              ? elementType
              : elementType + " (agent)"
          : iconKind
            ? CATEGORY_LABELS[category]
            : elementType;
    const color =
        CATEGORY_COLORS[category] ||
        FALLBACK_TYPE_COLORS[
            hashStr(elementType.trim().toLowerCase()) %
                FALLBACK_TYPE_COLORS.length
        ];
    return (
        '<span class="type-badge" style="background: ' +
        color.bg +
        "; color: " +
        color.fg +
        ';"' +
        (external
            ? ' title="External software system (detected from the red shape color)"'
            : agent
              ? ' title="AI agent (detected from \'agente\'/\'agent\' text or the indigo shape color)"'
              : "") +
        ">" +
        escapeHtml(label) +
        "</span>"
    );
}

function renderContainerMeta(technology, description) {
    const detail = document.createElement("div");
    detail.className = "container-meta";
    detail.innerHTML =
        (technology
            ? '<div class="tech-row"><span class="tech-label">Tech</span><span class="tech">' +
              escapeHtml(technology) +
              "</span></div>"
            : "") +
        (description
            ? '<div class="desc">' + escapeHtml(description) + "</div>"
            : "");
    return detail;
}

const LOCATE_ICON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"></circle>' +
    '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>' +
    "</svg>";

const DOWN_ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 4v14M6 13l6 6 6-6"></path>' +
    "</svg>";

const UP_DOWN_ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"></path>' +
    "</svg>";

const OUT_ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 12h14M13 6l6 6-6 6"></path>' +
    "</svg>";

const IN_ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 12H6M11 6l-6 6 6 6"></path>' +
    "</svg>";

const BOTH_ARROW_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 12h16M7 6L4 12l3 6M17 6l3 6-3 6"></path>' +
    "</svg>";

containersEl.addEventListener("click", (event) => {
    const focusBtn = event.target.closest(".icon-btn, .boundary-badge");
    if (focusBtn) {
        const id = focusBtn.getAttribute("data-id");
        if (id) {
            parent.postMessage({ pluginMessage: { type: "focus", id } }, "*");
        }
    }
    const card = event.target.closest(".container-card");
    if (!card) return;
    const containerId = card.getAttribute("data-id");
    selectedContainerId = focusBtn
        ? containerId
        : selectedContainerId === containerId
          ? null
          : containerId;
    containersEl.querySelectorAll(".container-card").forEach((el) => {
        el.classList.toggle(
            "selected",
            el.getAttribute("data-id") === selectedContainerId,
        );
    });
    if (selectedContainerId) {
        renderContainerDetail(selectedContainerId);
    } else {
        hideContainerDetail();
    }
});

function renderRelations() {
    const filtered = currentRelations.filter(relationMatchesSearch);
    relationCountEl.textContent =
        filtered.length === currentRelations.length
            ? currentRelations.length
            : filtered.length + "/" + currentRelations.length;
    relationsEl.innerHTML = "";
    if (currentRelations.length === 0) {
        relationsEl.innerHTML = emptyStateHtml(
            EMPTY_ICON_SVG,
            "No relations yet",
            "No connectors were found between shapes on this page.",
        );
        hideRelationDetail();
        return;
    }
    if (filtered.length === 0) {
        relationsEl.innerHTML = emptyStateHtml(
            EMPTY_ICON_SVG,
            "No matches",
            "No relations match your search.",
        );
        hideRelationDetail();
        return;
    }
    filtered.forEach((r) => {
        const sourceContainer = findContainer(r.source);
        const targetContainer = findContainer(r.target);

        const card = document.createElement("div");
        card.className =
            "card relation-card" +
            (r.id === selectedRelationId ? " selected" : "");
        card.setAttribute("data-relation-id", r.id);

        const sourceRow = document.createElement("div");
        sourceRow.className = "relation-endpoint";
        sourceRow.innerHTML =
            '<button class="icon-btn" data-id="' +
            escapeHtml(r.source) +
            '" title="Go to this element on canvas">' +
            LOCATE_ICON_SVG +
            "</button>" +
            '<span class="name">' +
            escapeHtml(r.sourceName) +
            "</span>" +
            fallbackWarningHtml(
                sourceContainer &&
                    sourceContainer.labelSource === "node-name-fallback",
            ) +
            typeBadgeHtml(sourceContainer);

        const connector = document.createElement("div");
        connector.className =
            "relation-connector" + (r.bidirectional ? " bidirectional" : "");
        const labelPart = r.label
            ? escapeHtml(r.label)
            : r.technology
              ? ""
              : "(no label)";
        const techPart = r.technology
            ? '<span class="relation-tech">' +
              escapeHtml(r.technology) +
              "</span>"
            : "";
        connector.innerHTML =
            (r.bidirectional ? UP_DOWN_ARROW_SVG : DOWN_ARROW_SVG) +
            (labelPart
                ? '<span class="relation-label">' + labelPart + "</span>"
                : "") +
            techPart;

        const targetRow = document.createElement("div");
        targetRow.className = "relation-endpoint";
        targetRow.innerHTML =
            '<button class="icon-btn" data-id="' +
            escapeHtml(r.target) +
            '" title="Go to this element on canvas">' +
            LOCATE_ICON_SVG +
            "</button>" +
            '<span class="name">' +
            escapeHtml(r.targetName) +
            "</span>" +
            fallbackWarningHtml(
                targetContainer &&
                    targetContainer.labelSource === "node-name-fallback",
            ) +
            typeBadgeHtml(targetContainer);

        const locateBtn = document.createElement("button");
        locateBtn.className = "icon-btn locate-corner";
        locateBtn.setAttribute("data-id", r.id);
        locateBtn.title = "Go to connector on canvas";
        locateBtn.innerHTML = LOCATE_ICON_SVG;

        card.appendChild(sourceRow);
        card.appendChild(connector);
        card.appendChild(targetRow);
        card.appendChild(locateBtn);
        relationsEl.appendChild(card);
    });

    if (
        selectedRelationId &&
        filtered.some((r) => r.id === selectedRelationId)
    ) {
        renderRelationDetail(selectedRelationId);
    } else {
        hideRelationDetail();
    }
}

// Human-readable label + hint for each Issue.kind the plugin can report (see
// the Issue type in code.ts) - keeps the taxonomy easy to extend with new
// kinds later without touching the render loop below.
const ISSUE_KIND_LABELS = {
    "unattached-endpoint": "Unattached endpoint",
    "self-relation": "Self-relation",
    "empty-label": "Empty label",
    "malformed-boundary-label": "Malformed boundary label",
};
const ISSUE_KIND_HINTS = {
    "unattached-endpoint":
        "One end of this connector isn't attached to any shape.",
    "self-relation":
        "Both ends of this connector resolve to the same shape.",
    "empty-label":
        "One end of this connector has no title text of its own.",
    "malformed-boundary-label":
        "This boundary box's label text looks malformed (multi-line or too long).",
};

function issueKindBadgeHtml(kind) {
    const label = ISSUE_KIND_LABELS[kind] || kind;
    const hint = ISSUE_KIND_HINTS[kind] || "";
    return (
        '<span class="type-badge issue-kind-badge" title="' +
        escapeHtml(hint) +
        '">' +
        escapeHtml(label) +
        "</span>"
    );
}

function renderIssues() {
    issueCountEl.textContent = currentIssues.length;
    issuesEl.innerHTML = "";
    if (currentIssues.length === 0) {
        issuesEl.innerHTML = emptyStateHtml(
            EMPTY_ICON_SVG,
            "No issues found",
            "Every connector resolved cleanly to a real element on both ends.",
        );
        return;
    }
    currentIssues.forEach((issue) => {
        const item = document.createElement("div");
        item.className = "card issue-card";

        const header = document.createElement("div");
        header.className = "container-card-header";
        header.innerHTML =
            '<span class="name">' +
            escapeHtml(issue.connectorLabel) +
            "</span>" +
            '<span class="header-badges">' +
            issueKindBadgeHtml(issue.kind) +
            "</span>";
        item.appendChild(header);

        const locateBtn = document.createElement("button");
        locateBtn.className = "icon-btn locate-corner";
        locateBtn.setAttribute("data-id", issue.connectorId);
        locateBtn.title = "Go to connector on canvas";
        locateBtn.innerHTML = LOCATE_ICON_SVG;
        item.appendChild(locateBtn);

        const message = document.createElement("div");
        message.className = "container-meta";
        message.innerHTML = '<div class="desc">' + escapeHtml(issue.message) + "</div>";
        item.appendChild(message);

        issuesEl.appendChild(item);
    });
}

issuesEl.addEventListener("click", (event) => {
    const focusBtn = event.target.closest(".icon-btn");
    if (!focusBtn) return;
    const id = focusBtn.getAttribute("data-id");
    if (id) {
        parent.postMessage({ pluginMessage: { type: "focus", id } }, "*");
    }
});

function findContainer(id) {
    return currentContainers.find((c) => c.id === id) || null;
}

function renderEndpointCard(role, nodeId, fallbackName) {
    const container = findContainer(nodeId);
    const name = container ? container.name : fallbackName;
    const isFallback =
        container && container.labelSource === "node-name-fallback";
    const card = document.createElement("div");
    card.className = "endpoint-card";

    const nameRow = document.createElement("div");
    nameRow.className = "endpoint-name-row";
    nameRow.innerHTML =
        '<button class="icon-btn" data-id="' +
        escapeHtml(nodeId) +
        '" title="Go to element on canvas">' +
        LOCATE_ICON_SVG +
        "</button>" +
        '<span class="name">' +
        escapeHtml(name) +
        "</span>" +
        (container ? fallbackWarningHtml(isFallback) : "") +
        typeBadgeHtml(container);

    const roleEl = document.createElement("div");
    roleEl.className = "endpoint-role";
    roleEl.textContent = role;

    const body = document.createElement("div");
    body.className = "endpoint-body";
    body.appendChild(nameRow);
    if (container && (container.technology || container.description)) {
        body.appendChild(
            renderContainerMeta(container.technology, container.description),
        );
    }

    card.appendChild(roleEl);
    card.appendChild(body);
    return card;
}

function renderRelationDetail(relationId) {
    const relation = currentRelations.find((r) => r.id === relationId);
    if (!relation) {
        hideRelationDetail();
        return;
    }
    relationDetailEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "relation-detail-header";
    const detailLabelText = relation.label
        ? escapeHtml(relation.label) +
          (relation.technology
              ? ' <span class="relation-tech">' +
                escapeHtml(relation.technology) +
                "</span>"
              : "")
        : relation.technology
          ? '<span class="relation-tech">' +
            escapeHtml(relation.technology) +
            "</span>"
          : "(no label)";
    header.innerHTML =
        '<span class="label-text">' +
        detailLabelText +
        (relation.bidirectional
            ? ' <span class="relation-bidirectional-badge">bidirectional</span>'
            : "") +
        "</span>" +
        '<button class="relation-detail-close" title="Close">&times;</button>';
    relationDetailEl.appendChild(header);
    header.querySelector(".relation-detail-close").onclick = () => {
        selectedRelationId = null;
        hideRelationDetail();
        relationsEl
            .querySelectorAll(".relation-card.selected")
            .forEach((el) => el.classList.remove("selected"));
    };

    relationDetailEl.appendChild(
        renderEndpointCard("Start", relation.source, relation.sourceName),
    );
    relationDetailEl.appendChild(
        renderEndpointCard("End", relation.target, relation.targetName),
    );

    const row = relationsEl.querySelector(
        '.relation-card[data-relation-id="' + relationId + '"]',
    );
    if (row) {
        row.insertAdjacentElement("afterend", relationDetailEl);
    }

    relationDetailEl.classList.remove("hidden");
}

function hideRelationDetail() {
    relationDetailEl.classList.add("hidden");
    relationDetailEl.innerHTML = "";
}

function containerRelationRow(relation, containerId) {
    // Which side is "other" depends on the container being viewed, not on
    // which list (Outgoing/Incoming) the row happens to render in — a
    // bidirectional relation appears in both lists for the same container.
    const isSource = relation.source === containerId;
    const otherId = isSource ? relation.target : relation.source;
    const otherName = isSource ? relation.targetName : relation.sourceName;
    const otherContainer = findContainer(otherId);
    const name = otherContainer ? otherContainer.name : otherName;
    const arrowDirection = relation.bidirectional
        ? "both"
        : isSource
          ? "out"
          : "in";
    const arrowSvg =
        arrowDirection === "both"
            ? BOTH_ARROW_SVG
            : arrowDirection === "out"
              ? OUT_ARROW_SVG
              : IN_ARROW_SVG;

    const row = document.createElement("div");
    row.className = "cd-relation-row";
    row.setAttribute("data-relation-id", relation.id);
    row.title = "Open this relation in the Relations tab";

    const labelPart = relation.label
        ? '<span class="cd-relation-label">' +
          escapeHtml(relation.label) +
          "</span>"
        : relation.technology
          ? ""
          : '<span class="cd-relation-label">(no label)</span>';
    const techPart = relation.technology
        ? '<span class="relation-tech">' +
          escapeHtml(relation.technology) +
          "</span>"
        : "";

    row.innerHTML =
        '<button class="icon-btn" data-id="' +
        escapeHtml(relation.id) +
        '" title="Go to connector on canvas">' +
        LOCATE_ICON_SVG +
        "</button>" +
        '<span class="cd-relation-arrow ' +
        arrowDirection +
        '">' +
        arrowSvg +
        "</span>" +
        '<div class="cd-relation-info">' +
        '<div class="cd-relation-endpoint"><span class="name">' +
        escapeHtml(name) +
        "</span>" +
        typeBadgeHtml(otherContainer) +
        "</div>" +
        '<div class="cd-relation-meta">' +
        labelPart +
        techPart +
        "</div>" +
        "</div>";
    return row;
}

function containerRelationSection(title, relations, containerId) {
    const section = document.createElement("div");
    section.className = "cd-section";
    const heading = document.createElement("div");
    heading.className = "cd-section-title";
    heading.textContent = title + " (" + relations.length + ")";
    section.appendChild(heading);
    if (relations.length === 0) {
        const none = document.createElement("div");
        none.className = "cd-section-empty";
        none.textContent = "None";
        section.appendChild(none);
        return section;
    }
    relations.forEach((r) =>
        section.appendChild(containerRelationRow(r, containerId)),
    );
    return section;
}

function renderContainerDetail(containerId) {
    const container = findContainer(containerId);
    if (!container) {
        hideContainerDetail();
        return;
    }
    // A bidirectional relation flows both ways, so it belongs in both the
    // Outgoing and Incoming lists for either endpoint container.
    const outgoing = currentRelations.filter(
        (r) =>
            r.source === containerId ||
            (r.bidirectional && r.target === containerId),
    );
    const incoming = currentRelations.filter(
        (r) =>
            r.target === containerId ||
            (r.bidirectional && r.source === containerId),
    );

    containerDetailEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "relation-detail-header";
    header.innerHTML =
        '<span class="cd-header-name-group">' +
        '<span class="cd-header-name">' +
        escapeHtml(container.name) +
        "</span>" +
        boundaryBadgeHtml(container) +
        "</span>" +
        '<button class="relation-detail-close" title="Close">&times;</button>';
    containerDetailEl.appendChild(header);
    header.querySelector(".relation-detail-close").onclick = () => {
        selectedContainerId = null;
        hideContainerDetail();
        containersEl
            .querySelectorAll(".container-card.selected")
            .forEach((el) => el.classList.remove("selected"));
    };

    containerDetailEl.appendChild(
        containerRelationSection("Outgoing", outgoing, containerId),
    );
    containerDetailEl.appendChild(
        containerRelationSection("Incoming", incoming, containerId),
    );

    const card = containersEl.querySelector(
        '.container-card[data-id="' + containerId + '"]',
    );
    if (card) {
        card.insertAdjacentElement("afterend", containerDetailEl);
    }

    containerDetailEl.classList.remove("hidden");
}

function hideContainerDetail() {
    containerDetailEl.classList.add("hidden");
    containerDetailEl.innerHTML = "";
}

// Selects a container in the Containers tab (switching to it if needed),
// scrolls its card into view and opens its incoming/outgoing detail panel.
function openContainerInList(containerId, scroll) {
    const container = findContainer(containerId);
    if (!container) return;
    selectedContainerId = containerId;
    // Make sure the active type chip doesn't hide the card we're opening.
    const category = containerCategory(container);
    if (typeFilter !== "all" && typeFilter !== category) {
        typeFilter = category;
    }
    showTab("containers");
    renderContainers();
    if (scroll) {
        const card = containersEl.querySelector(
            '.container-card[data-id="' + containerId + '"]',
        );
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

// Same, but for a relation card in the Relations tab (used when clicking a
// relation row inside the container detail panel).
function openRelationInList(relationId) {
    if (!currentRelations.some((r) => r.id === relationId)) return;
    selectedRelationId = relationId;
    showTab("relations");
    renderRelations();
    const card = relationsEl.querySelector(
        '.relation-card[data-relation-id="' + relationId + '"]',
    );
    if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
}

relationsEl.addEventListener("click", (event) => {
    const focusBtn = event.target.closest(".icon-btn");
    if (focusBtn) {
        const id = focusBtn.getAttribute("data-id");
        if (id) {
            parent.postMessage({ pluginMessage: { type: "focus", id } }, "*");
        }
    }
    const row = event.target.closest(".relation-card");
    if (!row) return;
    const relationId = row.getAttribute("data-relation-id");
    selectedRelationId = focusBtn
        ? relationId
        : selectedRelationId === relationId
          ? null
          : relationId;
    relationsEl.querySelectorAll(".relation-card").forEach((el) => {
        el.classList.toggle(
            "selected",
            el.getAttribute("data-relation-id") === selectedRelationId,
        );
    });
    if (selectedRelationId) {
        renderRelationDetail(selectedRelationId);
    } else {
        hideRelationDetail();
    }
});

relationDetailEl.addEventListener("click", (event) => {
    const btn = event.target.closest(".icon-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (id) {
        parent.postMessage({ pluginMessage: { type: "focus", id } }, "*");
    }
});

containerDetailEl.addEventListener("click", (event) => {
    const btn = event.target.closest(".icon-btn, .boundary-badge");
    if (btn) {
        const id = btn.getAttribute("data-id");
        if (id) {
            parent.postMessage({ pluginMessage: { type: "focus", id } }, "*");
        }
        return;
    }
    const row = event.target.closest(".cd-relation-row");
    if (row) {
        openRelationInList(row.getAttribute("data-relation-id"));
    }
});

function escapeHtml(str) {
    return String(str).replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c],
    );
}

window.onmessage = (event) => {
    const msg = event.data.pluginMessage;
    if (!msg) return;
    if (msg.type === "settings") {
        debugModeToggle.checked = !!msg.debugMode;
        scanAllPagesToggle.checked = !!msg.scanAllPages;
        updateScanScopeNote();
    }
    if (msg.type === "relations") {
        // A whole-file scan concatenates every page's containers/boundaries
        // as-is (see extractRelationsAllPages in code.ts) - the same system
        // referenced as a plain box on one page and fully decomposed on
        // another would otherwise appear twice. Only applied for that scope:
        // within a single page, two elements sharing a name are genuinely
        // distinct and must never be collapsed into one.
        const scoped =
            msg.scope === "all-pages"
                ? mergeAcrossPages(
                      msg.containers || [],
                      msg.relations || [],
                      msg.boundaries || [],
                  )
                : {
                      containers: msg.containers || [],
                      relations: msg.relations || [],
                      boundaries: msg.boundaries || [],
                  };
        currentContainers = scoped.containers;
        currentRelations = scoped.relations;
        currentBoundaries = scoped.boundaries;
        currentIssues = msg.issues || [];
        if (msg.focusRelationId) {
            selectedRelationId = msg.focusRelationId;
            showTab("relations");
        }
        if (msg.focusContainerId) {
            selectedContainerId = msg.focusContainerId;
            showTab("containers");
        }
        renderContainers();
        renderRelations();
        renderIssues();
        if (msg.focusRelationId) {
            const card = relationsEl.querySelector(
                '.relation-card[data-relation-id="' +
                    msg.focusRelationId +
                    '"]',
            );
            if (card)
                card.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (msg.focusContainerId) {
            const card = containersEl.querySelector(
                '.container-card[data-id="' + msg.focusContainerId + '"]',
            );
            if (card)
                card.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        if (!tabViews.export.classList.contains("hidden")) {
            renderExportOutput();
        }
    }
    // Sent by the plugin when the user selects a known container shape on
    // the canvas: mirror that selection in the Containers tab.
    if (msg.type === "container-selected" && msg.id) {
        openContainerInList(msg.id, true);
    }
};

// Tell the plugin we're ready to receive messages. figma.showUI() loads
// this iframe asynchronously, so if the plugin fires its initial extract
// right after showUI() (as it used to), the message can arrive before
// window.onmessage above is attached and gets silently dropped - leaving
// the panel empty until the user manually clicks Refresh. Sending this
// ready ping (after the listener is attached) and having the plugin wait
// for it removes that race.
parent.postMessage({ pluginMessage: { type: "ui-ready" } }, "*");
