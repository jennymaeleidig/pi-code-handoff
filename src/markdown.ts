/**
 * The Agent reply tab's view of a reply: its own markdown blocks, read back out
 * of the message text.
 *
 * A block is copied whole — a table keeps its rows, a list its items, a
 * blockquote its `>` marks — because this tab makes no promise about content
 * beyond "this is what the message says". A fenced block is the exception, and
 * it splits in two: a code fence's own fences are decoration around the
 * payload, so they come off and the code arrives as code; an `md` fence holds a
 * document, often one that fences blocks of its own, so it keeps its outer
 * fence and the blocks nested inside it stay decorated. Fences are found by
 * `fences.ts`, so nested and escaped fences stay content rather than structure.
 */

import { scanFenceSpans, type FenceSpan } from "./fences.ts";
import { plural } from "./handoff.ts";

export interface ParsedBlock {
  /** One line naming the kind and where it starts, for the picker's list. */
  label: string;
  /** What `enter` copies: the block's source, without a code fence's fences. */
  body: string;
}

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const BLOCKQUOTE = /^ {0,3}>/;
const TABLE_ROW = /^ {0,3}\|?\s*[^|\n]+\|/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function fenceCaption(lang: string, line: number): string {
  const tag = lang === "" ? "code" : lang;
  return `[${tag}] — line ${line}`;
}

/**
 * Info strings whose body is a document to read rather than code to run. The
 * fence is part of that payload, and so is any fence inside it.
 */
const DOCUMENT_TAGS = new Set(["md", "markdown"]);

/** The tag word of an info string, lower-cased: `ts title=x` is `ts`. */
function fenceTag(lang: string): string {
  return (lang.split(/\s+/, 1)[0] ?? "").toLowerCase();
}

function keepsFences(lang: string): boolean {
  return DOCUMENT_TAGS.has(fenceTag(lang));
}

/**
 * A code fence's body, with the final newline a fenced body cannot carry put
 * back. A hand-off block's fence leaves an empty line before the closer for
 * exactly this reason, so a block this extension spliced arrives here already
 * terminated and unchanged; a patch that lost its last newline is `corrupt
 * patch` to git.
 */
function codeBody(body: string): string {
  return body === "" || body.endsWith("\n") ? body : `${body}\n`;
}

function fencedBody(fence: FenceSpan, lines: string[]): string {
  // The scanner hands back the body with the opener's indentation removed; the
  // document case needs the source, fences and all.
  return keepsFences(fence.lang)
    ? lines.slice(fence.start, fence.end).join("\n")
    : codeBody(fence.body);
}

function tableStart(lines: string[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  return (
    header !== undefined &&
    delimiter !== undefined &&
    TABLE_ROW.test(header) &&
    TABLE_DELIMITER.test(delimiter)
  );
}

function isContinuation(line: string): boolean {
  return /^(?: {2,}|\t)/.test(line);
}

/** The end (exclusive) of a list starting at `index`, including loose items. */
function listEnd(lines: string[], index: number): number {
  let end = index;
  while (end < lines.length) {
    const line = lines[end]!;
    if (LIST_ITEM.test(line) || isContinuation(line)) {
      end += 1;
      continue;
    }
    if (line.trim() === "") {
      // A blank line only stays inside the list when the list resumes after it.
      let next = end + 1;
      while (next < lines.length && lines[next]!.trim() === "") next += 1;
      const resumed = lines[next];
      if (resumed !== undefined && (LIST_ITEM.test(resumed) || isContinuation(resumed))) {
        end = next;
        continue;
      }
    }
    break;
  }
  return end;
}

export function parseMarkdownBlocks(text: string): ParsedBlock[] {
  const lines = text.split(/\r\n|\r|\n/);
  const fences = new Map(scanFenceSpans(text).map((span) => [span.start, span]));
  const blocks: ParsedBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const fence = fences.get(index);
    if (fence) {
      blocks.push({
        label: fenceCaption(fence.lang, index + 1),
        body: fencedBody(fence, lines),
      });
      index = fence.end;
      continue;
    }

    if (tableStart(lines, index)) {
      let end = index + 2;
      while (end < lines.length && lines[end]!.trim() !== "" && lines[end]!.includes("|")) {
        end += 1;
      }
      const rows = end - index - 2;
      blocks.push({
        label: `[table] — ${plural(rows, "row")}, line ${index + 1}`,
        body: lines.slice(index, end).join("\n"),
      });
      index = end;
      continue;
    }

    if (BLOCKQUOTE.test(lines[index]!)) {
      let end = index;
      while (end < lines.length && BLOCKQUOTE.test(lines[end]!)) end += 1;
      blocks.push({
        label: `[quote] — line ${index + 1}`,
        body: lines.slice(index, end).join("\n"),
      });
      index = end;
      continue;
    }

    if (LIST_ITEM.test(lines[index]!)) {
      const end = listEnd(lines, index);
      const items = lines.slice(index, end).filter((line) => LIST_ITEM.test(line)).length;
      blocks.push({
        label: `[list] — ${plural(items, "item")}, line ${index + 1}`,
        body: lines.slice(index, end).join("\n"),
      });
      index = end;
      continue;
    }

    index += 1;
  }

  return blocks;
}
