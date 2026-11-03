import { closeKnowledgeDrawer } from '../lib/knowledge-panel'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type PointerEvent,
} from 'react'
import { useActivityDrag } from '../lib/use-activity-drag'
import { isHelpViewActive, useStore } from '../store'
import { findLeaf } from '../lib/pane-layout'
import {
  useExtensions,
  extensionIconURL,
  openExtensionView,
  saveActivityOrder,
} from './ExtensionHost'
import { VaultBadge } from './VaultBadge'
import { DocumentIcon, SettingsIcon } from './icons'
import { appUpdateBadgeLabel, useAppUpdateState } from '../lib/app-update-state'

function ActivityItem({
  label,
  title = label,
  active,
  open,
  accessibleName = title,
  disabled,
  children,
  onClick,
  onContextMenu,
  onPointerDown,
}: {
  label: string
  title?: string
  active?: boolean
  open?: boolean
  accessibleName?: string
  disabled?: boolean
  children: ReactNode
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={accessibleName}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`zn-activity-item relative flex w-full shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs disabled:cursor-not-allowed ${active || open ? 'bg-paper-300/70 text-ink-900' : 'text-ink-600 [@media(hover:hover)]:hover:bg-paper-200/70'}`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-1 rounded bg-accent"
        />
      )}
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center text-lg"
      >
        {children}
      </span>
      <span className="w-full truncate whitespace-nowrap text-center">
        {label}
      </span>
    </button>
  )
}
function ExtensionGlyph({
  url,
  fallback,
}: {
  url: string
  fallback: string
}): JSX.Element {
  const [loadedURL, setLoadedURL] = useState('')
  useEffect(() => {
    let current = true
    const image = new Image()
    image.onload = () => {
      if (current) setLoadedURL(url)
    }
    image.onerror = () => {
      if (current) setLoadedURL('')
    }
    image.src = url
    return () => {
      current = false
    }
  }, [url])
  return loadedURL === url ? (
    <span
      className="h-6 w-6 bg-current"
      style={{
        maskImage: `url("${url}")`,
        WebkitMaskImage: `url("${url}")`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskMode: 'alpha',
      }}
    />
  ) : (
    <span>{fallback}</span>
  )
}
export function ActivityBar({
  projectName,
  canOpenProjectMenu,
  openProjectMenu,
}: {
  projectName: string
  canOpenProjectMenu: boolean
  openProjectMenu: (event: MouseEvent<HTMLElement>) => void
}): JSX.Element {
  const open = useStore((s) => s.sidebarOpen)
  const activePath = useStore(
    (s) => findLeaf(s.paneLayout, s.activePaneId)?.activeTab,
  )
  const helpActive = useStore(isHelpViewActive)
  const extensions = useExtensions((s) => s.extensions)
  const savedOrder = useExtensions((s) => s.order)
  const orderLoaded = useExtensions((s) => s.orderLoaded)
  const orderSaving = useExtensions((s) => s.orderSaving)
  const group = useRef<HTMLDivElement>(null)
  const validItems = useMemo(() => {
    const ranks = new Map(savedOrder.map((id, i) => [id, i]))
    return extensions
      .flatMap((extension) =>
        extension.error
          ? []
          : (extension.views ?? []).map((view) => ({
              extension,
              view,
              id: `${extension.name}/${view.id}`,
            })),
      )
      .sort((a, b) => {
        const aRank = ranks.get(a.id),
          bRank = ranks.get(b.id)
        if (aRank !== undefined || bRank !== undefined)
          return (aRank ?? Infinity) - (bRank ?? Infinity)
        return (a.extension.order ?? 1000) - (b.extension.order ?? 1000)
      })
  }, [extensions, savedOrder])
  const ids = validItems.map((item) => item.id)
  const drag = useActivityDrag(
    group,
    ids,
    orderLoaded && !orderSaving,
    (next) => {
      const current = new Set(next)
      void saveActivityOrder([
        ...next,
        ...savedOrder.filter((id) => !current.has(id)),
      ])
    },
  )
  const remaining = ids.filter((id) => id !== drag.active)
  const update = useAppUpdateState()
  const badge = appUpdateBadgeLabel(update)
  const hasExtensionItems = extensions.some(
    (extension) => extension.error || extension.views?.length,
  )
  const activeExtension = extensions.some(
    (extension) =>
      !extension.error &&
      extension.views?.some(
        (view) => activePath === `ext:${extension.name}/${view.id}`,
      ),
  )
  return (
    <nav
      aria-label="客户端导航"
      className="zn-activity-bar glass-sidebar z-30 flex h-full w-[72px] shrink-0 flex-col gap-2 border-r border-paper-300 px-1 py-2"
    >
      <ActivityItem
        label={projectName}
        title={projectName}
        onClick={canOpenProjectMenu ? openProjectMenu : undefined}
        onContextMenu={canOpenProjectMenu ? openProjectMenu : undefined}
      >
        <VaultBadge name={projectName} size={28} />
      </ActivityItem>
      <div aria-hidden="true" className="mx-2 h-px shrink-0 bg-paper-300" />
      <ActivityItem
        label="知识库"
        active={!helpActive && !activeExtension}
        open={open}
        onClick={() => useStore.getState().toggleSidebar()}
      >
        <svg
          aria-hidden="true"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5.5C9 3.5 5.5 3.5 2.5 4.5v15c3-1 6.5-1 9.5 1 3-2 6.5-2 9.5-1v-15c-3-1-6.5-1-9.5 1Z" />
          <path d="M12 5.5v15" />
        </svg>
      </ActivityItem>
      {hasExtensionItems && (
        <div aria-hidden="true" className="mx-2 h-px shrink-0 bg-paper-300" />
      )}
      <div
        ref={group}
        onClickCapture={drag.onClickCapture}
        aria-label="扩展"
        aria-busy={orderSaving}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain select-none"
        style={{ touchAction: 'pan-y' }}
      >
        {validItems.map(({ extension, view, id }) => (
          <div
            key={id}
            data-activity-id={id}
            className={`relative ${drag.active === id ? 'opacity-60' : ''}`}
          >
            {drag.position !== null && remaining[drag.position] === id && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-1 top-0 z-10 h-0.5 bg-accent"
              />
            )}
            <ActivityItem
              label={view.title}
              title={`${view.title} · ${extension.title || extension.name}`}
              active={activePath === `ext:${id}`}
              onPointerDown={(event) => drag.onPointerDown(event, id)}
              onContextMenu={(event) => {
                if (drag.active) event.preventDefault()
              }}
              onClick={() => {
                openExtensionView(`ext:${id}`)
                closeKnowledgeDrawer()
              }}
            >
              <ExtensionGlyph
                url={extensionIconURL(extension, view.id)}
                fallback={Array.from(view.title)[0] || ''}
              />
            </ActivityItem>
          </div>
        ))}
        {drag.position === remaining.length && (
          <div
            aria-hidden="true"
            className="pointer-events-none relative z-10 mx-1 -mt-0.5 h-0.5 bg-accent"
          />
        )}
        {extensions
          .filter((extension) => extension.error)
          .map((extension) => (
            <div key={extension.name} data-activity-invalid>
              <ActivityItem
                label={extension.name}
                title={extension.error!}
                accessibleName={`${extension.name}: ${extension.error}`}
                disabled
              >
                <span className="relative flex h-7 w-7 items-center justify-center">
                  {Array.from(extension.name)[0]}
                  <span className="absolute right-0 top-0 flex h-3 w-3 items-center justify-center rounded-full bg-warning text-[10px] font-bold leading-none text-black ring-1 ring-paper-100">
                    !
                  </span>
                </span>
              </ActivityItem>
            </div>
          ))}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <ActivityItem
          label="设置"
          title={badge ? `设置 · ${badge}` : '设置'}
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          <SettingsIcon />
          {badge && (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />
          )}
        </ActivityItem>
        <ActivityItem
          label="帮助"
          active={helpActive}
          onClick={() => {
            void useStore.getState().openHelpView()
            closeKnowledgeDrawer()
          }}
        >
          <DocumentIcon />
        </ActivityItem>
      </div>
    </nav>
  )
}
