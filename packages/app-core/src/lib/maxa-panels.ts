import { create } from 'zustand'
import { useStore } from '../store'
import { useToastStore } from './toast'
import { confirmApp } from './confirm-requests'
import type { TranslationResult } from '@zennotes/bridge-contract/maxa'
interface TranslationPane {
  root: string
  source: string
  title: string
  body: string
}
export type TranslationState = {
  state: 'untranslated' | 'translated' | 'translating' | 'failed'
  error?: string
}
export const useMaxaPanels = create<{
  recent: boolean
  translation: TranslationPane | null
  translations: Record<string, TranslationState>
}>(() => ({ recent: false, translation: null, translations: {} }))
export const translationAllowed = (path: string): boolean =>
  /\.(md|markdown|txt|rst|adoc)$/i.test(path) &&
  !path.startsWith('translate-cache/')
const stateKey = (root: string, path: string): string => root + '\n' + path
export function translationState(
  root: string,
  path: string
): TranslationState | undefined {
  return useMaxaPanels.getState().translations[stateKey(root, path)]
}
function setState(root: string, path: string, value: TranslationState): void {
  if (useStore.getState().vault?.root !== root) return
  useMaxaPanels.setState((s) => ({
    translations: { ...s.translations, [stateKey(root, path)]: value }
  }))
}
const revisions = new Map<string, number>()
export async function refreshTranslationStatus(path: string): Promise<void> {
  const state = useStore.getState(),
    root = state.vault?.root
  if (
    !root ||
    !window.zen.translationCacheStatus ||
    state.noteDirty[path] ||
    translationState(root, path)?.state === 'translating'
  )
    return
  const key = stateKey(root, path),
    revision = (revisions.get(key) ?? 0) + 1
  revisions.set(key, revision)
  try {
    const result = await window.zen.translationCacheStatus(path)
    if (revisions.get(key) === revision)
      setState(root, path, {
        state: result.cacheHit ? 'translated' : 'untranslated'
      })
  } catch (e) {
    if (revisions.get(key) === revision)
      setState(root, path, { state: 'failed', error: String(e) })
  }
}
let translationRequest = 0
export async function translateNote(path: string): Promise<void> {
  const state = useStore.getState(),
    root = state.vault?.root
  if (
    !root ||
    !translationAllowed(path) ||
    !window.zen.translateNote ||
    !window.zen.translationCacheStatus ||
    translationState(root, path)?.state === 'translating'
  )
    return
  const dirty = (): boolean => !!useStore.getState().noteDirty[path]
  const saveFirst = (): void => {
    useToastStore
      .getState()
      .addToast('Save this note before translating.', 'info')
  }
  if (dirty()) {
    saveFirst()
    return
  }
  const wasCached = translationState(root, path)?.state === 'translated'
  const request = ++translationRequest,
    key = stateKey(root, path)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
  try {
    let result: TranslationResult =
      await window.zen.translationCacheStatus(path)
    if (
      useStore.getState().vault?.root !== root ||
      request !== translationRequest
    )
      return
    if (dirty()) {
      saveFirst()
      return
    }
    if (!result.cacheHit) {
      setState(root, path, { state: 'untranslated' })
      if (wasCached) return
      if (
        !(await confirmApp({
          title: 'Translate this note?',
          description: 'Send the saved note to the translation provider?',
          confirmLabel: 'Translate'
        }))
      )
        return
      if (
        useStore.getState().vault?.root !== root ||
        request !== translationRequest
      )
        return
      if (dirty()) {
        saveFirst()
        return
      }
      setState(root, path, { state: 'translating' })
      result = await window.zen.translateNote(path)
      setState(root, path, { state: 'translated' })
      // The source may have been saved again while the provider was running.
      void refreshTranslationStatus(path)
    }
    setState(root, path, { state: 'translated' })
    if (
      useStore.getState().vault?.root !== root ||
      request !== translationRequest
    )
      return
    const note = useStore.getState().notes.find((n) => n.path === path)
    useMaxaPanels.setState({
      translation: {
        root,
        source: path,
        title: note?.displayTitle || note?.title || path,
        body: result.body
      }
    })
  } catch (e) {
    setState(root, path, { state: 'failed', error: String(e) })
    if (useStore.getState().vault?.root === root)
      useToastStore.getState().addToast(String(e), 'error')
  }
}
