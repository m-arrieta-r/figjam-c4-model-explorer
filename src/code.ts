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

function findFirstTextDescendant(node: BaseNode): string | null {
  if ("findOne" in node) {
    const found = (node as ChildrenMixin).findOne((n) => n.type === "TEXT") as TextNode | null;
    if (found && found.characters.trim()) return found.characters.trim();
  }
  return null;
}

function getLabel(node: BaseNode | null): LabelResult {
  if (!node) return { label: "Unknown", source: "missing-node" };

  const withText = node as unknown as { text?: { characters?: string } };
  if (withText.text && typeof withText.text.characters === "string" && withText.text.characters.trim()) {
    return { label: withText.text.characters.trim(), source: "text-sublayer" };
  }

  const withChars = node as unknown as { characters?: string };
  if (typeof withChars.characters === "string" && withChars.characters.trim()) {
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

function focusNode(id: string) {
  const node = figma.getNodeById(id);
  if (!node || !("visible" in node)) {
    figma.notify("No se pudo encontrar ese elemento (puede que haya sido borrado).");
    return;
  }
  const sceneNode = node as SceneNode;
  figma.currentPage.selection = [sceneNode];
  figma.viewport.scrollAndZoomIntoView([sceneNode]);
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
