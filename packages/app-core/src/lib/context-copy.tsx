import { useEffect, useRef, type RefObject } from "react";
import { create } from "zustand";
import { useStore } from "../store";
import { copyWithFallback } from "./clipboard";
import { formatContext, type ContextItem } from "./context-format";
import { useToastStore } from "./toast";
import { matchesShortcutBinding, normalizeShortcutBinding } from "./keymaps";

export interface GrabHit {
  item: ContextItem;
  rects: DOMRect[];
}
interface ContextSurface {
  identity: string;
  direct: () => ContextItem[];
  resolve?: (item: ContextItem) => ContextItem | null;
  at?: (event: MouseEvent) => GrabHit | null;
  remember?: () => void;
}
const surfaces = new Map<HTMLElement, { current: ContextSurface }>();
let lastSurface: HTMLElement | null = null;
let grabbed: {
  root: HTMLElement;
  identity: string;
  items: ContextItem[];
} | null = null;
let highlight: HTMLDivElement | null = null;
function clearHighlight(): void {
  highlight?.remove();
  highlight = null;
}
export const useGrabMode = create<{ active: boolean }>(() => ({
  active: false,
}));
export function toggleGrabMode(): void {
  const active = !useGrabMode.getState().active;
  useGrabMode.setState({ active });
  document.documentElement.toggleAttribute("data-grab-mode", active);
  if (!active) {
    grabbed = null;
    clearHighlight();
  }
}
export async function copyContext(items: ContextItem[]): Promise<void> {
  if (!items.length) return;
  const prefix = useStore.getState().vaultSettings.projectPathPrefix ?? "";
  if (await copyWithFallback(formatContext(items, prefix)))
    useToastStore
      .getState()
      .addToast(
        `Copied ${items.length} item${items.length === 1 ? `: ${prefix}${items[0].path}` : "s"}`,
        "success",
        undefined,
        2200,
      );
}
export function useContextSurface(
  ref: RefObject<HTMLElement>,
  adapter: ContextSurface,
  enabled = true,
): void {
  const latest = useRef(adapter);
  latest.current = adapter;
  useEffect(() => {
    const root = ref.current;
    if (
      !root ||
      !enabled ||
      root.closest(".note-embed, .zn-canvas-embedded") ||
      (root.matches("[data-preview-content]") && root.closest(".zn-canvas"))
    )
      return;
    surfaces.set(root, latest);
    return () => {
      surfaces.delete(root);
    };
  });
  useEffect(
    () => () => {
      if (grabbed?.root === ref.current) grabbed = null;
    },
    [],
  );
}
function surfaceAt(
  target: EventTarget | null,
): [HTMLElement, ContextSurface] | undefined {
  let node = target instanceof Element ? target : null;
  while (node) {
    const adapter = surfaces.get(node as HTMLElement);
    if (adapter) return [node as HTMLElement, adapter.current];
    node = node.parentElement;
  }
}
export function copyCurrentContext(): void {
  const paneId = useStore.getState().activePaneId;
  const candidates = [...surfaces].filter(
    ([root]) =>
      root.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId === paneId &&
      root.getClientRects().length,
  );
  const focused = surfaceAt(document.activeElement);
  const root =
    focused && candidates.some(([r]) => r === focused[0])
      ? focused[0]
      : (candidates.find(([r]) => r === lastSurface)?.[0] ??
        candidates[0]?.[0]);
  const items = root ? (surfaces.get(root)?.current.direct() ?? []) : [];
  if (items.length) void copyContext(items);
  else
    useToastStore
      .getState()
      .addToast("No context target", "info", undefined, 2200);
}
export function useContextCopyRuntime(): void {
  useEffect(() => {
    const copyBinding = normalizeShortcutBinding("Mod+Alt+C")!;
    const grabBinding = normalizeShortcutBinding("Mod+Alt+G")!;
    let touch = false;
    const remember = (): void => {
      for (const entry of surfaces.values()) entry.current.remember?.();
    };
    const claim = (event: Event): void => {
      const found = surfaceAt(event.target);
      if (found) lastSurface = found[0];
    };
    const hit = (
      event: MouseEvent,
    ): {
      root: HTMLElement;
      adapter: ContextSurface;
      target: GrabHit;
    } | null => {
      if (!useGrabMode.getState().active) return null;
      const found = surfaceAt(event.target);
      if (!found) return null;
      const target = found[1].at?.(event);
      return target ? { root: found[0], adapter: found[1], target } : null;
    };
    const down = (event: Event): void => {
      claim(event);
      if (event instanceof PointerEvent) touch = event.pointerType === "touch";
      if (event instanceof MouseEvent && event.button !== 0) return;
      if (hit(event as MouseEvent)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const click = (event: MouseEvent): void => {
      const found = hit(event);
      if (!found) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const { root, adapter, target } = found;
      if (
        !event.shiftKey ||
        touch ||
        grabbed?.root !== root ||
        grabbed.identity !== adapter.identity
      )
        grabbed = { root, identity: adapter.identity, items: [target.item] };
      else {
        const index = grabbed.items.findIndex((i) => i.key === target.item.key);
        if (index < 0) grabbed.items.push(target.item);
        else grabbed.items.splice(index, 1);
      }
      if (adapter.resolve)
        grabbed.items = grabbed.items.flatMap(
          (item) => adapter.resolve!(item) ?? [],
        );
      void copyContext(grabbed.items);
    };
    const move = (event: MouseEvent): void => {
      clearHighlight();
      const found = hit(event);
      if (!found) return;
      highlight = document.createElement("div");
      highlight.style.cssText =
        "position:fixed;inset:0;pointer-events:none;z-index:9999";
      for (const rect of found.target.rects) {
        const box = document.createElement("div");
        box.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:2px solid rgb(var(--z-accent));background:rgb(var(--z-accent)/0.12);border-radius:3px;box-sizing:border-box`;
        highlight.append(box);
      }
      document.body.append(highlight);
    };
    const keydown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      if (event.key === "Escape" && useGrabMode.getState().active) {
        toggleGrabMode();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (matchesShortcutBinding(event, grabBinding)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleGrabMode();
      } else if (matchesShortcutBinding(event, copyBinding)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        copyCurrentContext();
      }
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("focusin", claim, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("mousedown", down, true);
    window.addEventListener("dragstart", down, true);
    window.addEventListener("dblclick", down, true);
    window.addEventListener("click", click, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("scroll", clearHighlight, true);
    window.addEventListener("blur", clearHighlight);
    document.addEventListener("selectionchange", remember);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("focusin", claim, true);
      for (const name of ["pointerdown", "mousedown", "dragstart", "dblclick"])
        window.removeEventListener(name, down, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("scroll", clearHighlight, true);
      window.removeEventListener("blur", clearHighlight);
      document.removeEventListener("selectionchange", remember);
      grabbed = null;
      clearHighlight();
    };
  }, []);
}
export function GrabButton(): JSX.Element {
  const active = useGrabMode((s) => s.active);
  return (
    <button
      type="button"
      title="Toggle Grab Mode"
      aria-label="Toggle Grab Mode"
      aria-pressed={active}
      onClick={toggleGrabMode}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${active ? "bg-accent/15 text-accent" : "text-ink-500 hover:bg-paper-200 hover:text-ink-800"}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v10c0 4-3 6-7 6h-1c-2 0-4-1-5-3l-4-6a2 2 0 0 1 3-2l2 2Z" />
      </svg>
    </button>
  );
}
