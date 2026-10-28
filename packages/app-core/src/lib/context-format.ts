import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import type { VaultTask } from "@shared/tasks";
import type { CanvasNode, CanvasEdge } from "./json-canvas";

export interface ContextItem {
  key: string;
  path: string;
  locator: string;
  content?: string;
  selectedText?: string;
}
export interface SourceBlock {
  start: number;
  end: number;
  from: number;
  to: number;
  type: string;
}
const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm);
const blockTypes = new Set([
  "heading",
  "paragraph",
  "listItem",
  "blockquote",
  "code",
  "table",
  "thematicBreak",
  "html",
]);
export function sourceBlocks(source: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  const walk = (node: {
    type: string;
    position?: {
      start: { line: number; offset?: number };
      end: { line: number; offset?: number };
    };
    children?: unknown[];
  }): void => {
    if (blockTypes.has(node.type) && node.position) {
      const { start, end } = node.position;
      blocks.push({
        start: start.line,
        end: end.line,
        from: start.offset ?? 0,
        to: end.offset ?? source.length,
        type: node.type,
      });
    }
    if (["root", "list", "listItem", "blockquote"].includes(node.type))
      node.children?.forEach((child) =>
        walk(child as Parameters<typeof walk>[0]),
      );
  };
  walk(parser.parse(source));
  return blocks;
}
export function smallestBlock(
  blocks: SourceBlock[],
  from: number,
  to = from,
): SourceBlock | undefined {
  return blocks
    .filter((b) => b.from <= from && b.to >= to)
    .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
}
export function noteItem(
  path: string,
  source: string,
  start: number,
  end: number,
  selectedText?: string,
): ContextItem {
  return {
    key: `${path}:${start}-${end}`,
    path,
    locator: `:${start}-${end}`,
    content: source
      .split("\n")
      .slice(start - 1, end)
      .join("\n"),
    selectedText,
  };
}
export function taskItem(task: VaultTask): ContextItem {
  return task.kind === "file" || task.taskIndex === -1
    ? {
        key: task.id,
        path: task.sourcePath,
        locator: " frontmatter task",
        content: task.content,
      }
    : {
        key: task.id,
        path: task.sourcePath,
        locator: `:${task.lineNumber + 1}`,
        content: task.rawText,
      };
}
export function canvasItem(
  path: string,
  component: CanvasNode | CanvasEdge,
): ContextItem {
  if ("type" in component) {
    const c = component as CanvasNode;
    const content =
      c.type === "text"
        ? c.text
        : c.type === "file"
          ? `${c.file ?? ""}${c.subpath ? (c.subpath.startsWith("#") ? "" : "#") + c.subpath : ""}`
          : c.type === "link"
            ? c.url
            : c.label;
    return {
      key: `node ${c.id}`,
      path,
      locator: ` node ${c.id} ${c.type}`,
      content,
    };
  }
  return {
    key: `edge ${component.id}`,
    path,
    locator: ` edge ${component.id} ${component.fromNode} -> ${component.toNode}`,
    content: component.label,
  };
}
export interface DrawingElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  text?: string;
  boundElements?: readonly { id: string; type: string }[] | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}
export function drawingItems(
  path: string,
  elements: readonly DrawingElement[],
  ids: Record<string, boolean>,
): ContextItem[] {
  return Object.keys(ids)
    .filter((id) => ids[id])
    .flatMap((id) => {
      const el = elements.find((e) => e.id === id && !e.isDeleted);
      if (!el) return [];
      const text =
        el.text ??
        el.boundElements
          ?.filter((b) => b.type === "text")
          .map(
            (b) =>
              elements.find((e) => e.id === b.id && !e.isDeleted)?.text ?? "",
          )
          .join("\n");
      const bindings =
        el.type === "arrow" || el.type === "line"
          ? ` start ${el.startBinding?.elementId ?? "unbound"} end ${el.endBinding?.elementId ?? "unbound"}`
          : "";
      return [
        {
          key: id,
          path,
          locator: ` element ${id} ${el.type}${bindings}`,
          content: text || undefined,
        },
      ];
    });
}
function fence(text: string): string {
  const ticks = "`".repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)),
  );
  return `${ticks}\n${text}\n${ticks}`;
}
export function formatContext(items: ContextItem[], prefix: string): string {
  return items
    .map((item) => {
      let text = `${prefix}${item.path}${item.locator}`;
      if (item.content !== undefined) {
        // Markdown source is always fenced, even when it occupies one line.
        text +=
          item.locator.startsWith(":") ||
          item.locator.endsWith(" text") ||
          item.content.includes("\n") ||
          item.content.includes("`")
            ? `\n${fence(item.content)}`
            : ` ${JSON.stringify(item.content)}`;
      }
      if (item.selectedText !== undefined)
        text += `\nselected text\n${fence(item.selectedText)}`;
      return text;
    })
    .join("\n\n");
}
