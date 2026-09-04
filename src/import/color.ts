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
