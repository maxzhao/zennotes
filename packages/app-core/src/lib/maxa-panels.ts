import { create } from 'zustand'
import { useStore } from '../store'
import { useToastStore } from './toast'
interface TranslationPane {
  root: string
  source: string
  title: string
  path: string
  body: string
}
export const useMaxaPanels = create<{ recent: boolean; translation: TranslationPane | null }>(
  () => ({ recent: false, translation: null })
)
let translationRequest = 0
export async function translateNote(path: string): Promise<void> {
  const state = useStore.getState(),
    root = state.vault?.root
  if (!root || !window.zen.translateNote) return
  const request = ++translationRequest
  try {
    useToastStore.getState().addToast('Translating…', 'info')
    const result = await window.zen.translateNote(path)
    if (useStore.getState().vault?.root !== root || request !== translationRequest) return
    const note = state.notes.find((n) => n.path === path)
    useMaxaPanels.setState({
      translation: {
        root,
        source: path,
        title: note?.displayTitle || note?.title || path,
        path: result.cachePath,
        body: result.body
      }
    })
  } catch (e) {
    useToastStore.getState().addToast(String(e), 'error')
  }
}
