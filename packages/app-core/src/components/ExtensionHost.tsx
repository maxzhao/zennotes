import * as React from 'react'
import htm from 'htm'
import { create } from 'zustand'
import type { VaultChangeEvent } from '@shared/ipc'
import { useStore } from '../store'
import { parseExtensionTab } from '../lib/extension-path'
import { focusEditorNormalMode } from '../lib/editor-focus'

export interface Extension {
  name: string
  source: 'project' | 'global'
  title?: string
  views?: { id: string; title: string }[]
  module?: string
  styles?: string[]
  service?: boolean
  version?: string
  order?: number
  error: string | null
}
export const useExtensions = create<{
  extensions: Extension[]
  loaded: boolean
  notice: string
  order: string[]
  orderLoaded: boolean
  orderSaving: boolean
}>(() => ({
  extensions: [],
  loaded: false,
  notice: '',
  order: [],
  orderLoaded: false,
  orderSaving: false,
}))
const activations = new Map<
  string,
  Promise<Record<string, React.ComponentType>>
>()
const activationAttempts = new Map<string, number>()
const styleVersions = new Map<
  string,
  { version: string; links: HTMLLinkElement[] }
>()
function basePath(): string {
  return (
    document
      .querySelector('meta[name="zn-base-path"]')
      ?.getAttribute('content')
      ?.replace(/\/$/, '') ?? ''
  )
}
function activityOrderResult(result: { order?: unknown }): string[] {
  if (
    !Array.isArray(result.order) ||
    !result.order.every((id) => typeof id === 'string')
  )
    throw new Error('Invalid activity order response')
  return result.order
}
export async function saveActivityOrder(order: string[]): Promise<void> {
  const previous = useExtensions.getState().order
  const project = useStore.getState().vault?.root
  useExtensions.setState({ order, orderSaving: true })
  try {
    const response = await fetch(`${basePath()}/api/maxa/activity-order`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const stored = activityOrderResult(await response.json())
    if (useStore.getState().vault?.root === project)
      useExtensions.setState({ order: stored })
  } catch (error) {
    if (useStore.getState().vault?.root === project)
      useExtensions.setState({
        order: previous,
        notice: `保存活动栏顺序失败：${String(error)}`,
      })
  } finally {
    if (useStore.getState().vault?.root === project)
      useExtensions.setState({ orderSaving: false })
  }
}
function versionURL(path: string, version: string): string {
  return `${basePath()}${path}${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`
}
function serviceURL(name: string, path: string): string {
  const relative = path.replace(/^\//, '')
  const url = new URL(
    `${basePath()}/api/ext/${name}/svc/${relative}`,
    location.origin,
  )
  const prefix = `${basePath()}/api/ext/${name}/svc/`
  if (url.origin !== location.origin || !url.pathname.startsWith(prefix))
    throw new Error('Invalid extension service path')
  return url.pathname + url.search
}
function makeAPI(extension: Extension) {
  const name = extension.name
  return {
    React,
    html: htm.bind(React.createElement),
    name,
    vault: {
      async list(prefix: string) {
        const [notes, assets] = await Promise.all([
          window.zen.listNotes(),
          window.zen.listAssets(),
        ])
        return [
          ...notes.map((n) => ({ path: n.path, kind: 'note' as const })),
          ...assets.map((a) => ({ path: a.path, kind: 'asset' as const })),
        ].filter((f) => f.path.startsWith(prefix))
      },
      async read(path: string) {
        return (await window.zen.readNote(path)).body
      },
      open(path: string) {
        return useStore.getState().selectNote(path)
      },
      onChange(prefix: string, cb: (event: VaultChangeEvent) => void) {
        return window.zen.onVaultChange((event) => {
          if (!event.path || event.path.startsWith(prefix)) cb(event)
        })
      },
    },
    service: {
      url(path: string) {
        return serviceURL(name, path)
      },
      fetch(path: string, init?: RequestInit) {
        return fetch(serviceURL(name, path), {
          ...init,
          credentials: 'same-origin',
        })
      },
      events(path: string, onMessage: (event: MessageEvent) => void) {
        const source = new EventSource(serviceURL(name, path))
        source.onmessage = onMessage
        return () => source.close()
      },
    },
    theme: {
      get mode() {
        return useStore.getState().themeMode
      },
    },
  }
}
async function activate(
  extension: Extension,
): Promise<Record<string, React.ComponentType>> {
  const key = `${extension.name}:${extension.version}`
  let activation = activations.get(key)
  if (!activation) {
    activation = (async () => {
      const previous = styleVersions.get(extension.name)
      if (previous?.version !== extension.version) {
        previous?.links.forEach((link) => link.remove())
        const links = (extension.styles ?? []).map((path) => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = versionURL(path, extension.version!)
          document.head.appendChild(link)
          return link
        })
        styleVersions.set(extension.name, {
          version: extension.version!,
          links,
        })
      }
      const attempt = activationAttempts.get(key) ?? 0
      const module = await import(
        /* @vite-ignore */ versionURL(extension.module!, extension.version!) +
          (attempt ? `&retry=${attempt}` : '')
      )
      if (typeof module.activate !== 'function')
        throw new Error('Extension must export activate(api)')
      const result = await module.activate(makeAPI(extension))
      // Schema 1 returns a view map directly; also accept an explicit wrapper.
      const views = result?.views ?? result
      if (!views || typeof views !== 'object')
        throw new Error('Extension activate(api) did not return views')
      return views
    })()
    activations.set(key, activation)
    // A failed import/activation can be retried; a successful activation is never repeated.
    void activation.catch(() => {
      if (activations.get(key) === activation) {
        activations.delete(key)
        activationAttempts.set(key, (activationAttempts.get(key) ?? 0) + 1)
      }
    })
  }
  return activation
}
function ExtensionError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}): JSX.Element {
  return (
    <div role="alert" className="p-4 text-sm">
      <p>扩展加载失败</p>
      <details className="my-2">
        <summary>详情</summary>
        <pre className="whitespace-pre-wrap break-words text-xs">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </details>
      <button
        className="rounded border border-paper-300 px-3 py-1 hover:bg-paper-200"
        onClick={retry}
      >
        重试
      </button>
    </div>
  )
}
class ExtensionBoundary extends React.Component<
  { children: React.ReactNode; retry: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? (
      <ExtensionError error={this.state.error} retry={this.props.retry} />
    ) : (
      this.props.children
    )
  }
}
export function ExtensionTab({ path }: { path: string }): JSX.Element {
  const extensions = useExtensions((s) => s.extensions)
  const loaded = useExtensions((s) => s.loaded)
  const themeMode = useStore((s) => s.themeMode)
  const parsed = parseExtensionTab(path)!
  const extension = extensions.find((e) => e.name === parsed.name)
  const [attempt, setAttempt] = React.useState(0)
  const [View, setView] = React.useState<React.ComponentType | null>(null)
  const [error, setError] = React.useState<unknown>(null)
  React.useEffect(() => {
    let current = true
    setView(null)
    setError(null)
    if (!loaded) return
    if (
      !extension ||
      extension.error ||
      !extension.views?.some((v) => v.id === parsed.view)
    ) {
      setError(new Error(extension?.error || 'Unknown extension or view'))
      return
    }
    void activate(extension)
      .then((views) => {
        if (!views[parsed.view]) throw new Error('Extension view not exported')
        if (current) setView(() => views[parsed.view])
      })
      .catch((err) => {
        if (current) setError(err)
      })
    return () => {
      current = false
    }
  }, [extension, loaded, parsed.view, attempt])
  const retry = async () => {
    try {
      const response = await fetch(`${basePath()}/api/ext`, {
        credentials: 'same-origin',
        cache: 'no-cache',
      })
      if (response.ok) {
        const result = await response.json()
        if (Array.isArray(result.extensions))
          useExtensions.setState({ extensions: result.extensions })
      }
    } catch {
      /* Retry the current version when discovery is temporarily unavailable. */
    } finally {
      setAttempt((n) => n + 1)
    }
  }
  return (
    <div
      data-extension={parsed.name}
      data-theme-mode={themeMode}
      className="min-h-0 min-w-0 flex-1 overflow-auto"
      style={{ background: 'var(--ext-bg)', color: 'var(--ext-fg)' }}
    >
      <ExtensionBoundary key={`${extension?.version}:${attempt}`} retry={retry}>
        {error ? (
          <ExtensionError error={error} retry={retry} />
        ) : View ? (
          <View />
        ) : (
          <p className="p-4 text-sm text-ink-400">Loading…</p>
        )}
      </ExtensionBoundary>
    </div>
  )
}
export function openExtensionView(path: string): void {
  const state = useStore.getState()
  void state
    .openNoteInPane(state.activePaneId, path)
    .then(() => focusEditorNormalMode())
}
export function extensionIconURL(extension: Extension, view: string): string {
  return versionURL(
    `/api/ext/${encodeURIComponent(extension.name)}/web/icons/${encodeURIComponent(view)}.svg`,
    extension.version || '',
  )
}
export function ExtensionRuntime(): JSX.Element | null {
  const vault = useStore((s) => s.vault)
  const restored = useStore((s) => s.workspaceRestored)
  const transitioning = useStore((s) => s.workspaceTransitioning)
  const extensions = useExtensions((s) => s.extensions)
  const loaded = useExtensions((s) => s.loaded)
  const notice = useExtensions((s) => s.notice)
  React.useEffect(() => {
    if (window.zen.getAppInfo().runtime !== 'web' || !vault) return
    let current = true
    useExtensions.setState({
      loaded: false,
      extensions: [],
      notice: '',
      order: [],
      orderLoaded: false,
      orderSaving: false,
    })
    void fetch(`${basePath()}/api/ext`, {
      credentials: 'same-origin',
      cache: 'no-cache',
    })
      .then(async (response) => {
        if (response.status === 404) return null
        if (!response.ok) throw new Error(`Extensions: HTTP ${response.status}`)
        const result = await response.json()
        return Array.isArray(result.extensions)
          ? (result.extensions as Extension[])
          : null
      })
      .then(async (entries) => {
        if (!current) return
        useExtensions.setState({ loaded: true, extensions: entries ?? [] })
        if (
          !entries?.some(
            (extension) => !extension.error && extension.views?.length,
          )
        )
          return
        try {
          const response = await fetch(
            `${basePath()}/api/maxa/activity-order`,
            { credentials: 'same-origin', cache: 'no-cache' },
          )
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const order = activityOrderResult(await response.json())
          if (current) useExtensions.setState({ order, orderLoaded: true })
        } catch (error) {
          if (current)
            useExtensions.setState({
              notice: `加载活动栏顺序失败：${String(error)}`,
            })
        }
      })
      .catch((error) => {
        if (current)
          useExtensions.setState({ loaded: true, notice: String(error) })
      })
    return () => {
      current = false
    }
  }, [vault?.root])
  React.useEffect(() => {
    if (
      window.zen.getAppInfo().runtime !== 'web' ||
      !loaded ||
      !restored ||
      transitioning
    )
      return
    const openHash = () => {
      if (!location.hash.startsWith('#ext/')) return
      const parsed = parseExtensionTab(`ext:${location.hash.slice(5)}`)
      const extension = extensions.find((e) => e.name === parsed?.name)
      if (
        !parsed ||
        !extension ||
        extension.error ||
        !extension.views?.some((v) => v.id === parsed.view)
      ) {
        useExtensions.setState({ notice: '未知扩展或视图' })
        return
      }
      openExtensionView(`ext:${parsed.name}/${parsed.view}`)
    }
    openHash()
    window.addEventListener('hashchange', openHash)
    return () => window.removeEventListener('hashchange', openHash)
  }, [loaded, restored, transitioning, extensions])
  return notice ? (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-toast max-w-sm rounded-lg border border-paper-300 bg-paper-50 p-3 text-sm shadow-panel"
    >
      {notice}
      <button
        type="button"
        className="ml-3 p-2"
        aria-label="Dismiss notice"
        onClick={() => useExtensions.setState({ notice: '' })}
      >
        ×
      </button>
    </div>
  ) : null
}
