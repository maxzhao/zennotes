import { describe, expect, it } from 'vitest'
import {
  coveringBlock,
  formatNoteContext,
  formatCanvasContext,
  resolveCanvasSubpath
} from './context-format'
import type { CanvasDocument, CanvasNode } from './json-canvas'

describe('source context formatting', () => {
  it('keeps exact source lines including frontmatter offsets and uses a safe fence', () => {
    const source = '---\ntitle: Semantic\n---\n\n# Heading\n\n```js\nconst x = `a`\n```\n'
    expect(formatNoteContext('specs/A.md', source, { start: 7, end: 9 }, '.maxa/')).toBe(
      '<note-context>\nfile: .maxa/specs/A.md\nlines: 7-9\n</note-context>\n\n````markdown\n```js\nconst x = `a`\n```\n````'
    )
    expect(coveringBlock(source, 8)).toEqual({ start: 7, end: 9 })
  })
  it('uses the smallest source block covering a nested list selection', () => {
    expect(coveringBlock('Intro\n\n- alpha\n  - beta\n\nAfter', 4)).toEqual({ start: 4, end: 4 })
    expect(coveringBlock('Intro\n\n- alpha\n  - beta\n\nAfter', 3, 4)).toEqual({ start: 3, end: 4 })
  })
  it('resolves real headings and block anchors but not examples in fenced code', () => {
    const source =
      '---\ntitle: A\n---\n```md\n# Hidden\nnot an anchor ^fake\n```\n# Real\nFirst ^id\n## Child\nBody\n# Next\nEnd'
    expect(resolveCanvasSubpath(source, '#Hidden')).toBeNull()
    expect(resolveCanvasSubpath(source, '#^fake')).toBeNull()
    expect(resolveCanvasSubpath(source, '#real')).toEqual({ start: 8, end: 11 })
    expect(resolveCanvasSubpath(source, '#^id')).toEqual({ start: 9, end: 9 })
  })
})
describe('Canvas context formatting', () => {
  const text: CanvasNode = {
    id: 'a',
    type: 'text',
    x: 0,
    y: 20,
    width: 100,
    height: 80,
    text: 'Hello ``` world'
  }
  const file: CanvasNode = {
    id: 'f',
    type: 'file',
    x: 120,
    y: 20,
    width: 100,
    height: 80,
    file: 'A.md',
    subpath: '#Part'
  }
  const group: CanvasNode = {
    id: 'g',
    type: 'group',
    x: -10,
    y: 0,
    width: 250,
    height: 120,
    label: 'Scope'
  }
  const doc: CanvasDocument = {
    nodes: [group, text, file],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'f', label: 'related' }]
  }
  it('copies text with component identity and position', () => {
    expect(formatCanvasContext('map.canvas', doc, text, '.maxa/')).toBe(
      '<canvas-context>\ncanvas: .maxa/map.canvas\ncomponent: node\nid: a\ntype: text\nposition: x=0 y=20 width=100 height=80\n</canvas-context>\n\n````markdown\nHello ``` world\n````'
    )
  })
  it('reports resolved and unresolved file subpaths without inventing content', () => {
    const resolved = formatCanvasContext('map.canvas', doc, file, '', '# Part\nbody\n# Other\nno')
    expect(resolved).toContain('subpath_resolved: true\nlines: 1-2')
    expect(resolved).toContain('```markdown\n# Part\nbody\n```')
    expect(formatCanvasContext('map.canvas', doc, file)).toMatch(
      /subpath_resolved: false\n<\/canvas-context>$/
    )
    expect(formatCanvasContext('map.canvas', doc, { ...file, subpath: undefined })).not.toContain(
      'subpath_resolved'
    )
  })
  it('summarizes containment and edge relations', () => {
    const g = formatCanvasContext('map.canvas', doc, group)
    expect(g).toContain('contains: 2 nodes')
    expect(g).toContain('## Contained nodes\n- text a — Hello ``` world\n- file f — A.md#Part')
    const edge = formatCanvasContext('map.canvas', doc, doc.edges![0])
    expect(edge).toContain('component: edge\nid: e\nfromNode: a\ntoNode: f\nlabel: related')
    expect(edge).toContain(
      '## Relation\n- From: text a — Hello ``` world\n- To: file f — A.md#Part'
    )
  })
})
