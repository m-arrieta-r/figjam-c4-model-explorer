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
| plugin → UI | `relations` | `containers`, `relations`, `boundaries`, `skipped`, `focusRelationId`, `focusContainerId` | Extraction result. `focusRelationId` / `focusContainerId` are non-null only when launched via the corresponding relaunch button (see below). |
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

## Boundary detection (System/Container Boundary boxes)

Some boards draw a big box around a cluster of containers — the C4 "System
Boundary" convention — with its own label sitting near the box's
bottom-left corner (e.g. `"Wink [Software System]"`, same
`"Name [Annotation]"` style as container labels). `findContainerBoundary(node,
endpointIds)` in `code.ts` detects this and sets `boundaryId` on each
enclosed `Container`; unique boundaries are collected into
`ExtractResult.boundaries` (`{ id, name, elementType }`).

Two things make this geometric rather than tree-based, unlike the container
text extraction above:

- The box and the container(s) it encloses are **flat siblings**, not
  parent/child — commonly all children of one giant top-level FigJam
  `SECTION` covering the whole board. So detection walks `node.parent.children`
  looking for the smallest sibling (of type `RECTANGLE`/`SHAPE_WITH_TEXT`/
  `FRAME`/`GROUP`/`SECTION`, excluding other connector endpoints via
  `endpointIds`) whose `absoluteBoundingBox` fully contains the container's
  own box (`containsBox`/`boxArea`).
- The box's label usually isn't its own `.text` (the observed case: a
  `SHAPE_WITH_TEXT` with `.text.characters === ""`) — it's a separate `TEXT`
  node, also a flat sibling, positioned near the box's bottom-left corner.
  `findBoundaryLabelText` checks the box's own text first, then falls back to
  the nearest sibling `TEXT` within `CORNER_LABEL_MARGIN_FRACTION` (20%) of
  the box's width/height from that corner. `parseBoundaryLabel` then splits
  `"Name [Annotation]"` the same way `splitTechAnnotation` does for
  containers.

Both exporters group containers by `boundaryId` via `groupByBoundary()`
(`export-shared.js`): Mermaid wraps them in `System_Boundary`/
`Container_Boundary`/`Enterprise_Boundary` (picked from the boundary's
`elementType` in `mermaidBoundaryMacro`, `export-mermaid.js`); LikeC4 nests
them as child elements and references them via dotted qualified ids
(`boundarySlug.containerSlug`) in relationships, since LikeC4 ids are scoped
by nesting (`export-likec4.js`). `buildIdMap()` takes boundaries as a second,
optional argument so boundary and container slugs share one collision-free
namespace.

## UI (`src/ui/`)

No framework. `app.js` holds all rendering/state logic;
`export-mermaid.js`/`export-likec4.js` hold the two export formats;
`export-shared.js` holds what both of those need. See "Architecture" above
for how these get combined into `dist/ui.html` at build time.

- Sticky header (title, tabs with live counts, search bar) so it stays
  visible while scrolling long lists (some boards have 200+ relations).
- The Containers tab has a second row of filter chips (`#type-filter`) that
  split the list by C4 element kind. `containerCategory(c)` in `app.js` maps
  each container to one of `person` / `software-system` / `external-system` /
  `ui` / `backend` / `database` / `container` / `component` / `other`. The
  chip row hides itself when everything falls in a single category, and
  resets to "All" if the active category disappears (e.g. after a search).
  `openContainerInList` switches the active chip when the container it's
  opening would otherwise be filtered out.
  - `person`/`software-system`/`external-system` come from the container's
    `elementType` text (Spanish + English keywords, accent-insensitive) plus
    the shape's `fillColor` (extracted in `code.ts` — first non-near-white
    solid fill in the node subtree, falling back to strokes). A red fill
    (`isRedFill`, hue ≤20° or ≥335° with enough saturation) marks a *software
    system* as external, matching the canvas convention (red = external,
    orange = internal); badge colors mirror that.
  - `ui`/`backend`/`database` exist because this C4 shape kit gives every
    non-Person/System container the same generic `"[Container: ...]"`
    annotation regardless of whether it's a frontend, a service, or a
    database — `elementType` alone can't tell them apart. Instead,
    `extractContainerKind(node)` in `code.ts` looks at the container's own
    direct children (excluding nodes named `"Magnet"`, which are connector
    attachment points, not icon geometry) for the small icon badge this kit
    draws inside each shape: a literal `TEXT` node whose name or content is
    `">_"` → `backend`; otherwise 3+ unnamed `ELLIPSE` children (the
    "traffic-light" browser-window dots) → `ui`; exactly 2 unnamed `ELLIPSE`
    children (the cylinder's top/bottom caps, with `RECTANGLE`s forming the
    body between them) → `database`. This is a per-shape-template heuristic
    confirmed against real node dumps (via the locate-icon + console-log
    workflow below) — if a new shape template doesn't match this exact
    ellipse/rectangle/text layout, `containerKind` comes back `null` and the
    container falls through to keyword-based `container`/`component`/`other`.
    `containerCategory` prefers `containerKind` over keyword matching when
    both are available. Badge text for these three categories shows the
    detected kind label ("UI"/"Backend"/"Database") instead of the
    uninformative raw `"Container"` elementType.
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
- `toLikeC4Dsl()`'s `likeC4KindFor()` maps each container to its LikeC4
  `element` kind via `containerCategory()` (`export-shared.js` — the same
  function the Containers tab's type filter uses), not raw `elementType`
  text. This matters because icon-detected `ui`/`backend`/`database`
  containers and color-detected external systems all carry a generic
  `elementType` (e.g. `"[Container: ...]"`) that can't tell them apart on its
  own — see the categorization writeup above. Any new category added to
  `containerCategory` needs a matching entry in `CATEGORY_TO_LIKEC4_KIND`
  (`export-likec4.js`) or it silently falls back to a camelCased version of
  the raw `elementType`.

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
