import { useEffect, useState } from 'react'
import { useStore } from '../store'

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
      // Also catches menu, keyboard and asynchronous opens (including Agent/live updates that switch a tab).
      if (
        media.matches &&
        state.sidebarOpen &&
        state.selectedPath !== previous.selectedPath &&
        state.selectedPath
      )
        closeKnowledgeDrawer()
    })
    return () => {
      unsubscribe()
      media.removeEventListener('change', change)
    }
  }, [])
  useEffect(() => {
    if (!narrow) return
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        useStore.getState().sidebarOpen
      )
        closeKnowledgeDrawer()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [narrow])
  return narrow
}
