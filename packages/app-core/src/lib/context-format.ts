import { parseOutline } from './outline'
import { parseBlockAnchors } from './block-anchors'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import type { CanvasDocument, CanvasNode, CanvasEdge } from './json-canvas'
import { canvasNodeSummary, containedNodes } from './json-canvas'

export interface LineRange {
  start: number
  end: number
}
export function markdownFence(text: string): string {
  return '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)))
}
export function fencedMarkdown(text: string): string {
  const fence = markdownFence(text)
  return `${fence}markdown\n${text}\n${fence}`
}
export function sourceLines(source: string, range: LineRange): string {
  return source
    .split('\n')
    .slice(range.start - 1, range.end)
    .join('\n')
}
export function sourceBlocks(source: string): LineRange[] {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkGfm)
    .parse(source)
  const out: LineRange[] = []
  const walk = (node: {
    type: string
    position?: { start: { line: number }; end: { line: number } }
    children?: unknown[]
  }): void => {
    if (node.type !== 'root' && node.position)
      out.push({ start: node.position.start.line, end: node.position.end.line })
    // Inline spans aren't source blocks; lists and their items are.
    if (['root', 'list', 'listItem', 'blockquote'].includes(node.type))
      for (const child of node.children ?? []) walk(child as Parameters<typeof walk>[0])
  }
  walk(tree)
  return out
}
export function coveringBlock(source: string, start: number, end = start): LineRange {
  return (
    sourceBlocks(source)
      .filter((r) => r.start <= start && r.end >= end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? { start, end }
  )
}
export function formatNoteContext(
  path: string,
  source: string,
  range: LineRange,
  prefix = ''
): string {
  return `<note-context>\nfile: ${prefix}${path}\nlines: ${range.start}-${range.end}\n</note-context>\n\n${fencedMarkdown(sourceLines(source, range))}`
}
export function resolveCanvasSubpath(source: string, subpath: string): LineRange | null {
  const anchor = subpath.replace(/^#/, '')
  if (anchor.startsWith('^')) {
    const found = parseBlockAnchors(source).find((a) => a.id === anchor.slice(1))
    if (!found) return null
    const range = coveringBlock(source, found.line)
    return { start: range.start, end: Math.max(range.end, found.markerLine) }
  }
  const outline = parseOutline(source),
    at = outline.findIndex((h) => h.text.toLowerCase() === anchor.trim().toLowerCase())
  if (at < 0) return null
  const next = outline.slice(at + 1).find((h) => h.level <= outline[at].level)
  return { start: outline[at].line, end: next ? next.line - 1 : source.split('\n').length }
}
export function formatCanvasContext(
  path: string,
  doc: CanvasDocument,
  component: CanvasNode | CanvasEdge,
  prefix = '',
  fileSource?: string
): string {
  const node = 'type' in component,
    c = component as CanvasNode
  const header = [
    '<canvas-context>',
    `canvas: ${prefix}${path}`,
    `component: ${node ? 'node' : 'edge'}`,
    `id: ${component.id}`
  ]
  let body = ''
  if (node) {
    for (const key of ['type', 'file', 'subpath', 'url', 'label'] as const)
      if (c[key] !== undefined) header.push(`${key}: ${c[key]}`)
    header.push(`position: x=${c.x} y=${c.y} width=${c.width} height=${c.height}`)
    if (c.type === 'text') body = fencedMarkdown(c.text ?? '')
    if (c.type === 'file' && c.subpath) {
      const range = fileSource === undefined ? null : resolveCanvasSubpath(fileSource, c.subpath)
      header.push(`subpath_resolved: ${!!range}`)
      if (range) {
        header.push(`lines: ${range.start}-${range.end}`)
        body = fencedMarkdown(sourceLines(fileSource!, range))
      }
    }
    if (c.type === 'group') {
      const contained = containedNodes(c, doc.nodes ?? [])
      header.push(`contains: ${contained.length} nodes`)
      body = '## Contained nodes\n' + contained.map((n) => '- ' + canvasNodeSummary(n)).join('\n')
    }
  } else {
    const edge = component as CanvasEdge
    header.push(`fromNode: ${edge.fromNode}`, `toNode: ${edge.toNode}`)
    if (edge.label !== undefined) header.push(`label: ${edge.label}`)
    body = `## Relation\n- From: ${canvasNodeSummary(doc.nodes?.find((n) => n.id === edge.fromNode))}\n- To: ${canvasNodeSummary(doc.nodes?.find((n) => n.id === edge.toNode))}`
  }
  header.push('</canvas-context>')
  return header.join('\n') + (body ? '\n\n' + body : '')
}
