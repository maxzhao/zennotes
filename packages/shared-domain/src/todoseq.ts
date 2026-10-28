import type { VaultTask, TaskPriority } from '@zennotes/bridge-contract/tasks'
import { FENCE_RE, TASK_LINE_RE, setTaskFieldAtIndex } from './tasklists'

const LINE =
  /^([ \t]*)(?:(?:[-+*]|\d+[.)])[ \t]+)?(?:\[([ xX>/-])\][ \t]+)?(TODO|LATER|NOW|DOING|IN-PROGRESS|WAIT|WAITING|DONE|CANCELED|CANCELLED|ARCHIVED)([ \t]+)(.*)$/
const PRIORITY = /(?:^|\s)\[#([ABC])\](?=\s|$)/
const ENTRY = /(SCHEDULED|DEADLINE|CLOSED):\s*(<[^>]*>|\[[^\]]*\])/g
export const todoStatus: Record<string, string> = {
  TODO: 'todo',
  LATER: 'todo',
  NOW: 'doing',
  DOING: 'doing',
  'IN-PROGRESS': 'doing',
  WAIT: 'waiting',
  WAITING: 'waiting',
  DONE: 'done',
  CANCELED: 'cancelled',
  CANCELLED: 'cancelled'
}
export function todoLine(line: string) {
  return LINE.exec(line)
}
export function indentWidth(line: string): number {
  return (line.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length
}
export function todoPriority(text: string): TaskPriority | undefined {
  const p = PRIORITY.exec(text)?.[1]
  return p === 'A' ? 'high' : p === 'B' ? 'med' : p === 'C' ? 'low' : undefined
}
export function todoText(text: string): string {
  return text.replace(PRIORITY, ' ').trim()
}
export function validTodoDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
  )
}
export interface TodoScan {
  line: number
  match: RegExpExecArray
  index: number
  checkboxIndex?: number
  planningEnd: number
  end: number
  children: number[]
}
/** Preserve native checkbox counting, including quoted/frontmatter checkboxes. */
export function scanTodoSeq(body: string): TodoScan[] {
  const lines = body.split('\n'),
    scans: TodoScan[] = []
  let fence: string | undefined,
    checkboxIndex = 0,
    index = 0
  const fmEnd = body.startsWith('---\n') ? lines.indexOf('---', 1) : -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      f = FENCE_RE.exec(line)
    if (f) {
      fence = fence === f[2] ? undefined : (fence ?? f[2])
      continue
    }
    if (fence) continue
    const native = TASK_LINE_RE.test(line),
      ci = native ? checkboxIndex++ : undefined
    const m = todoLine(line)
    if (!m || i <= fmEnd) continue
    let planningEnd = i + 1
    while (
      planningEnd < lines.length &&
      indentWidth(lines[planningEnd]) >= indentWidth(line) &&
      /^\s*(SCHEDULED|DEADLINE|CLOSED):/.test(lines[planningEnd])
    )
      planningEnd++
    const children: number[] = []
    let end = planningEnd
    let childFence: string | undefined
    for (; end < lines.length; end++) {
      const child = lines[end]
      if (!child.trim()) continue
      const depth = indentWidth(child),
        parentDepth = indentWidth(line)
      const f = FENCE_RE.exec(child)
      if (childFence) {
        if (f?.[2] === childFence) childFence = undefined
        continue
      }
      if (f) {
        if (depth <= parentDepth) break
        childFence = f[2]
        continue
      }
      if (todoLine(child) || /^\s*#{1,6}(?:\s|$)/.test(child)) break
      if (TASK_LINE_RE.test(child) && !/^\s*>/.test(child)) {
        if (depth < parentDepth || (m[2] != null && depth === parentDepth))
          break
        children.push(end)
      } else if (depth <= parentDepth) break
    }
    scans.push({
      line: i,
      match: m,
      index: ci == null ? index++ : -1,
      checkboxIndex: ci,
      planningEnd,
      end,
      children
    })
  }
  return scans
}
export function todoPlanning(
  lines: string[],
  scan: TodoScan
): Pick<VaultTask, 'due' | 'scheduled' | 'completedDate'> {
  const result: Pick<VaultTask, 'due' | 'scheduled' | 'completedDate'> = {}
  for (const line of lines.slice(scan.line + 1, scan.planningEnd)) {
    for (const m of line.matchAll(ENTRY)) {
      const date = m[2].slice(1).match(/^\d{4}-\d{2}-\d{2}(?=\s|[>\]])/)?.[0]
      if (
        date &&
        validTodoDate(date) &&
        (m[1] === 'CLOSED') === m[2].startsWith('[')
      )
        result[
          m[1] === 'DEADLINE'
            ? 'due'
            : m[1] === 'SCHEDULED'
              ? 'scheduled'
              : 'completedDate'
        ] = date
    }
  }
  return result
}
export function attachTodoChildren(
  tasks: VaultTask[],
  scans: TodoScan[]
): VaultTask[] {
  const hidden = new Set<number>()
  for (const scan of scans) {
    const parent = tasks.find((t) => t.lineNumber === scan.line)
    if (!parent) continue
    if (scan.match[3] === 'ARCHIVED') {
      hidden.add(scan.line)
      scan.children.forEach((n) => hidden.add(n))
      continue
    }
    const children = tasks.filter((t) => scan.children.includes(t.lineNumber))
    children.forEach((t) => {
      t.parentId = parent.id
    })
    parent.progress = {
      done: children.filter((t) => !t.cancelled && !t.forwarded && t.checked)
        .length,
      total: children.filter((t) => !t.cancelled && !t.forwarded).length
    }
  }
  return tasks.filter((t) => !hidden.has(t.lineNumber))
}
export type TodoMutation =
  | { kind: 'set-checked'; checked: boolean }
  | { kind: 'set-waiting'; waiting: boolean }
  | { kind: 'set-in-progress'; inProgress: boolean }
  | { kind: 'set-priority'; priority: TaskPriority | null }
  | { kind: 'set-due'; due: string | null }
  | { kind: 'set-field'; key: string; value: string | null }
  | { kind: 'set-text'; text: string }
/** The keyword owns every state flag, including optimistic board/list updates. */
export function withTodoMutationState(
  task: VaultTask,
  mutation: TodoMutation
): VaultTask {
  if (task.syntax !== 'todoseq') return task
  const status =
    mutation.kind === 'set-checked'
      ? mutation.checked
        ? 'done'
        : 'todo'
      : mutation.kind === 'set-waiting'
        ? mutation.waiting
          ? 'waiting'
          : 'todo'
        : mutation.kind === 'set-in-progress'
          ? mutation.inProgress
            ? 'doing'
            : 'todo'
          : mutation.kind === 'set-field' &&
              mutation.key.toLowerCase() === 'status'
            ? mutation.value
            : undefined
  if (
    !status ||
    !['todo', 'doing', 'waiting', 'done', 'cancelled'].includes(status)
  )
    return task
  return {
    ...task,
    status,
    fields: { ...task.fields, status },
    checked: status === 'done',
    waiting: status === 'waiting',
    inProgress: status === 'doing',
    cancelled: status === 'cancelled',
    forwarded: false
  }
}
export function mutateTodoSeq(
  body: string,
  task: Pick<VaultTask, 'id' | 'taskIndex'>,
  mutation: TodoMutation
): string {
  const scan = scanTodoSeq(body).find((s) =>
    task.id.includes('#todoseq:')
      ? s.index === Number(task.id.split('#todoseq:').pop())
      : s.checkboxIndex === task.taskIndex
  )
  if (!scan) return body
  const target = scan
  const lines = body.split('\n'),
    m = target.match
  let keyword = m[3],
    tail = m[5],
    prefix = lines[target.line].slice(
      0,
      m.index + m[0].length - keyword.length - m[4].length - tail.length
    )
  function planning(key: string, value: string | null) {
    let found = false
    for (let i = target.planningEnd - 1; i > target.line; i--) {
      lines[i] = lines[i].replace(
        ENTRY,
        (entry, name: string, timestamp: string) => {
          if (name !== key) return entry
          found = true
          return value == null
            ? ''
            : `${key}: ${timestamp.replace(/\d{4}-\d{2}-\d{2}/, value)}`
        }
      )
      if (!lines[i].trim()) lines.splice(i, 1)
    }
    if (!found && value) {
      const weekday = new Date(value + 'T00:00:00Z').toLocaleDateString(
        'en-US',
        { weekday: 'short', timeZone: 'UTC' }
      )
      lines.splice(target.line + 1, 0, `${m[1]}  ${key}: <${value} ${weekday}>`)
    }
  }
  let state: string | undefined
  switch (mutation.kind) {
    case 'set-checked':
      state = mutation.checked ? 'done' : 'todo'
      break
    case 'set-waiting':
      state = mutation.waiting ? 'waiting' : 'todo'
      break
    case 'set-in-progress':
      state = mutation.inProgress ? 'doing' : 'todo'
      break
    case 'set-field':
      if (mutation.key.toLowerCase() === 'status') {
        if (
          !mutation.value ||
          !['todo', 'doing', 'waiting', 'done', 'cancelled'].includes(
            mutation.value
          )
        )
          throw new Error(
            'TODOseq status must be todo, doing, waiting, done or cancelled'
          )
        state = mutation.value
      } else {
        // Reuse native field token handling on the tail only.
        tail = setTaskFieldAtIndex(
          `- [ ] ${tail}`,
          0,
          mutation.key,
          mutation.value
        ).slice(6)
      }
      break
    case 'set-priority': {
      tail = todoText(tail)
      const token = mutation.priority
        ? `[#${{ high: 'A', med: 'B', low: 'C' }[mutation.priority]}]`
        : ''
      tail = [token, tail].filter(Boolean).join(' ')
      break
    }
    case 'set-due':
      planning('DEADLINE', mutation.due)
      break
    case 'set-text': {
      const priority = PRIORITY.exec(tail)?.[0].trim()
      const fields =
        tail.match(/(?:^|\s)@[a-z][a-z0-9_-]*:[\p{L}\d][\p{L}\d/_-]*/giu) ?? []
      tail = [priority, mutation.text.trim(), ...fields.map((v) => v.trim())]
        .filter(Boolean)
        .join(' ')
      break
    }
  }
  if (state) {
    if (todoStatus[keyword] !== state)
      keyword = {
        todo: 'TODO',
        doing: 'DOING',
        waiting: 'WAIT',
        done: 'DONE',
        cancelled: 'CANCELED'
      }[state]!
    if (m[2] != null)
      prefix = prefix.replace(
        /\[[ xX>/-]\]/,
        `[${state === 'done' ? 'x' : state === 'cancelled' ? '-' : ' '}]`
      )
    if (state !== 'done') planning('CLOSED', null)
  }
  lines[target.line] = `${prefix}${keyword}${m[4]}${tail}`
  return lines.join('\n')
}
