import { useEffect } from 'react'
import { create } from 'zustand'
import { useStore } from '../store'
import { useToastStore } from './toast'
import { confirmApp } from './confirm-requests'
import { findLeaf } from './pane-layout'
import type { TranslationResult } from '@zennotes/bridge-contract/maxa'
interface PaneTranslation {
  root: string
  source: string
  sourceBody: string
  body: string
}
interface TranslationIntent extends Omit<PaneTranslation, 'body'> {
  paneId: string
}
export type TranslationState = {
  state: 'untranslated' | 'translated' | 'translating' | 'failed'
  error?: string
}
export const useMaxaPanels = create<{
  recent: boolean
  paneTranslations: Record<string, PaneTranslation>
  translations: Record<string, TranslationState>
}>(() => ({ recent: false, paneTranslations: {}, translations: {} }))
export const translationAllowed = (path: string): boolean =>
  /\.(md|markdown|txt|rst|adoc)$/i.test(path) &&
  !path.startsWith('translate-cache/')
const stateKey = (root: string, path: string): string => root + '\n' + path
export function translationState(root: string, path: string): TranslationState | undefined {
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
const requests = new Map<string, TranslationIntent>()
const openWhenReady = new Map<string, TranslationIntent>()
function resetPaneTranslation(paneId: string): void {
  requests.delete(paneId)
  openWhenReady.delete(paneId)
  if (!useMaxaPanels.getState().paneTranslations[paneId]) return
  useMaxaPanels.setState((s) => {
    const paneTranslations = { ...s.paneTranslations }
    delete paneTranslations[paneId]
    return { paneTranslations }
  })
}
export function usePaneTranslation(
  paneId: string,
  root: string | undefined,
  path: string | undefined,
  sourceBody: string | undefined
): string | null {
  const translation = useMaxaPanels((s) => s.paneTranslations[paneId])
  // Leaving the source (including a content change) also cancels its pending
  // automatic switch. Neither mode nor translated bodies are persisted.
  useEffect(() => () => resetPaneTranslation(paneId), [paneId, root, path, sourceBody])
  return translation?.root === root && translation.source === path &&
    translation.sourceBody === sourceBody ? translation.body : null
}
function currentIntent(intent: TranslationIntent): boolean {
  const state = useStore.getState()
  return requests.get(intent.paneId) === intent &&
    state.vault?.root === intent.root &&
    findLeaf(state.paneLayout, intent.paneId)?.activeTab === intent.source &&
    state.noteContents[intent.source]?.body === intent.sourceBody &&
    !state.noteDirty[intent.source]
}
function stopPolling(key: string): void {
  clearTimeout(polls.get(key))
  polls.delete(key)
}
function pollStatus(root: string, path: string): void {
  const key = stateKey(root, path)
  stopPolling(key)
  polls.set(key, setTimeout(() => {
    polls.delete(key)
    if (useStore.getState().vault?.root !== root) return
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
  if (state === 'failed' && previous === 'translating')
    useToastStore.getState().addToast(error ?? 'Translation failed.', 'error')
  for (const [paneId, intent] of openWhenReady) {
    if (intent.root !== root || intent.source !== path) continue
    openWhenReady.delete(paneId)
    if (result.cacheHit && currentIntent(intent)) {
      useMaxaPanels.setState((s) => ({
        paneTranslations: {
          ...s.paneTranslations,
          [paneId]: { root, source: path, sourceBody: intent.sourceBody, body: result.body }
        }
      }))
    }
    if (requests.get(paneId) === intent) requests.delete(paneId)
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
      for (const [paneId, intent] of openWhenReady)
        if (intent.root === root && intent.source === path) resetPaneTranslation(paneId)
      const previous = translationState(root, path)?.state
      setState(root, path, { state: 'failed', error: String(e) })
      if (previous === 'translating') useToastStore.getState().addToast(String(e), 'error')
    }
  }
}
export async function translateNote(
  path: string,
  paneId = useStore.getState().activePaneId
): Promise<void> {
  const state = useStore.getState(), root = state.vault?.root
  const sourceBody = state.noteContents[path]?.body
  if (!root || sourceBody === undefined || !translationAllowed(path) ||
    findLeaf(state.paneLayout, paneId)?.activeTab !== path) return
  const translation = useMaxaPanels.getState().paneTranslations[paneId]
  if (translation?.root === root && translation.source === path) {
    resetPaneTranslation(paneId)
    return
  }
  if (!window.zen.translateNote || !window.zen.translationCacheStatus) return
  const saveFirst = (): void => {
    useToastStore.getState().addToast('Save this note before translating.', 'info')
  }
  if (state.noteDirty[path]) { saveFirst(); return }
  const wasCached = translationState(root, path)?.state === 'translated'
  const intent: TranslationIntent = { paneId, root, source: path, sourceBody }
  requests.set(paneId, intent)
  const key = stateKey(root, path)
  revisions.set(key, (revisions.get(key) ?? 0) + 1)
  try {
    const result = await window.zen.translationCacheStatus(path)
    if (!currentIntent(intent)) return
    if (result.cacheHit) {
      openWhenReady.set(paneId, intent)
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
    if (!currentIntent(intent)) return
    stopPolling(key)
    revisions.set(key, (revisions.get(key) ?? 0) + 1)
    openWhenReady.set(paneId, intent)
    setState(root, path, { state: 'translating' })
    await window.zen.translateNote(path)
    if (useStore.getState().vault?.root === root) await refreshTranslationStatus(path)
  } catch (e) {
    openWhenReady.delete(paneId)
    requests.delete(paneId)
    stopPolling(key)
    setState(root, path, { state: 'failed', error: String(e) })
    if (useStore.getState().vault?.root === root)
      useToastStore.getState().addToast(String(e), 'error')
  }
}
