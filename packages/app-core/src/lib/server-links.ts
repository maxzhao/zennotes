import { useEffect, useState } from 'react'
import type { LinkReference } from '@zennotes/bridge-contract/maxa'
import { useStore } from '../store'
import { useToastStore } from './toast'
import { openWikilinkTarget } from './wikilink-navigation'
import { assetTabPath } from './asset-tabs'
import { offerCreateNoteFromLink } from './create-note-from-link'

export function useServerLinks(
  kind: 'outgoing' | 'backlinks' | 'unresolved',
  path?: string
): { links: LinkReference[]; error: string; loading: boolean } {
  const notes = useStore((s) => s.notes)
  const root = useStore((s) => s.vault?.root)
  const [result, setResult] = useState({ links: [] as LinkReference[], error: '', loading: true })
  useEffect(() => {
    let cancelled = false
    const get = window.zen?.getLinks
    if (!get || (kind !== 'unresolved' && !path)) return
    setResult({ links: [], error: '', loading: true })
    void get(kind, path).then(
      (links) => {
        if (!cancelled) setResult({ links: links ?? [], error: '', loading: false })
      },
      (e) => {
        if (!cancelled) setResult({ links: [], error: String(e), loading: false })
      }
    )
    return () => {
      cancelled = true
    }
  }, [kind, path, notes, root])
  return result
}

function rawTarget(raw: string): string {
  return raw.replace(/^!?\[\[|\]\]$/g, '').split('|')[0]
}
export async function followServerLink(
  target: string,
  source: string,
  kind: 'wikilink' | 'markdown'
): Promise<void> {
  try {
    if (target.startsWith('#')) {
      await openWikilinkTarget(source, target)
      return
    }
    const refs = await window.zen?.getLinks!('outgoing', source)
    let wanted = target
    if (kind === 'markdown')
      try {
        wanted = decodeURIComponent(target)
      } catch {
        /* retain malformed text for an actionable error */
      }
    const ref = refs.find(
      (r) =>
        (kind === 'wikilink'
          ? r.kind === 'wikilink' || r.kind === 'embed'
          : r.kind === 'markdown') && rawTarget(r.raw) === rawTarget(wanted)
    )
    if (!ref)
      throw new Error('Save this link before following it; it is not in the server index yet.')
    if (ref.status === 'ambiguous')
      throw new Error(`Ambiguous link: ${target}. Candidates: ${ref.candidates.join(', ')}`)
    if (ref.status === 'missing') {
      await offerCreateNoteFromLink(target)
      return
    }
    if (!ref.path) throw new Error('Server returned a resolved link without a path.')
    const state = useStore.getState()
    if (state.notes.some((n) => n.path === ref.path))
      await openWikilinkTarget(ref.path, ref.anchor ? '#' + ref.anchor.replace(/^#/, '') : '')
    else await state.openNoteInTab(assetTabPath(ref.path))
  } catch (e) {
    useToastStore.getState().addToast(String(e), 'error')
  }
}
