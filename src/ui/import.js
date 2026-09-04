// Import tab: paste/load a LikeC4 JSON export, pick a view, and ask the
// plugin thread to rebuild it as native FigJam shapes/connectors (see the
// "parse"/"import" message handling in code.ts, ported from the standalone
// likec4-to-figjam plugin).
const importFileInputEl = document.getElementById("import-file-input");
const importJsonEl = document.getElementById("import-json");
const importViewSelectEl = document.getElementById("import-view-select");
const importBtnEl = document.getElementById("import-btn");
const importStatusEl = document.getElementById("import-status");

let importParseTimer = null;

function setImportStatus(text, kind) {
    importStatusEl.textContent = text || "";
    importStatusEl.className = "status" + (kind ? " " + kind : "");
}

importFileInputEl.addEventListener("change", () => {
    const file = importFileInputEl.files[0];
    if (!file) return;
    setImportStatus(`Reading ${file.name}…`);
    const reader = new FileReader();
    reader.onload = () => {
        importJsonEl.value = reader.result;
        importJsonEl.dispatchEvent(new Event("input"));
    };
    reader.onerror = () => setImportStatus("Failed to read the file.", "error");
    reader.readAsText(file);
});

importJsonEl.addEventListener("input", () => {
    clearTimeout(importParseTimer);
    const text = importJsonEl.value.trim();
    if (!text) {
        importViewSelectEl.disabled = true;
        importViewSelectEl.innerHTML =
            "<option>Paste JSON to see views…</option>";
        importBtnEl.disabled = true;
        setImportStatus("");
        return;
    }
    importParseTimer = setTimeout(() => {
        parent.postMessage({ pluginMessage: { type: "parse", text } }, "*");
    }, 300);
});

importBtnEl.addEventListener("click", () => {
    const text = importJsonEl.value.trim();
    const viewId = importViewSelectEl.value;
    if (!text || !viewId) return;
    importBtnEl.disabled = true;
    setImportStatus("Building diagram in FigJam…");
    parent.postMessage({ pluginMessage: { type: "import", text, viewId } }, "*");
});

function renderImportParsed(msg) {
    if (msg.options.length === 0) {
        importViewSelectEl.disabled = true;
        importViewSelectEl.innerHTML = "<option>No views found</option>";
        importBtnEl.disabled = true;
        setImportStatus("No views found in this JSON.", "error");
        return;
    }
    importViewSelectEl.innerHTML = msg.options
        .map(
            (o) =>
                `<option value="${o.id}">${escapeHtml(o.title)} (${o.nodeCount} nodes)</option>`,
        )
        .join("");
    importViewSelectEl.disabled = false;
    importBtnEl.disabled = false;
    setImportStatus(`Found ${msg.options.length} view(s). Pick one and import.`, "success");
}

function renderImportResult(msg) {
    importBtnEl.disabled = false;
    const parts = [
        `Done — ${msg.nodeCount} node(s), ${msg.edgeCount} connector(s) added.`,
    ];
    if (msg.skippedNodes)
        parts.push(`${msg.skippedNodes} node(s) skipped (e.g. ${msg.firstNodeError}).`);
    if (msg.skippedEdges)
        parts.push(`${msg.skippedEdges} connector(s) skipped (e.g. ${msg.firstEdgeError}).`);
    setImportStatus(
        parts.join(" "),
        msg.skippedNodes || msg.skippedEdges ? "error" : "success",
    );
}

function renderImportError(msg) {
    importBtnEl.disabled = false;
    setImportStatus(msg.message, "error");
}
