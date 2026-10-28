import { parseOutline } from './outline'
import { parseBlockAnchors } from './block-anchors'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
export interface LineRange {
  start: number
  end: number
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
      out.push({
        start: node.position.start.line,
        end: node.position.end.line
      })
    // Inline spans aren't source blocks; lists and their items are.
    if (['root', 'list', 'listItem', 'blockquote'].includes(node.type))
      for (const child of node.children ?? [])
        walk(child as Parameters<typeof walk>[0])
  }
  walk(tree)
  return out
}
export function coveringBlock(
  source: string,
  start: number,
  end = start
): LineRange {
  return (
    sourceBlocks(source)
      .filter((r) => r.start <= start && r.end >= end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0] ?? { start, end }
  )
}
export function resolveCanvasSubpath(
  source: string,
  subpath: string
): LineRange | null {
  const anchor = subpath.replace(/^#/, '')
  if (anchor.startsWith('^')) {
    const found = parseBlockAnchors(source).find(
      (a) => a.id === anchor.slice(1)
    )
    if (!found) return null
    const range = coveringBlock(source, found.line)
    return { start: range.start, end: Math.max(range.end, found.markerLine) }
  }
  const outline = parseOutline(source),
    at = outline.findIndex(
      (h) => h.text.toLowerCase() === anchor.trim().toLowerCase()
    )
  if (at < 0) return null
  const next = outline.slice(at + 1).find((h) => h.level <= outline[at].level)
  return {
    start: outline[at].line,
    end: next ? next.line - 1 : source.split('\n').length
  }
}
