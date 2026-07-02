figma.showUI(__html__, { width: 480, height: 640, themeColors: true });

interface Box {
  id: string;
  name: string;
  nodeType: string;
  labelSource: string;
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

interface LabelResult {
  label: string;
  source: string;
}

// Punctuation-only runs (e.g. "[", "]") are decorative fragments some C4 shape
// libraries use to wrap a "[Type]" annotation across separate text nodes.
function isMeaningfulText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

// Breadth-first: the box's title text tends to sit closer to the root than
// nested decorative labels (like a "[Software System]" type annotation buried
// in a "Subtitle" sub-frame), so BFS finds the real title before those.
function findFirstTextDescendant(node: BaseNode): string | null {
  if (!("children" in node)) return null;

  const queue: BaseNode[] = [...(node as ChildrenMixin).children];
  while (queue.length > 0) {
    const current = queue.shift() as BaseNode;
    if (current.type === "TEXT") {
      const characters = (current as TextNode).characters.trim();
      if (characters && isMeaningfulText(characters)) return characters;
      continue;
    }
    if ("children" in current) {
      queue.push(...(current as ChildrenMixin).children);
    }
  }
  return null;
}

function getLabel(node: BaseNode | null): LabelResult {
  if (!node) return { label: "Unknown", source: "missing-node" };

  const withText = node as unknown as { text?: { characters?: string } };
  if (
    withText.text &&
    typeof withText.text.characters === "string" &&
    withText.text.characters.trim() &&
    isMeaningfulText(withText.text.characters)
  ) {
    return { label: withText.text.characters.trim(), source: "text-sublayer" };
  }

  const withChars = node as unknown as { characters?: string };
  if (
    typeof withChars.characters === "string" &&
    withChars.characters.trim() &&
    isMeaningfulText(withChars.characters)
  ) {
    return { label: withChars.characters.trim(), source: "characters" };
  }

  const descendantText = findFirstTextDescendant(node);
  if (descendantText) {
    return { label: descendantText, source: "descendant-text" };
  }

  return { label: node.name, source: "node-name-fallback" };
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
    const sourceLabel = getLabel(sourceNode);
    const targetLabel = getLabel(targetNode);

    console.log(
      `[extract-c4] connector ${connector.id}: ` +
        `${sourceNode?.type ?? "null"}#${sourceId} "${sourceLabel.label}" (${sourceLabel.source}) -> ` +
        `${targetNode?.type ?? "null"}#${targetId} "${targetLabel.label}" (${targetLabel.source})`
    );

    if (!boxMap.has(sourceId)) {
      boxMap.set(sourceId, {
        id: sourceId,
        name: sourceLabel.label,
        nodeType: sourceNode?.type ?? "unknown",
        labelSource: sourceLabel.source,
      });
    }
    if (!boxMap.has(targetId)) {
      boxMap.set(targetId, {
        id: targetId,
        name: targetLabel.label,
        nodeType: targetNode?.type ?? "unknown",
        labelSource: targetLabel.source,
      });
    }

    const label = connector.text && connector.text.characters ? connector.text.characters.trim() : "";

    relations.push({
      id: connector.id,
      source: sourceId,
      target: targetId,
      sourceName: sourceLabel.label,
      targetName: targetLabel.label,
      label,
    });
  }

  const boxes: Box[] = Array.from(boxMap.values());
  console.log(`[extract-c4] resolved ${boxes.length} box(es), skipped ${skipped} connector(s)`, boxes);
  return { boxes, relations, skipped };
}

function runExtraction() {
  const result = extractRelations();
  figma.ui.postMessage({ type: "relations", ...result });
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

runExtraction();
