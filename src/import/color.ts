export interface RGB {
  r: number
  g: number
  b: number
}

function hex(r: number, g: number, b: number): RGB {
  return { r: r / 255, g: g / 255, b: b / 255 }
}

// Approximate palette matching LikeC4's built-in color names
// (https://likec4.dev/dsl/color/) so imported diagrams look familiar.
const PALETTE: Record<string, RGB> = {
  primary: hex(59, 130, 246),
  secondary: hex(100, 116, 139),
  muted: hex(148, 163, 184),
  gray: hex(107, 114, 128),
  slate: hex(100, 116, 139),
  zinc: hex(113, 113, 122),
  neutral: hex(115, 115, 115),
  stone: hex(120, 113, 108),
  red: hex(239, 68, 68),
  orange: hex(249, 115, 22),
  amber: hex(245, 158, 11),
  yellow: hex(234, 179, 8),
  lime: hex(132, 204, 22),
  green: hex(34, 197, 94),
  emerald: hex(16, 185, 129),
  teal: hex(20, 184, 166),
  cyan: hex(6, 182, 212),
  sky: hex(14, 165, 233),
  blue: hex(59, 130, 246),
  indigo: hex(99, 102, 241),
  violet: hex(139, 92, 246),
  purple: hex(168, 85, 247),
  fuchsia: hex(217, 70, 239),
  pink: hex(236, 72, 153),
  rose: hex(244, 63, 94),
}

// Deterministic fallback for unknown color names so different kinds still
// end up visually distinct instead of collapsing into one default color.
function hashToColor(name: string): RGB {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  return hslToRgb(hue, 0.55, 0.55)
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0,
    g = 0,
    b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return { r: r + m, g: g + m, b: b + m }
}

export function colorForName(name: string | undefined | null): RGB {
  if (!name) return PALETTE.primary
  const key = name.toLowerCase()
  return PALETTE[key] ?? hashToColor(key)
}

function rgbToHue(rgb: RGB): number {
  const { r, g, b } = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / delta) % 6
  else if (max === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

// The exact accent colors this plugin's dedicated card shapes already use
// for their default (colorless) case - captured from the user's real FigJam
// shapes (see the reference comments throughout import.ts). A LikeC4 color
// name that maps onto one of these families should render pixel-identical
// to that same default, not PALETTE's paler Tailwind swatch, so an explicit
// `color` looks like it belongs on the card instead of washing it out.
const CARD_PALETTE: Record<string, RGB> = {
  blue: hex(17, 104, 189), // #1168BD - BROWSER_CHROME
  primary: hex(17, 104, 189),
  sky: hex(17, 104, 189),
  cyan: hex(17, 104, 189),
  green: hex(41, 126, 6), // #297E06 - PERSON_MAIN_GREEN
  emerald: hex(41, 126, 6),
  teal: hex(41, 126, 6),
  lime: hex(41, 126, 6),
  amber: hex(237, 134, 9), // #ED8609 - SOFTWARE_SYSTEM_ORANGE
  orange: hex(237, 134, 9),
  yellow: hex(237, 134, 9),
  red: hex(191, 16, 29), // #BF101D - EXTERNAL_SYSTEM_BORDER_RED
  rose: hex(191, 16, 29),
  pink: hex(191, 16, 29),
  fuchsia: hex(191, 16, 29),
  indigo: hex(111, 66, 193), // #6F42C1 - CODE_CHROME
  violet: hex(111, 66, 193),
  purple: hex(111, 66, 193),
}

// Anything outside CARD_PALETTE (a custom/exotic name) keeps its resolved
// hue but gets re-flattened onto the same darker, more saturated band as
// the mapped colors above (roughly 25-48% lightness at 85%+ saturation),
// instead of PALETTE's paler ~55-60%-lightness Tailwind swatches.
export function cardAccentColor(name: string | undefined | null): RGB {
  if (!name) return CARD_PALETTE.blue
  const key = name.toLowerCase()
  const mapped = CARD_PALETTE[key]
  if (mapped) return mapped
  const hue = rgbToHue(colorForName(key))
  return hslToRgb(hue, 0.85, 0.4)
}
