import { resolveCanvasSubpath, sourceLines } from '../lib/canvas-subpath'
import {
  lockCanvasAxis,
  resizeCanvasRect,
  type CanvasAxis,
  type ResizeHandle
} from '../lib/canvas-geometry'
import { paintCanvasEdges } from '../lib/canvas-export'
import { parseOutline } from '../lib/outline'
import { parseBlockAnchors } from '../lib/block-anchors'
import { VersionConflictBanner } from './VersionConflictBanner'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Background,
  Handle,
  Position,
  useReactFlow,
  useViewport,
  applyNodeChanges,
  type Node,
  type NodeProps,
  type NodeChange,
  type Edge,
  type Connection,
  type FinalConnectionState
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../store'
import { LazyPreview as Preview } from './LazyPreview'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { promptApp } from '../lib/prompt-requests'
import { useToastStore } from '../lib/toast'
import { readDragPayload } from '../lib/dnd'
import { vaultRelativeFolderPath } from '../lib/vault-layout'
import {
  parseCanvas,
  serializeCanvas,
  patchCanvasNode,
  containedNodes,
  canvasColor,
  type CanvasDocument,
  type CanvasNode,
  type CanvasEdge,
  type CanvasSide
} from '../lib/json-canvas'
import { copyWithFallback } from '../lib/clipboard'
import { useVersionConflicts, conflictKey } from '../lib/version-conflicts'
import '../styles/canvas.css'

type FlowCard = Node<{ card: CanvasNode }, 'canvasCard'>
interface CardContext {
  readonly: boolean
  editing: string | null
  selected: Set<string>
  path: string
  patch: (id: string, patch: Partial<CanvasNode>) => void
  edit: (id: string | null) => void
  assetUrl: (path: string) => string
  resizeEnd: () => void
  resizeStart: () => void
  snapObjects: boolean
  snapGrid: boolean
  reloads: Record<string, number>
}
const Cards = createContext<CardContext>(null!)
const SIDES: CanvasSide[] = ['top', 'right', 'bottom', 'left']
const positions = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left
}
const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `c${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
const empty = (): CanvasDocument => ({ nodes: [], edges: [] })
const notice = (error: unknown): void => useToastStore.getState().addToast(String(error), 'error')

function CanvasCard({ data, selected }: NodeProps<FlowCard>): JSX.Element {
  const ctx = useContext(Cards),
    card = data.card
  const displayTitle = useStore((s) => s.notes.find((n) => n.path === card.file)?.displayTitle)
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const resize = useRef<{
    pointerId: number
    handle: ResizeHandle
    from: { x: number; y: number }
    card: CanvasNode
  } | null>(null)
  const editing = ctx.editing === card.id && !ctx.readonly
  const isGroup = card.type === 'group'
  const style = {
    borderColor: card.color ? canvasColor(card.color) : undefined,
    backgroundImage:
      isGroup && card.background
        ? `url(${JSON.stringify(ctx.assetUrl(card.background))})`
        : undefined,
    backgroundSize:
      card.backgroundStyle === 'cover'
        ? 'cover'
        : card.backgroundStyle === 'ratio'
          ? 'contain'
          : 'auto',
    backgroundRepeat: card.backgroundStyle === 'repeat' ? 'repeat' : 'no-repeat'
  }
  return (
    <div
      className={`zn-canvas-card ${isGroup ? 'zn-canvas-group' : ''} ${selected ? 'is-selected' : ''}`}
      style={style}
    >
      {selected &&
        !ctx.readonly &&
        (
          [
            'top',
            'right',
            'bottom',
            'left',
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right'
          ] as ResizeHandle[]
        ).map((handle) => (
          <div
            key={handle}
            aria-label={'Resize ' + handle}
            style={handle.includes('-') ? { scale: 1 / zoom } : undefined}
            className={
              'react-flow__resize-control nodrag nopan ' +
              handle.replace('-', ' ') +
              (handle.includes('-') ? ' handle' : ' line')
            }
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.stopPropagation()
              resize.current = {
                pointerId: event.pointerId,
                handle,
                from: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                card: { ...card }
              }
              event.currentTarget.setPointerCapture(event.pointerId)
              ctx.resizeStart()
            }}
            onPointerMove={(event) => {
              const active = resize.current
              if (!active || active.pointerId !== event.pointerId) return
              event.preventDefault()
              event.stopPropagation()
              const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
              const delta = { x: point.x - active.from.x, y: point.y - active.from.y }
              if (ctx.snapGrid) {
                delta.x = Math.round(delta.x / 20) * 20
                delta.y = Math.round(delta.y / 20) * 20
              }
              const rect = resizeCanvasRect(active.card, active.handle, delta, event.shiftKey)
              ctx.patch(card.id, { ...rect })
            }}
            onPointerUp={(event) => {
              if (resize.current?.pointerId !== event.pointerId) return
              event.stopPropagation()
              resize.current = null
              ctx.resizeEnd()
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={(event) => {
              if (resize.current?.pointerId === event.pointerId) {
                resize.current = null
                ctx.resizeEnd()
              }
            }}
          />
        ))}
      <header
        onClick={(e) => {
          if (card.type === 'link' && (e.ctrlKey || e.metaKey) && safeWebUrl(card.url)) {
            e.stopPropagation()
            window.open(card.url, '_blank', 'noopener,noreferrer')
          }
        }}
        className="canvas-drag-handle"
        onDoubleClick={(e) => {
          e.stopPropagation()
          ctx.edit(card.id)
        }}
      >
        {isGroup && editing ? (
          <input
            autoFocus
            className="nodrag"
            value={card.label ?? ''}
            onChange={(e) => ctx.patch(card.id, { label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') ctx.edit(null)
            }}
          />
        ) : (
          <span>
            {isGroup
              ? card.label || 'Group'
              : displayTitle || card.file?.split('/').pop() || card.url || 'Text'}
          </span>
        )}
      </header>
      {!isGroup && (
        <div
          className={`canvas-card-content ${selected ? 'nowheel' : ''} ${editing ? 'nodrag' : ''}`}
          style={{
            overflow: selected ? 'auto' : 'hidden',
            pointerEvents: selected ? 'auto' : 'none'
          }}
        >
          {card.type === 'text' ? (
            editing ? (
              <textarea
                aria-label="Edit text card"
                autoFocus
                className="nodrag nowheel"
                value={card.text ?? ''}
                onChange={(e) => ctx.patch(card.id, { text: e.target.value })}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') ctx.edit(null)
                }}
              />
            ) : (
              <Preview
                markdown={card.text ?? ''}
                notePath={ctx.path}
                readOnly={ctx.readonly}
                onChange={(text) => ctx.patch(card.id, { text })}
              />
            )
          ) : card.type === 'file' ? (
            <CanvasFile card={card} editing={editing} />
          ) : card.type === 'link' ? (
            <iframe
              title={card.url || 'Web page'}
              src={safeWebUrl(card.url)}
              sandbox="allow-scripts allow-forms allow-popups"
              referrerPolicy="no-referrer"
              key={ctx.reloads[card.id] ?? 0}
            />
          ) : (
            <p>Unsupported node type: {card.type}</p>
          )}
        </div>
      )}
      {SIDES.map((side) => (
        <span key={side}>
          <Handle
            type="source"
            position={positions[side]}
            id={side}
            isConnectable={!ctx.readonly}
          />
        </span>
      ))}
    </div>
  )
}
function canvasFileKind(path: string): string {
  if (/\.(md|markdown|txt|rst|adoc)$/i.test(path)) return 'note'
  if (/\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i.test(path)) return 'image'
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(path)) return 'audio'
  if (/\.(mp4|webm|mov|mkv)$/i.test(path)) return 'video'
  return path.split('.').pop()?.toLowerCase() ?? 'file'
}
function safeWebUrl(url?: string): string | undefined {
  try {
    const parsed = new URL(url ?? '')
    return /^https?:$/.test(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}
function CanvasFile({ card, editing }: { card: CanvasNode; editing: boolean }): JSX.Element {
  const ctx = useContext(Cards),
    file = card.file ?? ''
  const markdown = /\.(md|markdown|txt|rst|adoc)$/i.test(file)
  const content = useStore((s) => s.noteContents[file]),
    dirty = useStore((s) => s.noteDirty[file])
  const mtime = useStore((s) => s.notes.find((n) => n.path === file)?.updatedAt)
  const root = useStore((s) => s.vault?.root)
  const [error, setError] = useState('')
  const range = content && card.subpath ? resolveCanvasSubpath(content.body, card.subpath) : null
  const [editRange, setEditRange] = useState<{ start: number; end: number } | null>(null)
  const loaded = !!content
  useEffect(() => {
    setEditRange(editing ? range : null)
  }, [editing, file, card.subpath, loaded])
  useEffect(() => {
    if (!markdown) return
    let cancelled = false
    const before = useStore.getState().noteContents[file]
    if (useStore.getState().noteDirty[file]) return
    void window.zen.readNote(file).then(
      (disk) => {
        if (cancelled || useStore.getState().vault?.root !== root) return
        useStore.setState((s) =>
          s.noteDirty[file] || s.noteContents[file]?.body !== before?.body
            ? s
            : { noteContents: { ...s.noteContents, [file]: disk } }
        )
        setError('')
      },
      (e) => {
        if (!cancelled) setError(String(e))
      }
    )
    return () => {
      cancelled = true
    }
  }, [file, markdown, mtime, root])
  const src = ctx.assetUrl(file)
  if (markdown) {
    const body = content
      ? card.subpath
        ? range
          ? sourceLines(content.body, range)
          : 'Subpath not found: ' + card.subpath
        : content.body
      : 'Loading…'
    return (
      <>
        {error && <p role="alert">{error}</p>}
        <VersionConflictBanner path={file} />
        {editing ? (
          <div className="nodrag nowheel h-full">
            <p className="text-xs">
              Editing file: {file}
              {editRange ? ` lines ${editRange.start}-${editRange.end}` : ''}
            </p>
            <textarea
              aria-label={'Edit ' + file}
              value={
                content
                  ? editRange
                    ? sourceLines(content.body, editRange)
                    : card.subpath
                      ? ''
                      : content.body
                  : ''
              }
              disabled={!content || (!!card.subpath && !editRange)}
              onChange={(e) => {
                if (!content) return
                if (editRange) {
                  const lines = content.body.split('\n'),
                    replacement = e.target.value.split('\n')
                  lines.splice(
                    editRange.start - 1,
                    editRange.end - editRange.start + 1,
                    ...replacement
                  )
                  useStore.getState().updateNoteBody(file, lines.join('\n'))
                  setEditRange({
                    start: editRange.start,
                    end: editRange.start + replacement.length - 1
                  })
                } else useStore.getState().updateNoteBody(file, e.target.value)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
                  void useStore.getState().persistNote(file)
                  ctx.edit(null)
                }
              }}
            />
            <button disabled={!dirty} onClick={() => void useStore.getState().persistNote(file)}>
              Save file
            </button>
          </div>
        ) : (
          <Preview markdown={body} notePath={file} readOnly />
        )}
      </>
    )
  }
  if (/\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i.test(file))
    return <img alt={file} src={src} draggable={false} />
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(file))
    return <audio className="nodrag nowheel" controls src={src} />
  if (/\.(mp4|webm|mov|mkv)$/i.test(file))
    return <video className="nodrag nowheel" controls src={src} />
  if (/\.pdf$/i.test(file)) return <iframe className="nodrag nowheel" title={file} src={src} />
  return (
    <a href={src} target="_blank" rel="noreferrer" className="nodrag">
      {file}
    </a>
  )
}
const nodeTypes = { canvasCard: CanvasCard }

export function CanvasView({
  path,
  embedded = false
}: {
  path: string
  embedded?: boolean
}): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasEditor path={path} embedded={embedded} />
    </ReactFlowProvider>
  )
}
function CanvasEditor({ path, embedded }: { path: string; embedded: boolean }): JSX.Element {
  const content = useStore((s) => s.noteContents[path]),
    root = useStore((s) => s.vault?.root ?? '')
  const notes = useStore((s) => s.notes),
    assets = useStore((s) => s.assetFiles)
  const [embedBody, setEmbedBody] = useState<string | null>(null),
    [embedError, setEmbedError] = useState('')
  useEffect(() => {
    let cancelled = false
    if (embedded)
      void window.zen.readNote(path).then(
        (n) => {
          if (!cancelled) setEmbedBody(n.body)
        },
        (e) => {
          if (!cancelled) setEmbedError(String(e))
        }
      )
    return () => {
      cancelled = true
    }
  }, [embedded, path, notes])
  const raw = embedded ? embedBody : content?.body
  const parsed = useMemo(() => {
    try {
      return { doc: raw == null ? empty() : parseCanvas(raw), error: '' }
    } catch (e) {
      return { doc: empty(), error: String(e) }
    }
  }, [raw])
  const doc = parsed.doc,
    docRef = useRef(doc)
  docRef.current = doc
  const [frontOrder, setFrontOrder] = useState<string[]>([])
  const selectionAtPointerDown = useRef<Set<string>>(new Set())
  const [selection, setSelection] = useState<Set<string>>(new Set()),
    [edgeSelection, setEdgeSelection] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null),
    [readonly, setReadonly] = useState(embedded)
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [touch, setTouch] = useState(false)
  const [snapGrid, setSnapGrid] = useState(true),
    [snapObjects, setSnapObjects] = useState(true),
    [space, setSpace] = useState(false)
  const shiftHeld = useRef(false)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    node?: string
    edge?: string
    connect?: { node: string; side?: CanvasSide }
  } | null>(null)
  const [picker, setPicker] = useState<{
      mode: 'file' | 'note' | 'media' | 'swap' | 'background'
      point: { x: number; y: number }
      node?: string
      connect?: { node: string; side?: CanvasSide }
    } | null>(null),
    [query, setQuery] = useState('')
  const [narrow, setNarrow] = useState<{
    node: string
    choices: { target: string; label: string }[]
  } | null>(null)
  const [exportOpen, setExportOpen] = useState(false),
    [help, setHelp] = useState(false)
  const history = useRef<{ undo: string[]; redo: string[] }>({ undo: [], redo: [] })
  const gesture = useRef<{
    before: string
    positions: Map<string, { x: number; y: number }>
    contained: Set<string>
    duplicates?: Map<string, string>
    groupId?: string
    axis?: CanvasAxis
    origin?: { x: number; y: number }
  } | null>(null)
  const host = useRef<HTMLDivElement>(null),
    flow = useReactFlow<FlowCard>()
  const conflict = useVersionConflicts((s) => s.conflicts[conflictKey(root, path)])
  const locked = embedded || readonly || !!parsed.error
  const commit = (next: CanvasDocument, record = true): void => {
    if (locked) return
    const prev = serializeCanvas(docRef.current),
      body = serializeCanvas(next)
    if (prev === body) return
    if (record && !gesture.current) {
      history.current.undo.push(prev)
      history.current.redo = []
    }
    docRef.current = next
    useStore.getState().updateNoteBody(path, body)
  }
  const patch = (id: string, value: Partial<CanvasNode>): void =>
    commit(patchCanvasNode(docRef.current, id, value))
  const begin = (): void => {
    if (!gesture.current)
      gesture.current = {
        before: serializeCanvas(docRef.current),
        positions: new Map((docRef.current.nodes ?? []).map((n) => [n.id, { x: n.x, y: n.y }])),
        contained: new Set()
      }
  }
  const end = (): void => {
    const g = gesture.current
    if (g && g.before !== serializeCanvas(docRef.current)) {
      history.current.undo.push(g.before)
      history.current.redo = []
    }
    gesture.current = null
  }
  const edit = (id: string | null): void => {
    if (editing && id !== editing) end()
    if (id) begin()
    setEditing(id)
  }
  const undo = (redo = false): void => {
    if (locked) return
    edit(null)
    const from = redo ? history.current.redo : history.current.undo,
      to = redo ? history.current.undo : history.current.redo
    const body = from.pop()
    if (!body) return
    to.push(serializeCanvas(docRef.current))
    const next = parseCanvas(body)
    docRef.current = next
    useStore.getState().updateNoteBody(path, body)
  }
  useEffect(() => {
    history.current = { undo: [], redo: [] }
    setSelection(new Set())
    setEdgeSelection(new Set())
    setEditing(null)
  }, [path, root])
  const nodes: FlowCard[] = (doc.nodes ?? []).map((n, index) => ({
    id: n.id,
    type: 'canvasCard',
    data: { card: n },
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    style: {
      width: n.width,
      height: n.height,
      zIndex:
        n.type === 'group'
          ? -1
          : frontOrder.includes(n.id)
            ? (doc.nodes?.length ?? 0) + frontOrder.indexOf(n.id) + 2
            : index + 2
    },
    selected: selection.has(n.id),
    dragHandle: editing === n.id ? '.canvas-drag-handle' : undefined,
    zIndex:
      n.type === 'group'
        ? -1
        : frontOrder.includes(n.id)
          ? (doc.nodes?.length ?? 0) + frontOrder.indexOf(n.id) + 2
          : index + 2
  }))
  const edges: Edge[] = (doc.edges ?? []).map((e) => ({
    id: e.id,
    source: e.fromNode,
    target: e.toNode,
    sourceHandle: e.fromSide ?? 'right',
    targetHandle: e.toSide ?? 'left',
    label: e.label,
    selected: edgeSelection.has(e.id),
    style: { stroke: canvasColor(e.color), strokeWidth: 2 },
    markerStart:
      e.fromEnd === 'arrow'
        ? { type: 'arrowclosed' as never, color: canvasColor(e.color) }
        : undefined,
    markerEnd:
      e.toEnd !== 'none'
        ? { type: 'arrowclosed' as never, color: canvasColor(e.color) }
        : undefined,
    zIndex: 1,
    interactionWidth: 20
  }))
  const onNodesChange = (changes: NodeChange<FlowCard>[]): void => {
    const selected = changes.filter((c) => c.type === 'select')
    if (selected.length)
      setSelection((prev) => {
        const next = new Set(prev)
        for (const c of selected)
          if (c.type === 'select') c.selected ? next.add(c.id) : next.delete(c.id)
        return next
      })
    if (locked) return
    const moved = changes.filter((c) => c.type === 'position')
    if (!moved.length) return
    const mapped = moved.map((c) =>
      'id' in c && gesture.current?.duplicates?.has(c.id)
        ? { ...c, id: gesture.current.duplicates.get(c.id)! }
        : c
    )
    const currentNodes: FlowCard[] = (docRef.current.nodes ?? []).map((n) => ({
      id: n.id,
      type: 'canvasCard',
      data: { card: n },
      position: { x: n.x, y: n.y },
      width: n.width,
      height: n.height
    }))
    const projected = applyNodeChanges(mapped, currentNodes)
    let next = docRef.current
    for (const p of projected) {
      const original = next.nodes?.find((n) => n.id === p.id)
      if (!original) continue
      let { x, y } = p.position
      const g = gesture.current,
        start = g?.positions.get(p.id)
      if (
        snapObjects &&
        !space &&
        mapped.some((c) => c.type === 'position' && 'id' in c && c.id === p.id)
      ) {
        for (const other of next.nodes ?? [])
          if (!selection.has(other.id) && other.id !== p.id) {
            if (Math.abs(other.x - x) < 8) x = other.x
            if (Math.abs(other.y - y) < 8) y = other.y
            if (Math.abs(other.x + other.width - x - original.width) < 8)
              x = other.x + other.width - original.width
            if (Math.abs(other.y + other.height - y - original.height) < 8)
              y = other.y + other.height - original.height
          }
      }
      const finishing = mapped.some(
        (c) => c.type === 'position' && c.id === p.id && c.dragging === false
      )
      if (g && start && (shiftHeld.current || (finishing && g.axis))) {
        // Pick the dominant axis from actual movement, not an object snap.
        // Initial zero-delta notifications must not lock a vertical drag to X.
        if (!g.axis && p.position.x === start.x && p.position.y === start.y) {
          x = start.x
          y = start.y
        } else {
          const axis = g.axis ?? lockCanvasAxis(start, p.position).axis
          const locked = lockCanvasAxis(start, { x, y }, axis)
          g.axis = locked.axis
          x = locked.position.x
          y = locked.position.y
        }
      } else if (g) g.axis = undefined
      if (mapped.some((c) => 'id' in c && c.id === p.id))
        next = patchCanvasNode(next, p.id, {
          x,
          y
        })
    }
    const g = gesture.current
    if (g && g.contained.size) {
      const group = next.nodes?.find((n) => n.id === g.groupId)
      if (group && g.origin)
        for (const id of g.contained) {
          const start = g.positions.get(id)
          if (start && !mapped.some((c) => 'id' in c && c.id === id))
            next = patchCanvasNode(next, id, {
              x: start.x + group.x - g.origin.x,
              y: start.y + group.y - g.origin.y
            })
        }
    }

    commit(next, false)
  }
  const remove = (ids = selection, edgeIds = edgeSelection): void =>
    commit({
      ...docRef.current,
      nodes: docRef.current.nodes?.filter((n) => !ids.has(n.id)),
      edges: docRef.current.edges?.filter(
        (e) => !edgeIds.has(e.id) && !ids.has(e.fromNode) && !ids.has(e.toNode)
      )
    })
  const duplicate = (selected = selection, offset = 30): Map<string, string> => {
    const mapping = new Map<string, string>(),
      original = docRef.current
    const idsToCopy = new Set(selected)
    for (const n of original.nodes ?? [])
      if (selected.has(n.id) && n.type === 'group')
        for (const child of containedNodes(n, original.nodes ?? [])) idsToCopy.add(child.id)
    for (const id of idsToCopy) mapping.set(id, uid())
    const copies = (original.nodes ?? [])
      .filter((n) => idsToCopy.has(n.id))
      .map((n) => ({ ...n, id: mapping.get(n.id)!, x: n.x + offset, y: n.y + offset }))
    const links = (original.edges ?? [])
      .filter((e) => mapping.has(e.fromNode) && mapping.has(e.toNode))
      .map((e) => ({
        ...e,
        id: uid(),
        fromNode: mapping.get(e.fromNode)!,
        toNode: mapping.get(e.toNode)!
      }))
    commit({
      ...original,
      nodes: [...(original.nodes ?? []), ...copies],
      edges: [...(original.edges ?? []), ...links]
    })
    const ids = new Set(copies.map((n) => n.id))
    setSelection(ids)
    return mapping
  }
  const add = (
    type: string,
    point?: { x: number; y: number },
    fields: Partial<CanvasNode> = {},
    connect = menu?.connect
  ): CanvasNode => {
    const at =
      point ??
      flow.screenToFlowPosition({
        x: (host.current?.getBoundingClientRect().left ?? 0) + 200,
        y: (host.current?.getBoundingClientRect().top ?? 0) + 180
      })
    const node: CanvasNode = {
      id: uid(),
      type,
      x: Math.round(at.x),
      y: Math.round(at.y),
      width: type === 'group' ? 700 : 360,
      height: type === 'group' ? 500 : 260,
      ...(type === 'text' ? { text: '' } : {}),
      ...fields
    }
    const edge: CanvasEdge | undefined = connect
      ? {
          id: uid(),
          fromNode: connect.node,
          fromSide: connect.side,
          toNode: node.id,
          toSide: 'left'
        }
      : undefined
    commit({
      ...docRef.current,
      nodes: [...(docRef.current.nodes ?? []), node],
      ...(edge ? { edges: [...(docRef.current.edges ?? []), edge] } : {})
    })
    setSelection(new Set([node.id]))
    if (type === 'text') edit(node.id)
    return node
  }
  const groupSelected = (): void => {
    const picked = (docRef.current.nodes ?? []).filter((n) => selection.has(n.id))
    if (!picked.length) {
      add('group', undefined, { label: 'Group' })
      return
    }
    const x = Math.min(...picked.map((n) => n.x)) - 40,
      y = Math.min(...picked.map((n) => n.y)) - 60
    const group: CanvasNode = {
      id: uid(),
      type: 'group',
      label: 'Group',
      x,
      y,
      width: Math.max(...picked.map((n) => n.x + n.width)) - x + 40,
      height: Math.max(...picked.map((n) => n.y + n.height)) - y + 40
    }
    commit({ ...docRef.current, nodes: [group, ...(docRef.current.nodes ?? [])] })
    setSelection(new Set([group.id]))
  }
  const arrange = (mode: string): void => {
    const picked = (docRef.current.nodes ?? []).filter((n) => selection.has(n.id))
    if (picked.length < 2) return
    const minX = Math.min(...picked.map((n) => n.x)),
      minY = Math.min(...picked.map((n) => n.y)),
      maxX = Math.max(...picked.map((n) => n.x + n.width)),
      maxY = Math.max(...picked.map((n) => n.y + n.height))
    let next = docRef.current,
      x = minX,
      y = minY
    const order = [...picked].sort((a, b) => (mode.includes('vertical') ? a.y - b.y : a.x - b.x))
    const gapX = (maxX - minX - picked.reduce((s, n) => s + n.width, 0)) / (picked.length - 1),
      gapY = (maxY - minY - picked.reduce((s, n) => s + n.height, 0)) / (picked.length - 1)
    const columns = Math.ceil(Math.sqrt(picked.length)),
      w = Math.max(...picked.map((n) => n.width)) + 40,
      h = Math.max(...picked.map((n) => n.height)) + 40
    order.forEach((n, i) => {
      const p: Partial<CanvasNode> = {}
      if (mode === 'left') p.x = minX
      if (mode === 'center') p.x = (minX + maxX - n.width) / 2
      if (mode === 'right') p.x = maxX - n.width
      if (mode === 'top') p.y = minY
      if (mode === 'middle') p.y = (minY + maxY - n.height) / 2
      if (mode === 'bottom') p.y = maxY - n.height
      if (mode === 'row') {
        p.x = x
        p.y = minY
        x += n.width + 40
      }
      if (mode === 'column') {
        p.x = minX
        p.y = y
        y += n.height + 40
      }
      if (mode === 'grid') {
        p.x = minX + (i % columns) * w
        p.y = minY + Math.floor(i / columns) * h
      }
      if (mode === 'distribute-horizontal') {
        p.x = x
        x += n.width + gapX
      }
      if (mode === 'distribute-vertical') {
        p.y = y
        y += n.height + gapY
      }
      if (mode === 'justify-horizontal') {
        p.x = minX
        p.width = maxX - minX
      }
      if (mode === 'justify-vertical') {
        p.y = minY
        p.height = maxY - minY
      }
      next = patchCanvasNode(next, n.id, p)
    })
    commit(next)
  }
  const onConnect = (c: Connection): void => {
    if (locked || !c.source || !c.target) return
    commit({
      ...docRef.current,
      edges: [
        ...(docRef.current.edges ?? []),
        {
          id: uid(),
          fromNode: c.source,
          toNode: c.target,
          fromSide: (c.sourceHandle ?? 'right') as CanvasSide,
          toSide: (c.targetHandle?.replace('to-', '') ?? 'left') as CanvasSide
        }
      ]
    })
  }
  const selectedNode = doc.nodes?.find((n) => selection.has(n.id)),
    selectedEdge = doc.edges?.find((e) => edgeSelection.has(e.id))
  const setColor = (color: string): void =>
    commit({
      ...docRef.current,
      nodes: docRef.current.nodes?.map((n) => (selection.has(n.id) ? { ...n, color } : n)),
      edges: docRef.current.edges?.map((e) => (edgeSelection.has(e.id) ? { ...e, color } : e))
    })
  const patchEdge = (id: string, p: Partial<CanvasEdge>): void =>
    commit({
      ...docRef.current,
      edges: docRef.current.edges?.map((e) => (e.id === id ? { ...e, ...p } : e))
    })
  const filePicker = (
    mode: 'file' | 'note' | 'media' | 'swap' | 'background',
    node?: string
  ): void => {
    setQuery('')
    setPicker({
      mode,
      node,
      connect: menu?.connect,
      point: flow.screenToFlowPosition({
        x: menu?.x ?? (host.current?.getBoundingClientRect().left ?? 0) + 200,
        y: menu?.y ?? (host.current?.getBoundingClientRect().top ?? 0) + 180
      })
    })
  }
  const askUrl = async (id?: string): Promise<void> => {
    const url = await promptApp({
      title: 'Web page URL',
      initialValue: id ? (docRef.current.nodes?.find((n) => n.id === id)?.url ?? '') : 'https://',
      validate: (v) => (safeWebUrl(v) ? null : 'Enter an HTTP(S) URL.')
    })
    if (url)
      id
        ? patch(id, { url })
        : add('link', menu ? flow.screenToFlowPosition(menu) : undefined, { url })
  }
  const convertToFile = async (node: CanvasNode): Promise<void> => {
    const title = await promptApp({ title: 'Convert text card to file', initialValue: 'Untitled' })
    if (!title || /[\\/]/.test(title)) return
    try {
      const s = useStore.getState(),
        folder = content?.folder ?? 'inbox',
        subpath = path.split('/').slice(0, -1).join('/')
      const parent = vaultRelativeFolderPath(folder, '', s.vaultSettings),
        sub =
          parent && subpath.startsWith(parent + '/')
            ? subpath.slice(parent.length + 1)
            : subpath === parent
              ? ''
              : subpath
      const meta = await window.zen.createNote(folder, title, sub)
      const original = await window.zen.readNote(meta.path)
      await window.zen.writeNote(meta.path, node.text ?? '', { baseVersion: original.version })
      const next = { ...node, type: 'file', file: meta.path }
      delete next.text
      commit({
        ...docRef.current,
        nodes: docRef.current.nodes?.map((n) => (n.id === node.id ? next : n))
      })
      await s.refreshNotes()
    } catch (e) {
      notice(e)
    }
  }
  const narrowTo = async (node: CanvasNode, block: boolean): Promise<void> => {
    try {
      const source =
        useStore.getState().noteContents[node.file ?? '']?.body ??
        (await window.zen.readNote(node.file ?? '')).body
      const choices = block
        ? parseBlockAnchors(source).map((a) => ({
            target: '#^' + a.id,
            label: a.id + ' · line ' + a.line
          }))
        : parseOutline(source).map((h) => ({
            target: '#' + h.text,
            label: h.text + ' · line ' + h.line
          }))
      setNarrow({ node: node.id, choices })
    } catch (e) {
      notice(e)
    }
  }
  const menuItems = (): ContextMenuItem[] => {
    const n = menu?.node ? doc.nodes?.find((n) => n.id === menu.node) : selectedNode,
      e = menu?.edge ? doc.edges?.find((e) => e.id === menu.edge) : selectedEdge
    if (e)
      return [
        {
          label: 'Follow connection',
          onSelect: () => {
            const from = doc.nodes?.find((n) => n.id === e.fromNode),
              to = doc.nodes?.find((n) => n.id === e.toNode)
            if (from && to) {
              const p = menu ? flow.screenToFlowPosition(menu) : { x: from.x, y: from.y }
              const distance = (n: CanvasNode): number =>
                Math.hypot(p.x - n.x - n.width / 2, p.y - n.y - n.height / 2)
              const target = distance(from) < distance(to) ? to : from
              void flow.fitView({ nodes: [{ id: target.id }], duration: 300 })
            }
          }
        },
        {
          label: 'Edit label',
          disabled: locked,
          onSelect: async () => {
            const label = await promptApp({
              title: 'Connection label',
              initialValue: e.label ?? ''
            })
            if (label !== null) patchEdge(e.id, { label })
          }
        },
        { label: 'Remove label', disabled: locked, onSelect: () => patchEdge(e.id, { label: '' }) },
        {
          label: 'Disconnect start',
          disabled: locked,
          onSelect: () => remove(new Set(), new Set([e.id]))
        },
        { label: 'Remove', disabled: locked, onSelect: () => remove(new Set(), new Set([e.id])) }
      ]
    if (n)
      return [
        { label: 'Edit', disabled: locked, onSelect: () => edit(n.id) },
        {
          label: 'Duplicate',
          disabled: locked,
          onSelect: () => {
            duplicate()
          }
        },
        {
          label: 'Zoom to selection',
          onSelect: () => {
            void flow.fitView({ nodes: [{ id: n.id }] })
          }
        },
        ...(n.type === 'text'
          ? [{ label: 'Convert to file…', disabled: locked, onSelect: () => convertToFile(n) }]
          : []),
        ...(n.type === 'file'
          ? [
              { label: 'Swap file', disabled: locked, onSelect: () => filePicker('swap', n.id) },
              { label: 'Narrow to heading…', disabled: locked, onSelect: () => narrowTo(n, false) },
              { label: 'Narrow to block…', disabled: locked, onSelect: () => narrowTo(n, true) }
            ]
          : []),
        ...(n.type === 'link'
          ? [
              {
                label: 'Open external link',
                onSelect: () => {
                  if (safeWebUrl(n.url)) window.open(n.url, '_blank', 'noopener,noreferrer')
                }
              },
              {
                label: 'Copy URL',
                onSelect: async () => {
                  await copyWithFallback(n.url ?? '')
                }
              },
              { label: 'Change URL…', disabled: locked, onSelect: () => askUrl(n.id) },
              {
                label: 'Reload page',
                onSelect: () => setReloads((prev) => ({ ...prev, [n.id]: (prev[n.id] ?? 0) + 1 }))
              }
            ]
          : []),
        ...(n.type === 'group'
          ? [
              { label: 'Rename group', disabled: locked, onSelect: () => edit(n.id) },
              {
                label: 'Set / replace background',
                disabled: locked,
                onSelect: () => filePicker('background', n.id)
              },
              {
                label: 'Remove background',
                disabled: locked,
                onSelect: () => patch(n.id, { background: undefined })
              },
              ...(['cover', 'ratio', 'repeat'] as const).map((backgroundStyle) => ({
                label: 'Background: ' + backgroundStyle,
                disabled: locked,
                onSelect: () => patch(n.id, { backgroundStyle })
              }))
            ]
          : []),
        { label: 'Create group from selection', disabled: locked, onSelect: groupSelected },
        { label: 'Remove', disabled: locked, onSelect: () => remove() }
      ]
    return [
      {
        label: 'Add card',
        disabled: locked,
        onSelect: () => {
          add('text', menu ? flow.screenToFlowPosition(menu) : undefined)
        }
      },
      { label: 'Add note from vault', disabled: locked, onSelect: () => filePicker('note') },
      { label: 'Add media from vault', disabled: locked, onSelect: () => filePicker('media') },
      { label: 'Add web page', disabled: locked, onSelect: () => askUrl() },
      {
        label: 'Create group',
        disabled: locked,
        onSelect: () => {
          add('group', menu ? flow.screenToFlowPosition(menu) : undefined, { label: 'Group' })
        }
      },
      {
        label: (snapGrid ? 'Disable' : 'Enable') + ' snap to grid',
        onSelect: () => setSnapGrid(!snapGrid)
      },
      {
        label: (snapObjects ? 'Disable' : 'Enable') + ' snap to objects',
        onSelect: () => setSnapObjects(!snapObjects)
      },
      {
        label: readonly ? 'Disable read-only' : 'Read-only',
        disabled: embedded,
        onSelect: () => setReadonly(!readonly)
      }
    ]
  }
  const selectNode = (id: string, additive: boolean): void => {
    setEdgeSelection(new Set())
    setSelection((prev) => {
      const next = additive ? new Set(prev) : new Set<string>()
      if (additive && next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setFrontOrder((prev) => [...prev.filter((key) => key !== id), id])
  }

  useEffect(() => {
    const listener = (event: Event): void => {
      if (
        !host.current?.closest('[data-pane-id]')?.contains(document.activeElement) &&
        useStore.getState().selectedPath !== path
      )
        return
      const action = (event as CustomEvent<string>).detail
      if (action === 'group') groupSelected()
      if (action === 'export') setExportOpen(true)
      if (action === 'jump-group') {
        const groups = docRef.current.nodes?.filter((n) => n.type === 'group') ?? []
        void promptApp({
          title: 'Jump to group',
          description: groups.map((n) => n.label || n.id).join(' · '),
          initialValue: '',
          validate: (value) =>
            groups.some((n) => (n.label || n.id) === value)
              ? null
              : 'Choose an existing group label or id.'
        }).then((value) => {
          const id = groups.find((n) => (n.label || n.id) === value)?.id
          if (id) void flow.fitView({ nodes: [{ id }], duration: 300 })
        })
      }
    }
    window.addEventListener('zen:canvas-command', listener)
    return () => window.removeEventListener('zen:canvas-command', listener)
  })
  const keyboard = (event: KeyboardEvent): void => {
    if (embedded) return
    if (event.key === 'Shift') shiftHeld.current = event.type === 'keydown'
    const target = event.target as HTMLElement
    if (target.closest('input,textarea,[contenteditable=true],.cm-editor')) return
    if (!host.current?.contains(target) && useStore.getState().selectedPath !== path) return
    if (event.key === ' ') {
      setSpace(event.type === 'keydown')
      if (event.type === 'keydown') event.preventDefault()
    }
    if (event.type !== 'keydown') return
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelection(new Set(doc.nodes?.map((n) => n.id)))
      setEdgeSelection(new Set(doc.edges?.map((e) => e.id)))
    }
    if (mod && ['z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      event.stopPropagation()
      undo(event.key.toLowerCase() === 'y' || event.shiftKey)
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      remove()
    }
    if (event.key === 'Escape') {
      edit(null)
      setMenu(null)
    }
    if (event.shiftKey && event.code === 'Digit1') {
      event.preventDefault()
      void flow.fitView()
    }
    if (event.shiftKey && event.code === 'Digit2') {
      event.preventDefault()
      void flow.fitView({ nodes: [...selection].map((id) => ({ id })) })
    }
  }
  useEffect(() => {
    const pointerModifiers = (e: MouseEvent): void => {
      shiftHeld.current = e.shiftKey
      if (!e.shiftKey && gesture.current) gesture.current.axis = undefined
    }
    window.addEventListener('mousemove', pointerModifiers, true)
    window.addEventListener('keydown', keyboard, true)
    window.addEventListener('keyup', keyboard, true)
    const blur = (): void => {
      setSpace(false)
      shiftHeld.current = false
    }
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mousemove', pointerModifiers, true)
      window.removeEventListener('keydown', keyboard, true)
      window.removeEventListener('keyup', keyboard, true)
      window.removeEventListener('blur', blur)
    }
  })
  const longPress = useRef<{
    timer: ReturnType<typeof setTimeout>
    x: number
    y: number
    node?: string
    edge?: string
    ready: boolean
    moved: boolean
    ids: Set<string>
  } | null>(null)
  const stopLongPress = (): void => {
    if (longPress.current) clearTimeout(longPress.current.timer)
    longPress.current = null
  }
  const touchStart = (e: ReactPointerEvent): void => {
    setTouch(e.pointerType === 'touch')
    if (
      e.pointerType !== 'touch' ||
      (e.target as HTMLElement).closest(
        'input,textarea,button,select,a,iframe,audio,video,.react-flow__resize-control'
      )
    )
      return
    stopLongPress()
    const target = e.target as HTMLElement,
      node = target.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined,
      edge = target.closest('.react-flow__edge')?.getAttribute('data-id') ?? undefined
    const ids = node && selection.has(node) ? new Set(selection) : new Set<string>()
    if (node && !locked) {
      for (const n of docRef.current.nodes ?? [])
        if (ids.has(n.id) && n.type === 'group')
          for (const child of containedNodes(n, docRef.current.nodes ?? [])) ids.add(child.id)
      e.stopPropagation()
      host.current?.setPointerCapture(e.pointerId)
    }
    const pending = {
      x: e.clientX,
      y: e.clientY,
      node,
      edge,
      ready: false,
      moved: false,
      ids,
      timer: setTimeout(() => {
        pending.ready = true
        if (ids.size) begin()
      }, 500)
    }
    longPress.current = pending
  }
  const touchMove = (e: ReactPointerEvent): void => {
    const pending = longPress.current
    if (!pending) return
    const distance = Math.hypot(e.clientX - pending.x, e.clientY - pending.y)
    if (!pending.ready) {
      if (distance > 12) stopLongPress()
      return
    }
    if (!pending.ids.size || locked) return
    e.preventDefault()
    e.stopPropagation()
    pending.moved = distance > 5
    const zoom = flow.getViewport().zoom,
      g = gesture.current
    if (!g) return
    let next = docRef.current
    for (const id of pending.ids) {
      const pos = g.positions.get(id)
      if (pos)
        next = patchCanvasNode(next, id, {
          x: pos.x + (e.clientX - pending.x) / zoom,
          y: pos.y + (e.clientY - pending.y) / zoom
        })
    }
    commit(next, false)
  }
  const touchEnd = (e: ReactPointerEvent): void => {
    // Mouse drags finish in XYDrag, after its final position update. Ending
    // in pointerup capture cleared the duplicate map one event too soon.
    if (e.pointerType !== 'touch') return
    const pending = longPress.current
    if (pending?.node && !pending.ready && !pending.moved) {
      e.stopPropagation()
      selectNode(pending.node, false)
    }
    if (pending?.ready && !pending.moved) {
      e.preventDefault()
      e.stopPropagation()
      if (pending.node && !selection.has(pending.node)) selectNode(pending.node, false)
      setMenu({ x: pending.x, y: pending.y, node: pending.node, edge: pending.edge })
      edit(null)
    }
    stopLongPress()
    end()
    if (host.current?.hasPointerCapture(e.pointerId))
      host.current.releasePointerCapture(e.pointerId)
  }
  const drop = async (event: React.DragEvent): Promise<void> => {
    if (locked) return
    event.preventDefault()
    event.stopPropagation()
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      payload = readDragPayload(event)
    let paths: string[] = []
    if (payload?.kind === 'note' || payload?.kind === 'asset') paths = [payload.path]
    if (payload?.kind === 'folder') {
      const prefix =
        vaultRelativeFolderPath(
          payload.folder,
          payload.subpath,
          useStore.getState().vaultSettings
        ) + '/'
      paths = [...notes.map((n) => n.path), ...assets.map((a) => a.path)].filter((p) =>
        p.startsWith(prefix)
      )
    }
    if (event.dataTransfer.files.length)
      try {
        const tokens = Array.from(event.dataTransfer.files)
          .map((file) => window.zen.getPathForFile(file))
          .filter((p): p is string => !!p)
        paths.push(...(await window.zen.importFilesToNote(path, tokens)).map((a) => a.path))
        await useStore.getState().refreshAssets()
      } catch (e) {
        notice(e)
      }
    if (!paths.length && !payload) {
      const url =
        event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain')
      if (safeWebUrl(url)) add('link', point, { url })
    }
    let next = docRef.current
    paths.forEach((file, i) => {
      const node: CanvasNode = {
        id: uid(),
        type: 'file',
        file,
        x: Math.round(point.x + (i % 4) * 400),
        y: Math.round(point.y + Math.floor(i / 4) * 300),
        width: 360,
        height: 260
      }
      next = { ...next, nodes: [...(next.nodes ?? []), node] }
    })
    commit(next)
  }
  if (embedError || parsed.error)
    return (
      <div role="alert" className="p-4">
        Cannot open Canvas: {embedError || parsed.error}. Original bytes have not been changed.
      </div>
    )
  const assetUrl = (file: string): string => window.zen.resolveVaultAssetUrl(root, file) ?? ''
  return (
    <Cards.Provider
      value={{
        readonly: locked,
        editing,
        selected: selection,
        path,
        patch,
        edit,
        assetUrl,
        resizeStart: begin,
        resizeEnd: end,
        snapObjects,
        snapGrid: snapGrid && !space,
        reloads
      }}
    >
      <div
        ref={host}
        tabIndex={0}
        aria-label={`Canvas ${path}`}
        className={`zn-canvas ${embedded ? 'zn-canvas-embedded' : ''}`}
        onContextMenuCapture={(e) => {
          const node = (e.target as HTMLElement)
            .closest('.react-flow__node')
            ?.getAttribute('data-id')
          if (node) {
            e.preventDefault()
            e.stopPropagation()
            if (!selection.has(node)) selectNode(node, false)
            setMenu({ x: e.clientX, y: e.clientY, node })
          }
        }}
        onDrop={(e) => void drop(e)}
        onDragOver={(e) => {
          if (!locked) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onPointerDownCapture={(e) => {
          selectionAtPointerDown.current = new Set(selection)
          touchStart(e)
        }}
        onPointerUpCapture={touchEnd}
        onPointerCancelCapture={(e) => {
          stopLongPress()
          if (e.pointerType === 'touch') end()
        }}
        onPointerMoveCapture={touchMove}
      >
        {!embedded && (
          <div className="zn-canvas-toolbar" aria-label="Canvas controls">
            <button
              disabled={locked}
              onClick={() => {
                add('text')
              }}
            >
              Text card
            </button>
            <button disabled={locked} onClick={() => filePicker('note')}>
              Note
            </button>
            <button disabled={locked} onClick={() => filePicker('media')}>
              Media
            </button>
            <button disabled={locked} onClick={() => void askUrl()}>
              Web page
            </button>
            <button disabled={locked} onClick={groupSelected}>
              Group
            </button>
            <button disabled={locked} onClick={() => undo()}>
              Undo
            </button>
            <button disabled={locked} onClick={() => undo(true)}>
              Redo
            </button>
            <button onClick={() => void flow.zoomIn()}>+</button>
            <button onClick={() => void flow.zoomOut()}>−</button>
            <button onClick={() => void flow.fitView()}>Fit</button>
            <button onClick={() => void flow.setViewport({ ...flow.getViewport(), zoom: 1 })}>
              Reset zoom
            </button>
            <select
              aria-label="Jump to group"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  void flow.fitView({ nodes: [{ id: e.target.value }], duration: 300 })
              }}
            >
              <option value="">Jump to group…</option>
              {doc.nodes
                ?.filter((n) => n.type === 'group')
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label || n.id}
                  </option>
                ))}
            </select>
            <label>
              <input
                type="checkbox"
                checked={snapGrid}
                onChange={(e) => setSnapGrid(e.target.checked)}
              />
              Grid snap
            </label>
            <label>
              <input
                type="checkbox"
                checked={snapObjects}
                onChange={(e) => setSnapObjects(e.target.checked)}
              />
              Object snap
            </label>
            <label>
              <input
                type="checkbox"
                checked={readonly}
                onChange={(e) => {
                  edit(null)
                  setReadonly(e.target.checked)
                }}
              />
              Read-only
            </label>
            <button disabled={!doc.nodes?.length} onClick={() => setExportOpen(true)}>
              Export PNG
            </button>
            <button onClick={() => setHelp(!help)}>Help</button>
            {conflict && <span role="alert">Save conflict — use the conflict controls above.</span>}
          </div>
        )}
        {!embedded && (selection.size > 0 || edgeSelection.size > 0) && (
          <div className="zn-canvas-selection-controls">
            <button
              disabled={locked}
              onClick={() => {
                if (selectedNode) edit(selectedNode.id)
              }}
            >
              Edit
            </button>
            <button
              onClick={() => void flow.fitView({ nodes: [...selection].map((id) => ({ id })) })}
            >
              Zoom to selection
            </button>
            <button disabled={locked} onClick={() => duplicate()}>
              Duplicate
            </button>
            <button disabled={locked} onClick={() => remove()}>
              Remove
            </button>
            <select
              disabled={locked || selection.size < 2}
              value=""
              aria-label="Align and arrange"
              onChange={(e) => arrange(e.target.value)}
            >
              <option value="">Align / arrange…</option>
              {[
                'left',
                'center',
                'right',
                'top',
                'middle',
                'bottom',
                'row',
                'column',
                'grid',
                'distribute-horizontal',
                'distribute-vertical',
                'justify-horizontal',
                'justify-vertical'
              ].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              disabled={locked}
              aria-label="Set color"
              value=""
              onChange={(e) => setColor(e.target.value)}
            >
              <option value="">Set color…</option>
              {['1', '2', '3', '4', '5', '6'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              disabled={locked}
              type="color"
              aria-label="Custom color"
              onChange={(e) => setColor(e.target.value)}
            />
            {selectedEdge && (
              <>
                <input
                  aria-label="Connection label"
                  disabled={locked}
                  value={selectedEdge.label ?? ''}
                  onChange={(e) => patchEdge(selectedEdge.id, { label: e.target.value })}
                />
                <select
                  disabled={locked}
                  aria-label="Line direction"
                  value={
                    selectedEdge.fromEnd === 'arrow'
                      ? 'both'
                      : selectedEdge.toEnd === 'none'
                        ? 'none'
                        : 'one'
                  }
                  onChange={(e) =>
                    patchEdge(selectedEdge.id, {
                      fromEnd: e.target.value === 'both' ? 'arrow' : 'none',
                      toEnd: e.target.value === 'none' ? 'none' : 'arrow'
                    })
                  }
                >
                  <option value="none">Nondirectional</option>
                  <option value="one">Unidirectional</option>
                  <option value="both">Bidirectional</option>
                </select>
              </>
            )}
          </div>
        )}
        <ReactFlow<FlowCard>
          connectionMode={ConnectionMode.Loose}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.05}
          maxZoom={4}
          nodesDraggable={!locked && !touch}
          nodesConnectable={!locked}
          edgesReconnectable={!locked}
          elementsSelectable
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          panActivationKeyCode="Space"
          panOnDrag={touch || space || embedded ? true : [1]}
          panOnScroll
          zoomOnScroll={false}
          zoomActivationKeyCode={['Control', 'Meta', 'Space']}
          zoomOnPinch
          selectionOnDrag={!space && !touch}
          snapToGrid={snapGrid && !space}
          snapGrid={[20, 20]}
          elevateNodesOnSelect={false}
          onNodesChange={onNodesChange}
          onEdgesChange={(changes) =>
            setEdgeSelection((prev) => {
              const next = new Set(prev)
              for (const c of changes)
                if (c.type === 'select') c.selected ? next.add(c.id) : next.delete(c.id)
              return next
            })
          }
          onNodeClick={(e, n) => {
            if (editing && editing !== n.id) edit(null)
            if (!e.shiftKey) setEdgeSelection(new Set())
            setSelection(() => {
              const next = e.shiftKey ? new Set(selectionAtPointerDown.current) : new Set<string>()
              if (e.shiftKey && next.has(n.id)) next.delete(n.id)
              else next.add(n.id)
              return next
            })
            setFrontOrder((prev) => [...prev.filter((id) => id !== n.id), n.id])
          }}
          onNodeDoubleClick={(_, n) => edit(n.id)}
          onNodeDragStart={(event, n) => {
            shiftHeld.current = event.shiftKey
            begin()
            const source = docRef.current.nodes?.find((c) => c.id === n.id)
            if (event.altKey) {
              const mapping = duplicate(selection.has(n.id) ? selection : new Set([n.id]), 0)
              if (gesture.current) {
                gesture.current.duplicates = mapping
                for (const [from, to] of mapping) {
                  const pos = gesture.current.positions.get(from)
                  if (pos) gesture.current.positions.set(to, pos)
                }
              }
            }
            if (source?.type === 'group' && gesture.current && !event.altKey) {
              gesture.current.contained = new Set(
                containedNodes(source, docRef.current.nodes ?? []).map((n) => n.id)
              )
              gesture.current.origin = { x: source.x, y: source.y }
              gesture.current.groupId = source.id
            }
          }}
          onNodeDragStop={end}
          onNodeContextMenu={(e, n) => {
            e.preventDefault()
            if (!selection.has(n.id)) selectNode(n.id, false)
            setMenu({ x: e.clientX, y: e.clientY, node: n.id })
          }}
          onEdgeClick={(_, e) => {
            edit(null)
            setSelection(new Set())
            setEdgeSelection(new Set([e.id]))
          }}
          onEdgeDoubleClick={(_, e) => {
            void promptApp({
              title: 'Connection label',
              initialValue: e.label?.toString() ?? ''
            }).then((label) => {
              if (label !== null) patchEdge(e.id, { label })
            })
          }}
          onEdgeContextMenu={(event, e) => {
            event.preventDefault()
            setSelection(new Set())
            setEdgeSelection(new Set([e.id]))
            setMenu({ x: event.clientX, y: event.clientY, edge: e.id })
          }}
          onPaneClick={() => {
            edit(null)
            setSelection(new Set())
            setEdgeSelection(new Set())
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault()
            edit(null)
            setSelection(new Set())
            setEdgeSelection(new Set())
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).classList.contains('react-flow__pane'))
              add('text', flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
          }}
          zoomOnDoubleClick={false}
          onConnect={onConnect}
          onConnectEnd={(event, state: FinalConnectionState) => {
            if (locked || state.isValid || !state.fromNode) return
            const p = 'changedTouches' in event ? event.changedTouches[0] : event
            setMenu({
              x: p.clientX,
              y: p.clientY,
              connect: {
                node: state.fromNode.id,
                side: state.fromHandle?.id?.replace('to-', '') as CanvasSide
              }
            })
          }}
          onReconnect={(edge, c) => {
            if (!locked)
              patchEdge(edge.id, {
                fromNode: c.source,
                toNode: c.target,
                fromSide: c.sourceHandle as CanvasSide,
                toSide: c.targetHandle?.replace('to-', '') as CanvasSide
              })
          }}
          onReconnectEnd={(_, edge, __, state) => {
            if (!locked && !state.isValid) remove(new Set(), new Set([edge.id]))
          }}
        >
          <Background gap={20} />
        </ReactFlow>
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
        )}
        {picker && (
          <div role="dialog" aria-label="Choose vault file" className="zn-canvas-dialog">
            <h3>Choose {picker.mode}</h3>
            <input
              autoFocus
              aria-label="Filter vault files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-80 overflow-auto">
              {[
                ...notes.map((n) => ({
                  path: n.path,
                  label: n.displayTitle || n.title,
                  note: true
                })),
                ...assets.map((a) => ({ path: a.path, label: a.name, note: false }))
              ]
                .filter(
                  (f, i, all) =>
                    f.path !== path &&
                    all.findIndex((a) => a.path === f.path) === i &&
                    (picker.mode !== 'swap' ||
                      canvasFileKind(f.path) ===
                        canvasFileKind(doc.nodes?.find((n) => n.id === picker.node)?.file ?? '')) &&
                    (picker.mode !== 'note' || /\.md$/i.test(f.path)) &&
                    (picker.mode !== 'media' || !f.note) &&
                    (picker.mode !== 'background' || /\.(png|jpe?g|gif|svg|webp)$/i.test(f.path)) &&
                    `${f.label} ${f.path}`.toLowerCase().includes(query.toLowerCase())
                )
                .map((f) => (
                  <button
                    className="block w-full text-left"
                    key={f.path}
                    onClick={() => {
                      if (picker.mode === 'background' && picker.node)
                        patch(picker.node, { background: f.path })
                      else if (picker.mode === 'swap' && picker.node)
                        patch(picker.node, { file: f.path, subpath: undefined })
                      else add('file', picker.point, { file: f.path }, picker.connect)
                      setPicker(null)
                    }}
                  >
                    {f.label}
                    <small> {f.path}</small>
                  </button>
                ))}
            </div>
            <button onClick={() => setPicker(null)}>Cancel</button>
          </div>
        )}
        {help && (
          <div role="dialog" aria-label="Canvas shortcuts" className="zn-canvas-dialog">
            <h3>Canvas help</h3>
            <p>
              Double-click empty space: text card. Double-click card / Edit: edit. Escape or outside
              click: stop editing. Click, Shift-click, marquee, Ctrl/Cmd+A: select. Alt-drag:
              duplicate. Shift-drag: axis lock; Shift-resize: aspect ratio. Space while
              moving/resizing: disable snapping. Backspace/Delete: remove.
            </p>
            <p>
              Space-drag or middle mouse: pan. Wheel: vertical pan; Shift-wheel: horizontal pan.
              Ctrl/Cmd/Space+wheel or +/−: zoom. Shift+1: fit. Shift+2: selection. Ctrl/Cmd+Z: undo;
              Ctrl+Y or Ctrl/Cmd+Shift+Z: redo.
            </p>
            <p>
              Drag a side handle to connect; drop on empty space to create a card. Drag connection
              ends to reconnect or disconnect. Double-click line to label. Long-press to open menus.
              Touch: drag to pan, pinch to zoom, select a card then hold and drag to move it.
            </p>
            <button onClick={() => setHelp(false)}>Close</button>
          </div>
        )}
        {narrow && (
          <div role="dialog" aria-label="Narrow file card" className="zn-canvas-dialog">
            <h3>Choose heading or block</h3>
            <button
              onClick={() => {
                patch(narrow.node, { subpath: undefined })
                setNarrow(null)
              }}
            >
              Whole file
            </button>
            {narrow.choices.map((choice, i) => (
              <button
                className="block w-full text-left"
                key={i}
                onClick={() => {
                  patch(narrow.node, { subpath: choice.target })
                  setNarrow(null)
                }}
              >
                {choice.label}
              </button>
            ))}
            {!narrow.choices.length && <p>No headings or block anchors found.</p>}
            <button onClick={() => setNarrow(null)}>Cancel</button>
          </div>
        )}
        {exportOpen && (
          <CanvasExport
            host={host.current}
            doc={doc}
            path={path}
            viewport={flow.getViewport()}
            onClose={() => setExportOpen(false)}
          />
        )}
      </div>
    </Cards.Provider>
  )
}
function CanvasExport({
  host,
  doc,
  path,
  viewport,
  onClose
}: {
  host: HTMLElement | null
  doc: CanvasDocument
  path: string
  viewport: { x: number; y: number; zoom: number }
  onClose: () => void
}): JSX.Element {
  const [full, setFull] = useState(true),
    [zoom, setZoom] = useState(1),
    [privacy, setPrivacy] = useState(false),
    [busy, setBusy] = useState(false)
  const nodes = doc.nodes ?? [],
    minX = Math.min(...nodes.map((n) => n.x)) - 30,
    minY = Math.min(...nodes.map((n) => n.y)) - 30
  const width = full
      ? Math.max(...nodes.map((n) => n.x + n.width)) - minX + 30
      : (host?.querySelector<HTMLElement>('.react-flow')?.clientWidth ?? 0),
    height = full
      ? Math.max(...nodes.map((n) => n.y + n.height)) - minY + 30
      : (host?.querySelector<HTMLElement>('.react-flow')?.clientHeight ?? 0)
  const save = async (): Promise<void> => {
    if (!host || !nodes.length) return
    setBusy(true)
    try {
      const { toCanvas } = await import('html-to-image')
      const el = host.querySelector<HTMLElement>('.react-flow__viewport')
      if (!el) throw new Error('Canvas viewport unavailable.')
      const scale = full ? zoom : zoom * viewport.zoom,
        x = full ? -minX * zoom : viewport.x * zoom,
        y = full ? -minY * zoom : viewport.y * zoom
      const output = document.createElement('canvas')
      output.width = Math.ceil(width * zoom)
      output.height = Math.ceil(height * zoom)
      const context = output.getContext('2d')
      if (!context) throw new Error('PNG canvas unavailable.')
      const computed = getComputedStyle(host),
        background = computed.backgroundColor || '#ffffff',
        foreground = computed.color || '#222222'
      context.fillStyle = background
      context.fillRect(0, 0, output.width, output.height)
      const layer = async (groups: boolean): Promise<HTMLCanvasElement> =>
        toCanvas(el, {
          width: output.width,
          height: output.height,
          pixelRatio: 1,
          style: {
            width: width + 'px',
            height: height + 'px',
            transform: 'translate(' + x + 'px, ' + y + 'px) scale(' + scale + ')',
            transformOrigin: '0 0'
          },
          filter: (node) => {
            if (privacy && node.nodeType === 3) return false
            if (!(node instanceof Element)) return true
            if (
              node.tagName === 'IFRAME' ||
              node.classList.contains('react-flow__edges') ||
              node.classList.contains('react-flow__edge') ||
              node.classList.contains('react-flow__edgelabel-renderer')
            )
              return false
            if (
              privacy &&
              (node.classList.contains('canvas-card-content') ||
                ['HEADER', 'INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName))
            )
              return false
            if (node.classList.contains('react-flow__node'))
              return (
                (doc.nodes?.find((n) => n.id === node.getAttribute('data-id'))?.type ===
                  'group') ===
                groups
              )
            return true
          }
        })
      context.drawImage(await layer(true), 0, 0)
      context.save()
      context.translate(x, y)
      context.scale(scale, scale)
      paintCanvasEdges(context, el, doc, privacy, background, foreground)
      context.restore()
      context.drawImage(await layer(false), 0, 0)
      const url = output.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = url
      link.download = path
        .split('/')
        .pop()!
        .replace(/\.canvas$/i, '.png')
      link.click()
      onClose()
    } catch (e) {
      notice(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div role="dialog" aria-label="Export canvas as image" className="zn-canvas-dialog">
      <h3>Export PNG</h3>
      <label>
        <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
        Full canvas (off: viewport only)
      </label>
      <label>
        Zoom / quality{' '}
        <input
          type="number"
          min="0.25"
          max="4"
          step="0.25"
          value={zoom}
          onChange={(e) => setZoom(Math.min(4, Math.max(0.25, Number(e.target.value))))}
        />
      </label>
      <p>
        {Math.ceil(width * zoom)} × {Math.ceil(height * zoom)} px
      </p>
      <label>
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        Privacy mode (hide text)
      </label>
      <p className="text-xs">
        Web/PDF iframe contents cannot be exported by browsers and are omitted.
      </p>
      <button
        disabled={busy || !nodes.length || width * zoom > 16000 || height * zoom > 16000}
        onClick={() => void save()}
      >
        Save PNG
      </button>
      <button onClick={onClose}>Cancel</button>
    </div>
  )
}
