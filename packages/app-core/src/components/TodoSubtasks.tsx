import type { VaultTask } from '@shared/tasks'
import { useStore } from '../store'
import { TaskStateBox } from './TaskStateBox'
import { InlineMarkdown } from '../lib/inline-markdown'

/** TODOseq owns its entire checklist; native rollups remain unchanged. */
export function TodoSubtasks({
  task
}: {
  task: VaultTask
}): JSX.Element | null {
  const tasks = useStore((s) => s.vaultTasks)
  const toggle = useStore((s) => s.toggleTaskFromList)
  if (!task.progress) return null
  return (
    <div
      className="mt-1 text-xs text-current/70"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span aria-label="Subtask progress">
        {task.progress.done}/{task.progress.total}
      </span>
      {tasks
        .filter((child) => child.parentId === task.id)
        .map((child) => (
          <div key={child.id} className="ml-3 flex items-start gap-2 py-0.5">
            <TaskStateBox task={child} onToggle={() => void toggle(child)} />
            <span
              className={
                child.checked || child.cancelled
                  ? 'line-through opacity-60'
                  : ''
              }
            >
              <InlineMarkdown text={child.content} />
            </span>
          </div>
        ))}
    </div>
  )
}
