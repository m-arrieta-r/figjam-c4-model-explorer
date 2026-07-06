# AGENTS.md

Context for LLM coding agents working in this repo. Read this before making changes.

## What this is

A FigJam plugin. It scans the current page for `CONNECTOR` nodes, resolves the
shapes at both ends of each connector into "boxes" (extracting name /
C4 element type / technology / description from their text layers), and shows
the result in a plugin UI with three tabs: **Relaciones** (relations),
**Boxes**, and **Export** (Mermaid C4 or LikeC4 DSL).

## Architecture

Two runtimes talking over `postMessage`, standard Figma plugin split:

- `src/code.ts` — the plugin sandbox. Has the Figma document API
  (`figma.*`), no DOM. Compiled with esbuild to `dist/code.js` (gitignored),
  which is what `manifest.json`'s `"main"` points to.
- `ui.html` — the plugin UI, rendered in a sandboxed iframe. Plain HTML/CSS/JS,
  **not bundled** — `manifest.json`'s `"ui"` field points at it directly, so
  editing `ui.html` takes effect on the next plugin run with **no build step**.
  Only edits to `src/code.ts` require `npm run build`.

Message protocol between the two (informal, not typed across the boundary):

| Direction | `type` | Payload | Purpose |
|---|---|---|---|
| UI → plugin | `ui-ready` | — | Sent once, right after `window.onmessage` is attached. See "startup race" below. |
| UI → plugin | `extract` | — | Re-run extraction (Refresh button). |
| UI → plugin | `focus` | `id` | Select + zoom to a node on the canvas. |
| UI → plugin | `close` | — | Close the plugin. |
| plugin → UI | `relations` | `boxes`, `relations`, `skipped`, `focusRelationId` | Extraction result. `focusRelationId` is non-null only when launched via the relaunch button (see below). |

### Startup race — do not reintroduce

`figma.showUI()` loads the `ui.html` iframe **asynchronously**. Early versions
of this plugin called `runExtraction()` unconditionally right after
`figma.showUI(...)`, which raced the iframe's own script startup: if the
`relations` message arrived before `window.onmessage` was attached in
`ui.html`, it was silently dropped and the panel stayed empty until the user
manually clicked Refresh. Fixed by a ready handshake — `ui.html` sends
`{ type: 'ui-ready' }` as the *last* line of its script (after
`window.onmessage` is assigned), and `code.ts` only calls `runExtraction()`
in response to that message (or to `extract`), never at top-level script
scope. Keep it that way — don't add a bare `runExtraction()` call after
`figma.showUI()`.

## Text extraction (the tricky part)

`extractBoxDetails(node)` in `code.ts` turns an arbitrary connector endpoint
node into `{ name, nameSource, elementType, technology, description }`. It
tries strategies in order, falling through if one doesn't produce a name:

1. **Simple text-bearing node** — the node itself has `.text.characters` or
   `.characters` (sticky note, plain text, shape-with-text). Used directly.
2. **Named text layers** — some C4 shape templates name each text layer
   semantically: `Título`/`Title`, `Tecnología`/`Technology`/`Subtítulo`,
   `Descripción`/`Description` (regexes `TITLE_NAME_RE`/`TECH_NAME_RE`/
   `DESC_NAME_RE`, accent- and case-insensitive). If a layer's own name
   matches, its content is used directly for that field, regardless of
   nesting.
3. **Positional fallback** (`extractFlatDetails` / `findBracketRun`) — for
   shapes where the layers *aren't* semantically named (a very common case:
   Figma defaults a text layer's name to its own content when nobody
   renames it, e.g. a layer literally named `"[Software System]"`).
   `collectNamedTexts` flattens **every** descendant TEXT node into document
   order regardless of how deeply/where it's nested — the bracket annotation
   can be one node (`"[Software System]"`) or split across siblings
   (`"["`, `"Software System"`, `"]"`); `findBracketRun` locates it wherever
   it sits. Whatever's left, in order: first meaningful text → name, rest →
   description. This does **not** depend on frame names or grouping, only on
   document order (title text before description text) — that assumption
   held for every real shape template seen so far.
4. **`node-name-fallback`** — nothing textual found; use the node's own
   Figma layer name. Flagged via `labelSource === 'node-name-fallback'`, and
   surfaced in the UI as a small ⚠ (see `fallbackWarningHtml` in `ui.html`)
   rather than a full badge — treat this as "extraction probably guessed
   wrong, the box may need a proper text layer."

`splitTechAnnotation(raw)` then splits whatever bracket content was found on
the first `:` — `"Container: Oracle APEX"` → `elementType: "Container"`,
`technology: "Oracle APEX"`; `"Person"` (no colon) → `elementType: "Person"`,
`technology: null`.

If you need to debug a specific box's extraction, click its locate icon (🎯)
in the UI — `focusNode()` in `code.ts` logs the full node subtree as JSON to
the plugin console (Figma → Plugins → Development → Open Console). That JSON
is the fastest way to see why a shape isn't parsing the way you'd expect —
ask for it before guessing at a fix.

## UI (`ui.html`)

Single file, inline `<style>` + `<script>`, no framework, no build step.

- Sticky header (title, tabs with live counts, search bar) so it stays
  visible while scrolling long lists (some boards have 200+ relations).
- Relations and boxes render as cards (`.relation-card` / `.box-card`), not
  plain list rows — deliberate, a flat 3-column row layout wrapped badly for
  long Spanish names (see git history around the UI redesign if curious).
- Clicking a relation card (or its locate icons) toggles `#relation-detail`
  open/closed. That panel is a single reused DOM node that gets physically
  moved via `insertAdjacentElement('afterend', ...)` to sit right after the
  *currently selected* card on every render — it does **not** live at a
  fixed position. This was a real bug once: with a long list, appending the
  detail panel at the end of `#relations` made it appear far below the
  clicked row, looking like "nothing happened." Keep this
  find-the-row-then-insert-after pattern if you touch that code.
- Each relation card has **three** separate locate icons: source endpoint,
  target endpoint, and the connector itself (corner button) — each posts
  `focus` with a different id. Don't collapse these into one.
- Search (`matchesSearch`) is accent-insensitive (NFD-normalize + strip
  combining marks) and matches name/description/technology/elementType
  across both boxes and (via `findBox`) the endpoints of each relation.
- Export tab toggles between `toMermaidC4()` and `toLikeC4Dsl()`, both built
  from the same `buildIdMap()`/`slugify()` (stable, collision-free per-box
  identifiers reused across both formats).

## Relaunch button (canvas → plugin)

Figma does **not** let plugins add buttons to its native selection toolbar
(the black rounded bar with color/stroke/arrowhead controls that appears
when you select a connector) — that's fully native UI, no API surface for
it. The supported integration point is `node.setRelaunchData()`, which shows
a button in Figma's **properties panel** (FigJam: property menu) when that
node is selected. This plugin uses it:

- `manifest.json` declares `relaunchButtons: [{ command: "view-relation",
  name: "Ver relación C4" }]`.
- Every connector gets `connector.setRelaunchData({ "view-relation": "..." })`
  during extraction (in `extractRelations()`), which (re)attaches the button
  each time.
- On startup, if `figma.command === "view-relation"` (i.e. launched via that
  button), `getSelectedConnectorId()` reads the connector from
  `figma.currentPage.selection` and that id is threaded through as
  `focusRelationId` in the `relations` message, which `ui.html` uses to
  switch to the Relaciones tab, select the right card, scroll it into view,
  and open its detail panel automatically.

## Conventions / things that look inconsistent on purpose

- UI copy mixes Spanish (most labels, tooltips, empty states) and English tab
  names ("Boxes", "Export") — that's intentional, matches what the user
  explicitly asked for, not an oversight to "fix."
- No test framework is set up. Verification during development has been done
  ad hoc with headless `jsdom` scripts in `/tmp` (install `jsdom` with
  `npm install --no-save jsdom` in a scratch dir, load `ui.html` with
  `runScripts: 'dangerously'`, simulate `postMessage`/clicks, assert on the
  resulting DOM) since `ui.html`'s script isn't covered by `tsc`. Clean up
  the scratch dir after. There's no persistent test suite to run — don't go
  looking for one.

## Commands

```
npm run build      # esbuild src/code.ts -> dist/code.js
npm run watch       # same, with --watch
npm run typecheck   # tsc --noEmit (src/ only; ui.html's script is untyped)
```

Always run `typecheck` (and `build` if `dist/code.js` will be loaded) after
touching `src/code.ts`. `ui.html` changes need no build, just a plugin
reload in Figma.
