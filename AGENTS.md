# AGENTS.md

Context for LLM coding agents working in this repo. Read this before making changes.

## What this is

A FigJam plugin. It scans the current page for `CONNECTOR` nodes, resolves the
shapes at both ends of each connector into "containers" (extracting name /
C4 element type / technology / description from their text layers), and shows
the result in a plugin UI with three tabs: **Relations**, **Containers**, and
**Export** (Mermaid C4 or LikeC4 DSL). The word "container" here is the
project-wide term for a connector endpoint shape (any C4 element — Person,
Software System, Database... — not just the C4 "Container" type); it replaced
the earlier term "box" everywhere (types, message payloads, DOM ids/classes,
docs), so don't reintroduce "box" naming.

## Architecture

Two runtimes talking over `postMessage`, standard Figma plugin split:

- `src/code.ts` — the plugin sandbox. Has the Figma document API
  (`figma.*`), no DOM. Compiled with esbuild to `dist/code.js` (gitignored),
  which is what `manifest.json`'s `"main"` points to.
- `src/ui/` — the plugin UI, rendered in a sandboxed iframe. Plain HTML/CSS/JS,
  split into `index.html` (markup shell with `/*BUILD:INLINE_CSS*/` /
  `/*BUILD:INLINE_JS*/` placeholders), `styles.css`, `export-shared.js`
  (`esc`/`slugify`/`buildIdMap`, shared by both export formats),
  `export-mermaid.js`, `export-likec4.js`, and `app.js` (state, DOM refs,
  tabs, search, rendering, `postMessage` wiring — everything not related to
  export). `scripts/build-ui.js` (dependency-free, just `fs`/`path`) inlines
  `styles.css` and concatenates the JS files — `export-shared.js` first,
  since the others call its functions — into those placeholders, producing
  a single `dist/ui.html`, which is what `manifest.json`'s `"ui"` field
  points to. Figma loads the `"ui"` file as one iframe document with no way
  to fetch sibling files, so it **must** ship as one self-contained file —
  the split only exists in `src/ui/`, never in what's loaded.
  Editing anything under `src/ui/` requires `npm run build` (or
  `npm run watch`, which rebuilds both `dist/code.js` and `dist/ui.html` on
  change) before reloading the plugin in Figma.

Message protocol between the two (informal, not typed across the boundary):

| Direction | `type` | Payload | Purpose |
|---|---|---|---|
| UI → plugin | `ui-ready` | — | Sent once, right after `window.onmessage` is attached. See "startup race" below. |
| UI → plugin | `extract` | — | Re-run extraction (Refresh button). |
| UI → plugin | `focus` | `id` | Select + zoom to a node on the canvas. |
| UI → plugin | `close` | — | Close the plugin. |
| plugin → UI | `relations` | `containers`, `relations`, `skipped`, `focusRelationId`, `focusContainerId` | Extraction result. `focusRelationId` / `focusContainerId` are non-null only when launched via the corresponding relaunch button (see below). |
| plugin → UI | `container-selected` | `id` | Sent by the `selectionchange` listener when the user selects exactly one node on the canvas whose id is a known container (from the last extraction). The UI switches to the Containers tab, selects that card and opens its incoming/outgoing detail panel. Programmatic selections made by `focusNode` are suppressed via `lastProgrammaticSelectionId` so clicking a locate icon in the UI doesn't bounce the panel to the Containers tab — keep that suppression if you touch selection code. |

### Startup race — do not reintroduce

`figma.showUI()` loads the UI iframe **asynchronously**. Early versions
of this plugin called `runExtraction()` unconditionally right after
`figma.showUI(...)`, which raced the iframe's own script startup: if the
`relations` message arrived before `window.onmessage` was attached in
the UI, it was silently dropped and the panel stayed empty until the user
manually clicked Refresh. Fixed by a ready handshake — `app.js` sends
`{ type: 'ui-ready' }` as the *last* line of its script (after
`window.onmessage` is assigned), and `code.ts` only calls `runExtraction()`
in response to that message (or to `extract`), never at top-level script
scope. Keep it that way — don't add a bare `runExtraction()` call after
`figma.showUI()`.

## Text extraction (the tricky part)

`extractContainerDetails(node)` in `code.ts` turns an arbitrary connector
endpoint node into `{ name, nameSource, elementType, technology, description }`. It
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
   surfaced in the UI as a small ⚠ (see `fallbackWarningHtml` in `app.js`)
   rather than a full badge — treat this as "extraction probably guessed
   wrong, the container may need a proper text layer."

`splitTechAnnotation(raw)` then splits whatever bracket content was found on
the first `:` — `"Container: Oracle APEX"` → `elementType: "Container"`,
`technology: "Oracle APEX"`; `"Person"` (no colon) → `elementType: "Person"`,
`technology: null`.

If you need to debug a specific container's extraction, click its locate icon (🎯)
in the UI — `focusNode()` in `code.ts` logs the full node subtree as JSON to
the plugin console (Figma → Plugins → Development → Open Console). That JSON
is the fastest way to see why a shape isn't parsing the way you'd expect —
ask for it before guessing at a fix.

## UI (`src/ui/`)

No framework. `app.js` holds all rendering/state logic;
`export-mermaid.js`/`export-likec4.js` hold the two export formats;
`export-shared.js` holds what both of those need. See "Architecture" above
for how these get combined into `dist/ui.html` at build time.

- Sticky header (title, tabs with live counts, search bar) so it stays
  visible while scrolling long lists (some boards have 200+ relations).
- Relations and containers render as cards (`.relation-card` /
  `.container-card`), not plain list rows — deliberate, a flat 3-column row
  layout wrapped badly for long Spanish names (see git history around the UI
  redesign if curious).
- Clicking a relation card (or its locate icons) toggles `#relation-detail`
  open/closed. That panel is a single reused DOM node that gets physically
  moved via `insertAdjacentElement('afterend', ...)` to sit right after the
  *currently selected* card on every render — it does **not** live at a
  fixed position. This was a real bug once: with a long list, appending the
  detail panel at the end of `#relations` made it appear far below the
  clicked row, looking like "nothing happened." Keep this
  find-the-row-then-insert-after pattern if you touch that code.
- Clicking a container card toggles `#container-detail` the same way (same
  reused-node + insert-after pattern). It shows the container's name plus
  two sections, **Outgoing** and **Incoming**, listing every relation where
  the container is the source/target. Each row has a locate icon for the
  connector, and clicking the row itself jumps to that relation in the
  Relations tab (selects the card, scrolls to it, opens its detail).
- Each relation card has **three** separate locate icons: source endpoint,
  target endpoint, and the connector itself (corner button) — each posts
  `focus` with a different id. Don't collapse these into one.
- Search (`matchesSearch`) is accent-insensitive (NFD-normalize + strip
  combining marks) and matches name/description/technology/elementType
  across both containers and (via `findContainer`) the endpoints of each
  relation.
- Export tab toggles between `toMermaidC4()` (`export-mermaid.js`) and
  `toLikeC4Dsl()` (`export-likec4.js`), both built from the same
  `buildIdMap()`/`slugify()` in `export-shared.js` (stable, collision-free
  per-container identifiers reused across both formats).

## Relaunch button (canvas → plugin)

Figma does **not** let plugins add buttons to its native selection toolbar
(the black rounded bar with color/stroke/arrowhead controls that appears
when you select a connector) — that's fully native UI, no API surface for
it. The supported integration point is `node.setRelaunchData()`, which shows
a button in Figma's **properties panel** (FigJam: property menu) when that
node is selected. This plugin uses it:

- `manifest.json` declares two `relaunchButtons`: `view-relation`
  ("View C4 relation") and `view-container` ("View C4 container").
- During extraction (in `extractRelations()`), every connector gets
  `setRelaunchData({ "view-relation": ... })` and both endpoint shapes get
  `setRelaunchData({ "view-container": ... })`, which (re)attaches the
  buttons each time.
- On startup, if `figma.command === "view-relation"` (i.e. launched via that
  button), `getSelectedConnectorId()` reads the connector from
  `figma.currentPage.selection` and that id is threaded through as
  `focusRelationId` in the `relations` message, which `app.js` uses to
  switch to the Relations tab, select the right card, scroll it into view,
  and open its detail panel automatically. `view-container` works the same
  way via `getSelectedContainerId()` → `focusContainerId` → Containers tab.
- While the plugin is **open**, a `figma.on("selectionchange")` listener does
  the live equivalent: selecting a single known container on the canvas
  posts `container-selected` to the UI (see the message table above,
  including the `lastProgrammaticSelectionId` suppression detail).

## Conventions / things that look inconsistent on purpose

- UI copy is English; plugin-side `figma.notify()` messages are Spanish —
  intentional, matches what the user explicitly asked for, not an oversight
  to "fix."
- No test framework is set up. Verification during development has been done
  ad hoc with headless `jsdom` scripts in `/tmp` (install `jsdom` with
  `npm install --no-save jsdom` in a scratch dir, run `npm run build` first,
  load the built `dist/ui.html` with `runScripts: 'dangerously'`, simulate
  `postMessage`/clicks, assert on the resulting DOM) since the UI's script
  isn't covered by `tsc`. Note: in jsdom the top-level window's `parent` is
  the window itself, so overriding `window.parent.postMessage` in
  `beforeParse` also clobbers `window.postMessage` — patch
  `window.postMessage` directly (after load, wrapping the original) if you
  need to observe outgoing messages while still driving the UI with
  incoming ones. Clean up the scratch dir after. There's no persistent test
  suite to run — don't go looking for one.

## Commands

```
npm run build       # esbuild src/code.ts -> dist/code.js, then build-ui.js -> dist/ui.html
npm run build:code  # just the esbuild step
npm run build:ui    # just the UI inline/concat step (scripts/build-ui.js)
npm run watch       # both of the above, in --watch mode, in parallel
npm run typecheck   # tsc --noEmit (src/code.ts only; src/ui/*.js is untyped)
```

Always run `typecheck` (and `build` if `dist/` will be loaded) after
touching `src/code.ts`. Changes under `src/ui/` need `npm run build:ui` (or
`npm run build`) before reloading the plugin in Figma — there is no
build-free path anymore now that the UI is split across multiple files.
