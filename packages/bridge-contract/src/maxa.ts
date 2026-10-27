export interface LinkReference {
  source: string
  line: number | null
  nodeId: string | null
  kind: 'wikilink' | 'embed' | 'markdown' | 'canvas'
  raw: string
  anchor: string
  status: 'resolved' | 'missing' | 'ambiguous'
  path: string | null
  candidates: string[]
}

export interface WriteOptions {
  baseVersion?: string
  force?: boolean
}
export interface VersionConflict {
  code: 'VERSION_CONFLICT'
  version: string
  body: string
}
export class VersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT'
  constructor(
    readonly path: string,
    readonly version: string,
    readonly body: string
  ) {
    super(`The file ${path} changed on disk. Your unsaved changes have been kept.`)
    this.name = 'VersionConflictError'
  }
}
export interface TranslationResult {
  cacheHit: boolean
  cachePath: string
  body: string
}
