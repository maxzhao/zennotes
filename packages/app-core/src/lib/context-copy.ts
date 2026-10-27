import type { EditorView } from '@codemirror/view'
import { useStore } from '../store'
import { useToastStore } from './toast'
import { coveringBlock, formatNoteContext, type LineRange } from './context-format'

export async function copyWithFallback(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* plain HTTP or permission denial */
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0'
  document.body.append(textarea)
  textarea.focus()
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    /* show manual copy below */
  }
  textarea.remove()
  if (copied) return true
  const dialog = document.createElement('dialog')
  dialog.setAttribute('aria-label', 'Copy context manually')
  dialog.style.cssText = 'width:80vw;padding:20px;background:var(--glass-bg,white);color:inherit'
  const label = document.createElement('p')
  label.textContent = 'Clipboard unavailable. Copy the selected context manually.'
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.style.cssText = 'width:100%;height:60vh;color:black;background:white'
  const close = document.createElement('button')
  close.textContent = 'Close'
  close.onclick = () => dialog.close()
  dialog.append(label, input, close)
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  dialog.showModal()
  input.focus()
  input.select()
  return false
}
export async function copyNoteRange(path: string, source: string, range: LineRange): Promise<void> {
  const prefix = useStore.getState().vaultSettings.projectPathPrefix ?? ''
  if (await copyWithFallback(formatNoteContext(path, source, range, prefix)))
    useToastStore.getState().addToast(`Copied ${path} lines ${range.start}-${range.end}`, 'success')
}
export async function copyEditorContext(view?: EditorView | null): Promise<void> {
  const state = useStore.getState(),
    editor = view ?? state.editorViewRef
  if (!state.selectedPath || !editor) return
  const source = editor.state.doc.toString(),
    sel = editor.state.selection.main
  const start = editor.state.doc.lineAt(sel.from).number
  const end = editor.state.doc.lineAt(sel.empty ? sel.to : Math.max(sel.from, sel.to - 1)).number
  await copyNoteRange(
    state.selectedPath,
    source,
    sel.empty ? coveringBlock(source, start) : { start, end }
  )
}
let preview: { path: string; source: string; range: LineRange } | null = null
export function rememberEditorContext(): void {
  preview = null
}
export function rememberPreviewContext(
  path: string,
  source: string,
  target: HTMLElement,
  root: HTMLElement
): void {
  const lineFor = (node: Node | null): number | null => {
    const el = node instanceof HTMLElement ? node : node?.parentElement
    const block = el?.closest<HTMLElement>('[data-source-line]')
    return block && root.contains(block) && !block.closest('.note-embed')
      ? Number(block.dataset.sourceLine) || null
      : null
  }
  const selection = window.getSelection()
  let start = lineFor(target),
    end = start
  if (
    selection &&
    !selection.isCollapsed &&
    root.contains(selection.anchorNode) &&
    root.contains(selection.focusNode)
  ) {
    start = lineFor(selection.anchorNode)
    end = lineFor(selection.focusNode)
  }
  if (start && end) {
    const a = coveringBlock(source, Math.min(start, end)),
      b = coveringBlock(source, Math.max(start, end))
    preview = {
      path,
      source,
      range: { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) }
    }
  }
}
export async function copyPreviewContext(): Promise<void> {
  if (preview) await copyNoteRange(preview.path, preview.source, preview.range)
}
export async function copyCurrentContext(): Promise<void> {
  const state = useStore.getState()
  if (state.selectedPath?.endsWith('.canvas')) {
    window.dispatchEvent(new CustomEvent('zen:canvas-command', { detail: 'copy' }))
    return
  }
  const pane = document.querySelector(`[data-pane-id="${state.activePaneId}"]`)
  const active = document.activeElement
  if (
    preview?.path === state.selectedPath &&
    active instanceof HTMLElement &&
    (active.closest('[data-preview-scroll]') || !state.editorViewRef?.hasFocus)
  )
    await copyPreviewContext()
  else if (pane) await copyEditorContext()
}
