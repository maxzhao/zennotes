// Web-only clipboard write owner. Try the legacy copy synchronously, before
// any promise boundary can consume the tap/click's transient activation.
let nativeWriteText: ((text: string) => Promise<void>) | undefined
let installed = false

function copyDuringGesture(text: string): boolean {
  const previous = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.inputMode = 'none'
  textarea.tabIndex = -1
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px'
  document.body.append(textarea)
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus({ preventScroll: true })
  }
}

function manualCopy(text: string): Promise<never> {
  const previous = document.activeElement
  const dialog = document.createElement('dialog')
  dialog.setAttribute('aria-label', 'Copy text manually')
  dialog.style.cssText =
    'width:80vw;padding:20px;background:var(--glass-bg,white);color:inherit'
  const label = document.createElement('p')
  label.textContent = 'Clipboard unavailable. Copy the selected text manually.'
  const input = document.createElement('textarea')
  input.value = text
  input.readOnly = true
  input.inputMode = 'none'
  input.style.cssText = 'width:100%;height:60vh;font-size:16px;color:black;background:white'
  const close = document.createElement('button')
  close.textContent = 'Close'
  close.onclick = () => dialog.close()
  dialog.append(label, input, close)
  dialog.addEventListener('close', () => {
    dialog.remove()
    if (previous instanceof HTMLElement && previous.isConnected)
      previous.focus({ preventScroll: true })
  }, { once: true })
  document.body.append(dialog)
  dialog.showModal()
  input.focus({ preventScroll: true })
  input.select()
  input.setSelectionRange(0, text.length)
  return Promise.reject(new Error('Automatic clipboard copy failed; copy the selected text manually.'))
}

export function writeWebClipboardText(text: string): Promise<void> {
  if (copyDuringGesture(text)) return Promise.resolve()
  if (nativeWriteText) {
    try {
      return nativeWriteText(text).catch(() => manualCopy(text))
    } catch {
      // Some implementations throw before returning their promise.
    }
  }
  return manualCopy(text)
}

export function installWebClipboard(): void {
  if (installed) return
  const clipboard = navigator.clipboard
  nativeWriteText = clipboard?.writeText?.bind(clipboard)
  if (clipboard) {
    // Keep its native read methods/permissions and receiver intact.
    Object.defineProperty(clipboard, 'writeText', {
      configurable: true, value: writeWebClipboardText
    })
  } else {
    // No clipboard read implementation is added in an insecure context.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: writeWebClipboardText }
    })
  }
  installed = true
}
