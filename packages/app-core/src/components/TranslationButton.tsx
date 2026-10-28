import { useEffect } from 'react'
import { useStore } from '../store'
import {
  useMaxaPanels,
  refreshTranslationStatus,
  translateNote,
  translationAllowed
} from '../lib/maxa-panels'

export function TranslationButton({
  paneId,
  path,
  translated
}: {
  paneId: string
  path: string
  translated: boolean
}): JSX.Element | null {
  const root = useStore((s) => s.vault?.root)
  const dirty = useStore((s) => s.noteDirty[path])
  const body = useStore((s) => s.noteContents[path]?.body)
  const status = useMaxaPanels(
    (s) => s.translations[(root ?? '') + '\n' + path]
  )
  useEffect(() => {
    if (translationAllowed(path) && !dirty) void refreshTranslationStatus(path)
  }, [root, path, dirty, body])
  if (!window.zen.translationCacheStatus || !translationAllowed(path))
    return null
  const label = status?.state ?? 'untranslated'
  return (
    <button
      type="button"
      title={translated ? 'Return to original' : status?.error ?? `Translation: ${label}`}
      aria-label={translated ? 'Show original' : `Translation: ${label}`}
      aria-pressed={translated}
      disabled={!translated && label === 'translating'}
      className={`rounded px-2 py-1 text-xs hover:bg-paper-200 disabled:opacity-50 ${translated ? 'bg-paper-200 text-ink-900' : ''}`}
      onClick={() => void translateNote(path, paneId)}
    >
      {translated ? 'Show original' : `Translate · ${label}`}
    </button>
  )
}
