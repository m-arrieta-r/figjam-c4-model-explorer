// Minimal shape of LikeC4's exported JSON we actually rely on.
// Produced by: `npx likec4 export json -o diagram.json`
// (see @likec4/core `DiagramView` / `ComputedNode` / `ComputedEdge` types)

export interface LikeC4Point {
  0: number
  1: number
}

export interface LikeC4BBox {
  x: number
  y: number
  width: number
  height: number
}

// LikeC4 stores rich-text fields (description, some technology values) as
// either a plain string or an object carrying the source format:
// { txt: "..." } for plain text, { md: "..." } for Markdown.
export type LikeC4Text = string | { txt?: string; md?: string } | null | undefined

export interface LikeC4Node {
  id: string
  parent: string | null
  title: string
  description?: LikeC4Text
  technology?: LikeC4Text
  kind?: string
  shape?: string
  notation?: string
  color?: string
  tags?: string[]
  level: number
  children: string[]
  x: number
  y: number
  width: number
  height: number
}

// Unwraps a LikeC4Text into a plain string suitable for figma text nodes.
export function likeC4Text(value: LikeC4Text): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.txt ?? value.md ?? ''
}

export interface LikeC4Edge {
  id: string
  parent: string | null
  source: string
  target: string
  label?: string | null
  color?: string
  line?: string
  head?: string | null
  tail?: string | null
  points: Array<[number, number]>
}

export interface LikeC4View {
  id: string
  title?: string | null
  description?: string | null
  bounds: LikeC4BBox
  nodes: LikeC4Node[]
  edges: LikeC4Edge[]
  // Dynamic (sequence) views: "sequence" marks a `likec4 export json` dynamic
  // view meant to be rendered as a UML-style sequence diagram (actors +
  // lifelines + numbered steps) rather than a plain node/connector graph.
  // `flow` gives the step (edge id) order when present; edges are already in
  // that order in practice, but this is the authoritative source.
  variant?: string
  flow?: string[]
  // Present on sequence-variant dynamic views: the authoritative left-to-
  // right actor order and x position for the UML lifeline layout. The
  // top-level `nodes[].x` is computed for a *different* rendering (LikeC4's
  // own elbowed-diagram view of the same steps) and can overlap wildly if
  // reused for a lifeline layout — always prefer this when present.
  sequenceLayout?: { actors: Array<{ id: string; x: number }> }
}

export interface LikeC4Export {
  views: Record<string, LikeC4View>
  // When a view's node positions have been manually adjusted in the LikeC4
  // editor (dragging elements around), the adjusted positions live here
  // instead of in `views` — the auto-layout engine doesn't know about them.
  manualLayouts?: Record<string, LikeC4View>
  projectId?: string
  project?: { id?: string }
}

export function isLikeC4View(value: any): value is LikeC4View {
  return (
    value &&
    typeof value === 'object' &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    value.bounds
  )
}

export function isLikeC4Export(value: any): value is LikeC4Export {
  return value && typeof value === 'object' && value.views && typeof value.views === 'object'
}

// Extracts a { [viewId]: LikeC4View } map from any of:
// - a full single-project CLI export ({ views: {...} })
// - an array of per-project exports (when the workspace has multiple
//   LikeC4 projects, `likec4 export json` emits one export object per
//   project instead of a single one)
// - a single already-selected view object
export function extractViews(parsed: any): Record<string, LikeC4View> {
  if (Array.isArray(parsed)) {
    const merged: Record<string, LikeC4View> = {}
    for (const entry of parsed) {
      if (!isLikeC4Export(entry)) continue
      const projectId: string | undefined = entry.projectId || entry.project?.id
      for (const [viewId, view] of Object.entries(entry.views)) {
        // Different projects can reuse the same view id (e.g. "index");
        // namespace by project to avoid one silently overwriting another.
        const key = projectId && projectId !== 'default' ? `${projectId}/${viewId}` : viewId
        // Prefer the manually-adjusted layout over the auto-computed one,
        // when the user has repositioned elements in the LikeC4 editor.
        merged[key] = (entry.manualLayouts?.[viewId] as LikeC4View) || (view as LikeC4View)
      }
    }
    if (Object.keys(merged).length === 0) {
      throw new Error('This array of exports has no views in it.')
    }
    return merged
  }
  if (isLikeC4Export(parsed)) {
    const merged: Record<string, LikeC4View> = {}
    for (const [viewId, view] of Object.entries(parsed.views)) {
      merged[viewId] = parsed.manualLayouts?.[viewId] || view
    }
    return merged
  }
  if (isLikeC4View(parsed)) {
    const id = parsed.id || 'view'
    return { [id]: parsed }
  }
  throw new Error(
    "Couldn't recognize this as LikeC4 JSON. Expected the output of `likec4 export json`, or a single view object with nodes/edges/bounds."
  )
}
