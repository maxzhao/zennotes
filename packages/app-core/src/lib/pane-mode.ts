export type PaneMode = 'edit' | 'preview' | 'split'

export const ZEN_SET_PANE_MODE_EVENT = 'zen:set-pane-mode'
export const DEFAULT_PANE_MODE: PaneMode = 'edit'
export const PREFERRED_PANE_MODE_KEY = 'zen:preferred-pane-mode'

export function readPreferredPaneMode(): PaneMode | null {
  try {
    const value = localStorage.getItem(PREFERRED_PANE_MODE_KEY)
    return isPaneMode(value) ? value : null
  } catch { return null }
}

export type PaneModesByPath = Record<string, PaneMode>

export function isPaneMode(value: unknown): value is PaneMode {
  return value === 'edit' || value === 'preview' || value === 'split'
}

export function paneModeForPath(
  modesByPath: PaneModesByPath,
  path: string | null,
  // A note the user has not put in a mode yet opens in this; the "Default
  // view mode" preference feeds it so readers can land in Preview. (#543)
  fallback: PaneMode = DEFAULT_PANE_MODE,
  preferred: PaneMode | null = null
): PaneMode {
  return preferred ?? (path ? modesByPath[path] ?? fallback : fallback)
}

export function paneModesWithPathMode(
  modesByPath: PaneModesByPath,
  path: string | null,
  mode: PaneMode
): PaneModesByPath {
  if (!path || modesByPath[path] === mode) return modesByPath
  return { ...modesByPath, [path]: mode }
}

export function requestPaneMode(mode: PaneMode): void {
  window.dispatchEvent(
    new CustomEvent<{ mode: PaneMode }>(ZEN_SET_PANE_MODE_EVENT, {
      detail: { mode }
    })
  )
}
