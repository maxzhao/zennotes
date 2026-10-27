import { useState } from 'react'
import { useStore } from '../store'
import { conflictKey, useVersionConflicts } from '../lib/version-conflicts'
import { useToastStore } from '../lib/toast'

export function VersionConflictBanner({ path }: { path: string }): JSX.Element | null {
  const root = useStore((s) => s.vault?.root)
  const key = conflictKey(root, path)
  const error = useVersionConflicts((s) => s.conflicts[key])
  const local = useStore((s) => s.noteContents[path]?.body ?? '')
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!error) return null
  const resolve = async (reload: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (reload) {
        const disk = await window.zen.readNote(path)
        if (useStore.getState().vault?.root !== root) return
        useStore.setState((s) => ({
          noteContents: { ...s.noteContents, [path]: disk },
          noteDirty: { ...s.noteDirty, [path]: false },
          ...(s.selectedPath === path ? { activeNote: disk, activeDirty: false } : {})
        }))
      } else {
        useStore.setState((s) => ({
          noteContents: {
            ...s.noteContents,
            [path]: { ...s.noteContents[path], version: error.version }
          }
        }))
      }
      useVersionConflicts.getState().clear(key)
      if (!reload) await useStore.getState().persistNote(path)
    } catch (e) {
      useToastStore.getState().addToast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div role="alert" className="border-b border-amber-500 bg-paper-100 p-3 text-sm">
      <strong>File changed on disk.</strong> Your unsaved buffer is kept; automatic saving is
      paused.
      <div className="flex gap-3 py-2">
        <button disabled={busy} onClick={() => void resolve(true)}>
          Reload disk (discard buffer)
        </button>
        <button disabled={busy} onClick={() => void resolve(false)}>
          Overwrite with buffer
        </button>
        <button onClick={() => setCompare(!compare)}>Compare both</button>
      </div>
      {compare && (
        <div className="grid max-h-96 grid-cols-2 gap-3 overflow-auto">
          <div>
            <h3>Unsaved buffer</h3>
            <pre className="whitespace-pre-wrap select-text">{local}</pre>
          </div>
          <div>
            <h3>Disk version at conflict</h3>
            <pre className="whitespace-pre-wrap select-text">{error.body}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
