import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WidgetType } from '@codemirror/view'
import { useStore } from '../store'
const Canvas = lazy(() => import('./CanvasView').then((m) => ({ default: m.CanvasView })))
export function LazyCanvasView(props: { path: string; embedded?: boolean }): JSX.Element {
  return (
    <Suspense fallback={<p>Loading canvas…</p>}>
      <Canvas {...props} />
    </Suspense>
  )
}
export function CanvasEmbed({ target, source }: { target: string; source: string }): JSX.Element {
  const notes = useStore((s) => s.notes)
  const [path, setPath] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setPath('')
    setError('')
    if (window.zen.getLinks)
      void window.zen.getLinks('outgoing', source).then(
        (refs) => {
          if (cancelled) return
          const ref = refs.find(
            (r) => r.kind === 'embed' && r.raw.replace(/^!\[\[|\]\]$/g, '').split('|')[0] === target
          )
          if (ref?.status === 'resolved' && ref.path) setPath(ref.path)
          else
            setError(
              ref?.status === 'ambiguous'
                ? `Ambiguous canvas: ${ref.candidates.join(', ')}`
                : `Canvas not in server index: ${target}`
            )
        },
        (e) => {
          if (!cancelled) setError(String(e))
        }
      )
    else {
      const wanted = target.replace(/^\//, ''),
        matches = notes.filter((n) => n.path === wanted || n.path.endsWith('/' + wanted))
      if (matches.length === 1) setPath(matches[0].path)
      else setError('Missing or ambiguous canvas: ' + target)
    }
    return () => {
      cancelled = true
    }
  }, [source, target, notes])
  if (error) return <p role="alert">{error}</p>
  return path ? (
    <Suspense fallback={<p>Loading canvas…</p>}>
      <Canvas path={path} embedded />
    </Suspense>
  ) : (
    <p>Loading canvas…</p>
  )
}
export class CanvasEmbedWidget extends WidgetType {
  private root?: Root
  constructor(
    readonly target: string,
    readonly source: string
  ) {
    super()
  }
  eq(other: CanvasEmbedWidget): boolean {
    return other.target === this.target && other.source === this.source
  }
  toDOM(): HTMLElement {
    const host = document.createElement('div')
    host.style.cssText = 'height:420px;width:100%;white-space:normal'
    host.className = 'canvas-embed-host'
    this.root = createRoot(host)
    this.root.render(<CanvasEmbed target={this.target} source={this.source} />)
    return host
  }
  destroy(): void {
    this.root?.unmount()
  }
  ignoreEvent(): boolean {
    return true
  }
}
