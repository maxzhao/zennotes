import { useState } from 'react'
import { useStore } from '../store'
import { useServerLinks } from '../lib/server-links'
import { assetTabPath } from '../lib/asset-tabs'
import { offerCreateNoteFromLink } from '../lib/create-note-from-link'
import type { LinkReference } from '@zennotes/bridge-contract/maxa'

function ReferenceRow({
  reference: r,
  incoming = false
}: {
  reference: LinkReference
  incoming?: boolean
}): JSX.Element {
  const notes = useStore((s) => s.notes)
  const path = incoming ? r.source : r.path
  const meta = notes.find((n) => n.path === path)
  const open = (): void => {
    const s = useStore.getState()
    if (path) void (meta ? s.selectNote(path) : s.openNoteInTab(assetTabPath(path)))
    else if (r.status === 'missing') void offerCreateNoteFromLink(r.raw)
  }
  return (
    <div className="mb-2 rounded border border-paper-300 p-2">
      {!incoming && <button className="mb-1 block text-left text-xs text-accent" onClick={() => {
        const state = useStore.getState()
        if (r.line) void window.zen.readNote(r.source).then((note) => {
          const offset = note.body.split('\n').slice(0, r.line! - 1).reduce((n, line) => n + line.length + 1, 0)
          void state.openNoteAtOffset(r.source, offset)
        })
        else void state.selectNote(r.source)
      }}>Open source: {notes.find((n) => n.path === r.source)?.displayTitle || r.source}{r.line ? `:${r.line}` : r.nodeId ? ` · node ${r.nodeId}` : ''}</button>}
      <button
        data-connections-path={path ?? ''}
        onClick={open}
        className="text-left text-sm text-accent"
      >
        {meta?.displayTitle || meta?.title || path || r.raw}
      </button>
      <div className="text-xs text-ink-500">
        {r.source}
        {r.line ? `:${r.line}` : r.nodeId ? ` · node ${r.nodeId}` : ''} · {r.kind} · {r.status}
      </div>
      {r.status === 'ambiguous' && (
        <div className="text-xs">Candidates: {r.candidates.join(', ')}</div>
      )}
    </div>
  )
}
export function ServerUnresolvedLinksView(): JSX.Element {
  const { links, error, loading } = useServerLinks('unresolved')
  const [query, setQuery] = useState('')
  return (
    <section className="flex-1 overflow-auto p-5">
      <h3>Unresolved links</h3>
      <input
        aria-label="Filter unresolved links"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="my-3 w-full bg-paper-100 p-2"
      />
      {error && <p role="alert">{error}</p>}
      {loading && 'Loading…'}
      {links
        .filter((r) =>
          `${r.raw} ${r.source} ${r.candidates.join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
        .map((r, i) => (
          <ReferenceRow key={i} reference={r} />
        ))}
    </section>
  )
}
