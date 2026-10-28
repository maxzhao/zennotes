import { useMemo, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useContextSurface, type GrabHit } from "./context-copy";
import {
  noteItem,
  sourceBlocks,
  smallestBlock,
  type ContextItem,
} from "./context-format";

function refreshNote(item: ContextItem, source: string): ContextItem | null {
  const [start, end] = item.locator.slice(1).split("-").map(Number);
  return end <= source.split("\n").length
    ? noteItem(item.path, source, start, end)
    : null;
}
export function useEditorContext(
  root: RefObject<HTMLElement>,
  view: RefObject<EditorView | null>,
  path: string | null,
): void {
  let cached = "",
    blocks = sourceBlocks("");
  const parsed = (source: string) => {
    if (source !== cached) {
      cached = source;
      blocks = sourceBlocks(source);
    }
    return blocks;
  };
  useContextSurface(
    root,
    {
      identity: `editor:${path}`,
      resolve: (item) => {
        const source = view.current?.state.doc.toString();
        return source === undefined ? null : refreshNote(item, source);
      },
      direct: () => {
        const editor = view.current;
        if (!path || !editor) return [];
        const doc = editor.state.doc,
          source = doc.toString(),
          sel = editor.state.selection.main;
        if (sel.empty) {
          const block = smallestBlock(parsed(source), sel.head);
          return block ? [noteItem(path, source, block.start, block.end)] : [];
        }
        const start = doc.lineAt(sel.from),
          end = doc.lineAt(sel.to - 1);
        const whole =
          sel.from === start.from &&
          (sel.to === end.to || sel.to === end.to + 1);
        return [
          noteItem(
            path,
            source,
            start.number,
            end.number,
            whole ? undefined : doc.sliceString(sel.from, sel.to),
          ),
        ];
      },
      at: (event) => {
        const editor = view.current;
        if (
          !path ||
          !editor ||
          !(event.target instanceof Element) ||
          !event.target.closest(".cm-content")
        )
          return null;
        const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY }, false);
        if (pos == null) return null;
        const source = editor.state.doc.toString(),
          block = smallestBlock(parsed(source), pos);
        if (!block) return null;
        const first = editor.coordsAtPos(
          Math.max(block.from, editor.viewport.from),
        );
        const last = editor.coordsAtPos(Math.min(block.to, editor.viewport.to));
        const bounds = editor.contentDOM.getBoundingClientRect();
        const rect = new DOMRect(
          bounds.left,
          first?.top ?? bounds.top,
          bounds.width,
          (last?.bottom ?? bounds.bottom) - (first?.top ?? bounds.top),
        );
        return {
          item: noteItem(path, source, block.start, block.end),
          rects: [rect],
        };
      },
    },
    !!path && !!path.match(/\.md$/i) && !path.endsWith(".excalidraw.md"),
  );
}
export interface EmbedReplacement {
  from: number;
  to: number;
  text: string;
}
export function previewLineMap(
  source: string,
  expanded: string,
  replacements: EmbedReplacement[],
): number[] {
  let offset = 0;
  return expanded.split("\n").map((line) => {
    const pos = offset;
    offset += line.length + 1;
    let shift = 0,
      original = pos;
    for (const replacement of replacements) {
      if (pos < replacement.from + shift) break;
      if (pos < replacement.from + shift + replacement.text.length) {
        original = replacement.from;
        return source.slice(0, original).split("\n").length;
      }
      shift += replacement.text.length - (replacement.to - replacement.from);
    }
    original = pos - shift;
    return source.slice(0, original).split("\n").length;
  });
}
export function usePreviewContext(
  root: RefObject<HTMLElement>,
  path: string,
  source: string,
  lineMap?: number[],
  enabled = true,
): void {
  const blocks = useMemo(() => sourceBlocks(source), [source]);
  const remembered = useRef<ContextItem[]>([]);
  const identity = useRef("");
  if (identity.current !== path + "\0" + source) {
    identity.current = path + "\0" + source;
    remembered.current = [];
  }
  const forNode = (node: Node | null): GrabHit | null => {
    let el = node instanceof Element ? node : node?.parentElement;
    if (!el || !root.current?.contains(el)) return null;
    // Expanded notes never own targets: use the outermost host embed's mapped line.
    const embeds: Element[] = [];
    for (
      let p: Element | null = el;
      p && p !== root.current;
      p = p.parentElement
    )
      if (p.matches(".note-embed")) embeds.push(p);
    const embed = embeds.at(-1);
    if (embed) el = embed.querySelector("[data-source-line]") ?? embed;
    const marked = el.closest<HTMLElement>("[data-source-line]");
    if (!marked || !root.current.contains(marked)) return null;
    const renderedLine = Number(marked.dataset.sourceLine);
    const line = lineMap?.[renderedLine - 1] ?? renderedLine;
    const candidates = blocks.filter((b) => b.start === line);
    const block =
      (marked.tagName === "LI" && !embed
        ? candidates.find((b) => b.type === "listItem")
        : candidates.sort((a, b) =>
            embed
              ? a.to - a.from - (b.to - b.from)
              : b.to - b.from - (a.to - a.from),
          )[0]) ??
      blocks
        .filter((b) => b.start <= line && b.end >= line)
        .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    if (!block) return null;
    return {
      item: noteItem(path, source, block.start, block.end),
      rects: [(embed ?? marked).getBoundingClientRect()],
    };
  };
  const remember = (): void => {
    const selection = window.getSelection();
    if (
      !selection ||
      !root.current?.contains(selection.anchorNode) ||
      !root.current.contains(selection.focusNode)
    )
      return;
    if (selection.isCollapsed) {
      remembered.current = [];
      return;
    }
    const range = selection.getRangeAt(0);
    const a = forNode(range.startContainer),
      b = forNode(range.endContainer);
    if (!a || !b) {
      remembered.current = [];
      return;
    }
    const parse = (item: ContextItem) =>
      item.locator.slice(1).split("-").map(Number);
    const [as, ae] = parse(a.item),
      [bs, be] = parse(b.item);
    let start = Math.min(as, bs),
      end = Math.max(ae, be);
    const covering = blocks
      .filter((block) => block.start <= start && block.end >= end)
      .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    if (covering) {
      start = covering.start;
      end = covering.end;
    }
    remembered.current = [
      noteItem(path, source, start, end, selection.toString()),
    ];
  };
  useContextSurface(
    root,
    {
      identity: `preview:${path}`,
      resolve: (item) => refreshNote(item, source),
      direct: () => {
        remember();
        return remembered.current;
      },
      remember,
      at: (event) => forNode(event.target as Node),
    },
    enabled,
  );
}
