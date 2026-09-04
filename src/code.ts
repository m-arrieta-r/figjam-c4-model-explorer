import { extractViews, importView, importSequenceView } from "./import/import";

figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

// Debug mode is off by default and only toggled on from the UI's Settings
// tab; persisted via clientStorage so it survives across plugin re-launches.
let debugMode = false;
const debugModeLoaded: Promise<void> = figma.clientStorage
  .getAsync("debugMode")
  .then((value) => {
    debugMode = value === true;
  });

function debugLog(...args: unknown[]): void {
  if (debugMode) console.log(...args);
}

// Off by default (scans only the current page, same as before this option
// existed); toggled from the UI's Settings tab and persisted the same way as
// debugMode. When on, extraction runs across every page in the file - see
// extractRelationsAllPages.
let scanAllPages = false;
const scanAllPagesLoaded: Promise<void> = figma.clientStorage
  .getAsync("scanAllPages")
  .then((value) => {
    scanAllPages = value === true;
  });

type ContainerKind = "ui" | "backend" | "database" | null;

interface Container {
  id: string;
  name: string;
  nodeType: string;
  labelSource: string;
  elementType: string | null;
  technology: string | null;
  description: string | null;
  fillColor: string | null;
  containerKind: ContainerKind;
  boundaryId: string | null;
}

// A "boundary" is a big box (drawn shape, or a native FigJam Section) that
// visually encloses several containers, with its own label sitting near its
// bottom-left corner - the C4 "System Boundary" convention this shape kit
// draws as a plain sibling shape rather than an actual parent/child nesting.
interface Boundary {
  id: string;
  name: string;
  elementType: string | null;
  // The label text exactly as read off the canvas, before parseBoundaryLabel
  // trims it down to a usable name - kept so callers can flag a label that
  // looks malformed (spans multiple lines, unusually long) without having to
  // re-derive it.
  rawLabel: string;
}

interface Relation {
  id: string;
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  label: string;
  technology: string | null;
  bidirectional: boolean;
}

// A problem found while extracting a connector, surfaced in the UI's Errors
// tab so the user can jump straight to the offending connector on the canvas
// instead of only seeing its symptom (a missing relation, a bogus container).
type IssueKind =
  | "unattached-endpoint"
  | "self-relation"
  | "empty-label"
  | "malformed-boundary-label";

interface Issue {
  id: string;
  // The id of the node the UI's "locate" button should focus - historically
  // always a connector, but a "malformed-boundary-label" issue has no single
  // connector to blame, so this holds the boundary shape's id instead.
  connectorId: string;
  connectorLabel: string;
  kind: IssueKind;
  message: string;
}

interface ExtractResult {
  containers: Container[];
  relations: Relation[];
  boundaries: Boundary[];
  issues: Issue[];
  skipped: number;
}

interface ContainerDetails {
  name: string;
  nameSource: string;
  elementType: string | null;
  technology: string | null;
  description: string | null;
}

// Punctuation-only runs (e.g. "[", "]") are decorative fragments some C4 shape
// libraries use to wrap a "[Technology]" annotation across separate text nodes.
function isMeaningfulText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

interface NamedText {
  nodeName: string;
  text: string;
}

const TITLE_NAME_RE = /^(t[ií]tulo|title|nombre|name)$/i;
const TECH_NAME_RE = /^(tecnolog[ií]a|technology|tech|subt[ií]tulo|subtitle)$/i;
const DESC_NAME_RE = /^(descripci[oó]n|description|desc)$/i;

// Flattens every descendant TEXT node's own layer name + content, regardless
// of how deeply nested or how they're grouped by parent frame. Some C4 shape
// templates label each text layer directly (e.g. "Título", "Tecnología",
// "Descripción") as siblings in the same frame, with no separate subframe per
// role - collectTextGroups alone can't tell those apart.
function collectNamedTexts(node: BaseNode): NamedText[] {
  const result: NamedText[] = [];

  function walk(n: BaseNode) {
    if (!("children" in n)) return;
    (n as ChildrenMixin).children.forEach((c) => {
      if (c.type === "TEXT") {
        const text = c.characters.trim();
        if (text.length > 0) result.push({ nodeName: c.name.trim(), text });
      } else {
        walk(c);
      }
    });
  }

  walk(node);
  return result;
}

function stripBracket(text: string): string {
  return text
    .replace(/^\[\s*/, "")
    .replace(/\s*\]$/, "")
    .trim();
}

// Splits a C4 annotation like "Container: Oracle APEX" into its element type
// ("Container") and concrete technology ("Oracle APEX"). Annotations with no
// colon (e.g. "Person", "Software System") are the element type alone.
function splitTechAnnotation(raw: string | null): {
  elementType: string | null;
  technology: string | null;
} {
  if (!raw) return { elementType: null, technology: null };
  const idx = raw.indexOf(":");
  if (idx === -1) return { elementType: raw.trim() || null, technology: null };
  return {
    elementType: raw.slice(0, idx).trim() || null,
    technology: raw.slice(idx + 1).trim() || null,
  };
}

// Finds the bracket annotation within an ordered list of text runs, e.g.
// "[Software System]" as a single run, or "[" + "Software System" + "]" split
// across separate sibling text nodes. Returns the [start, end] run indices.
function findBracketRun(texts: string[]): [number, number] | null {
  for (let i = 0; i < texts.length; i++) {
    if (!texts[i].startsWith("[")) continue;
    for (let j = i; j < texts.length; j++) {
      if (texts[j].endsWith("]")) return [i, j];
    }
  }
  return null;
}

interface FlatDetails {
  name: string | null;
  elementType: string | null;
  technology: string | null;
  description: string | null;
}

// Positional fallback for shapes whose text layers aren't semantically named
// (e.g. a designer left the default layer name, which Figma sets to the
// text's own content). Works purely off document order: the bracket
// annotation is found and removed wherever it sits, the first remaining
// meaningful text becomes the name, and everything after it becomes the
// description - regardless of how the texts are nested/grouped in frames.
function extractFlatDetails(node: BaseNode): FlatDetails {
  const texts = collectNamedTexts(node).map((t) => t.text);
  if (texts.length === 0) {
    return {
      name: null,
      elementType: null,
      technology: null,
      description: null,
    };
  }

  const bracketRun = findBracketRun(texts);
  let elementType: string | null = null;
  let technology: string | null = null;
  let remaining = texts;

  if (bracketRun) {
    const [start, end] = bracketRun;
    const bracketText = texts.slice(start, end + 1).join(" ");
    const split = splitTechAnnotation(stripBracket(bracketText));
    elementType = split.elementType;
    technology = split.technology;
    remaining = texts.filter((_, idx) => idx < start || idx > end);
  }

  const meaningful = remaining.filter((t) => isMeaningfulText(t));
  const name = meaningful.length > 0 ? meaningful[0] : null;
  const description =
    meaningful.length > 1 ? meaningful.slice(1).join(" ").trim() : null;

  return { name, elementType, technology, description };
}

// Extracts the title, technology (bracketed annotation, e.g. "[Software
// System]" or "[Container: Java, Spring]") and description of a C4 container.
function extractContainerDetails(node: BaseNode | null): ContainerDetails {
  if (!node) {
    return {
      name: "Unknown",
      nameSource: "missing-node",
      elementType: null,
      technology: null,
      description: null,
    };
  }

  // A native FigJam Section is sometimes used as the System Boundary box
  // itself (see BOUNDARY_CANDIDATE_TYPES below), and a relation can
  // legitimately start/end right on its edge - e.g. "the whole system reads
  // feature flags from Redis" - rather than on one specific inner container.
  // A Section can hold dozens of unrelated containers though, so falling
  // through to the generic lookup below (which walks every descendant) would
  // grab the *first* Título/Tecnología/Descripción triplet it stumbles on and
  // mislabel the Section as if it were that unrelated container. Instead,
  // look only at the Section's own direct children for its "Name [Type]"
  // boundary label - the same convention hand-drawn boundary boxes use.
  if (node.type === "SECTION") {
    const ownLabel = node.children.find(
      (c): c is TextNode =>
        c.type === "TEXT" &&
        isMeaningfulText(c.characters) &&
        /\[[^\]]+\]/.test(c.characters),
    );
    if (ownLabel) {
      const { name, elementType } = parseBoundaryLabel(
        ownLabel.characters.trim(),
      );
      return {
        name,
        nameSource: "section-label",
        elementType,
        technology: null,
        description: null,
      };
    }
    return {
      name: node.name,
      nameSource: "node-name-fallback",
      elementType: null,
      technology: null,
      description: null,
    };
  }

  // Simple text-bearing nodes (shape-with-text, sticky, plain text) - use directly.
  const withText = node as unknown as { text?: { characters?: string } };
  if (
    withText.text &&
    typeof withText.text.characters === "string" &&
    withText.text.characters.trim() &&
    isMeaningfulText(withText.text.characters)
  ) {
    return {
      name: withText.text.characters.trim(),
      nameSource: "text-sublayer",
      elementType: null,
      technology: null,
      description: null,
    };
  }
  const withChars = node as unknown as { characters?: string };
  if (
    typeof withChars.characters === "string" &&
    withChars.characters.trim() &&
    isMeaningfulText(withChars.characters)
  ) {
    return {
      name: withChars.characters.trim(),
      nameSource: "characters",
      elementType: null,
      technology: null,
      description: null,
    };
  }

  // Shapes that label each text layer directly (e.g. "Título", "Tecnología",
  // "Descripción" as sibling TEXT nodes with no dedicated subframe per role).
  const namedTexts = collectNamedTexts(node);
  const namedTitle = namedTexts.find((t) => TITLE_NAME_RE.test(t.nodeName));
  if (namedTitle) {
    const namedTech = namedTexts.find((t) => TECH_NAME_RE.test(t.nodeName));
    const namedDesc = namedTexts.find((t) => DESC_NAME_RE.test(t.nodeName));
    const { elementType, technology } = splitTechAnnotation(
      namedTech ? stripBracket(namedTech.text) : null,
    );
    return {
      name: namedTitle.text,
      nameSource: "named-text-node",
      elementType,
      technology,
      description: namedDesc ? namedDesc.text : null,
    };
  }

  // Fallback for shapes whose text layers aren't semantically named: work off
  // document order instead (bracket annotation anywhere, then name, then
  // description - see extractFlatDetails).
  const flat = extractFlatDetails(node);
  if (flat.name) {
    return {
      name: flat.name,
      nameSource: "descendant-text",
      elementType: flat.elementType,
      technology: flat.technology,
      description: flat.description,
    };
  }

  return {
    name: node.name,
    nameSource: "node-name-fallback",
    elementType: flat.elementType,
    technology: flat.technology,
    description: flat.description,
  };
}

// Figma/FigJam's own default layer names for shapes nobody ever typed a
// label into. extractContainerDetails's last resort (node.name) can't tell
// "this was actually named X" apart from "this is an empty shape that
// happens to be named Rectangle" - so a connector landing on one of these
// exports a container whose name is just a stray shape's default name.
const GENERIC_DEFAULT_NAMES = new Set([
  "Rectangle",
  "Ellipse",
  "Frame",
  "Group",
  "Section",
  "Shape with text",
  "Sticky",
  "Sticky note",
  "Text",
  "Line",
  "Arrow",
  "Star",
  "Polygon",
  "Slice",
]);

function isUnlabeledFallback(details: ContainerDetails): boolean {
  return (
    details.nameSource === "node-name-fallback" &&
    GENERIC_DEFAULT_NAMES.has(details.name)
  );
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}

// First visible, non-near-white solid paint in a fills/strokes array.
// Near-white fills are card backgrounds, not the C4 accent color that
// distinguishes element kinds (e.g. red external system vs orange internal).
function firstSolidHex(paints: unknown): string | null {
  if (!Array.isArray(paints)) return null;
  for (const paint of paints as Paint[]) {
    if (paint.type !== "SOLID" || paint.visible === false) continue;
    if ((paint.opacity !== undefined ? paint.opacity : 1) < 0.05) continue;
    const { r, g, b } = paint.color;
    if (r > 0.95 && g > 0.95 && b > 0.95) continue;
    return rgbToHex(r, g, b);
  }
  return null;
}

function findPaintHex(node: BaseNode, prop: "fills" | "strokes"): string | null {
  if (node.type === "TEXT") return null;
  const own = firstSolidHex(
    (node as unknown as Record<string, unknown>)[prop],
  );
  if (own) return own;
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      const hex = findPaintHex(child, prop);
      if (hex) return hex;
    }
  }
  return null;
}

// The shape's dominant color: first meaningful fill anywhere in the subtree,
// falling back to strokes (for outline-only shapes). Used by the UI to tell
// C4 variants apart that share the same bracket annotation - e.g. external
// software systems (red) vs internal ones (orange).
function extractFillColor(node: BaseNode | null): string | null {
  if (!node) return null;
  const byFill = findPaintHex(node, "fills");
  return byFill !== null ? byFill : findPaintHex(node, "strokes");
}

// Detects the small icon badge this C4 shape kit draws inside a container's
// own direct children, distinguishing UI/backend/database containers that
// all carry the same "[Container: ...]" annotation and so look identical by
// text alone: a row of unnamed ELLIPSE nodes forming a "traffic light"
// browser icon (UI), a literal ">_" TEXT glyph (backend/service), or a
// top+bottom ELLIPSE pair with RECTANGLE nodes between them forming a
// cylinder body (database). "Magnet" nodes are connector attachment points,
// not icon geometry, and are excluded before counting.
function extractContainerKind(node: BaseNode | null): ContainerKind {
  if (!node || !("children" in node)) return null;
  const children = (node as ChildrenMixin).children.filter(
    (c) => c.name !== "Magnet",
  );

  const hasBackendMarker = children.some(
    (c) =>
      c.type === "TEXT" &&
      (c.name.trim() === ">_" || c.characters.trim() === ">_"),
  );
  if (hasBackendMarker) return "backend";

  const ellipseCount = children.filter((c) => c.type === "ELLIPSE").length;
  if (ellipseCount >= 3) return "ui";
  if (ellipseCount === 2) return "database";
  return null;
}

// Node types this shape kit draws boundary boxes as. FRAME/GROUP/SECTION are
// included for native FigJam sections and auto-layout wrappers; RECTANGLE and
// SHAPE_WITH_TEXT cover a hand-drawn box (the observed case: a big
// SHAPE_WITH_TEXT with its own .text left empty, boundary label floating
// beside it as a separate sibling TEXT node - see findBoundaryLabelText).
const BOUNDARY_CANDIDATE_TYPES = new Set([
  "RECTANGLE",
  "SHAPE_WITH_TEXT",
  "FRAME",
  "GROUP",
  "SECTION",
]);

// Fraction of the boundary box's own width/height a label is allowed to sit
// away from the bottom-left corner and still count as "in that corner"
// (observed case: label ~0.5% of width from the left edge, ~1.7% of height
// above the bottom edge - this tolerance is deliberately generous since box
// sizes vary a lot across boards).
const CORNER_LABEL_MARGIN_FRACTION = 0.2;

function containsBox(outer: Rect, inner: Rect): boolean {
  const epsilon = 0.5;
  return (
    inner.x >= outer.x - epsilon &&
    inner.y >= outer.y - epsilon &&
    inner.x + inner.width <= outer.x + outer.width + epsilon &&
    inner.y + inner.height <= outer.y + outer.height + epsilon
  );
}

function boxArea(box: Rect): number {
  return box.width * box.height;
}

// Splits a boundary label like "Wink [Software System]" into its display
// name and element type, mirroring splitTechAnnotation's "Name [Annotation]"
// convention for container shapes - the same shape kit uses the same bracket
// style for boundary labels. Unlike a plain container's card, a boundary
// label is sometimes typed as a full multi-line "Name\n[Type]\nDescription"
// block (the same layout a container card uses) rather than a single "Name
// [Type]" line, so the bracket isn't necessarily the last thing in the
// string - looking for it anywhere (like findBracketRun/splitTechAnnotation
// already do for containers) instead of anchoring to the end keeps that case
// from swallowing the whole raw blob as the name (see isMalformedBoundaryLabel
// for surfacing that blob as an issue when it still looks off).
function parseBoundaryLabel(raw: string): {
  name: string;
  elementType: string | null;
} {
  const trimmed = raw.trim();
  const bracketMatch = trimmed.match(/\[([^\]]+)\]/);
  if (!bracketMatch || bracketMatch.index === undefined) {
    const firstLine = trimmed.split("\n")[0].trim();
    return { name: firstLine || trimmed, elementType: null };
  }
  const before = trimmed.slice(0, bracketMatch.index);
  const { elementType } = splitTechAnnotation(bracketMatch[1].trim());
  const namePart = before.split("\n")[0].trim();
  return { name: namePart || trimmed.split("\n")[0].trim(), elementType };
}

// A boundary label is normally a short "Name [Type]" line. Anything spanning
// multiple lines, or unusually long, is a sign the shape's text field is
// mixing in content that belongs to a nested container (or a duplicated
// paste) rather than a clean boundary tag - see the malformed-boundary-label
// issue this feeds into.
const MALFORMED_BOUNDARY_LABEL_LENGTH = 80;
function isMalformedBoundaryLabel(raw: string): boolean {
  const trimmed = raw.trim();
  return (
    trimmed.includes("\n") || trimmed.length > MALFORMED_BOUNDARY_LABEL_LENGTH
  );
}

// A boundary box's label is either its own text (a SHAPE_WITH_TEXT/sticky
// whose .text isn't empty) or, more commonly, a separate TEXT node floating
// near its bottom-left corner among its siblings (not nested inside it) -
// see the "Wink [Software System]" example this heuristic was built from.
function findBoundaryLabelText(
  shape: SceneNode,
  shapeBox: Rect,
  siblings: readonly SceneNode[],
): string | null {
  const withText = shape as unknown as { text?: { characters?: string } };
  if (
    withText.text &&
    typeof withText.text.characters === "string" &&
    withText.text.characters.trim() &&
    isMeaningfulText(withText.text.characters)
  ) {
    return withText.text.characters.trim();
  }

  const cornerX = shapeBox.x;
  const cornerY = shapeBox.y + shapeBox.height;
  const marginX = shapeBox.width * CORNER_LABEL_MARGIN_FRACTION;
  const marginY = shapeBox.height * CORNER_LABEL_MARGIN_FRACTION;

  let best: { text: string; dist: number } | null = null;
  for (const sibling of siblings) {
    if (sibling.id === shape.id || sibling.type !== "TEXT") continue;
    const text = sibling as TextNode;
    const characters = text.characters.trim();
    if (!characters || !isMeaningfulText(characters)) continue;
    const box = text.absoluteBoundingBox;
    if (!box) continue;
    const textBottom = box.y + box.height;
    if (box.x < cornerX - marginX || box.x > cornerX + marginX) continue;
    if (textBottom < cornerY - marginY || textBottom > cornerY + marginY)
      continue;
    const dist = Math.abs(box.x - cornerX) + Math.abs(textBottom - cornerY);
    if (!best || dist < best.dist) best = { text: characters, dist };
  }

  return best ? best.text : null;
}

// Finds the smallest labeled boundary candidate among a set of siblings that
// geometrically encloses containerBox, excluding other connector endpoints.
function bestBoundaryAt(
  siblings: readonly SceneNode[],
  excludeId: string,
  containerBox: Rect,
  endpointIds: Set<string>,
): { shape: SceneNode; box: Rect } | null {
  let best: { shape: SceneNode; box: Rect } | null = null;
  for (const sibling of siblings) {
    if (sibling.id === excludeId) continue;
    if (!BOUNDARY_CANDIDATE_TYPES.has(sibling.type)) continue;
    if (endpointIds.has(sibling.id)) continue;
    const box = (sibling as SceneNode).absoluteBoundingBox;
    if (!box) continue;
    if (boxArea(box) <= boxArea(containerBox)) continue;
    if (!containsBox(box, containerBox)) continue;
    if (!best || boxArea(box) < boxArea(best.box)) best = { shape: sibling, box };
  }
  return best;
}

// Finds the boundary box (if any) that geometrically encloses a container:
// the smallest shape (not another connector endpoint) whose bounding box
// fully contains the container's own bounding box. Boxes and containers
// aren't necessarily direct siblings in the layer tree - a board may have
// some containers grouped together (e.g. a manual Ctrl+G) while others sit
// loose directly under the same top-level FigJam Section as the boundary box
// itself, so a container can be nested one or more GROUP/FRAME levels deeper
// than the box that visually encloses it. This climbs the ancestor chain -
// checking each level's siblings in turn against the *original* container's
// absolute box (unaffected by how deep it's nested) - stopping at the first
// level that yields a labeled match, or at the page if none do.
function findContainerBoundary(
  node: BaseNode | null,
  endpointIds: Set<string>,
): Boundary | null {
  if (!node || !("absoluteBoundingBox" in node)) return null;
  const containerBox = (node as SceneNode).absoluteBoundingBox;
  if (!containerBox) return null;

  let currentId: string = node.id;
  let ancestor: (BaseNode & ChildrenMixin) | null = node.parent;
  while (ancestor) {
    const siblings: readonly SceneNode[] = ancestor.children;
    const best = bestBoundaryAt(siblings, currentId, containerBox, endpointIds);
    if (best) {
      const labelText = findBoundaryLabelText(best.shape, best.box, siblings);
      if (labelText) {
        const { name, elementType } = parseBoundaryLabel(labelText);
        return { id: best.shape.id, name, elementType, rawLabel: labelText };
      }
    }
    if (ancestor.type === "PAGE") break;
    currentId = ancestor.id;
    ancestor = ancestor.parent;
  }
  return null;
}

// Container ids from the last extraction. Used by the selectionchange
// listener to tell "user selected a C4 container on the canvas" apart from
// selecting any other random node.
let knownContainerIds = new Set<string>();

// FigJam connectors don't carry an explicit "direction" property — direction
// is implied by which end(s) have an arrowhead (stroke cap). A plain "NONE"
// cap means that end has no arrowhead.
function hasArrowhead(cap: ConnectorStrokeCap): boolean {
  return cap !== "NONE";
}

function connectorLabelFor(connector: ConnectorNode): string {
  const text =
    connector.text && connector.text.characters
      ? connector.text.characters.trim().replace(/\s+/g, " ")
      : "";
  return text || connector.name.trim() || "(no label)";
}

// Scans a single page for connectors and resolves them into containers,
// boundaries and relations. Factored out from extractRelations (which just
// calls this with figma.currentPage) so extractRelationsAllPages can run the
// exact same resolution logic over every page in the file - see below.
function extractRelationsForPage(page: PageNode): ExtractResult {
  const connectors = page.findAllWithCriteria({
    types: ["CONNECTOR"],
  });
  const containerMap = new Map<string, Container>();
  const boundaryMap = new Map<string, Boundary>();
  const relations: Relation[] = [];
  const issues: Issue[] = [];
  let skipped = 0;

  // Every connector endpoint is a known container - collected up front so
  // findContainerBoundary can tell "a boundary box" apart from "another
  // container that happens to be nearby," regardless of which endpoint gets
  // processed (and thus resolved into containerMap) first.
  const endpointIds = new Set<string>();
  for (const connector of connectors) {
    const start = connector.connectorStart;
    const end = connector.connectorEnd;
    if (start && "endpointNodeId" in start) endpointIds.add(start.endpointNodeId);
    if (end && "endpointNodeId" in end) endpointIds.add(end.endpointNodeId);
  }

  debugLog(
    `[extract-c4] found ${connectors.length} connector(s) on page "${page.name}"`,
  );

  for (const connector of connectors) {
    const start = connector.connectorStart;
    const end = connector.connectorEnd;

    if (
      !start ||
      !end ||
      !("endpointNodeId" in start) ||
      !("endpointNodeId" in end)
    ) {
      skipped++;
      issues.push({
        id: `${connector.id}-unattached`,
        connectorId: connector.id,
        connectorLabel: connectorLabelFor(connector),
        kind: "unattached-endpoint",
        message:
          "This connector isn't attached to a shape on one of its ends.",
      });
      debugLog(
        `[extract-c4] skipping connector ${connector.id}: not attached to a node on both ends`,
      );
      continue;
    }

    // Default assumption is start -> end, but a connector drawn "backwards"
    // (arrowhead only on the start endpoint) actually points end -> start,
    // and a connector with arrowheads on both ends is bidirectional.
    const startHasArrow = hasArrowhead(connector.connectorStartStrokeCap);
    const endHasArrow = hasArrowhead(connector.connectorEndStrokeCap);
    const reversed = startHasArrow && !endHasArrow;
    const bidirectional = startHasArrow && endHasArrow;

    const sourceId = reversed ? end.endpointNodeId : start.endpointNodeId;
    const targetId = reversed ? start.endpointNodeId : end.endpointNodeId;

    // A connector whose two ends both resolve to the same shape (usually a
    // stray connector dragged onto the same sticky by accident) can't be
    // expressed as a LikeC4 relationship - it forbids an element relating to
    // itself. Surface it instead of silently exporting the invalid pair.
    if (sourceId === targetId) {
      skipped++;
      issues.push({
        id: `${connector.id}-self-relation`,
        connectorId: connector.id,
        connectorLabel: connectorLabelFor(connector),
        kind: "self-relation",
        message:
          "This connector starts and ends on the same shape - it can't be exported as a relationship.",
      });
      debugLog(
        `[extract-c4] skipping connector ${connector.id}: source and target both resolve to node #${sourceId}`,
      );
      continue;
    }

    const sourceNode = figma.getNodeById(sourceId);
    const targetNode = figma.getNodeById(targetId);

    const sourceDetails = extractContainerDetails(sourceNode);
    const targetDetails = extractContainerDetails(targetNode);

    debugLog(
      `[extract-c4] connector ${connector.id}: ` +
        `${sourceNode?.type ?? "null"}#${sourceId} "${sourceDetails.name}" (${sourceDetails.nameSource}) -> ` +
        `${targetNode?.type ?? "null"}#${targetId} "${targetDetails.name}" (${targetDetails.nameSource})` +
        (reversed ? " [reversed arrowhead]" : "") +
        (bidirectional ? " [bidirectional]" : ""),
    );

    // A shape nobody ever typed a title into falls back to Figma's own
    // default layer name (e.g. "Shape with text") - flag it so the user
    // notices instead of finding a nonsense element in the exported model.
    if (isUnlabeledFallback(sourceDetails)) {
      issues.push({
        id: `${connector.id}-empty-label-source`,
        connectorId: connector.id,
        connectorLabel: connectorLabelFor(connector),
        kind: "empty-label",
        message: `This connector's start shape has no title text - it will export as "${sourceDetails.name}" (Figma's default layer name). Add a title on the shape.`,
      });
    }
    if (isUnlabeledFallback(targetDetails)) {
      issues.push({
        id: `${connector.id}-empty-label-target`,
        connectorId: connector.id,
        connectorLabel: connectorLabelFor(connector),
        kind: "empty-label",
        message: `This connector's end shape has no title text - it will export as "${targetDetails.name}" (Figma's default layer name). Add a title on the shape.`,
      });
    }

    if (!containerMap.has(sourceId)) {
      const sourceBoundary = findContainerBoundary(sourceNode, endpointIds);
      if (sourceBoundary && !boundaryMap.has(sourceBoundary.id)) {
        boundaryMap.set(sourceBoundary.id, sourceBoundary);
        if (isMalformedBoundaryLabel(sourceBoundary.rawLabel)) {
          issues.push({
            id: `${sourceBoundary.id}-malformed-boundary-label`,
            connectorId: sourceBoundary.id,
            connectorLabel: sourceBoundary.name.slice(0, 60),
            kind: "malformed-boundary-label",
            message:
              "This boundary's label spans multiple lines or is unusually long - check its text on the canvas, it may be mixing in a nested container's own title/description.",
          });
        }
      }
      containerMap.set(sourceId, {
        id: sourceId,
        name: sourceDetails.name,
        nodeType: sourceNode?.type ?? "unknown",
        labelSource: sourceDetails.nameSource,
        elementType: sourceDetails.elementType,
        technology: sourceDetails.technology,
        description: sourceDetails.description,
        fillColor: extractFillColor(sourceNode),
        containerKind: extractContainerKind(sourceNode),
        boundaryId: sourceBoundary ? sourceBoundary.id : null,
      });
    }
    if (!containerMap.has(targetId)) {
      const targetBoundary = findContainerBoundary(targetNode, endpointIds);
      if (targetBoundary && !boundaryMap.has(targetBoundary.id)) {
        boundaryMap.set(targetBoundary.id, targetBoundary);
        if (isMalformedBoundaryLabel(targetBoundary.rawLabel)) {
          issues.push({
            id: `${targetBoundary.id}-malformed-boundary-label`,
            connectorId: targetBoundary.id,
            connectorLabel: targetBoundary.name.slice(0, 60),
            kind: "malformed-boundary-label",
            message:
              "This boundary's label spans multiple lines or is unusually long - check its text on the canvas, it may be mixing in a nested container's own title/description.",
          });
        }
      }
      containerMap.set(targetId, {
        id: targetId,
        name: targetDetails.name,
        nodeType: targetNode?.type ?? "unknown",
        labelSource: targetDetails.nameSource,
        elementType: targetDetails.elementType,
        technology: targetDetails.technology,
        description: targetDetails.description,
        fillColor: extractFillColor(targetNode),
        containerKind: extractContainerKind(targetNode),
        boundaryId: targetBoundary ? targetBoundary.id : null,
      });
    }

    // Same relaunch integration as connectors (see below), but for the
    // containers themselves: selecting the shape on the canvas shows a
    // "view-container" button in Figma's property panel that opens the
    // plugin straight into that container's relations.
    for (const endpointNode of [sourceNode, targetNode]) {
      if (endpointNode && "setRelaunchData" in endpointNode) {
        endpointNode.setRelaunchData({
          "view-container": "View this container's relations in the C4 panel",
        });
      }
    }

    const rawLabel =
      connector.text && connector.text.characters
        ? connector.text.characters.trim()
        : "";
    // Extract [technology] bracket from anywhere in the label (handles multiline too)
    const bracketMatch = rawLabel.match(/\[([^\]]+)\]/);
    let relationTechnology: string | null = null;
    let label = rawLabel;
    if (bracketMatch) {
      relationTechnology = bracketMatch[1].trim() || null;
      label = rawLabel.replace(bracketMatch[0], "");
    }
    // A FigJam connector label wraps across multiple visual lines far more
    // often than it carries a [technology] annotation - collapse embedded
    // newlines/runs of whitespace into single spaces either way, not just on
    // the branch above, or a wrapped label (the common case) ends up in the
    // exported DSL/Mermaid as a literal multi-line string.
    label = label.replace(/\s+/g, " ").trim();

    relations.push({
      id: connector.id,
      source: sourceId,
      target: targetId,
      sourceName: sourceDetails.name,
      targetName: targetDetails.name,
      label,
      technology: relationTechnology,
      bidirectional,
    });

    // Lets the user select this connector on the canvas and relaunch the
    // plugin straight into that relation's detail panel (see figma.command
    // handling in runExtraction/figma.ui.onmessage below).
    connector.setRelaunchData({
      "view-relation": "View this relation's detail in the C4 panel",
    });
  }

  const containers: Container[] = Array.from(containerMap.values());
  const boundaries: Boundary[] = Array.from(boundaryMap.values());
  debugLog(
    `[extract-c4] resolved ${containers.length} container(s), ` +
      `${boundaries.length} boundary(ies), skipped ${skipped} connector(s) on page "${page.name}"`,
    containers,
    boundaries,
  );
  return { containers, relations, boundaries, issues, skipped };
}

function extractRelations(): ExtractResult {
  return extractRelationsForPage(figma.currentPage);
}

// Whole-file scan: resolves every page instead of just the current one, so a
// board that only references another system with a plain placeholder box
// (drawn on a different page, where it's actually decomposed into
// containers) doesn't need a separate manual merge step afterwards - see
// mergeAcrossPages in export-shared.js, which the UI runs over this
// function's combined-but-not-yet-deduplicated result.
async function extractRelationsAllPages(): Promise<ExtractResult> {
  await figma.loadAllPagesAsync();
  const containers: Container[] = [];
  const relations: Relation[] = [];
  const boundaries: Boundary[] = [];
  const issues: Issue[] = [];
  let skipped = 0;
  for (const page of figma.root.children) {
    const result = extractRelationsForPage(page);
    containers.push(...result.containers);
    relations.push(...result.relations);
    boundaries.push(...result.boundaries);
    issues.push(...result.issues);
    skipped += result.skipped;
  }
  debugLog(
    `[extract-c4] whole-file scan: ${figma.root.children.length} page(s), ` +
      `${containers.length} raw container(s) before cross-page merge`,
  );
  return { containers, relations, boundaries, issues, skipped };
}

function getSelectedConnectorId(): string | null {
  const connector = figma.currentPage.selection.find(
    (n) => n.type === "CONNECTOR",
  );
  return connector ? connector.id : null;
}

function getSelectedContainerId(): string | null {
  const node = figma.currentPage.selection.find((n) => n.type !== "CONNECTOR");
  return node ? node.id : null;
}

async function runExtraction(
  focusRelationId: string | null = null,
  focusContainerId: string | null = null,
) {
  const result = scanAllPages
    ? await extractRelationsAllPages()
    : extractRelations();
  knownContainerIds = new Set(result.containers.map((c) => c.id));
  figma.ui.postMessage({
    type: "relations",
    ...result,
    scope: scanAllPages ? "all-pages" : "current-page",
    focusRelationId,
    focusContainerId,
  });
}

interface ResolvedEndpointRef {
  id: string;
  type: string;
  name: string;
}

interface EndpointSummary {
  endpointNodeId?: string;
  magnet?: string;
  position?: { x: number; y: number };
  resolvedNode?: ResolvedEndpointRef | null;
}

interface PaintSummary {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a: number };
}

interface NodeSummary {
  id: string;
  type: string;
  name: string;
  visible?: boolean;
  removed?: boolean;
  characters?: string;
  childCount?: number;
  children?: NodeSummary[];
  connectorStart?: EndpointSummary;
  connectorEnd?: EndpointSummary;

  // Geometry
  x?: number;
  y?: number;
  width?: number;
  height?: number;

  // Style
  fills?: PaintSummary[] | "mixed";
  strokes?: PaintSummary[] | "mixed";
  strokeWeight?: number | "mixed";
  opacity?: number;

  // FRAME / RECTANGLE
  cornerRadius?: number | "mixed";
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;
  clipsContent?: boolean;
  layoutMode?: string;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  itemSpacing?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;

  // TEXT
  fontName?: { family: string; style: string } | "mixed";
  fontSize?: number | "mixed";
  lineHeight?: unknown;
  letterSpacing?: unknown;
  textAlignHorizontal?: string;
  textAutoResize?: string;
}

function serializePaints(
  paints: readonly Paint[] | typeof figma.mixed | undefined,
): PaintSummary[] | "mixed" | undefined {
  if (paints === undefined) return undefined;
  if (paints === figma.mixed) return "mixed";
  return paints.map((paint) => {
    const summary: PaintSummary = {
      type: paint.type,
      visible: paint.visible,
      opacity: paint.opacity,
    };
    if (paint.type === "SOLID") {
      summary.color = {
        r: paint.color.r,
        g: paint.color.g,
        b: paint.color.b,
        a: paint.opacity ?? 1,
      };
    }
    return summary;
  });
}

function summarizeEndpoint(
  endpoint: ConnectorEndpoint | null,
): EndpointSummary | undefined {
  if (!endpoint) return undefined;

  const summary: EndpointSummary = {};

  if ("endpointNodeId" in endpoint) {
    summary.endpointNodeId = endpoint.endpointNodeId;
    const resolved = figma.getNodeById(endpoint.endpointNodeId);
    summary.resolvedNode = resolved
      ? { id: resolved.id, type: resolved.type, name: resolved.name }
      : null;
  }
  if ("magnet" in endpoint) {
    summary.magnet = endpoint.magnet;
  }
  if ("position" in endpoint) {
    summary.position = endpoint.position;
  }

  return summary;
}

function summarizeNode(node: BaseNode, depth = 4): NodeSummary {
  const summary: NodeSummary = {
    id: node.id,
    type: node.type,
    name: node.name,
  };

  if ("visible" in node) summary.visible = (node as SceneNode).visible;
  if ("removed" in node) summary.removed = (node as SceneNode).removed;

  // Geometry
  const withLayout = node as unknown as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
  if (typeof withLayout.x === "number") summary.x = withLayout.x;
  if (typeof withLayout.y === "number") summary.y = withLayout.y;
  if (typeof withLayout.width === "number") summary.width = withLayout.width;
  if (typeof withLayout.height === "number")
    summary.height = withLayout.height;

  // Fills / strokes
  const withPaints = node as unknown as {
    fills?: readonly Paint[] | typeof figma.mixed;
    strokes?: readonly Paint[] | typeof figma.mixed;
    strokeWeight?: number | typeof figma.mixed;
    opacity?: number;
  };
  if ("fills" in node) summary.fills = serializePaints(withPaints.fills);
  if ("strokes" in node) summary.strokes = serializePaints(withPaints.strokes);
  if ("strokeWeight" in node) {
    summary.strokeWeight =
      withPaints.strokeWeight === figma.mixed
        ? "mixed"
        : (withPaints.strokeWeight as number | undefined);
  }
  if ("opacity" in node) summary.opacity = withPaints.opacity;

  // FRAME / RECTANGLE corner radius + auto layout
  const withCorner = node as unknown as {
    cornerRadius?: number | typeof figma.mixed;
    topLeftRadius?: number;
    topRightRadius?: number;
    bottomLeftRadius?: number;
    bottomRightRadius?: number;
    clipsContent?: boolean;
    layoutMode?: string;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    itemSpacing?: number;
    primaryAxisAlignItems?: string;
    counterAxisAlignItems?: string;
  };
  if ("cornerRadius" in node) {
    summary.cornerRadius =
      withCorner.cornerRadius === figma.mixed
        ? "mixed"
        : (withCorner.cornerRadius as number | undefined);
    if (summary.cornerRadius === "mixed") {
      summary.topLeftRadius = withCorner.topLeftRadius;
      summary.topRightRadius = withCorner.topRightRadius;
      summary.bottomLeftRadius = withCorner.bottomLeftRadius;
      summary.bottomRightRadius = withCorner.bottomRightRadius;
    }
  }
  if ("clipsContent" in node) summary.clipsContent = withCorner.clipsContent;
  if ("layoutMode" in node && withCorner.layoutMode !== "NONE") {
    summary.layoutMode = withCorner.layoutMode;
    summary.paddingTop = withCorner.paddingTop;
    summary.paddingBottom = withCorner.paddingBottom;
    summary.paddingLeft = withCorner.paddingLeft;
    summary.paddingRight = withCorner.paddingRight;
    summary.itemSpacing = withCorner.itemSpacing;
    summary.primaryAxisAlignItems = withCorner.primaryAxisAlignItems;
    summary.counterAxisAlignItems = withCorner.counterAxisAlignItems;
  }

  // TEXT properties
  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    summary.fontName =
      textNode.fontName === figma.mixed
        ? "mixed"
        : (textNode.fontName as { family: string; style: string });
    summary.fontSize =
      textNode.fontSize === figma.mixed
        ? "mixed"
        : (textNode.fontSize as number);
    summary.lineHeight = textNode.lineHeight;
    summary.letterSpacing = textNode.letterSpacing;
    summary.textAlignHorizontal = textNode.textAlignHorizontal;
    summary.textAutoResize = textNode.textAutoResize;
  }

  const withText = node as unknown as { text?: { characters?: string } };
  if (withText.text && typeof withText.text.characters === "string") {
    summary.characters = withText.text.characters;
  }
  const withChars = node as unknown as { characters?: string };
  if (typeof withChars.characters === "string") {
    summary.characters = withChars.characters;
  }

  if (node.type === "CONNECTOR") {
    const connector = node as ConnectorNode;
    summary.connectorStart = summarizeEndpoint(connector.connectorStart);
    summary.connectorEnd = summarizeEndpoint(connector.connectorEnd);
  }

  if ("children" in node) {
    const children = (node as ChildrenMixin).children;
    summary.childCount = children.length;
    if (depth > 0) {
      summary.children = children.map((child) =>
        summarizeNode(child, depth - 1),
      );
    }
  }

  return summary;
}

// Set by focusNode right before it changes the canvas selection, so the
// selectionchange listener can tell our own programmatic selection apart
// from the user actually clicking a shape (and not bounce the UI around).
let lastProgrammaticSelectionId: string | null = null;

figma.on("selectionchange", () => {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) return;
  const id = selection[0].id;
  if (id === lastProgrammaticSelectionId) {
    lastProgrammaticSelectionId = null;
    return;
  }
  if (knownContainerIds.has(id)) {
    figma.ui.postMessage({ type: "container-selected", id });
  }
});

function focusNode(id: string) {
  const node = figma.getNodeById(id);

  if (node) {
    debugLog(
      `[extract-c4] focusNode(${id}) tree (copy this to debug the label extraction):\n` +
        JSON.stringify(summarizeNode(node), null, 2),
    );
  } else {
    debugLog(`[extract-c4] focusNode(${id}): getNodeById returned null`);
  }

  if (!node) {
    console.warn(
      `[extract-c4] focusNode(${id}): getNodeById returned null (node was likely deleted)`,
    );
    figma.notify(
      "No se pudo encontrar ese elemento (puede que haya sido borrado).",
    );
    return;
  }

  if (!("visible" in node)) {
    console.warn(
      `[extract-c4] focusNode(${id}): node type "${node.type}" is not a SceneNode, cannot select/zoom`,
    );
    figma.notify(
      "Ese elemento no se puede seleccionar (tipo: " + node.type + ").",
    );
    return;
  }

  const sceneNode = node as SceneNode;
  const removed = "removed" in sceneNode ? sceneNode.removed : undefined;
  const page = sceneNode.parent ? findPage(sceneNode) : null;

  debugLog("[extract-c4] focusNode resolved node", {
    id: sceneNode.id,
    type: sceneNode.type,
    name: sceneNode.name,
    removed,
    page: page ? { id: page.id, name: page.name } : null,
    currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
  });

  if (removed) {
    console.warn(
      `[extract-c4] focusNode(${id}): node.removed === true, it no longer exists on the canvas`,
    );
    figma.notify("Ese elemento fue eliminado del lienzo.");
    return;
  }

  try {
    if (page && page.id !== figma.currentPage.id) {
      debugLog(
        `[extract-c4] focusNode(${id}): node lives on a different page ("${page.name}"), switching`,
      );
      figma.currentPage = page;
    }
    lastProgrammaticSelectionId = sceneNode.id;
    figma.currentPage.selection = [sceneNode];
    figma.viewport.scrollAndZoomIntoView([sceneNode]);
  } catch (err) {
    console.error(`[extract-c4] focusNode(${id}): failed to select/zoom`, err);
    figma.notify(
      "No se pudo enfocar ese elemento. Revisa la consola para más detalle.",
    );
  }
}

function findPage(node: BaseNode): PageNode | null {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current as PageNode;
    current = current.parent;
  }
  return null;
}

figma.ui.onmessage = async (
  msg: {
    type: string;
    id?: string;
    enabled?: boolean;
    text?: string;
    viewId?: string;
  },
) => {
  if (msg.type === "parse" && msg.text) {
    try {
      const views = extractViews(JSON.parse(msg.text));
      const options = Object.entries(views).map(([key, v]) => ({
        id: key,
        title: v.title || key,
        nodeCount: v.nodes.length,
      }));
      figma.ui.postMessage({ type: "parsed", options });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "error", message });
    }
    return;
  }
  if (msg.type === "import" && msg.text && msg.viewId) {
    try {
      const views = extractViews(JSON.parse(msg.text));
      const view = views[msg.viewId];
      if (!view) {
        throw new Error(`View "${msg.viewId}" not found in the pasted JSON.`);
      }
      const result =
        view.variant === "sequence"
          ? await importSequenceView(view)
          : await importView(view);
      figma.ui.postMessage({ type: "imported", ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      figma.ui.postMessage({ type: "error", message });
    }
    return;
  }
  if (msg.type === "ui-ready") {
    await Promise.all([debugModeLoaded, scanAllPagesLoaded]);
    figma.ui.postMessage({ type: "settings", debugMode, scanAllPages });
    const focusRelationId =
      figma.command === "view-relation" ? getSelectedConnectorId() : null;
    const focusContainerId =
      figma.command === "view-container" ? getSelectedContainerId() : null;
    await runExtraction(focusRelationId, focusContainerId);
  }
  if (msg.type === "extract") {
    await runExtraction();
  }
  if (msg.type === "focus" && msg.id) {
    focusNode(msg.id);
  }
  if (msg.type === "set-debug") {
    debugMode = !!msg.enabled;
    figma.clientStorage.setAsync("debugMode", debugMode);
  }
  if (msg.type === "set-scan-all-pages") {
    scanAllPages = !!msg.enabled;
    figma.clientStorage.setAsync("scanAllPages", scanAllPages);
    await runExtraction();
  }
  if (msg.type === "dump-selection") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({
        type: "dump-selection-result",
        error: "Nothing selected. Select a shape or connector on the canvas first.",
      });
    } else {
      const dump = selection.map((node) => summarizeNode(node));
      figma.ui.postMessage({
        type: "dump-selection-result",
        json: JSON.stringify(dump, null, 2),
      });
    }
  }
  if (msg.type === "close") {
    figma.closePlugin();
  }
};
