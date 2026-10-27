// JSON Canvas 1.0: the stored document is the authority. UI projections must
// never replace it with React Flow's own node/edge objects.
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'
export interface CanvasNode {
  [key: string]: unknown
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  text?: string
  file?: string
  subpath?: string
  url?: string
  label?: string
  color?: string
  background?: string
  backgroundStyle?: 'cover' | 'ratio' | 'repeat'
}
export interface CanvasEdge {
  [key: string]: unknown
  id: string
  fromNode: string
  toNode: string
  fromSide?: CanvasSide
  toSide?: CanvasSide
  fromEnd?: 'none' | 'arrow'
  toEnd?: 'none' | 'arrow'
  color?: string
  label?: string
}
export interface CanvasDocument {
  [key: string]: unknown
  nodes?: CanvasNode[]
  edges?: CanvasEdge[]
}
export function parseCanvas(raw: string): CanvasDocument {
  const doc = JSON.parse(raw) as CanvasDocument
  if (!doc || typeof doc !== 'object' || Array.isArray(doc))
    throw new Error('Canvas must be a JSON object.')
  if (doc.nodes !== undefined && !Array.isArray(doc.nodes))
    throw new Error('Canvas nodes must be an array.')
  if (doc.edges !== undefined && !Array.isArray(doc.edges))
    throw new Error('Canvas edges must be an array.')
  const ids = new Set<string>()
  for (const n of doc.nodes ?? []) {
    if (
      !n ||
      typeof n.id !== 'string' ||
      typeof n.type !== 'string' ||
      ids.has(n.id) ||
      !['x', 'y', 'width', 'height'].every(
        (k) => typeof n[k] === 'number' && Number.isInteger(n[k])
      )
    )
      throw new Error('Invalid Canvas node or duplicate id.')
    ids.add(n.id)
  }
  for (const e of doc.edges ?? []) {
    if (
      !e ||
      typeof e.id !== 'string' ||
      ids.has(e.id) ||
      !ids.has(e.fromNode) ||
      !ids.has(e.toNode)
    )
      throw new Error('Invalid Canvas edge or duplicate id.')
    ids.add(e.id)
  }
  return doc
}
export function serializeCanvas(doc: CanvasDocument): string {
  return JSON.stringify(doc, null, 2) + '\n'
}
export function patchCanvasNode(
  doc: CanvasDocument,
  id: string,
  patch: Partial<CanvasNode>
): CanvasDocument {
  const next = { ...patch }
  for (const k of ['x', 'y', 'width', 'height'] as const)
    if (typeof next[k] === 'number') next[k] = Math.round(next[k]!)
  return { ...doc, nodes: doc.nodes?.map((n) => (n.id === id ? { ...n, ...next } : n)) }
}
export function containedNodes(group: CanvasNode, nodes: CanvasNode[]): CanvasNode[] {
  return nodes.filter(
    (n) =>
      n.id !== group.id &&
      n.x >= group.x &&
      n.y >= group.y &&
      n.x + n.width <= group.x + group.width &&
      n.y + n.height <= group.y + group.height
  )
}
export function canvasNodeSummary(n?: CanvasNode): string {
  if (!n) return '(empty)'
  const body = (n.text || (n.file ? n.file + (n.subpath || '') : '') || n.url || n.label || '')
    .slice(0, 80)
    .replace(/\r?\n/g, ' ')
  return `${n.type} ${n.id} — ${body || '(empty)'}`
}
export const canvasColors: Record<string, string> = {
  '1': '#d95858',
  '2': '#e6953c',
  '3': '#c8af36',
  '4': '#5d9f5a',
  '5': '#429ba8',
  '6': '#9b6acd'
}
export const canvasColor = (color?: string): string =>
  canvasColors[color ?? ''] ||
  (/^#[0-9a-f]{6}$/i.test(color ?? '') ? color! : 'rgb(var(--z-accent))')
