figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

interface Box {
  id: string;
  name: string;
  nodeType: string;
  labelSource: string;
  elementType: string | null;
  technology: string | null;
  description: string | null;
}

interface Relation {
  id: string;
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  label: string;
}

interface ExtractResult {
  boxes: Box[];
  relations: Relation[];
  skipped: number;
}

interface BoxDetails {
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
  return text.replace(/^\[\s*/, "").replace(/\s*\]$/, "").trim();
}

// Splits a C4 annotation like "Container: Oracle APEX" into its element type
// ("Container") and concrete technology ("Oracle APEX"). Annotations with no
// colon (e.g. "Person", "Software System") are the element type alone.
function splitTechAnnotation(raw: string | null): { elementType: string | null; technology: string | null } {
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
    return { name: null, elementType: null, technology: null, description: null };
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
  const description = meaningful.length > 1 ? meaningful.slice(1).join(" ").trim() : null;

  return { name, elementType, technology, description };
}

// Extracts the title, technology (bracketed annotation, e.g. "[Software
// System]" or "[Container: Java, Spring]") and description of a C4 box.
function extractBoxDetails(node: BaseNode | null): BoxDetails {
  if (!node) {
    return { name: "Unknown", nameSource: "missing-node", elementType: null, technology: null, description: null };
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
    const { elementType, technology } = splitTechAnnotation(namedTech ? stripBracket(namedTech.text) : null);
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

function extractRelations(): ExtractResult {
  const connectors = figma.currentPage.findAllWithCriteria({ types: ["CONNECTOR"] });
  const boxMap = new Map<string, Box>();
  const relations: Relation[] = [];
  let skipped = 0;

  console.log(`[extract-c4] found ${connectors.length} connector(s) on page "${figma.currentPage.name}"`);

  for (const connector of connectors) {
    const start = connector.connectorStart;
    const end = connector.connectorEnd;

    if (!start || !end || !("endpointNodeId" in start) || !("endpointNodeId" in end)) {
      skipped++;
      console.log(`[extract-c4] skipping connector ${connector.id}: not attached to a node on both ends`);
      continue;
    }

    const sourceId = start.endpointNodeId;
    const targetId = end.endpointNodeId;
    const sourceNode = figma.getNodeById(sourceId);
    const targetNode = figma.getNodeById(targetId);
    const sourceDetails = extractBoxDetails(sourceNode);
    const targetDetails = extractBoxDetails(targetNode);

    console.log(
      `[extract-c4] connector ${connector.id}: ` +
        `${sourceNode?.type ?? "null"}#${sourceId} "${sourceDetails.name}" (${sourceDetails.nameSource}) -> ` +
        `${targetNode?.type ?? "null"}#${targetId} "${targetDetails.name}" (${targetDetails.nameSource})`
    );

    if (!boxMap.has(sourceId)) {
      boxMap.set(sourceId, {
        id: sourceId,
        name: sourceDetails.name,
        nodeType: sourceNode?.type ?? "unknown",
        labelSource: sourceDetails.nameSource,
        elementType: sourceDetails.elementType,
        technology: sourceDetails.technology,
        description: sourceDetails.description,
      });
    }
    if (!boxMap.has(targetId)) {
      boxMap.set(targetId, {
        id: targetId,
        name: targetDetails.name,
        nodeType: targetNode?.type ?? "unknown",
        labelSource: targetDetails.nameSource,
        elementType: targetDetails.elementType,
        technology: targetDetails.technology,
        description: targetDetails.description,
      });
    }

    const label = connector.text && connector.text.characters ? connector.text.characters.trim() : "";

    relations.push({
      id: connector.id,
      source: sourceId,
      target: targetId,
      sourceName: sourceDetails.name,
      targetName: targetDetails.name,
      label,
    });

    // Lets the user select this connector on the canvas and relaunch the
    // plugin straight into that relation's detail panel (see figma.command
    // handling in runExtraction/figma.ui.onmessage below).
    connector.setRelaunchData({ "view-relation": "View this relation's detail in the C4 panel" });
  }

  const boxes: Box[] = Array.from(boxMap.values());
  console.log(`[extract-c4] resolved ${boxes.length} box(es), skipped ${skipped} connector(s)`, boxes);
  return { boxes, relations, skipped };
}

function getSelectedConnectorId(): string | null {
  const connector = figma.currentPage.selection.find((n) => n.type === "CONNECTOR");
  return connector ? connector.id : null;
}

function runExtraction(focusRelationId: string | null = null) {
  const result = extractRelations();
  figma.ui.postMessage({ type: "relations", ...result, focusRelationId });
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
}

function summarizeEndpoint(endpoint: ConnectorEndpoint | null): EndpointSummary | undefined {
  if (!endpoint) return undefined;

  const summary: EndpointSummary = {};

  if ("endpointNodeId" in endpoint) {
    summary.endpointNodeId = endpoint.endpointNodeId;
    const resolved = figma.getNodeById(endpoint.endpointNodeId);
    summary.resolvedNode = resolved ? { id: resolved.id, type: resolved.type, name: resolved.name } : null;
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
      summary.children = children.map((child) => summarizeNode(child, depth - 1));
    }
  }

  return summary;
}

function focusNode(id: string) {
  const node = figma.getNodeById(id);

  if (node) {
    console.log(
      `[extract-c4] focusNode(${id}) tree (copy this to debug the label extraction):\n` +
        JSON.stringify(summarizeNode(node), null, 2)
    );
  } else {
    console.log(`[extract-c4] focusNode(${id}): getNodeById returned null`);
  }

  if (!node) {
    console.warn(`[extract-c4] focusNode(${id}): getNodeById returned null (node was likely deleted)`);
    figma.notify("No se pudo encontrar ese elemento (puede que haya sido borrado).");
    return;
  }

  if (!("visible" in node)) {
    console.warn(`[extract-c4] focusNode(${id}): node type "${node.type}" is not a SceneNode, cannot select/zoom`);
    figma.notify("Ese elemento no se puede seleccionar (tipo: " + node.type + ").");
    return;
  }

  const sceneNode = node as SceneNode;
  const removed = "removed" in sceneNode ? sceneNode.removed : undefined;
  const page = sceneNode.parent ? findPage(sceneNode) : null;

  console.log("[extract-c4] focusNode resolved node", {
    id: sceneNode.id,
    type: sceneNode.type,
    name: sceneNode.name,
    removed,
    page: page ? { id: page.id, name: page.name } : null,
    currentPage: { id: figma.currentPage.id, name: figma.currentPage.name },
  });

  if (removed) {
    console.warn(`[extract-c4] focusNode(${id}): node.removed === true, it no longer exists on the canvas`);
    figma.notify("Ese elemento fue eliminado del lienzo.");
    return;
  }

  try {
    if (page && page.id !== figma.currentPage.id) {
      console.log(`[extract-c4] focusNode(${id}): node lives on a different page ("${page.name}"), switching`);
      figma.currentPage = page;
    }
    figma.currentPage.selection = [sceneNode];
    figma.viewport.scrollAndZoomIntoView([sceneNode]);
  } catch (err) {
    console.error(`[extract-c4] focusNode(${id}): failed to select/zoom`, err);
    figma.notify("No se pudo enfocar ese elemento. Revisa la consola para más detalle.");
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

figma.ui.onmessage = (msg: { type: string; id?: string }) => {
  if (msg.type === "ui-ready") {
    const focusRelationId = figma.command === "view-relation" ? getSelectedConnectorId() : null;
    runExtraction(focusRelationId);
  }
  if (msg.type === "extract") {
    runExtraction();
  }
  if (msg.type === "focus" && msg.id) {
    focusNode(msg.id);
  }
  if (msg.type === "close") {
    figma.closePlugin();
  }
};
