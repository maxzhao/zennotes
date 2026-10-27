import { copyCurrentContext } from '../lib/context-copy'
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useMaxaPanels } from '../lib/maxa-panels'
import { LazyPreview as Preview } from './LazyPreview'

export function RecentView({ compact = false }: { compact?: boolean }): JSX.Element {
  const notes = useStore((s) => s.notes)
  const [query, setQuery] = useState('')
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(timer)
  }, [])
  const recent = notes
    .filter(
      (n) =>
        n.folder !== 'trash' &&
        `${n.displayTitle || n.title} ${n.path} ${(n.aliases ?? []).join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, compact ? 5 : 50)
  return (
    <section aria-label="Recent" className="min-h-0 overflow-auto p-3">
      <button className="font-semibold" onClick={() => useMaxaPanels.setState({ recent: true })}>
        Recent
      </button>
      {!compact && (
        <input
          autoFocus
          aria-label="Filter Recent"
          className="my-2 w-full bg-paper-100 p-2"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {recent.map((n) => {
        const seconds = Math.max(0, Math.floor((Date.now() - n.updatedAt) / 1000))
        const time =
          seconds < 60
            ? 'just now'
            : seconds < 3600
              ? `${Math.floor(seconds / 60)}m ago`
              : seconds < 86400
                ? `${Math.floor(seconds / 3600)}h ago`
                : `${Math.floor(seconds / 86400)}d ago`
        return (
          <button
            key={n.path}
            className="block w-full truncate py-1 text-left text-sm"
            title={n.path}
            onClick={() => void useStore.getState().selectNote(n.path)}
          >
            {n.displayTitle || n.title}
            <small className="block truncate text-ink-500">
              {n.path.split('/').slice(0, -1).join('/') || '/'} · {time}
            </small>
          </button>
        )
      })}
    </section>
  )
}
export function MaxaSidePanes(): JSX.Element {
  const { recent, translation } = useMaxaPanels()
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        e.stopPropagation()
        void copyCurrentContext()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])
  const root = useStore((s) => s.vault?.root)
  return (
    <>
      {recent && (
        <aside
          className="flex w-80 shrink-0 flex-col border-l border-paper-300"
          aria-label="Recent changes"
        >
          <button onClick={() => useMaxaPanels.setState({ recent: false })}>Close Recent</button>
          <RecentView />
        </aside>
      )}
      {translation && translation.root === root && (
        <aside
          className="flex min-w-64 w-[40%] resize-x flex-col overflow-auto border-l border-paper-300"
          aria-label="Translation split"
        >
          <header className="flex justify-between border-b border-paper-300 p-3">
            <h3>{translation.title} — Translation</h3>
            <button
              aria-label="Close translation"
              onClick={() => useMaxaPanels.setState({ translation: null })}
            >
              ×
            </button>
          </header>
          <Preview markdown={translation.body} notePath={translation.path} readOnly />
        </aside>
      )}
    </>
  )
}
