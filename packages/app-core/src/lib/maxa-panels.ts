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
const polls = new Map<string, ReturnType<typeof setTimeout>>()
const openWhenReady = new Map<string, number>()
let translationRequest = 0
function stopPolling(key: string): void {
  clearTimeout(polls.get(key))
  polls.delete(key)
}
function pollStatus(root: string, path: string): void {
  const key = stateKey(root, path)
  stopPolling(key)
  polls.set(key, setTimeout(() => {
    polls.delete(key)
    if (useStore.getState().vault?.root !== root) {
      openWhenReady.delete(key)
      return
    }
    void refreshTranslationStatus(path)
  }, 2000))
}
function acceptStatus(root: string, path: string, result: TranslationResult): void {
  if (useStore.getState().vault?.root !== root) return
  const key = stateKey(root, path)
  const previous = translationState(root, path)?.state
  const state = result.cacheHit ? 'translated' : result.state ?? 'untranslated'
  const error = result.error ? `${result.error.code}: ${result.error.message}` : undefined
  setState(root, path, { state, error })
  if (state === 'translating') {
    pollStatus(root, path)
    return
  }
  stopPolling(key)
  const request = openWhenReady.get(key)
  openWhenReady.delete(key)
  if (state === 'failed' && previous === 'translating')
    useToastStore.getState().addToast(error ?? 'Translation failed.', 'error')
  if (
    result.cacheHit && request === translationRequest &&
    !useStore.getState().noteDirty[path]
  ) {
    const note = useStore.getState().notes.find((n) => n.path === path)
    useMaxaPanels.setState({
      translation: {
        root, source: path,
        title: note?.displayTitle || note?.title || path,
        body: result.body
      }
    })
  }
}
export async function refreshTranslationStatus(path: string): Promise<void> {
  const state = useStore.getState(), root = state.vault?.root
  if (!root || !window.zen.translationCacheStatus) return
  if (state.noteDirty[path]) {
    if (translationState(root, path)?.state === 'translating') pollStatus(root, path)
    return
  }
  const key = stateKey(root, path), revision = (revisions.get(key) ?? 0) + 1
  revisions.set(key, revision)
  try {
    const result = await window.zen.translationCacheStatus(path)
    if (revisions.get(key) === revision && !useStore.getState().noteDirty[path])
      acceptStatus(root, path, result)
  } catch (e) {
    if (revisions.get(key) === revision && useStore.getState().vault?.root === root) {
      stopPolling(key)
      openWhenReady.delete(key)
      const previous = translationState(root, path)?.state
      setState(root, path, { state: 'failed', error: String(e) })
      if (previous === 'translating') useToastStore.getState().addToast(String(e), 'error')
    }
  }
}
export async function translateNote(path: string): Promise<void> {
  const state = useStore.getState(), root = state.vault?.root
  if (
    !root || !translationAllowed(path) || !window.zen.translateNote ||
    !window.zen.translationCacheStatus ||
    translationState(root, path)?.state === 'translating'
  ) return
  const dirty = (): boolean => !!useStore.getState().noteDirty[path]
  const saveFirst = (): void => {
    useToastStore.getState().addToast('Save this note before translating.', 'info')
  }
  if (dirty()) { saveFirst(); return }
  const wasCached = translationState(root, path)?.state === 'translated'
  const request = ++translationRequest, key = stateKey(root, path)
  const current = (): boolean => useStore.getState().vault?.root === root && request === translationRequest
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
  try {
    const result = await window.zen.translationCacheStatus(path)
    if (!current()) return
    if (dirty()) { saveFirst(); return }
    if (result.cacheHit) {
      openWhenReady.set(key, request)
      acceptStatus(root, path, result)
      return
    }
    acceptStatus(root, path, result)
    if (result.state === 'translating' || wasCached) return
    if (!(await confirmApp({
      title: 'Translate this note?',
      description: 'Send the saved note to the translation provider?',
      confirmLabel: 'Translate'
    }))) return
    if (!current()) return
    if (dirty()) { saveFirst(); return }
    stopPolling(key)
    revisions.set(key, (revisions.get(key) ?? 0) + 1)
    openWhenReady.set(key, request)
    setState(root, path, { state: 'translating' })
    await window.zen.translateNote(path)
    // Query the current saved source, which may have changed while starting.
    if (useStore.getState().vault?.root === root) await refreshTranslationStatus(path)
  } catch (e) {
    stopPolling(key)
    openWhenReady.delete(key)
    setState(root, path, { state: 'failed', error: String(e) })
    if (useStore.getState().vault?.root === root)
      useToastStore.getState().addToast(String(e), 'error')
  }
}
