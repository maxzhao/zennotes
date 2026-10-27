import { copyCurrentContext } from '../lib/context-copy'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useMaxaPanels } from '../lib/maxa-panels'
import { focusEditorNormalMode } from '../lib/editor-focus'
import { isImeComposing } from '../lib/ime'
import { ChevronRightIcon } from './icons'
import { Modal } from './ui/Modal'
import { LazyPreview as Preview } from './LazyPreview'

const RECENT_COLLAPSED_KEY = 'zen:recent-collapsed'
function useRecentNotes() {
  const notes = useStore((s) => s.notes)
  // The server-owned note list already applies exclusions and watcher updates.
  return useMemo(
    () => notes.filter((n) => n.folder !== 'trash').sort((a, b) => b.updatedAt - a.updatedAt),
    [notes]
  )
}
function useRecentClock(): void {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(timer)
  }, [])
}
function relativeTime(updatedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
  return seconds < 60
    ? 'just now'
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`
}
export function SidebarRecent(): JSX.Element {
  const notes = useRecentNotes()
  useRecentClock()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(RECENT_COLLAPSED_KEY) !== 'false'
    } catch {
      return true
    }
  })
  return (
    <section aria-label="Recent" className="shrink-0 px-3 py-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls="sidebar-recent-list"
        onClick={() =>
          setCollapsed((previous) => {
            const next = !previous
            try {
              localStorage.setItem(RECENT_COLLAPSED_KEY, String(next))
            } catch {
              /* storage may be disabled */
            }
            return next
          })
        }
        className="flex h-7 w-full items-center gap-1 rounded px-1 text-left text-xs font-medium text-ink-500 hover:bg-paper-200/70"
      >
        <ChevronRightIcon
          className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`}
        />
        Recent
      </button>
      {!collapsed && (
        <ul
          id="sidebar-recent-list"
          aria-label="Recent files"
          className="overflow-y-auto overscroll-contain"
          style={{ maxHeight: 'min(14rem, 25vh)' }}
        >
          {notes.slice(0, 50).map((note) => (
            <li key={note.path}>
              <button
                type="button"
                title={note.path}
                className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-ink-700 hover:bg-paper-200/70"
                onClick={() =>
                  void useStore
                    .getState()
                    .selectNote(note.path)
                    .then(() => focusEditorNormalMode())
                }
              >
                <span className="min-w-0 flex-1 truncate">{note.displayTitle || note.title}</span>
                <time
                  className="shrink-0 text-right text-2xs tabular-nums text-ink-400"
                  dateTime={new Date(note.updatedAt).toISOString()}
                >
                  {relativeTime(note.updatedAt)}
                </time>
              </button>
            </li>
          ))}
          {!notes.length && <li className="px-2 py-1 text-xs text-ink-400">No recent files.</li>}
        </ul>
      )}
    </section>
  )
}
function RecentPalette(): JSX.Element {
  const notes = useRecentNotes()
  useRecentClock()
  const [query, setQuery] = useState(''),
    [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLUListElement>(null)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes.filter((n) =>
      `${n.displayTitle || n.title} ${n.title} ${n.path} ${(n.aliases ?? []).join(' ')}`
        .toLowerCase()
        .includes(q)
    )
  }, [notes, query])
  const active = Math.min(cursor, Math.max(0, filtered.length - 1))
  const close = (): void => useMaxaPanels.setState({ recent: false })
  const open = (path: string): void => {
    close()
    void useStore
      .getState()
      .selectNote(path)
      .then(() => focusEditorNormalMode())
  }
  useEffect(() => {
    list.current
      ?.querySelector(`[data-recent-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, filtered])
  return (
    <Modal
      size="lg"
      layer="palette"
      labelledBy="recent-palette-title"
      initialFocus={input}
      onClose={close}
    >
      <div className="border-b border-paper-300 p-3">
        <h3 id="recent-palette-title" className="mb-2 text-sm font-medium">
          Open Recent
        </h3>
        <input
          ref={input}
          aria-label="Filter Recent"
          aria-controls="recent-palette-list"
          aria-activedescendant={filtered.length ? `recent-option-${active}` : undefined}
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          placeholder="Filter recent files…"
          className="w-full rounded bg-paper-50 px-3 py-2 text-sm outline-none"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor(
                Math.max(
                  0,
                  Math.min(filtered.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))
                )
              )
            }
            if (e.key === 'Enter' && filtered[active]) {
              e.preventDefault()
              open(filtered[active].path)
            }
          }}
        />
      </div>
      <ul
        ref={list}
        id="recent-palette-list"
        role="listbox"
        aria-label="Recent files"
        className="max-h-[55vh] overflow-y-auto p-2"
      >
        {filtered.map((note, index) => (
          <li
            key={note.path}
            id={`recent-option-${index}`}
            role="option"
            aria-selected={index === active}
            data-recent-index={index}
          >
            <button
              type="button"
              title={note.path}
              tabIndex={-1}
              onClick={() => open(note.path)}
              onMouseEnter={() => setCursor(index)}
              className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm ${index === active ? 'bg-paper-200 text-ink-900' : 'text-ink-700 hover:bg-paper-200/70'}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{note.displayTitle || note.title}</span>
                <small className="block truncate text-xs text-ink-400">{note.path}</small>
              </span>
              <span className="shrink-0 text-xs text-ink-400">{relativeTime(note.updatedAt)}</span>
            </button>
          </li>
        ))}
        {!filtered.length && (
          <li className="p-4 text-center text-sm text-ink-400">No matching recent files.</li>
        )}
      </ul>
    </Modal>
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
      {recent && <RecentPalette />}
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
