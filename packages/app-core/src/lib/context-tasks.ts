import type { RefObject } from "react";
import { useStore } from "../store";
import { useContextSurface } from "./context-copy";
import { taskItem } from "./context-format";

export function useTasksContext(
  root: RefObject<HTMLElement>,
  viewMode: string,
): void {
  const itemFor = (element: Element | null) => {
    const id = element?.getAttribute("data-context-task");
    const task = useStore.getState().vaultTasks.find((t) => t.id === id);
    return task ? taskItem(task) : null;
  };
  useContextSurface(root, {
    identity: `tasks:${viewMode}`,
    resolve: (item) => {
      const task = useStore
        .getState()
        .vaultTasks.find((t) => t.id === item.key);
      return task ? taskItem(task) : null;
    },
    direct: () => {
      const item = itemFor(
        root.current?.querySelector('[data-context-cursor="true"]') ?? null,
      );
      return item ? [item] : [];
    },
    at: (event) => {
      const element = (
        event.target instanceof Element ? event.target : null
      )?.closest("[data-context-task]");
      const item = itemFor(element ?? null);
      return item && element
        ? { item, rects: [element.getBoundingClientRect()] }
        : null;
    },
  });
}
