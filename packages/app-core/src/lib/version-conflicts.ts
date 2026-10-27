import { create } from 'zustand'
import { VersionConflictError } from '@zennotes/bridge-contract/maxa'
export { VersionConflictError }
export const useVersionConflicts = create<{
  conflicts: Record<string, VersionConflictError>
  put: (key: string, error: VersionConflictError) => void
  clear: (key: string) => void
}>((set) => ({
  conflicts: {},
  put: (key, error) => set((s) => ({ conflicts: { ...s.conflicts, [key]: error } })),
  clear: (key) =>
    set((s) => {
      const conflicts = { ...s.conflicts }
      delete conflicts[key]
      return { conflicts }
    })
}))
export const conflictKey = (root: string | undefined, path: string): string =>
  `${root ?? ''}\0${path}`
