import { mutateTodoSeq, type TodoMutation } from './todoseq'
import type { VaultTask } from './tasks'
import { describe, expect, it } from 'vitest'
import fixtures from '../../bridge-contract/fixtures/task-roundtrip.json'
import { setTaskDueAtIndex } from './tasklists'
import {
  groupTasks,
  parseTasksFromBody,
  toIsoDateLocal,
  type ParseTasksContext
} from './tasks'

describe('shared task roundtrip fixtures', () => {
  it.each(fixtures.cases)('$id', (fixture) => {
    const note = fixture.note as ParseTasksContext
    const before = parseTasksFromBody(fixture.body, note)
    expect(before).toHaveLength(fixture.expectedTaskCount)
    expect(before[fixture.taskIndex]).toMatchObject(fixture.expectedBefore)

    const localNow = fixture.localNow
      ? new Date(
          fixture.localNow[0],
          fixture.localNow[1] - 1,
          fixture.localNow[2],
          fixture.localNow[3],
          fixture.localNow[4]
        )
      : undefined
    const due = localNow ? toIsoDateLocal(localNow) : fixture.due!
    const saved = setTaskDueAtIndex(fixture.body, fixture.taskIndex, due)
    expect(saved).toBe(fixture.expectedBody)

    const after = parseTasksFromBody(saved, note)
    expect(after).toHaveLength(fixture.expectedTaskCount)
    expect(after[fixture.taskIndex]).toMatchObject(fixture.expectedAfter)
    expect(after[fixture.taskIndex].id).toBe(before[fixture.taskIndex].id)
    if (localNow) {
      expect(
        groupTasks(after, localNow).today.map((task) => task.id)
      ).toContain(after[fixture.taskIndex].id)
    }
  })
})

interface TodoFixture {
  id: string
  body: string
  expected: Partial<VaultTask>[]
  absent?: string[]
  noParents?: boolean
  mutation?: TodoMutation
  expectedBody?: string
  expectedAfter?: Partial<VaultTask>[]
  error?: boolean
  insert?: string
  insertExpected?: Partial<VaultTask>[]
}
describe('shared TODOseq task contract', () => {
  const note: ParseTasksContext = {
    path: 'note.md',
    title: 'Note',
    folder: 'inbox'
  }
  it.each(fixtures.todoseq as unknown as TodoFixture[])('$id', (fixture) => {
    const before = parseTasksFromBody(fixture.body, note)
    expect(before).toHaveLength(fixture.expected.length)
    fixture.expected.forEach((expected, i) =>
      expect(before[i]).toMatchObject(expected)
    )
    for (const key of fixture.absent ?? [])
      expect(before[0][key as keyof VaultTask]).toBeUndefined()
    if (fixture.noParents) expect(before.every((t) => !t.parentId)).toBe(true)
    if (fixture.insert) {
      const inserted = parseTasksFromBody(fixture.insert + fixture.body, note)
      expect(inserted).toHaveLength(fixture.insertExpected!.length)
      fixture.insertExpected!.forEach((expected, i) =>
        expect(inserted[i]).toMatchObject(expected)
      )
      expect(inserted.filter((t) => t.taskIndex >= 0).map((t) => t.id)).toEqual(
        before.filter((t) => t.taskIndex >= 0).map((t) => t.id)
      )
    }
    if (!fixture.mutation) return
    if (fixture.error) {
      expect(() =>
        mutateTodoSeq(fixture.body, before[0], fixture.mutation!)
      ).toThrow(/TODOseq status/)
      return
    }
    const saved = mutateTodoSeq(fixture.body, before[0], fixture.mutation)
    expect(saved).toBe(fixture.expectedBody)
    const after = parseTasksFromBody(saved, note)
    fixture.expectedAfter!.forEach((expected, i) =>
      expect(after[i]).toMatchObject(expected)
    )
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id))
  })
})
