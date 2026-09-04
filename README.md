# FigJam C4 Model Explorer

A FigJam plugin for both directions of a C4 model workflow:

- **Export**: extracts relations (connectors) between shapes on the canvas
  and shows them in a navigable panel, with export to **Mermaid C4** or
  **LikeC4 DSL**.
- **Import**: takes a [LikeC4](https://likec4.dev) JSON export and rebuilds
  it as native FigJam shapes and connectors — same layout, colors, and
  labels LikeC4 computed, but editable on the FigJam canvas.

## Export: FigJam → C4

- Scans the current FigJam page for **connectors** and resolves the shape
  at each end (source/target).
- Extracts each shape's **name**, **C4 element type** (Person, Container,
  Software System, etc.), **technology**, and **description** from the
  shape's text (supports several template formats, see below).
- Shows everything in a panel with four explorer tabs:
  - **Relations**: list of connectors as source → label → target. Clicking
    a relation opens a detail panel (Start/End) for that relation right
    below it. Each endpoint and the connector have their own icon to jump
    to that element on the canvas.
  - **Containers**: list of all resolved shapes, with their type,
    technology, and description. Clicking a container opens a panel with
    **all its outgoing and incoming relations**; each row lets you jump to
    the connector on the canvas or open that relation in the Relations tab.
  - **Landscape**: a flat catalog of the software systems found on the
    board.
  - **Errors**: extraction issues (unattached connectors, self-relations,
    empty labels, malformed boundary labels) with a jump-to-element icon
    for each.
- Three icon buttons next to Refresh open overlay panels on top of the
  explorer tabs:
  - 📥 **Import**: paste/load a LikeC4 JSON export and rebuild it in
    FigJam (see below).
  - 📤 **Export**: generates the diagram as Mermaid C4, LikeC4 DSL, or a
    software-systems-only DSL catalog (toggle), with a copy-to-clipboard
    button.
  - ⚙️ **Settings**: toggle debug logging and whole-file (all pages)
    scanning.
- Search box that filters by name, description, technology, or type, in
  the Relations and Containers tabs.
- With the plugin open, **selecting a shape on the canvas** automatically
  opens that container in the Containers tab with its incoming and
  outgoing relations.
- Selecting a connector on the canvas and using the **"View C4 relation"**
  button (shown in Figma's properties panel) opens the plugin directly on
  that relation's detail. Same for a shape with the **"View C4 container"**
  button, which opens the plugin directly on that container's relations.

### How to structure shapes in FigJam for best results

The plugin tries to extract name / type / technology / description in
several ways, from most to least reliable:

1. **Shape with simple text** (sticky, plain text, shape-with-text): uses
   the text directly as the name.
2. **Semantically named text layers**: if the shape contains text layers
   named `Title`, `Technology`/`Subtitle`, and `Description` (or their
   Spanish equivalents: `Título`, `Tecnología`, `Descripción`), they're used
   directly regardless of which frame they're nested in.
3. **Positional fallback**: if there are no layers named that way, the
   plugin looks for a bracketed annotation (`[Person]`,
   `[Container: Oracle APEX]`, etc.) wherever it appears, and assumes the
   first remaining text is the name and the rest is the description. Works
   with most typical FigJam C4 templates with no extra setup.
4. If no text is found at all, it falls back to the Figma layer name as a
   last resort, and flags it with a ⚠ in the panel (a signal that shape is
   worth reviewing).

The technology inside the brackets can include the type and the technology
separated by `:`, e.g. `[Container: Oracle APEX]` → type `Container`,
technology `Oracle APEX`. Without `:` (`[Person]`, `[Software System]`) it's
used as the type only.

If a shape isn't being extracted the way you expect, click its "go to
element" icon (🎯) in the panel and check the plugin console (**Plugins →
Development → Open Console**): it prints the full node tree as JSON, which
is useful for reporting or debugging the case. Alternatively, select the
shape on the canvas and use **⚙️ Settings → Debug → Dump selected
element** to get the same JSON directly in the panel, with a
copy-to-clipboard button.

## Import: LikeC4 → FigJam

1. Export a view from your LikeC4 project as JSON (this includes the
   computed layout — node positions, sizes, and edge routing):

   ```bash
   npx likec4 export json -o diagram.json
   ```

2. Click the 📥 **Import** icon next to Refresh, load `diagram.json` (or paste its
   contents), pick a view if there's more than one, and click **Import
   into FigJam**.

3. The plugin creates a Section containing a shape per LikeC4 node (color
   and rough icon-shape matched to LikeC4's `color`/`shape`) and a
   connector per relationship (dashed/solid, arrowheads, and label all
   carried over). Both regular architecture views and dynamic (sequence)
   views are supported — a sequence view renders as a UML-style lifeline
   diagram instead of reusing LikeC4's own layout.

### Notes / limitations

- Positions are absolute, taken directly from LikeC4's layout engine, so
  nested/compound elements (systems with children) come through correctly.
- Colors are matched against LikeC4's built-in palette names; unrecognized
  names get a deterministic fallback color instead of all collapsing to one
  default.

## Requirements

- Figma Desktop (to import the plugin in development mode).
- Node.js + npm.

## Install and build

```bash
npm install
npm run build
```

This generates `dist/code.js` from `src/code.ts` and `dist/ui.html` from
the files in `src/ui/` (HTML/CSS/JS split across several files). Figma
loads `dist/ui.html` directly; both build steps are needed because Figma
only supports a single UI file.

## Loading the plugin in Figma

1. Open Figma Desktop, go to **Plugins → Development → Import plugin from
   manifest…**
2. Select this repo's `manifest.json`.
3. Open a FigJam file and run the plugin from **Plugins → Development →
   C4 Model Explorer**.

If you edit `src/code.ts`, any file under `src/import/`, or any file under
`src/ui/`, run `npm run build` and reopen the plugin (close it and open it
again) so it picks up the new files in `dist/`.

## Scripts

```bash
npm run build        # builds src/code.ts -> dist/code.js and src/ui/* -> dist/ui.html
npm run build:code    # esbuild step only
npm run build:ui      # dist/ui.html assembly step only
npm run watch         # both of the above, in watch mode
npm run typecheck     # type checking (tsc --noEmit)
```

## License

MIT — see [LICENSE](LICENSE).
