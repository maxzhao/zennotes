import { useContextCopyRuntime } from '../lib/context-copy'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useMaxaPanels } from '../lib/maxa-panels'
import { focusEditorNormalMode } from '../lib/editor-focus'
import { isImeComposing } from '../lib/ime'
import {
  useStableSidebarIdxBase,
  type SidebarIdxCounter,
  type SidebarIdxPass,
} from '../lib/sidebar-idx-counter'
import { Modal } from './ui/Modal'

function useRecentNotes() {
  const notes = useStore((s) => s.notes)
  // The server-owned note list already applies exclusions and watcher updates.
  return useMemo(
    () =>
      notes
        .filter((n) => n.folder !== 'trash')
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [notes],
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
export function SidebarRecent({
  idxCounter,
  idxPass,
  vimCursor,
}: {
  idxCounter: SidebarIdxCounter
  idxPass: SidebarIdxPass
  vimCursor: number
}): JSX.Element {
  const notes = useRecentNotes()
  const selectedPath = useStore((s) => s.selectedPath)
  useRecentClock()
  useStableSidebarIdxBase(idxCounter, idxPass)
  return (
    <ul aria-label="最近">
      {notes.slice(0, 50).map((note) => {
        const idx = idxCounter.value++
        return (
          <li key={note.path}>
            <button
              type="button"
              title={note.path.slice(0, note.path.lastIndexOf('/')) || '/'}
              data-sidebar-idx={idx}
              data-sidebar-type="note"
              data-sidebar-path={note.path}
              className={`flex h-[var(--z-sidebar-row-h)] w-full items-center gap-2 rounded px-2 text-left text-xs ${vimCursor === idx ? 'vim-cursor' : selectedPath === note.path ? 'bg-paper-300/70 text-ink-900' : 'text-ink-700 [@media(hover:hover)]:hover:bg-paper-200/70'}`}
              onClick={() =>
                void useStore
                  .getState()
                  .selectNote(note.path)
                  .then(() => focusEditorNormalMode())
              }
            >
              <span className="min-w-0 flex-1 truncate">
                {note.displayTitle || note.title}
              </span>
              <time
                className="shrink-0 text-right text-2xs tabular-nums text-ink-400"
                dateTime={new Date(note.updatedAt).toISOString()}
              >
                {relativeTime(note.updatedAt)}
              </time>
            </button>
          </li>
        )
      })}
      {!notes.length && (
        <li className="px-2 py-1 text-xs text-ink-400">No recent files.</li>
      )}
    </ul>
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
        .includes(q),
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
          aria-activedescendant={
            filtered.length ? `recent-option-${active}` : undefined
          }
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
                  Math.min(
                    filtered.length - 1,
                    active + (e.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
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
                <span className="block truncate">
                  {note.displayTitle || note.title}
                </span>
                <small className="block truncate text-xs text-ink-400">
                  {note.path}
                </small>
              </span>
              <span className="shrink-0 text-xs text-ink-400">
                {relativeTime(note.updatedAt)}
              </span>
            </button>
          </li>
        ))}
        {!filtered.length && (
          <li className="p-4 text-center text-sm text-ink-400">
            No matching recent files.
          </li>
        )}
      </ul>
    </Modal>
  )
}
export function MaxaSidePanes(): JSX.Element | null {
  useContextCopyRuntime()
  const recent = useMaxaPanels((s) => s.recent)
  return recent ? <RecentPalette /> : null
}
