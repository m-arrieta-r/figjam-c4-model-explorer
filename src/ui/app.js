let currentContainers = [];
let currentRelations = [];
let selectedRelationId = null;
let selectedContainerId = null;
let searchQuery = "";
let exportFormat = "mermaid";

const relationsEl = document.getElementById("relations");
const containersEl = document.getElementById("containers");
const containerCountEl = document.getElementById("container-count");
const relationCountEl = document.getElementById("relation-count");
const relationDetailEl = document.getElementById("relation-detail");
const containerDetailEl = document.getElementById("container-detail");
const mermaidOutput = document.getElementById("mermaid-output");
const copyBtn = document.getElementById("copy");
const copyStatus = document.getElementById("copy-status");
const searchBarEl = document.getElementById("search-bar");
const searchInputEl = document.getElementById("search-input");
const searchClearEl = document.getElementById("search-clear");
const formatButtons = document.querySelectorAll(".format-btn");

const tabButtons = document.querySelectorAll(".tab-btn");
const tabViews = {
    relations: document.getElementById("relations-view"),
    containers: document.getElementById("containers-view"),
    export: document.getElementById("export-view"),
};

function renderExportOutput() {
    mermaidOutput.value =
        exportFormat === "likec4"
            ? toLikeC4Dsl(currentContainers, currentRelations)
            : toMermaidC4(currentContainers, currentRelations);
    copyStatus.textContent = "";
}

function showTab(name) {
    tabButtons.forEach((btn) =>
        btn.classList.toggle("active", btn.dataset.tab === name),
    );
    Object.entries(tabViews).forEach(([key, el]) =>
        el.classList.toggle("hidden", key !== name),
    );
    searchBarEl.classList.toggle("hidden", name === "export");
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
        renderExportOutput();
    };
});

var DIACRITIC_RE = new RegExp("[̀-ͯ]", "g");
function normalizeSearch(str) {
    return String(str || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(DIACRITIC_RE, "");
}

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

function renderContainers() {
    const filtered = currentContainers.filter(containerMatchesSearch);
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
            typeBadgeHtml(c.elementType);
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

const KNOWN_TYPE_COLORS = {
    person: { bg: "#f3e8ff", fg: "#7c3aed" },
    "software system": { bg: "#e6f7ee", fg: "#1f9254" },
    "external system": { bg: "#f2eee0", fg: "#8a6d1f" },
    container: { bg: "#e8f0fe", fg: "#1a56b0" },
    component: { bg: "#ffe8ef", fg: "#c23163" },
    database: { bg: "#e3f6f6", fg: "#0d7a7a" },
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

function typeBadgeHtml(elementType) {
    if (!elementType) return "";
    const key = elementType.trim().toLowerCase();
    const color =
        KNOWN_TYPE_COLORS[key] ||
        FALLBACK_TYPE_COLORS[hashStr(key) % FALLBACK_TYPE_COLORS.length];
    return (
        '<span class="type-badge" style="background: ' +
        color.bg +
        "; color: " +
        color.fg +
        ';">' +
        escapeHtml(elementType) +
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

containersEl.addEventListener("click", (event) => {
    const focusBtn = event.target.closest(".icon-btn");
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
            typeBadgeHtml(sourceContainer && sourceContainer.elementType);

        const connector = document.createElement("div");
        connector.className = "relation-connector";
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
            DOWN_ARROW_SVG +
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
            typeBadgeHtml(targetContainer && targetContainer.elementType);

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
        (container ? typeBadgeHtml(container.elementType) : "");

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

function containerRelationRow(relation, direction) {
    const otherId = direction === "out" ? relation.target : relation.source;
    const otherName =
        direction === "out" ? relation.targetName : relation.sourceName;
    const otherContainer = findContainer(otherId);
    const name = otherContainer ? otherContainer.name : otherName;

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
        (direction === "out" ? "out" : "in") +
        '">' +
        (direction === "out" ? OUT_ARROW_SVG : IN_ARROW_SVG) +
        "</span>" +
        '<div class="cd-relation-info">' +
        '<div class="cd-relation-endpoint"><span class="name">' +
        escapeHtml(name) +
        "</span>" +
        typeBadgeHtml(otherContainer && otherContainer.elementType) +
        "</div>" +
        '<div class="cd-relation-meta">' +
        labelPart +
        techPart +
        "</div>" +
        "</div>";
    return row;
}

function containerRelationSection(title, relations, direction) {
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
        section.appendChild(containerRelationRow(r, direction)),
    );
    return section;
}

function renderContainerDetail(containerId) {
    const container = findContainer(containerId);
    if (!container) {
        hideContainerDetail();
        return;
    }
    const outgoing = currentRelations.filter((r) => r.source === containerId);
    const incoming = currentRelations.filter((r) => r.target === containerId);

    containerDetailEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "relation-detail-header";
    header.innerHTML =
        '<span class="cd-header-name">' +
        escapeHtml(container.name) +
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
        containerRelationSection("Outgoing", outgoing, "out"),
    );
    containerDetailEl.appendChild(
        containerRelationSection("Incoming", incoming, "in"),
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
    if (!findContainer(containerId)) return;
    selectedContainerId = containerId;
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
    const btn = event.target.closest(".icon-btn");
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
    if (msg.type === "relations") {
        currentContainers = msg.containers || [];
        currentRelations = msg.relations || [];
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
