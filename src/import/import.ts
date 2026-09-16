import { likeC4Text, LikeC4Edge, LikeC4Node, LikeC4View } from './likec4-types'
import { cardAccentColor, colorForName, RGB } from './color'

export { extractViews } from './likec4-types'
export type { LikeC4View } from './likec4-types'

// Each dedicated card shape (person, software system, database, ...) has its
// own default accent color baked in, but a LikeC4 node can carry an explicit
// `color` (e.g. "blue", "amber", "red" - see color.ts's palette) that should
// win when present, same as it would in the LikeC4 viewer itself.
function accentColor(node: LikeC4Node, fallback: RGB): RGB {
  return node.color ? cardAccentColor(node.color) : fallback
}

// LikeC4 descriptions can carry long free-form (even multi-paragraph
// Markdown) text meant for the LikeC4 viewer, not for a fixed-size FigJam
// card — rendered verbatim it overflows well past the shape's box. Trim it
// down to a single line that fits, with an ellipsis marking the cut.
function trimText(text: string, maxLength = 220): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLength) return collapsed
  return collapsed.slice(0, maxLength - 1).replace(/\s+$/, '') + '…'
}

// trimText caps character count, but at a given font size/box width that's
// still not tight enough — a long-but-under-220-char description can wrap
// into more lines than actually fit above the shape's bottom edge. Once the
// text node has its real font/width, shrink its content word-by-word until
// its rendered (auto-resized) height fits maxHeight.
function fitTextToHeight(node: TextNode, maxHeight: number): void {
  if (node.height <= maxHeight || maxHeight <= 0) return
  let text = node.characters.replace(/…$/, '')
  while (node.height > maxHeight && text.length > 10) {
    text = text.slice(0, Math.ceil(text.length * 0.85)).replace(/\s+\S*$/, '')
    node.characters = text + '…'
  }
}

type ShapeType = ShapeWithTextNode['shapeType']

const SHAPE_MAP: Record<string, ShapeType> = {
  rectangle: 'ROUNDED_RECTANGLE',
  browser: 'SQUARE',
  mobile: 'SQUARE',
  window: 'SQUARE',
  person: 'ELLIPSE',
  actor: 'ELLIPSE',
  cylinder: 'ENG_DATABASE',
  storage: 'ENG_DATABASE',
  database: 'ENG_DATABASE',
  queue: 'ENG_QUEUE',
  step: 'ELLIPSE',
}

function shapeForNode(node: LikeC4Node): ShapeType {
  const key = (node.shape || '').toLowerCase()
  return SHAPE_MAP[key] || 'ROUNDED_RECTANGLE'
}

// Custom "browser window" chrome for shape:"browser" nodes (UI/website
// containers) — a rounded frame with a title bar (traffic-light dots +
// address bar) and centered title/technology/description text, matching
// the user's existing FigJam design. Not a native FigJam shape, so it's
// built from primitives rather than createShapeWithText.
// Exact values captured from the user's real FigJam "App Móvil" browser
// window (frame 1293:404, 432×252 reference size) via extract-c4. These are
// fixed chrome dimensions — like real OS window title bars, they don't scale
// with the window's own size.
const BROWSER_CHROME = { r: 17 / 255, g: 104 / 255, b: 189 / 255 } // #1168BD
const WHITE = { r: 1, g: 1, b: 1 }
// Default relationship stroke color when a LikeC4 edge has no explicit
// color — matches the dark gray used by hand-drawn C4 diagrams' connectors,
// distinct from PALETTE.gray (a lighter mid-gray used for element fills).
const EDGE_DEFAULT_GRAY = { r: 75 / 255, g: 85 / 255, b: 99 / 255 } // #4B5563
// Values measured at this reference size (432×252). LikeC4 computes ui nodes
// much smaller than this in practice (~320×180), so every geometry value is
// scaled down proportionally in createBrowserWindowNode — otherwise the
// fixed reference-size chrome looks oversized on LikeC4's actual layout.
const BROWSER_REF_WIDTH = 432
const BROWSER_REF_HEIGHT = 252
const BROWSER = {
  cornerRadius: 14.4,
  strokeWeight: 3.6,
  barHeight: 33.6,
  dotSize: 16.8,
  dotStartX: 14.4,
  dotGap: 21.6,
  dotY: 8.4,
  addressBarX: 90,
  addressBarRightMargin: 24,
  addressBarHeight: 16.8,
  addressBarY: 8.4,
  addressBarRadius: 8.4,
  bodyPadding: 24,
  bodyTopGap: 14.4,
  itemSpacing: 9.6,
  titleFontSize: 28.34,
  techFontSize: 19.2,
  techOpacity: 0.9,
  descFontSize: 19.84,
  descOpacity: 0.95,
}

async function createBrowserWindowNode(node: LikeC4Node): Promise<FrameNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)
  // Uniform scale (not stretched per-axis) so the dots stay circular and
  // nothing distorts; fit-within the node's box based on the reference size.
  const scale = Math.min(width / BROWSER_REF_WIDTH, height / BROWSER_REF_HEIGHT)
  const s = (value: number) => value * scale
  const chrome = accentColor(node, BROWSER_CHROME)

  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(width, height)
  frame.cornerRadius = s(BROWSER.cornerRadius)
  frame.fills = [{ type: 'SOLID', color: WHITE }]
  frame.strokes = [{ type: 'SOLID', color: chrome }]
  frame.strokeWeight = s(BROWSER.strokeWeight)
  // Not clipped: the frame's own stroke renders above its children (Figma's
  // default z-order for a container's border), which is what hides the
  // TitleBar's square corners under the frame's rounded border - same
  // color, so the seam disappears.
  frame.clipsContent = false

  const barHeight = s(BROWSER.barHeight)
  const bar = figma.createRectangle()
  bar.name = 'TitleBar'
  bar.resize(width, barHeight)
  bar.x = 0
  bar.y = 0
  bar.fills = [{ type: 'SOLID', color: chrome }]
  frame.appendChild(bar)

  const dotSize = s(BROWSER.dotSize)
  const dotGap = s(BROWSER.dotGap)
  for (let i = 0; i < 3; i++) {
    const dot = figma.createEllipse()
    dot.resize(dotSize, dotSize)
    dot.x = s(BROWSER.dotStartX) + i * dotGap
    dot.y = s(BROWSER.dotY)
    dot.fills = [{ type: 'SOLID', color: WHITE }]
    frame.appendChild(dot)
  }

  const addressBarX = s(BROWSER.addressBarX)
  const addressBar = figma.createRectangle()
  addressBar.name = 'AddressBar'
  addressBar.resize(Math.max(width - addressBarX - s(BROWSER.addressBarRightMargin), 4), s(BROWSER.addressBarHeight))
  addressBar.x = addressBarX
  addressBar.y = s(BROWSER.addressBarY)
  addressBar.cornerRadius = s(BROWSER.addressBarRadius)
  addressBar.fills = [{ type: 'SOLID', color: WHITE }]
  frame.appendChild(addressBar)

  const bodyPadding = s(BROWSER.bodyPadding)
  const itemSpacing = s(BROWSER.itemSpacing)
  const textWidth = Math.max(width - bodyPadding * 2, 4)
  let cursorY = barHeight + s(BROWSER.bodyTopGap)

  const titleText = figma.createText()
  titleText.name = 'Título'
  titleText.fontName = { family: 'Inter', style: 'Bold' }
  titleText.characters = node.title
  titleText.fontSize = s(BROWSER.titleFontSize)
  titleText.textAlignHorizontal = 'CENTER'
  titleText.textAutoResize = 'HEIGHT'
  titleText.resize(textWidth, titleText.height)
  titleText.fills = [{ type: 'SOLID', color: chrome }]
  titleText.x = bodyPadding
  titleText.y = cursorY
  frame.appendChild(titleText)
  cursorY += titleText.height + itemSpacing

  const technology = trimText(likeC4Text(node.technology), 60)
  const techText = figma.createText()
  techText.name = 'Tecnología'
  techText.fontName = { family: 'Inter', style: 'Regular' }
  techText.characters = technology ? `[Container: ${technology}]` : '[Container]'
  techText.fontSize = s(BROWSER.techFontSize)
  techText.textAlignHorizontal = 'CENTER'
  techText.textAutoResize = 'HEIGHT'
  techText.resize(textWidth, techText.height)
  techText.fills = [{ type: 'SOLID', color: chrome, opacity: BROWSER.techOpacity }]
  techText.x = bodyPadding
  techText.y = cursorY
  frame.appendChild(techText)
  cursorY += techText.height + itemSpacing

  const description = trimText(likeC4Text(node.description))
  if (description) {
    const descText = figma.createText()
    descText.name = 'Descripción'
    descText.fontName = { family: 'Inter', style: 'Regular' }
    descText.characters = description
    descText.fontSize = s(BROWSER.descFontSize)
    descText.textAlignHorizontal = 'CENTER'
    descText.textAutoResize = 'HEIGHT'
    descText.resize(textWidth, descText.height)
    descText.fills = [{ type: 'SOLID', color: chrome, opacity: BROWSER.descOpacity }]
    fitTextToHeight(descText, height - cursorY - bodyPadding)
    descText.x = bodyPadding
    descText.y = cursorY
    frame.appendChild(descText)
  }

  return frame
}

// Exact values captured from the user's real FigJam "General/Actor" person
// icon (frame 6:6856, 369×318 reference size) via extract-c4: a circular
// head over a rounded-rect "capsule" body outline, with a "[Kind]" tag,
// title and description on a white card, plus two decorative baseline ticks.
const PERSON_MAIN_GREEN = { r: 41 / 255, g: 126 / 255, b: 6 / 255 } // #297E06
const PERSON_KIND_GREEN = { r: 27 / 255, g: 128 / 255, b: 27 / 255 } // #1B801B
const PERSON_REF_WIDTH = 369
const PERSON_REF_HEIGHT = 318
const PERSON = {
  headX: 107,
  headY: 0,
  headSize: 156,
  headStroke: 4,
  borderX: 0,
  borderY: 117,
  borderWidth: 369,
  borderHeight: 201,
  borderRadius: 45,
  borderStroke: 4,
  contentX: 0,
  contentY: 75.5,
  contentWidth: 369,
  contentHeight: 223,
  paddingTop: 48,
  paddingSide: 16,
  sectionGap: 16,
  kindGap: 4,
  kindFontSize: 19,
  titleFontSize: 24,
  descFontSize: 20,
  lineY: 270,
  lineLength: 53,
  lineMargin: 32,
  lineOpacity: 0.2,
}

function capitalize(value: string): string {
  return value.length ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

async function createPersonIconNode(node: LikeC4Node): Promise<FrameNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)
  const scale = Math.min(width / PERSON_REF_WIDTH, height / PERSON_REF_HEIGHT)
  const s = (value: number) => value * scale
  const mainColor = accentColor(node, PERSON_MAIN_GREEN)
  const kindColor = node.color ? mainColor : PERSON_KIND_GREEN

  // The icon's own aspect ratio (369:318) rarely matches the box LikeC4
  // computes for a person node, so scale is bounded by whichever dimension
  // is tighter. Sizing the frame to the scaled icon itself — instead of the
  // full requested box — avoids leaving transparent dead space down the
  // sides (which read as an oversized, off-center card, and made connectors
  // land past the visible edge). The caller re-centers this smaller frame
  // within the original box.
  const iconWidth = PERSON_REF_WIDTH * scale
  const iconHeight = PERSON_REF_HEIGHT * scale

  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(iconWidth, iconHeight)
  frame.fills = []
  frame.clipsContent = false

  const at = (localX: number) => s(localX)
  const atY = (localY: number) => s(localY)

  // Content — white card behind everything else.
  const content = figma.createRectangle()
  content.name = 'Content'
  content.resize(s(PERSON.contentWidth), s(PERSON.contentHeight))
  content.x = at(PERSON.contentX)
  content.y = atY(PERSON.contentY)
  content.fills = [{ type: 'SOLID', color: WHITE }]
  frame.appendChild(content)

  // Lines — two faint decorative baseline ticks, symmetric around center.
  const lineY = atY(PERSON.lineY)
  const leftLine = figma.createLine()
  leftLine.name = 'Left'
  leftLine.resize(s(PERSON.lineLength), 0)
  leftLine.x = at(PERSON.lineMargin)
  leftLine.y = lineY
  leftLine.strokes = [{ type: 'SOLID', color: mainColor, opacity: PERSON.lineOpacity }]
  leftLine.strokeWeight = Math.max(s(1), 0.5)
  frame.appendChild(leftLine)

  const rightLine = figma.createLine()
  rightLine.name = 'Right'
  rightLine.resize(s(PERSON.lineLength), 0)
  rightLine.x = at(PERSON_REF_WIDTH - PERSON.lineMargin - PERSON.lineLength)
  rightLine.y = lineY
  rightLine.strokes = [{ type: 'SOLID', color: mainColor, opacity: PERSON.lineOpacity }]
  rightLine.strokeWeight = Math.max(s(1), 0.5)
  frame.appendChild(rightLine)

  // Content border — the rounded "capsule" body outline.
  const border = figma.createRectangle()
  border.name = 'Content border'
  border.resize(s(PERSON.borderWidth), s(PERSON.borderHeight))
  border.x = at(PERSON.borderX)
  border.y = atY(PERSON.borderY)
  border.cornerRadius = s(PERSON.borderRadius)
  border.fills = []
  border.strokes = [{ type: 'SOLID', color: mainColor }]
  border.strokeWeight = s(PERSON.borderStroke)
  frame.appendChild(border)

  // Head — the circle, drawn last so it sits on top of the card.
  const head = figma.createEllipse()
  head.name = 'Head'
  head.resize(s(PERSON.headSize), s(PERSON.headSize))
  head.x = at(PERSON.headX)
  head.y = atY(PERSON.headY)
  head.fills = [{ type: 'SOLID', color: WHITE }]
  head.strokes = [{ type: 'SOLID', color: mainColor }]
  head.strokeWeight = s(PERSON.headStroke)
  frame.appendChild(head)

  // Text block, stacked inside the content card.
  const textWidth = s(PERSON.contentWidth - PERSON.paddingSide * 2)
  const textX = at(PERSON.contentX + PERSON.paddingSide)
  let cursorY = atY(PERSON.borderY) + s(PERSON.paddingTop)

  const kindText = figma.createText()
  kindText.name = 'Tecnología'
  kindText.fontName = { family: 'Inter', style: 'Regular' }
  kindText.characters = `[${capitalize(node.kind || 'person')}]`
  kindText.fontSize = s(PERSON.kindFontSize)
  kindText.textAlignHorizontal = 'CENTER'
  kindText.textAutoResize = 'HEIGHT'
  kindText.resize(textWidth, kindText.height)
  kindText.fills = [{ type: 'SOLID', color: kindColor }]
  kindText.x = textX
  kindText.y = cursorY
  frame.appendChild(kindText)
  cursorY += kindText.height + s(PERSON.kindGap)

  const titleText = figma.createText()
  titleText.name = 'Título'
  try {
    await figma.loadFontAsync({ family: 'Open Sans', style: 'Bold' })
    titleText.fontName = { family: 'Open Sans', style: 'Bold' }
  } catch {
    titleText.fontName = { family: 'Inter', style: 'Bold' }
  }
  titleText.characters = node.title
  titleText.fontSize = s(PERSON.titleFontSize)
  titleText.textAlignHorizontal = 'CENTER'
  titleText.textAutoResize = 'HEIGHT'
  titleText.resize(textWidth, titleText.height)
  titleText.fills = [{ type: 'SOLID', color: mainColor }]
  titleText.x = textX
  titleText.y = cursorY
  frame.appendChild(titleText)
  cursorY += titleText.height + s(PERSON.sectionGap)

  const description = trimText(likeC4Text(node.description))
  if (description) {
    const descText = figma.createText()
    descText.name = 'Descripción'
    descText.fontName = { family: 'Inter', style: 'Regular' }
    descText.characters = description
    descText.fontSize = s(PERSON.descFontSize)
    descText.textAlignHorizontal = 'CENTER'
    descText.textAutoResize = 'HEIGHT'
    descText.resize(textWidth, descText.height)
    descText.fills = [{ type: 'SOLID', color: mainColor }]
    fitTextToHeight(descText, atY(PERSON.contentY + PERSON.contentHeight) - cursorY - s(PERSON.paddingSide))
    descText.x = textX
    descText.y = cursorY
    frame.appendChild(descText)
  }

  return frame
}

// Exact values captured from the user's real FigJam "API Gateway" backend
// container card (frame 6:6711, ~438.86×256 reference size) via extract-c4:
// same white/blue chrome as the browser window, but with a ">_" terminal
// glyph instead of a title bar, above the title/technology/description text.
const CONTAINER_REF_WIDTH = 438.857
const CONTAINER_REF_HEIGHT = 256
const CONTAINER = {
  cornerRadius: 14.629,
  strokeWeight: 3.657,
  promptX: 18.286,
  promptY: 14.628,
  promptFontSize: 29.257,
  contentX: 24.381,
  contentY: 48.762,
  contentWidth: 390.095,
  itemSpacing: 9.752,
  titleFontSize: 30.031,
  techFontSize: 20.021,
  techOpacity: 0.9,
  descFontSize: 22.523,
  descOpacity: 0.95,
}

async function createBackendContainerNode(node: LikeC4Node): Promise<FrameNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)
  const scale = Math.min(width / CONTAINER_REF_WIDTH, height / CONTAINER_REF_HEIGHT)
  const s = (value: number) => value * scale
  const chrome = accentColor(node, BROWSER_CHROME)

  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(width, height)
  frame.cornerRadius = s(CONTAINER.cornerRadius)
  frame.fills = [{ type: 'SOLID', color: WHITE }]
  frame.strokes = [{ type: 'SOLID', color: chrome }]
  frame.strokeWeight = s(CONTAINER.strokeWeight)
  frame.clipsContent = false

  const promptText = figma.createText()
  promptText.name = '>_'
  promptText.fontName = { family: 'Inter', style: 'Bold' }
  promptText.characters = '>_'
  promptText.fontSize = s(CONTAINER.promptFontSize)
  promptText.fills = [{ type: 'SOLID', color: chrome }]
  promptText.x = s(CONTAINER.promptX)
  promptText.y = s(CONTAINER.promptY)
  frame.appendChild(promptText)

  const textX = s(CONTAINER.contentX)
  const textWidth = Math.max(width - textX * 2, 4)
  const itemSpacing = s(CONTAINER.itemSpacing)
  let cursorY = s(CONTAINER.contentY)

  const titleText = figma.createText()
  titleText.name = 'Título'
  titleText.fontName = { family: 'Inter', style: 'Bold' }
  titleText.characters = node.title
  titleText.fontSize = s(CONTAINER.titleFontSize)
  titleText.textAlignHorizontal = 'CENTER'
  titleText.textAutoResize = 'HEIGHT'
  titleText.resize(textWidth, titleText.height)
  titleText.fills = [{ type: 'SOLID', color: chrome }]
  titleText.x = textX
  titleText.y = cursorY
  frame.appendChild(titleText)
  cursorY += titleText.height + itemSpacing

  const technology = trimText(likeC4Text(node.technology), 60)
  const techText = figma.createText()
  techText.name = 'Tecnología'
  techText.fontName = { family: 'Inter', style: 'Regular' }
  techText.characters = technology ? `[Container: ${technology}]` : '[Container]'
  techText.fontSize = s(CONTAINER.techFontSize)
  techText.textAlignHorizontal = 'CENTER'
  techText.textAutoResize = 'HEIGHT'
  techText.resize(textWidth, techText.height)
  techText.fills = [{ type: 'SOLID', color: chrome, opacity: CONTAINER.techOpacity }]
  techText.x = textX
  techText.y = cursorY
  frame.appendChild(techText)
  cursorY += techText.height + itemSpacing

  const description = trimText(likeC4Text(node.description))
  if (description) {
    const descText = figma.createText()
    descText.name = 'Descripción'
    descText.fontName = { family: 'Inter', style: 'Regular' }
    descText.characters = description
    descText.fontSize = s(CONTAINER.descFontSize)
    descText.textAlignHorizontal = 'CENTER'
    descText.textAutoResize = 'HEIGHT'
    descText.resize(textWidth, descText.height)
    descText.fills = [{ type: 'SOLID', color: chrome, opacity: CONTAINER.descOpacity }]
    fitTextToHeight(descText, height - cursorY - s(CONTAINER.contentX))
    descText.x = textX
    descText.y = cursorY
    frame.appendChild(descText)
  }

  return frame
}

// Exact values captured from the user's real FigJam "Core DB" database box
// (frame 336×186.667 reference size) via the debug extractor: a classic
// cylinder — two blue-stroked white ellipses (top and bottom caps, each
// centered on the body rectangle's matching edge, so half of each cap
// overlaps the body and half extends past it) joined by a white body
// rectangle with thin blue side rails, holding a centered title/technology/
// description stack in the same blue as the other C4 cards.
const DATABASE_REF_WIDTH = 336
const DATABASE_REF_HEIGHT = 186.667
const DATABASE = {
  cornerRadius: 11.2,
  ellipseHeight: 22.4,
  borderWidth: 2.8,
  bodyY: 11.2,
  contentX: 46.667,
  contentY: 37.333,
  itemSpacing: 7.467,
  titleFontSize: 22.4,
  techFontSize: 14.933,
  techOpacity: 0.9,
  descFontSize: 16.8,
  descOpacity: 0.95,
}

async function createDatabaseNode(node: LikeC4Node): Promise<FrameNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)
  const scale = Math.min(width / DATABASE_REF_WIDTH, height / DATABASE_REF_HEIGHT)
  const s = (value: number) => value * scale
  const chrome = accentColor(node, BROWSER_CHROME)

  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(width, height)
  frame.cornerRadius = s(DATABASE.cornerRadius)
  frame.fills = []
  frame.strokes = []
  frame.clipsContent = false

  const ellipseHeight = s(DATABASE.ellipseHeight)
  const bodyY = s(DATABASE.bodyY)
  const bodyHeight = height - bodyY * 2
  const borderWidth = s(DATABASE.borderWidth)

  const bodyRect = figma.createRectangle()
  bodyRect.name = 'Rectangle'
  bodyRect.resize(width, bodyHeight)
  bodyRect.x = 0
  bodyRect.y = bodyY
  bodyRect.fills = [{ type: 'SOLID', color: WHITE }]
  bodyRect.strokes = []
  frame.appendChild(bodyRect)

  const leftBorder = figma.createRectangle()
  leftBorder.name = 'Rectangle'
  leftBorder.resize(borderWidth, bodyHeight)
  leftBorder.x = 0
  leftBorder.y = bodyY
  leftBorder.fills = [{ type: 'SOLID', color: chrome }]
  frame.appendChild(leftBorder)

  const rightBorder = figma.createRectangle()
  rightBorder.name = 'Rectangle'
  rightBorder.resize(borderWidth, bodyHeight)
  rightBorder.x = width - borderWidth
  rightBorder.y = bodyY
  rightBorder.fills = [{ type: 'SOLID', color: chrome }]
  frame.appendChild(rightBorder)

  const topEllipse = figma.createEllipse()
  topEllipse.name = 'Ellipse'
  topEllipse.resize(width, ellipseHeight)
  topEllipse.x = 0
  topEllipse.y = bodyY - ellipseHeight / 2
  topEllipse.fills = [{ type: 'SOLID', color: WHITE }]
  topEllipse.strokes = [{ type: 'SOLID', color: chrome }]
  topEllipse.strokeWeight = s(DATABASE.borderWidth)
  frame.appendChild(topEllipse)

  const bottomEllipse = figma.createEllipse()
  bottomEllipse.name = 'Ellipse'
  bottomEllipse.resize(width, ellipseHeight)
  bottomEllipse.x = 0
  bottomEllipse.y = bodyY + bodyHeight - ellipseHeight / 2
  bottomEllipse.fills = [{ type: 'SOLID', color: WHITE }]
  bottomEllipse.strokes = [{ type: 'SOLID', color: chrome }]
  bottomEllipse.strokeWeight = s(DATABASE.borderWidth)
  frame.appendChild(bottomEllipse)

  const textX = s(DATABASE.contentX)
  const textWidth = Math.max(width - textX * 2, 4)
  const itemSpacing = s(DATABASE.itemSpacing)
  let cursorY = s(DATABASE.contentY)

  const titleText = figma.createText()
  titleText.name = 'Título'
  titleText.fontName = { family: 'Inter', style: 'Bold' }
  titleText.characters = node.title
  titleText.fontSize = s(DATABASE.titleFontSize)
  titleText.textAlignHorizontal = 'CENTER'
  titleText.textAutoResize = 'HEIGHT'
  titleText.resize(textWidth, titleText.height)
  titleText.fills = [{ type: 'SOLID', color: chrome }]
  titleText.x = textX
  titleText.y = cursorY
  frame.appendChild(titleText)
  cursorY += titleText.height + itemSpacing

  const technology = trimText(likeC4Text(node.technology), 60)
  const techText = figma.createText()
  techText.name = 'Tecnología'
  techText.fontName = { family: 'Inter', style: 'Regular' }
  techText.characters = technology ? `[Container: ${technology}]` : '[Container: Database]'
  techText.fontSize = s(DATABASE.techFontSize)
  techText.textAlignHorizontal = 'CENTER'
  techText.textAutoResize = 'HEIGHT'
  techText.resize(textWidth, techText.height)
  techText.fills = [{ type: 'SOLID', color: chrome, opacity: DATABASE.techOpacity }]
  techText.x = textX
  techText.y = cursorY
  frame.appendChild(techText)
  cursorY += techText.height + itemSpacing

  const description = trimText(likeC4Text(node.description))
  if (description) {
    const descText = figma.createText()
    descText.name = 'Descripción'
    descText.fontName = { family: 'Inter', style: 'Regular' }
    descText.characters = description
    descText.fontSize = s(DATABASE.descFontSize)
    descText.textAlignHorizontal = 'CENTER'
    descText.textAutoResize = 'HEIGHT'
    descText.resize(textWidth, descText.height)
    descText.fills = [{ type: 'SOLID', color: chrome, opacity: DATABASE.descOpacity }]
    fitTextToHeight(descText, height - cursorY - s(DATABASE.contentX))
    descText.x = textX
    descText.y = cursorY
    frame.appendChild(descText)
  }

  return frame
}

// Exact values captured from the user's real FigJam "Core banking system"
// internal software system box (frame 336×191 reference size, kind
// "softwareSystem") via the debug extractor: an orange (#ED8609) rounded
// outline with no fill — the canvas shows through — holding a "[Software
// System]" subtitle, a bold title, and a description, all in the same
// orange.
const SOFTWARE_SYSTEM_ORANGE = { r: 237 / 255, g: 134 / 255, b: 9 / 255 } // #ED8609
const SOFTWARE_SYSTEM_REF_WIDTH = 336
const SOFTWARE_SYSTEM_REF_HEIGHT = 191
const SOFTWARE_SYSTEM = {
  cornerRadius: 6,
  strokeWeight: 4,
  paddingSide: 16,
  subtitleFontSize: 18,
  titleFontSize: 24,
  descFontSize: 20,
  itemSpacing: 10,
}

// Exact values captured from the user's real FigJam "Email Component" card
// (360×210 reference size, kind "component") via the debug extractor: a
// white rounded card with a blue (#1168BD) outline — same chrome color as
// BROWSER/CONTAINER — plus two small notch tabs poking out of the left edge
// (the classic UML "component" connector notation), holding a bold title, a
// "[Component: ...]" technology line, and a description, all in blue.
// "code" (level 4) nodes reuse the component card's frame/tabs layout but
// get a distinct violet chrome (rather than the component blue) plus a
// "[<notation>: technology]" line — driven by LikeC4's `notation` field
// (e.g. "Código") instead of the hardcoded "Component" label — so the two
// kinds stay visually distinguishable at a glance.
const CODE_CHROME = { r: 111 / 255, g: 66 / 255, b: 193 / 255 } // #6F42C1

const COMPONENT_REF_WIDTH = 360
const COMPONENT_REF_HEIGHT = 210
const COMPONENT = {
  cornerRadius: 12,
  strokeWeight: 3,
  tabWidth: 28,
  tabHeight: 12,
  tabX: -14,
  tabY1: 12,
  tabY2: 30,
  contentX: 20,
  contentY: 40,
  itemSpacing: 8,
  titleFontSize: 22.305,
  techFontSize: 14.889,
  descFontSize: 16.729,
}

async function createComponentNode(node: LikeC4Node, variant: 'component' | 'code' = 'component'): Promise<FrameNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)
  const scale = Math.min(width / COMPONENT_REF_WIDTH, height / COMPONENT_REF_HEIGHT)
  const s = (value: number) => value * scale

  const chromeColor = accentColor(node, variant === 'code' ? CODE_CHROME : BROWSER_CHROME)
  const label = variant === 'code' ? node.notation || 'Código' : 'Component'

  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(width, height)
  frame.cornerRadius = s(COMPONENT.cornerRadius)
  frame.fills = [{ type: 'SOLID', color: WHITE }]
  frame.strokes = [{ type: 'SOLID', color: chromeColor }]
  frame.strokeWeight = s(COMPONENT.strokeWeight)
  frame.clipsContent = false

  const tabYs = variant === 'code' ? [] : [COMPONENT.tabY1, COMPONENT.tabY2]
  for (const tabY of tabYs) {
    const tab = figma.createRectangle()
    tab.name = 'Tab'
    tab.resize(s(COMPONENT.tabWidth), s(COMPONENT.tabHeight))
    tab.x = s(COMPONENT.tabX)
    tab.y = s(tabY)
    tab.fills = [{ type: 'SOLID', color: WHITE }]
    tab.strokes = [{ type: 'SOLID', color: chromeColor }]
    tab.strokeWeight = s(COMPONENT.strokeWeight)
    frame.appendChild(tab)
  }

  const textX = s(COMPONENT.contentX)
  const textWidth = Math.max(width - textX * 2, 4)
  const itemSpacing = s(COMPONENT.itemSpacing)
  let cursorY = s(COMPONENT.contentY)

  const titleText = figma.createText()
  titleText.name = 'Título'
  titleText.fontName = { family: 'Inter', style: 'Bold' }
  titleText.characters = node.title
  titleText.fontSize = s(COMPONENT.titleFontSize)
  titleText.textAlignHorizontal = 'CENTER'
  titleText.textAutoResize = 'HEIGHT'
  titleText.resize(textWidth, titleText.height)
  titleText.fills = [{ type: 'SOLID', color: chromeColor }]
  titleText.x = textX
  titleText.y = cursorY
  frame.appendChild(titleText)
  cursorY += titleText.height + itemSpacing

  const technology = trimText(likeC4Text(node.technology), 60)
  const techText = figma.createText()
  techText.name = 'Tecnología'
  techText.fontName = { family: 'Inter', style: 'Regular' }
  techText.characters = technology ? `[${label}: ${technology}]` : `[${label}]`
  techText.fontSize = s(COMPONENT.techFontSize)
  techText.textAlignHorizontal = 'CENTER'
  techText.textAutoResize = 'HEIGHT'
  techText.resize(textWidth, techText.height)
  techText.fills = [{ type: 'SOLID', color: chromeColor }]
  techText.x = textX
  techText.y = cursorY
  frame.appendChild(techText)
  cursorY += techText.height + itemSpacing

  const description = trimText(likeC4Text(node.description))
  if (description) {
    const descText = figma.createText()
    descText.name = 'Descripción'
    descText.fontName = { family: 'Inter', style: 'Regular' }
    descText.characters = description
    descText.fontSize = s(COMPONENT.descFontSize)
    descText.textAlignHorizontal = 'CENTER'
    descText.textAutoResize = 'HEIGHT'
    descText.resize(textWidth, descText.height)
    descText.fills = [{ type: 'SOLID', color: chromeColor }]
    fitTextToHeight(descText, height - cursorY - s(COMPONENT.contentX))
    descText.x = textX
    descText.y = cursorY
    frame.appendChild(descText)
  }

  return frame
}

async function createSoftwareSystemNode(node: LikeC4Node): Promise<FrameNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)
  const scale = Math.min(width / SOFTWARE_SYSTEM_REF_WIDTH, height / SOFTWARE_SYSTEM_REF_HEIGHT)
  const s = (value: number) => value * scale

  // An explicit LikeC4 color always wins. Absent one: orange is the default
  // for a standalone software system (a Context diagram's "system in
  // focus", sitting directly on the canvas), while one nested inside a
  // boundary - a Landscape group like "Coopenae" or "Cross Systems" - reads
  // as just another system within scope, so it defaults to the same blue
  // used for containers/boundaries instead.
  const color = node.color
    ? cardAccentColor(node.color)
    : node.parent
      ? BROWSER_CHROME
      : SOFTWARE_SYSTEM_ORANGE

  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(width, height)
  frame.cornerRadius = s(SOFTWARE_SYSTEM.cornerRadius)
  frame.fills = []
  frame.strokes = [{ type: 'SOLID', color }]
  frame.strokeWeight = s(SOFTWARE_SYSTEM.strokeWeight)
  frame.clipsContent = false

  const paddingSide = s(SOFTWARE_SYSTEM.paddingSide)
  const textWidth = Math.max(width - paddingSide * 2, 4)
  const itemSpacing = s(SOFTWARE_SYSTEM.itemSpacing)

  const subtitleText = figma.createText()
  subtitleText.name = 'Subtítulo'
  subtitleText.fontName = { family: 'Inter', style: 'Regular' }
  subtitleText.characters = '[Software System]'
  subtitleText.fontSize = s(SOFTWARE_SYSTEM.subtitleFontSize)
  subtitleText.textAlignHorizontal = 'CENTER'
  subtitleText.textAutoResize = 'HEIGHT'
  subtitleText.resize(textWidth, subtitleText.height)
  subtitleText.fills = [{ type: 'SOLID', color }]

  const titleText = figma.createText()
  titleText.name = 'Título'
  try {
    await figma.loadFontAsync({ family: 'Open Sans', style: 'Bold' })
    titleText.fontName = { family: 'Open Sans', style: 'Bold' }
  } catch {
    titleText.fontName = { family: 'Inter', style: 'Bold' }
  }
  titleText.characters = node.title
  titleText.fontSize = s(SOFTWARE_SYSTEM.titleFontSize)
  titleText.textAlignHorizontal = 'CENTER'
  titleText.textAutoResize = 'HEIGHT'
  titleText.resize(textWidth, titleText.height)
  titleText.fills = [{ type: 'SOLID', color }]

  const description = trimText(likeC4Text(node.description))
  let descText: TextNode | null = null
  if (description) {
    descText = figma.createText()
    descText.name = 'Descripción'
    descText.fontName = { family: 'Inter', style: 'Regular' }
    descText.characters = description
    descText.fontSize = s(SOFTWARE_SYSTEM.descFontSize)
    descText.textAlignHorizontal = 'CENTER'
    descText.textAutoResize = 'HEIGHT'
    descText.resize(textWidth, descText.height)
    descText.fills = [{ type: 'SOLID', color }]
    const maxDescHeight = height - subtitleText.height - itemSpacing - titleText.height - itemSpacing - s(16) * 2
    fitTextToHeight(descText, maxDescHeight)
  }

  // Center the text block vertically in the box — there's no header bar to
  // anchor to (unlike the browser/container chrome), so this reads best
  // balanced rather than pinned to the top.
  const blockHeight =
    subtitleText.height + itemSpacing + titleText.height + (descText ? itemSpacing + descText.height : 0)
  let cursorY = Math.max((height - blockHeight) / 2, s(16))

  subtitleText.x = paddingSide
  subtitleText.y = cursorY
  frame.appendChild(subtitleText)
  cursorY += subtitleText.height + itemSpacing

  titleText.x = paddingSide
  titleText.y = cursorY
  frame.appendChild(titleText)
  cursorY += titleText.height + itemSpacing

  if (descText) {
    descText.x = paddingSide
    descText.y = cursorY
    frame.appendChild(descText)
  }

  return frame
}

// Exact values captured from the user's real FigJam "Amazon Web Services
// Email Service" external software system box (frame 336×191 reference
// size, kind "externalSystem") via the debug extractor: same transparent
// rounded-outline layout as the internal software system card, but red
// instead of orange — and with two distinct reds: the "[Software System]"
// subtitle and border use the darker #BF101D, while the title and
// description use the lighter #CC3333.
const EXTERNAL_SYSTEM_BORDER_RED = { r: 191 / 255, g: 16 / 255, b: 29 / 255 } // #BF101D
const EXTERNAL_SYSTEM_TEXT_RED = { r: 204 / 255, g: 51 / 255, b: 51 / 255 } // #CC3333
const EXTERNAL_SYSTEM_REF_WIDTH = 336
const EXTERNAL_SYSTEM_REF_HEIGHT = 191
const EXTERNAL_SYSTEM = {
  cornerRadius: 6,
  strokeWeight: 4,
  paddingSide: 16,
  subtitleFontSize: 18,
  titleFontSize: 22.4,
  descFontSize: 16.8,
  itemSpacing: 10,
}

async function createExternalSystemNode(node: LikeC4Node): Promise<FrameNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)
  const scale = Math.min(width / EXTERNAL_SYSTEM_REF_WIDTH, height / EXTERNAL_SYSTEM_REF_HEIGHT)
  const s = (value: number) => value * scale
  const borderColor = accentColor(node, EXTERNAL_SYSTEM_BORDER_RED)
  const textColor = node.color ? borderColor : EXTERNAL_SYSTEM_TEXT_RED

  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(width, height)
  frame.cornerRadius = s(EXTERNAL_SYSTEM.cornerRadius)
  frame.fills = []
  frame.strokes = [{ type: 'SOLID', color: borderColor }]
  frame.strokeWeight = s(EXTERNAL_SYSTEM.strokeWeight)
  frame.clipsContent = false

  const paddingSide = s(EXTERNAL_SYSTEM.paddingSide)
  const textWidth = Math.max(width - paddingSide * 2, 4)
  const itemSpacing = s(EXTERNAL_SYSTEM.itemSpacing)

  const subtitleText = figma.createText()
  subtitleText.name = 'Subtítulo'
  subtitleText.fontName = { family: 'Inter', style: 'Regular' }
  subtitleText.characters = '[Software System]'
  subtitleText.fontSize = s(EXTERNAL_SYSTEM.subtitleFontSize)
  subtitleText.textAlignHorizontal = 'CENTER'
  subtitleText.textAutoResize = 'HEIGHT'
  subtitleText.resize(textWidth, subtitleText.height)
  subtitleText.fills = [{ type: 'SOLID', color: borderColor }]

  const titleText = figma.createText()
  titleText.name = 'Título'
  titleText.fontName = { family: 'Inter', style: 'Bold' }
  titleText.characters = node.title
  titleText.fontSize = s(EXTERNAL_SYSTEM.titleFontSize)
  titleText.textAlignHorizontal = 'CENTER'
  titleText.textAutoResize = 'HEIGHT'
  titleText.resize(textWidth, titleText.height)
  titleText.fills = [{ type: 'SOLID', color: textColor }]

  const description = trimText(likeC4Text(node.description))
  let descText: TextNode | null = null
  if (description) {
    descText = figma.createText()
    descText.name = 'Descripción'
    descText.fontName = { family: 'Inter', style: 'Regular' }
    descText.characters = description
    descText.fontSize = s(EXTERNAL_SYSTEM.descFontSize)
    descText.textAlignHorizontal = 'CENTER'
    descText.textAutoResize = 'HEIGHT'
    descText.resize(textWidth, descText.height)
    descText.fills = [{ type: 'SOLID', color: textColor }]
    const maxDescHeight = height - subtitleText.height - itemSpacing - titleText.height - itemSpacing - s(16) * 2
    fitTextToHeight(descText, maxDescHeight)
  }

  const blockHeight =
    subtitleText.height + itemSpacing + titleText.height + (descText ? itemSpacing + descText.height : 0)
  let cursorY = Math.max((height - blockHeight) / 2, s(16))

  subtitleText.x = paddingSide
  subtitleText.y = cursorY
  frame.appendChild(subtitleText)
  cursorY += subtitleText.height + itemSpacing

  titleText.x = paddingSide
  titleText.y = cursorY
  frame.appendChild(titleText)
  cursorY += titleText.height + itemSpacing

  if (descText) {
    descText.x = paddingSide
    descText.y = cursorY
    frame.appendChild(descText)
  }

  return frame
}

// Boundary box used to encapsulate a lower LikeC4 level (e.g. a system
// boundary wrapping its containers) — a transparent rounded rectangle with
// the same blue chrome as the browser window (#1168BD), captured from the
// user's real FigJam design via the debug extractor. Unlike the other
// element cards, the label isn't centered inside the box: it sits pinned to
// the bottom-left corner, outside the way of whatever is nested inside.
const LEVEL_BOUNDARY = {
  cornerRadius: 3,
  strokeWeight: 4,
  padding: 20,
  fontSize: 20,
  subtitleFontSize: 12,
  subtitleOpacity: 0.85,
  subtitleGap: 2,
}

// Turns a LikeC4 kind ("softwareSystem", "external_system", "backend") into
// the bracketed subtitle c4model.com diagrams print under a boundary's name
// (e.g. "[Software System]") — split on camelCase/snake/kebab word
// boundaries and title-case each word, same convention as the hardcoded
// "[Software System]"/"[Container]" subtitles on the leaf element cards,
// but derived dynamically since a boundary can wrap any kind of element.
function kindLabel(kind: string | undefined): string {
  if (!kind) return ''
  const words = kind
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
  if (words.length === 0) return ''
  return `[${words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}]`
}

// Returns [outline, ...labelTexts] rather than a single parented node.
// FRAME nodes turn out to have a real FigJam limitation (confirmed via a
// bare, property-clean repro): dragging a single edge handle scales BOTH
// axes together — width, height, even descendants' strokeWeight/cornerRadius
// /fontSize — no matter what targetAspectRatio/constraints say, while a
// plain FigJam shape (SHAPE_WITH_TEXT, RECTANGLE, TEXT — anything that isn't
// FRAME) resizes one axis at a time exactly as expected. So the boundary's
// outline is a ShapeWithTextNode (its own text sublayer left empty; it can't
// hold two independently-positioned lines) and the title/subtitle are plain
// TextNodes returned as siblings, not children — the caller
// (importView/importSequenceView) appends and offsets every element in the
// returned array together, so visually this is identical to before.
export async function createLevelBoundaryNode(node: LikeC4Node): Promise<GroupNode> {
  const width = Math.max(node.width, 60)
  const height = Math.max(node.height, 60)

  const outline = figma.createRectangle()
  outline.name = node.title
  outline.resize(width, height)
  outline.cornerRadius = LEVEL_BOUNDARY.cornerRadius
  outline.fills = [{ type: 'SOLID', color: WHITE, opacity: 0 }]
  outline.strokes = [{ type: 'SOLID', color: BROWSER_CHROME }]
  outline.strokeWeight = LEVEL_BOUNDARY.strokeWeight

  let titleFontName: FontName
  try {
    await figma.loadFontAsync({ family: 'Open Sans', style: 'Bold' })
    titleFontName = { family: 'Open Sans', style: 'Bold' }
  } catch {
    titleFontName = { family: 'Inter', style: 'Bold' }
  }

  const subtitle = kindLabel(node.kind)
  let subtitleText: TextNode | null = null
  if (subtitle) {
    subtitleText = figma.createText()
    subtitleText.name = 'Subtítulo'
    subtitleText.fontName = { family: 'Inter', style: 'Regular' }
    subtitleText.characters = subtitle
    subtitleText.fontSize = LEVEL_BOUNDARY.subtitleFontSize
    subtitleText.textAlignHorizontal = 'LEFT'
    subtitleText.textAutoResize = 'WIDTH_AND_HEIGHT'
    subtitleText.fills = [
      { type: 'SOLID', color: BROWSER_CHROME, opacity: LEVEL_BOUNDARY.subtitleOpacity },
    ]
    subtitleText.x = LEVEL_BOUNDARY.padding
    subtitleText.y = height - subtitleText.height - LEVEL_BOUNDARY.padding
  }

  const labelText = figma.createText()
  labelText.name = 'Título'
  labelText.fontName = titleFontName
  labelText.characters = node.title
  labelText.fontSize = LEVEL_BOUNDARY.fontSize
  labelText.textAlignHorizontal = 'LEFT'
  labelText.textAutoResize = 'WIDTH_AND_HEIGHT'
  labelText.fills = [{ type: 'SOLID', color: BROWSER_CHROME }]
  labelText.x = LEVEL_BOUNDARY.padding
  labelText.y = subtitleText
    ? subtitleText.y - LEVEL_BOUNDARY.subtitleGap - labelText.height
    : height - labelText.height - LEVEL_BOUNDARY.padding

  const parts = subtitleText ? [outline, labelText, subtitleText] : [outline, labelText]
  for (const part of parts) figma.currentPage.appendChild(part)
  const group = figma.group(parts, figma.currentPage)
  group.name = node.title
  return group
}

// Calling unlockAspectRatio() on a node before it's been reparented into the
// document (still "detached" right after figma.createFrame()/createEllipse()
// etc.) doesn't reliably stick — Figma keeps reporting targetAspectRatio as
// locked once the shape is actually on the canvas, and a locked ratio makes
// FigJam's plain edge-handle resize act like the "K" Scale tool (proportionally
// scaling stroke weight, corner radius and font size along with width/height,
// not just the one dimension being dragged). So this must be called again
// after the caller has appended the shape into its container.
// Recursively pins every descendant of a generated shape to its top-left
// corner (constraints: MIN/MIN) so resizing the outer shape never scales an
// inner text/rect/ellipse's own size (and, for text, its font size) — see
// the comment where this is called in createShapeForNode for why that
// matters.
function pinDescendantsTopLeft(node: SceneNode): void {
  if (!('children' in node)) return
  for (const child of (node as SceneNode & ChildrenMixin).children) {
    if ('constraints' in child) {
      ;(child as SceneNode & ConstraintMixin).constraints = { horizontal: 'MIN', vertical: 'MIN' }
    }
    pinDescendantsTopLeft(child as SceneNode)
  }
}

// Confirmed by a bare (not-in-a-Section) repro: a boundary/card built with
// figma.createFrame() comes out at its exact requested size when appended
// directly to the page, but shrinks by a uniform factor (hitting its own
// width/height/strokeWeight/cornerRadius, and every text child's fontSize)
// once it's appended as a child of the diagram's wrapping Section — i.e. the
// shape's own default constraints (as a Section child) are what's driving a
// SCALE-style rescale, not anything about how the shape itself was built.
// Pinning it to MIN/MIN right after container.appendChild(shape) stops that.
function stabilizeAfterAppend(shape: SceneNode): void {
  if ('constraints' in shape) {
    ;(shape as SceneNode & ConstraintMixin).constraints = { horizontal: 'MIN', vertical: 'MIN' }
  }
  if ('unlockAspectRatio' in shape) {
    try {
      ;(shape as SceneNode & { unlockAspectRatio(): void }).unlockAspectRatio()
    } catch {
      // Some node types (e.g. connectors) don't support this — ignore.
    }
  }
}

// Creates the right FigJam shape for a LikeC4 node based on its shape/kind,
// fully styled and sized but not yet parented or positioned — the caller
// appends it to a container and sets x/y (Figma reinterprets a node's x/y as
// relative to its new parent only once it's actually reparented). Shared by
// the regular architecture-diagram importer and the sequence-diagram one so
// the same node (e.g. a "code" or "component" kind) renders identically in
// both.
async function createShapeForNode(node: LikeC4Node): Promise<SceneNode> {
  const isContainer = node.children.length > 0
  const shapeKey = (node.shape || '').toLowerCase()
  const isBrowser = shapeKey === 'browser' || shapeKey === 'mobile' || shapeKey === 'window'
  const isPerson = shapeKey === 'person' || shapeKey === 'actor'
  const isDatabase =
    (shapeKey === 'cylinder' || shapeKey === 'storage' || shapeKey === 'database') && !isContainer
  // Only leaf backend nodes get the compact card — a "backend"/"container"
  // node with children (e.g. this components view's root container) is a
  // boundary/group box around other elements, not this card shape.
  const isBackend = (node.kind === 'backend' || node.kind === 'container') && !isContainer
  // Only leaf software systems get the compact orange card — a
  // "softwareSystem" node with children (e.g. "Customer Channels") is a
  // boundary/group box around other elements, not this card shape.
  const isSoftwareSystem = (node.kind || '').toLowerCase() === 'softwaresystem' && !isContainer
  const isExternalSystem = (node.kind || '').toLowerCase() === 'externalsystem' && !isContainer
  const isComponent = (node.kind || '').toLowerCase() === 'component' && !isContainer
  const isCode = (node.kind || '').toLowerCase() === 'code' && !isContainer

  let shape: SceneNode
  if (isBrowser) shape = await createBrowserWindowNode(node)
  else if (isPerson) shape = await createPersonIconNode(node)
  else if (isDatabase) shape = await createDatabaseNode(node)
  else if (isSoftwareSystem) shape = await createSoftwareSystemNode(node)
  else if (isExternalSystem) shape = await createExternalSystemNode(node)
  else if (isComponent) shape = await createComponentNode(node)
  else if (isCode) shape = await createComponentNode(node, 'code')
  else if (isBackend) shape = await createBackendContainerNode(node)
  else if (isContainer) shape = await createLevelBoundaryNode(node)
  else {
    const generic = figma.createShapeWithText()
    generic.shapeType = shapeForNode(node)
    generic.resize(Math.max(node.width, 1), Math.max(node.height, 1))

    const rgb = colorForName(node.color)
    generic.fills = [{ type: 'SOLID', color: rgb, opacity: isContainer ? 0.12 : 0.85 }]

    const genericTech = trimText(likeC4Text(node.technology), 60)
    const label = genericTech ? `${node.title}\n${genericTech}` : node.title
    generic.text.characters = label
    generic.text.fontSize = isContainer ? 14 : Math.min(16, Math.max(10, node.width / 12))
    shape = generic
  }

  // Pin every descendant to the top-left corner instead of leaving Figma's
  // default constraints in place. A "SCALE" constraint (which some FigJam
  // defaults use) makes a plain edge-handle resize proportionally stretch
  // that descendant's own size — and for text nodes, its font size — which
  // is what was making these cards/boundaries look "aspect-locked" even
  // though nothing here ever calls lockAspectRatio(). Pinning top-left keeps
  // a resize a pure width/height change of the outer shape.
  pinDescendantsTopLeft(shape)
  return shape
}

export async function importView(view: LikeC4View) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })

  // Derive the bounding box from the nodes' actual coordinates rather than
  // trusting view.bounds verbatim: some exports (e.g. views with visual
  // grouping boxes) declare bounds that don't tightly wrap every node,
  // which would leave the section under/mis-sized relative to its content.
  const box = view.nodes.reduce(
    (acc, n) => ({
      minX: Math.min(acc.minX, n.x),
      minY: Math.min(acc.minY, n.y),
      maxX: Math.max(acc.maxX, n.x + n.width),
      maxY: Math.max(acc.maxY, n.y + n.height),
    }),
    { minX: view.bounds.x, minY: view.bounds.y, maxX: view.bounds.x + view.bounds.width, maxY: view.bounds.y + view.bounds.height }
  )
  const contentWidth = box.maxX - box.minX
  const contentHeight = box.maxY - box.minY

  // Anchor the section near wherever the user is currently looking. This is
  // the section's own absolute page position — it isn't reparented, so this
  // assignment is safe.
  const viewportCenter = figma.viewport.center
  const section = figma.createSection()
  section.name = view.title || view.id
  section.x = viewportCenter.x - contentWidth / 2 - 40
  section.y = viewportCenter.y - contentHeight / 2 - 40
  section.resizeWithoutConstraints(contentWidth + 80, contentHeight + 80)

  // Once a shape/connector is reparented into the section via appendChild,
  // Figma reinterprets its x/y as relative to the section's own top-left —
  // not as an absolute page coordinate. So node positions here must be
  // expressed relative to the section's local origin (padded by 40px),
  // not offset by the section's own page position.

  const nodesById = new Map<string, SceneNode>()

  const sortedNodes = [...view.nodes].sort((a, b) => a.level - b.level)

  // Boundary boxes are kept as flat siblings of their contents inside the
  // section (not real parent frames): FigJam sections don't support
  // double-click-to-enter a nested frame the way Figma Design does, so
  // actually nesting children inside a boundary frame made the whole thing
  // drag/select as one inseparable group — worse than the original
  // resize/z-order friction it was meant to fix. Selecting the boundary
  // itself when it's visually behind other shapes (e.g. to resize it or send
  // it further back) requires clicking it in the Layers panel rather than on
  // canvas, same as any obscured layer in a design tool.
  const container: BaseNode & ChildrenMixin = section
  const offsetX = -box.minX + 40
  const offsetY = -box.minY + 40

  let skippedNodes = 0
  let firstNodeError: string | null = null

  for (const node of sortedNodes) {
    try {
      const shape = await createShapeForNode(node)
      container.appendChild(shape)
      stabilizeAfterAppend(shape)
      // Most shapes fill their node's full width/height, so this is a no-op;
      // a person icon can end up narrower/shorter (see createPersonIconNode)
      // and gets centered in the space LikeC4 allocated for it instead of
      // sitting flush against its top-left corner.
      shape.x = node.x + offsetX + (node.width - shape.width) / 2
      shape.y = node.y + offsetY + (node.height - shape.height) / 2
      nodesById.set(node.id, shape)
    } catch (err) {
      skippedNodes++
      if (!firstNodeError) firstNodeError = err instanceof Error ? err.message : String(err)
    }
  }

  let skippedEdges = 0
  let firstEdgeError: string | null = null

  for (const edge of view.edges) {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!source || !target) continue

    try {
      const connector = figma.createConnector()
      connector.connectorLineType = 'STRAIGHT'
      connector.connectorStart = { endpointNodeId: source.id, magnet: 'CENTER' }
      connector.connectorEnd = { endpointNodeId: target.id, magnet: 'CENTER' }

      const rgb = edge.color ? colorForName(edge.color) : EDGE_DEFAULT_GRAY
      connector.strokes = [{ type: 'SOLID', color: rgb }]
      connector.strokeWeight = 4
      if ((edge.line || 'dashed').toLowerCase() !== 'solid') {
        connector.dashPattern = [16, 10]
      }
      connector.connectorEndStrokeCap = edge.head === 'none' ? 'NONE' : 'ARROW_EQUILATERAL'
      connector.connectorStartStrokeCap =
        edge.tail && edge.tail !== 'none' ? 'ARROW_EQUILATERAL' : 'NONE'

      if (edge.label) {
        connector.text.characters = edge.label
        connector.text.fontSize = 11
      }

      section.appendChild(connector)
    } catch (err) {
      skippedEdges++
      if (!firstEdgeError) firstEdgeError = err instanceof Error ? err.message : String(err)
    }
  }

  figma.currentPage.selection = [section]
  figma.viewport.scrollAndZoomIntoView([section])

  return {
    nodeCount: nodesById.size,
    edgeCount: view.edges.length - skippedEdges,
    skippedNodes,
    skippedEdges,
    firstNodeError,
    firstEdgeError,
  }
}

// LikeC4 dynamic (sequence) views ship node positions computed for its own
// staggered "avoid crossings" layout (autoLayout: "LR"), not a classic UML
// grid — reusing them as-is (importView's approach) scatters actor boxes and
// routes generic node-to-node connectors between them, losing the left-to-
// right "who called whom, in what order" reading that's the entire point of
// a sequence diagram. This renders the UML-standard shape instead: actor
// cards in one top row, a dashed vertical lifeline hanging from each one, and
// each step (in `flow` order) as its own numbered horizontal arrow at a fixed
// row height — ignoring the JSON's own x/y for edges/steps and recomputing a
// clean grid from participant order and step count instead.
const SEQ_LIFELINE_GRAY = { r: 148 / 255, g: 163 / 255, b: 184 / 255 } // #94A3B8
const SEQ_BADGE_BG = { r: 31 / 255, g: 41 / 255, b: 55 / 255 } // #1F2937
const SEQ = {
  rowHeight: 74,
  headerGap: 56,
  bottomPad: 50,
  sidePad: 40,
  activationWidth: 6,
  activationHeight: 18,
  badgeHeight: 20,
  badgeGap: 6,
  labelGapAboveLine: 16,
  labelFontSize: 12,
  badgeFontSize: 11,
}

export async function importSequenceView(view: LikeC4View) {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })

  if (view.nodes.length === 0) {
    throw new Error('This sequence view has no participants to render.')
  }

  // Participant order: prefer `sequenceLayout.actors`, the authoritative
  // left-to-right lifeline order — the top-level `nodes[].x` belongs to a
  // different (elbowed-diagram) rendering of the same steps and can place
  // actors out of lifeline order if reused here (e.g. a participant that
  // sorts near the middle by lifeline order can have the smallest top-level
  // x).
  const actorLayoutX = new Map((view.sequenceLayout?.actors ?? []).map((a) => [a.id, a.x]))
  const sortedActors =
    actorLayoutX.size > 0
      ? [...view.nodes].sort((a, b) => (actorLayoutX.get(a.id) ?? a.x) - (actorLayoutX.get(b.id) ?? b.x))
      : [...view.nodes].sort((a, b) => a.x - b.x)

  // Cards render at each node's own width/height, which vary by kind (a
  // "component" card is taller than a "code" one) — fine for an
  // architecture diagram, but a sequence diagram reads as a row of equal
  // participants, so give every actor the same box size and re-space them
  // evenly by that uniform width instead of trusting either JSON's x.
  const uniformWidth = Math.max(...sortedActors.map((n) => n.width))
  const uniformHeight = Math.max(...sortedActors.map((n) => n.height))
  const actorGap = 80
  const actors = sortedActors.map((node, index) => ({
    ...node,
    x: index * (uniformWidth + actorGap),
    width: uniformWidth,
    height: uniformHeight,
  }))

  // Prefer the explicit `flow` (step/edge id order) when present; fall back
  // to the edges array's own order. Either way, resolve ids to edges and
  // silently drop any that don't match rather than failing the whole import.
  const edgesById = new Map(view.edges.map((e) => [e.id, e]))
  const steps: LikeC4Edge[] =
    view.flow && view.flow.length > 0
      ? view.flow.map((id) => edgesById.get(id)).filter((e): e is LikeC4Edge => !!e)
      : view.edges

  const minX = Math.min(...actors.map((a) => a.x))
  const maxRight = Math.max(...actors.map((a) => a.x + a.width))
  const headerHeight = Math.max(...actors.map((a) => a.height))

  const firstStepY = headerHeight + SEQ.headerGap
  const lastStepY = firstStepY + Math.max(steps.length - 1, 0) * SEQ.rowHeight
  const contentWidth = maxRight - minX
  const contentHeight = lastStepY + SEQ.bottomPad

  const viewportCenter = figma.viewport.center
  const section = figma.createSection()
  section.name = view.title || view.id
  section.x = viewportCenter.x - contentWidth / 2 - SEQ.sidePad
  section.y = viewportCenter.y - contentHeight / 2 - SEQ.sidePad
  section.resizeWithoutConstraints(contentWidth + SEQ.sidePad * 2, contentHeight + SEQ.sidePad * 2)

  const offsetX = -minX + SEQ.sidePad
  const offsetY = SEQ.sidePad

  const lifelineX = new Map<string, number>()
  let skippedNodes = 0
  let firstNodeError: string | null = null

  for (const actor of actors) {
    try {
      const shape = await createShapeForNode(actor)
      section.appendChild(shape)
      stabilizeAfterAppend(shape)
      // Center a shape that ends up smaller than the uniform actor box (e.g.
      // a person icon, see createPersonIconNode) instead of leaving it flush
      // against the top-left corner.
      shape.x = actor.x + offsetX + (actor.width - shape.width) / 2
      shape.y = offsetY + (actor.height - shape.height) / 2
      const x = actor.x + actor.width / 2 + offsetX
      lifelineX.set(actor.id, x)

      const lifeline = figma.createRectangle()
      lifeline.name = `${actor.title} — lifeline`
      lifeline.resize(2, contentHeight - headerHeight)
      section.appendChild(lifeline)
      lifeline.x = x - 1
      lifeline.y = offsetY + actor.height
      lifeline.fills = [{ type: 'SOLID', color: SEQ_LIFELINE_GRAY }]
    } catch (err) {
      skippedNodes++
      if (!firstNodeError) firstNodeError = err instanceof Error ? err.message : String(err)
    }
  }

  let skippedEdges = 0
  let firstEdgeError: string | null = null

  for (const [index, edge] of steps.entries()) {
    const x1 = lifelineX.get(edge.source)
    const x2 = lifelineX.get(edge.target)
    if (x1 === undefined || x2 === undefined) {
      skippedEdges++
      continue
    }

    try {
      const y = offsetY + firstStepY + index * SEQ.rowHeight
      // A call from a participant to itself has no distance to route an
      // arrow across; nudge the visual endpoint right so it reads as a
      // distinct (if simplified) self-call loop instead of a zero-length line.
      const isSelfCall = Math.abs(x1 - x2) < 1
      const drawX2 = isSelfCall ? x1 + 90 : x2

      for (const x of isSelfCall ? [x1] : [x1, x2]) {
        const tick = figma.createRectangle()
        tick.name = 'Activation'
        tick.resize(SEQ.activationWidth, SEQ.activationHeight)
        section.appendChild(tick)
        tick.x = x - SEQ.activationWidth / 2
        tick.y = y - SEQ.activationHeight / 2
        tick.fills = [{ type: 'SOLID', color: BROWSER_CHROME }]
      }

      // Floating connector endpoints (no endpointNodeId) are positioned in
      // page-absolute coordinates even once the connector is parented into
      // the section — unlike a plain shape's x/y, which becomes
      // section-relative on reparenting. Add the section's own page
      // position back in, or every connector ends up drawn off in some
      // unrelated corner of the canvas instead of on the diagram.
      const connector = figma.createConnector()
      section.appendChild(connector)
      connector.connectorLineType = isSelfCall ? 'ELBOWED' : 'STRAIGHT'
      connector.connectorStart = { position: { x: section.x + x1, y: section.y + y } }
      connector.connectorEnd = {
        position: { x: section.x + drawX2, y: section.y + (isSelfCall ? y + SEQ.rowHeight * 0.4 : y) },
      }

      const rgb = edge.color ? colorForName(edge.color) : EDGE_DEFAULT_GRAY
      connector.strokes = [{ type: 'SOLID', color: rgb }]
      connector.strokeWeight = 2
      if ((edge.line || 'dashed').toLowerCase() !== 'solid') {
        connector.dashPattern = [8, 6]
      }
      connector.connectorEndStrokeCap = edge.head === 'none' ? 'NONE' : 'ARROW_EQUILATERAL'
      connector.connectorStartStrokeCap = 'NONE'

      if (edge.label) {
        const stepNumber = `${index + 1}`
        const badgeText = figma.createText()
        badgeText.name = 'Paso'
        badgeText.fontName = { family: 'Inter', style: 'Bold' }
        badgeText.characters = stepNumber
        badgeText.fontSize = SEQ.badgeFontSize
        badgeText.textAlignHorizontal = 'CENTER'
        badgeText.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
        const badgeWidth = Math.max(badgeText.width + 12, SEQ.badgeHeight)

        const badge = figma.createRectangle()
        badge.name = 'Badge'
        badge.resize(badgeWidth, SEQ.badgeHeight)
        badge.cornerRadius = 5
        badge.fills = [{ type: 'SOLID', color: SEQ_BADGE_BG, opacity: 0.85 }]

        const labelText = figma.createText()
        labelText.name = 'Mensaje'
        labelText.fontName = { family: 'Inter', style: 'Regular' }
        labelText.characters = edge.label
        labelText.fontSize = SEQ.labelFontSize
        labelText.fills = [{ type: 'SOLID', color: EDGE_DEFAULT_GRAY }]

        const groupWidth = badgeWidth + SEQ.badgeGap + labelText.width
        const groupLeft = (x1 + drawX2) / 2 - groupWidth / 2
        const groupTop = y - SEQ.labelGapAboveLine - SEQ.badgeHeight

        section.appendChild(badge)
        badge.x = groupLeft
        badge.y = groupTop

        section.appendChild(badgeText)
        badgeText.x = groupLeft + (badgeWidth - badgeText.width) / 2
        badgeText.y = groupTop + (SEQ.badgeHeight - badgeText.height) / 2

        section.appendChild(labelText)
        labelText.x = groupLeft + badgeWidth + SEQ.badgeGap
        labelText.y = groupTop + (SEQ.badgeHeight - labelText.height) / 2
      }
    } catch (err) {
      skippedEdges++
      if (!firstEdgeError) firstEdgeError = err instanceof Error ? err.message : String(err)
    }
  }

  figma.currentPage.selection = [section]
  figma.viewport.scrollAndZoomIntoView([section])

  return {
    nodeCount: lifelineX.size,
    edgeCount: steps.length - skippedEdges,
    skippedNodes,
    skippedEdges,
    firstNodeError,
    firstEdgeError,
  }
}
