let currentBoxes = [];
let currentRelations = [];
let selectedRelationId = null;
let searchQuery = "";
let exportFormat = "mermaid";

const relationsEl = document.getElementById("relations");
const boxesEl = document.getElementById("boxes");
const boxCountEl = document.getElementById("box-count");
const relationCountEl = document.getElementById("relation-count");
const relationDetailEl = document.getElementById("relation-detail");
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
    boxes: document.getElementById("boxes-view"),
    export: document.getElementById("export-view"),
};

function renderExportOutput() {
    mermaidOutput.value =
        exportFormat === "likec4"
            ? toLikeC4Dsl(currentBoxes, currentRelations)
            : toMermaidC4(currentBoxes, currentRelations);
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

function boxMatchesSearch(b) {
    return matchesSearch([b.name, b.description, b.technology, b.elementType]);
}

function relationMatchesSearch(r) {
    const sourceBox = findBox(r.source);
    const targetBox = findBox(r.target);
    return matchesSearch([
        r.sourceName,
        r.targetName,
        r.label,
        r.technology,
        sourceBox && sourceBox.description,
        sourceBox && sourceBox.technology,
        sourceBox && sourceBox.elementType,
        targetBox && targetBox.description,
        targetBox && targetBox.technology,
        targetBox && targetBox.elementType,
    ]);
}

searchInputEl.addEventListener("input", () => {
    searchQuery = searchInputEl.value;
    searchClearEl.style.display = searchQuery ? "inline-flex" : "none";
    renderBoxes();
    renderRelations();
});

searchClearEl.onclick = () => {
    searchInputEl.value = "";
    searchQuery = "";
    searchClearEl.style.display = "none";
    renderBoxes();
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

function renderBoxes() {
    const filtered = currentBoxes.filter(boxMatchesSearch);
    boxCountEl.textContent =
        filtered.length === currentBoxes.length
            ? currentBoxes.length
            : filtered.length + "/" + currentBoxes.length;
    boxesEl.innerHTML = "";
    if (currentBoxes.length === 0) {
        boxesEl.innerHTML = emptyStateHtml(
            EMPTY_ICON_SVG,
            "No boxes yet",
            "Run Refresh to extract shapes from the FigJam canvas.",
        );
        return;
    }
    if (filtered.length === 0) {
        boxesEl.innerHTML = emptyStateHtml(
            EMPTY_ICON_SVG,
            "No matches",
            "No boxes match your search.",
        );
        return;
    }
    filtered.forEach((b) => {
        const item = document.createElement("div");
        item.className = "card box-card";
        item.setAttribute("data-id", b.id);
        const isFallback = b.labelSource === "node-name-fallback";

        const header = document.createElement("div");
        header.className = "box-card-header";
        header.innerHTML =
            '<span class="name">' +
            escapeHtml(b.name) +
            "</span>" +
            fallbackWarningHtml(isFallback) +
            typeBadgeHtml(b.elementType);
        item.appendChild(header);

        const locateBtn = document.createElement("button");
        locateBtn.className = "icon-btn locate-corner";
        locateBtn.setAttribute("data-id", b.id);
        locateBtn.title = "Go to element on canvas";
        locateBtn.innerHTML = LOCATE_ICON_SVG;
        item.appendChild(locateBtn);

        if (b.technology || b.description) {
            item.appendChild(renderBoxDetail(b.technology, b.description));
        }

        boxesEl.appendChild(item);
    });
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

function renderBoxDetail(technology, description) {
    const detail = document.createElement("div");
    detail.className = "box-detail";
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

boxesEl.addEventListener("click", (event) => {
    const btn = event.target.closest(".icon-btn");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (id) {
        parent.postMessage({ pluginMessage: { type: "focus", id } }, "*");
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
        const sourceBox = findBox(r.source);
        const targetBox = findBox(r.target);

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
                sourceBox && sourceBox.labelSource === "node-name-fallback",
            ) +
            typeBadgeHtml(sourceBox && sourceBox.elementType);

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
                targetBox && targetBox.labelSource === "node-name-fallback",
            ) +
            typeBadgeHtml(targetBox && targetBox.elementType);

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

function findBox(id) {
    return currentBoxes.find((b) => b.id === id) || null;
}

function renderEndpointCard(role, nodeId, fallbackName) {
    const box = findBox(nodeId);
    const name = box ? box.name : fallbackName;
    const isFallback = box && box.labelSource === "node-name-fallback";
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
        (box ? fallbackWarningHtml(isFallback) : "") +
        (box ? typeBadgeHtml(box.elementType) : "");

    const roleEl = document.createElement("div");
    roleEl.className = "endpoint-role";
    roleEl.textContent = role;

    const body = document.createElement("div");
    body.className = "endpoint-body";
    body.appendChild(nameRow);
    if (box && (box.technology || box.description)) {
        body.appendChild(renderBoxDetail(box.technology, box.description));
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
        currentBoxes = msg.boxes || [];
        currentRelations = msg.relations || [];
        if (msg.focusRelationId) {
            selectedRelationId = msg.focusRelationId;
            showTab("relations");
        }
        renderBoxes();
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
        if (!tabViews.export.classList.contains("hidden")) {
            renderExportOutput();
        }
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
