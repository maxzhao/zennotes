import { useEffect, useLayoutEffect, useState } from 'react'
import { useStore } from '../store'
import { findLeaf } from './pane-layout'

const NARROW = '(width < 1024px)'
const WIDE_VISIBILITY = 'zen:knowledge-panel-wide-open'
export function closeKnowledgeDrawer(): void {
  if (matchMedia(NARROW).matches) useStore.setState({ sidebarOpen: false })
}

/** sidebarOpen remains the single command/shortcut/focus visibility state.
 * Workspace snapshots must not restore an open drawer or override the local wide preference. */
export function useKnowledgePanelLayout(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches)
  useEffect(() => {
    const media = matchMedia(NARROW)
    let wideOpen = true
    try {
      wideOpen = localStorage.getItem(WIDE_VISIBILITY) !== 'false'
    } catch {
      /* storage disabled */
    }
    let applying = false
    const apply = () => {
      applying = true
      useStore.setState({ sidebarOpen: media.matches ? false : wideOpen })
      applying = false
    }
    apply()
    const change = () => {
      setNarrow(media.matches)
      apply()
    }
    media.addEventListener('change', change)
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (applying) return
      if (
        (state.workspaceRestored && !previous.workspaceRestored) ||
        (!state.workspaceTransitioning && previous.workspaceTransitioning) ||
        (!state.zenMode && previous.zenMode)
      ) {
        apply()
        return
      }
      if (
        !media.matches &&
        state.workspaceRestored &&
        !state.workspaceTransitioning &&
        !state.zenMode &&
        state.sidebarOpen !== previous.sidebarOpen &&
        !previous.zenMode
      ) {
        wideOpen = state.sidebarOpen
        try {
          localStorage.setItem(WIDE_VISIBILITY, String(wideOpen))
        } catch {
          /* storage disabled */
        }
      }
      // Folder selection temporarily clears selectedPath; its later restoration is
      // not a tab open. Observe the pane's actual active tab instead.
      const activeTab = findLeaf(
        state.paneLayout,
        state.activePaneId,
      )?.activeTab
      const previousTab = findLeaf(
        previous.paneLayout,
        previous.activePaneId,
      )?.activeTab
      if (
        media.matches &&
        state.sidebarOpen &&
        activeTab &&
        activeTab !== previousTab
      )
        closeKnowledgeDrawer()
    })
    return () => {
      unsubscribe()
      media.removeEventListener('change', change)
    }
  }, [])
  useLayoutEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && useStore.getState().sidebarOpen)
        closeKnowledgeDrawer()
      // Do not consume the key: editor, menu and palette Escape handlers still run.
    }
    // Register once, even on wide screens, before passive global Vim listeners
    // that can stopImmediatePropagation. The close helper checks the live viewport.
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [])
  return narrow
}
