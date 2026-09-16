// Import tab: paste/load a LikeC4 JSON export, pick a view, and ask the
// plugin thread to rebuild it as native FigJam shapes/connectors (see the
// "parse"/"import" message handling in code.ts, ported from the standalone
// likec4-to-figjam plugin).
const importFileInputEl = document.getElementById("import-file-input");
const importJsonEl = document.getElementById("import-json");
const importViewSelectEl = document.getElementById("import-view-select");
const importBtnEl = document.getElementById("import-btn");
const importStatusEl = document.getElementById("import-status");
const lastImportRowEl = document.getElementById("last-import-row");
const loadLastImportBtnEl = document.getElementById("load-last-import-btn");
const syncAllBtnEl = document.getElementById("sync-all-btn");
const syncStatusEl = document.getElementById("sync-status");
const syncLastBtnEl = document.getElementById("sync-last-btn");

let importParseTimer = null;
// Name of the file currently loaded into importJsonEl (if any), so a
// successful import can be remembered by file name - see
// applyLastImportInfo/"save-last-import" below.
let pendingImportFileName = null;
// Last successfully imported file, restored from clientStorage via the
// "settings" message on plugin launch (see code.ts) - lets the user re-import
// it without having to browse for it again.
let lastImportInfo = null;

function applyLastImportInfo(fileName, text) {
    lastImportInfo = fileName && text ? { fileName, text } : null;
    lastImportRowEl.classList.toggle("hidden", !lastImportInfo);
    if (lastImportInfo) {
        loadLastImportBtnEl.textContent = `Load last imported file: ${lastImportInfo.fileName}`;
        if (syncLastBtnEl) {
            syncLastBtnEl.textContent = `Sync now: ${lastImportInfo.fileName}`;
            syncLastBtnEl.disabled = false;
        }
    }
    // Containers/Relations empty states offer a "re-import last file" shortcut
    // (see emptyLastImportBtnHtml in app.js) - re-render them so it appears
    // as soon as lastImportInfo becomes available, not just on next render.
    renderContainers();
    renderRelations();
}

function loadLastImportIntoTextarea() {
    if (!lastImportInfo) return;
    pendingImportFileName = lastImportInfo.fileName;
    importJsonEl.value = lastImportInfo.text;
    importJsonEl.dispatchEvent(new Event("input"));
}

loadLastImportBtnEl.addEventListener("click", loadLastImportIntoTextarea);

// Used by the Containers/Relations empty states' "Import last file" button -
// jumps straight to the Import overlay with the last file already loaded.
function openImportWithLastFile() {
    openOverlay("import");
    loadLastImportIntoTextarea();
}

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
        pendingImportFileName = file.name;
        importJsonEl.value = reader.result;
        importJsonEl.dispatchEvent(new Event("input"));
    };
    reader.onerror = () => setImportStatus("Failed to read the file.", "error");
    reader.readAsText(file);
});

importJsonEl.addEventListener("input", (event) => {
    // Real keystrokes/paste (isTrusted) invalidate the file name we'd
    // remember this import under; the synthetic events dispatched above
    // after loading a file/last-import don't (isTrusted is false for those).
    if (event.isTrusted) pendingImportFileName = null;
    clearTimeout(importParseTimer);
    const text = importJsonEl.value.trim();
    if (!text) {
        importViewSelectEl.disabled = true;
        importViewSelectEl.innerHTML =
            "<option>Paste JSON to see views…</option>";
        importBtnEl.disabled = true;
        syncAllBtnEl.disabled = true;
        setImportStatus("");
        setSyncStatus("");
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
    parent.postMessage(
        { pluginMessage: { type: "import", text, viewId, fileName: pendingImportFileName } },
        "*",
    );
});

function renderImportParsed(msg) {
    if (msg.options.length === 0) {
        importViewSelectEl.disabled = true;
        importViewSelectEl.innerHTML = "<option>No views found</option>";
        importBtnEl.disabled = true;
        syncAllBtnEl.disabled = true;
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
    syncAllBtnEl.disabled = false;
    setImportStatus(`Found ${msg.options.length} view(s). Pick one and import.`, "success");
}

function setSyncStatus(text, kind) {
    syncStatusEl.textContent = text || "";
    syncStatusEl.className = "status" + (kind ? " " + kind : "");
}

// Text/fileName of whatever sync is currently in flight, so renderSyncResult
// can remember it via applyLastImportInfo once the plugin thread replies —
// the reply itself doesn't echo the JSON back.
let pendingSyncText = null;
let pendingSyncFileName = null;

function runSync(text, fileName) {
    if (!text) return;
    pendingSyncText = text;
    pendingSyncFileName = fileName || null;
    syncAllBtnEl.disabled = true;
    if (syncLastBtnEl) syncLastBtnEl.disabled = true;
    setSyncStatus("Syncing views to pages…");
    parent.postMessage(
        { pluginMessage: { type: "sync-all", text, fileName: pendingSyncFileName } },
        "*",
    );
}

syncAllBtnEl.addEventListener("click", () => {
    runSync(importJsonEl.value.trim(), pendingImportFileName);
});

if (syncLastBtnEl) {
    syncLastBtnEl.addEventListener("click", () => {
        if (!lastImportInfo) return;
        runSync(lastImportInfo.text, lastImportInfo.fileName);
    });
}

function renderSyncResult(msg) {
    syncAllBtnEl.disabled = false;
    if (syncLastBtnEl) syncLastBtnEl.disabled = !lastImportInfo;
    if (msg.fileName && pendingSyncText) {
        applyLastImportInfo(msg.fileName, pendingSyncText);
    }
    const total = msg.results.length;
    const created = msg.results.filter((r) => r.created).length;
    const updated = total - created;
    const errors = msg.results.filter((r) => r.error);
    const parts = [
        `Synced ${total} view(s) — ${created} new page(s), ${updated} updated.`,
    ];
    if (errors.length) {
        parts.push(
            `${errors.length} view(s) failed (e.g. "${errors[0].title}": ${errors[0].error}).`,
        );
    }
    setSyncStatus(parts.join(" "), errors.length ? "error" : "success");
}

function renderSyncError(msg) {
    syncAllBtnEl.disabled = false;
    if (syncLastBtnEl) syncLastBtnEl.disabled = !lastImportInfo;
    setSyncStatus(msg.message, "error");
}

function renderImportResult(msg) {
    importBtnEl.disabled = false;
    if (msg.fileName) applyLastImportInfo(msg.fileName, importJsonEl.value.trim());
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
