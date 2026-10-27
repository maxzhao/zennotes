import { describe, expect, it } from 'vitest'
import { parseCanvas, serializeCanvas, patchCanvasNode } from './json-canvas'

describe('JSON Canvas 1.0 round-trip fidelity', () => {
  const raw =
    '{ "extension": {"version": 3}, "nodes": [{"id":"group","type":"group","x":-40,"y":-20,"width":900,"height":600,"background":"img/a.png","backgroundStyle":"ratio","extra":{"v":[1,2]}},{"id":"text","type":"text","x":1,"y":2,"width":300,"height":200,"text":"# Trace\\n```lua\\nprint(1)\\n```","color":"4","unknown":true},{"id":"file","type":"file","x":400,"y":2,"width":300,"height":200,"file":"specs/A.md","subpath":"#^id"}], "edges":[{"id":"e","fromNode":"text","toNode":"file","fromSide":"right","toSide":"left","fromEnd":"none","toEnd":"arrow","color":"#abcdef","label":"uses","extra":17}] }'
  it('preserves unknown fields, node/edge order and JSON values on an unchanged save', () => {
    const result = serializeCanvas(parseCanvas(raw))
    expect(JSON.parse(result)).toEqual(JSON.parse(raw))
    expect(parseCanvas(result).nodes!.map((n) => n.id)).toEqual(['group', 'text', 'file'])
    expect(parseCanvas(result).edges![0].extra).toBe(17)
  })
  it('changes only the requested fields and rounds edited geometry to integers', () => {
    const doc = parseCanvas(raw),
      next = patchCanvasNode(doc, 'text', { x: 6.7, width: 321.2 })
    expect(next.nodes![1]).toEqual({ ...doc.nodes![1], x: 7, width: 321 })
    expect(next.nodes![0]).toBe(doc.nodes![0])
    expect(next.edges).toBe(doc.edges)
    expect(next.extension).toEqual(doc.extension)
    expect(doc.nodes![1].x).toBe(1)
  })
  it('keeps optional arrays absent and refuses malformed files rather than replacing them', () => {
    expect(serializeCanvas(parseCanvas('{"future":true}'))).toBe('{\n  "future": true\n}\n')
    expect(() => parseCanvas('not JSON')).toThrow()
    expect(() =>
      parseCanvas('{"nodes":[{"id":"x","type":"text","x":1.5,"y":0,"width":20,"height":20}]}')
    ).toThrow()
  })
})
