import type { NoteFolder } from '@shared/ipc'
import { useStore } from '../store'
import { promptApp } from './prompt-requests'
import { vaultRelativeFolderPath } from './vault-layout'
import { useToastStore } from './toast'
export async function createCanvas(folder: NoteFolder = 'inbox', subpath = ''): Promise<void> {
  if (!window.zen.createCanvas) return
  const title = await promptApp({
    title: 'New canvas',
    initialValue: 'Untitled',
    placeholder: 'Canvas name',
    validate: (v) =>
      !v.trim() || /[\\/:\0]/.test(v) || v === '..' ? 'Use a file name without slashes.' : null
  })
  if (!title) return
  const state = useStore.getState(),
    root = state.vault?.root
  const parent = vaultRelativeFolderPath(folder, subpath, state.vaultSettings)
  const name = title.replace(/\.canvas$/i, '') + '.canvas',
    path = parent ? `${parent}/${name}` : name
  if (state.notes.some((n) => n.path === path)) {
    useToastStore.getState().addToast('A file with that name already exists.', 'error')
    return
  }
  try {
    const meta = await window.zen.createCanvas(folder, title.replace(/\.canvas$/i, ''), subpath)
    if (useStore.getState().vault?.root !== root) return
    await useStore.getState().refreshNotes()
    await useStore.getState().selectNote(meta.path)
  } catch (e) {
    useToastStore.getState().addToast(String(e), 'error')
  }
}
