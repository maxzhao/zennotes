import { closeKnowledgeDrawer } from '../lib/knowledge-panel'
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { isHelpViewActive, useStore } from '../store'
import {
  useExtensions,
  extensionIconURL,
  openExtensionView,
} from './ExtensionHost'
import { VaultBadge } from './VaultBadge'
import { DocumentIcon, PanelLeftIcon, SettingsIcon } from './icons'
import { appUpdateBadgeLabel, useAppUpdateState } from '../lib/app-update-state'

function ActivityItem({
  label,
  title = label,
  active,
  disabled,
  children,
  onClick,
  onContextMenu,
}: {
  label: string
  title?: string
  active?: boolean
  disabled?: boolean
  children: ReactNode
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`zn-activity-item relative flex w-full shrink-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs disabled:opacity-50 ${active ? 'bg-paper-300/70 text-ink-900' : 'text-ink-600 [@media(hover:hover)]:hover:bg-paper-200/70'}`}
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
  const activePath = useStore((s) => s.selectedPath)
  const helpActive = useStore(isHelpViewActive)
  const extensions = useExtensions((s) => s.extensions)
  const update = useAppUpdateState()
  const badge = appUpdateBadgeLabel(update)
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
      <ActivityItem
        label="知识库"
        active={open}
        onClick={() => useStore.getState().toggleSidebar()}
      >
        <PanelLeftIcon />
      </ActivityItem>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {extensions.map((extension) =>
          extension.error ? (
            <ActivityItem
              key={extension.name}
              label={extension.name}
              title={extension.error}
              disabled
            >
              <span>
                {Array.from(extension.name)[0]}
                <sup>⚠</sup>
              </span>
            </ActivityItem>
          ) : (
            extension.views?.map((view) => (
              <ActivityItem
                key={`${extension.name}/${view.id}`}
                label={view.title}
                title={`${view.title} · ${extension.title || extension.name}`}
                active={activePath === `ext:${extension.name}/${view.id}`}
                onClick={() => {
                  openExtensionView(`ext:${extension.name}/${view.id}`)
                  closeKnowledgeDrawer()
                }}
              >
                <ExtensionGlyph
                  url={extensionIconURL(extension, view.id)}
                  fallback={Array.from(view.title)[0] || ''}
                />
              </ActivityItem>
            ))
          ),
        )}
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
