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
  textarea.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0'
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
  dialog.setAttribute('aria-label', 'Copy text manually')
  dialog.style.cssText =
    'width:80vw;padding:20px;background:var(--glass-bg,white);color:inherit'
  const label = document.createElement('p')
  label.textContent = 'Clipboard unavailable. Copy the selected text manually.'
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
