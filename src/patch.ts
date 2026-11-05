/**
 * Parsing and applying a raw unified-diff patch supplied through the
 * escape hatch. Hunk headers are read only to locate context; they are never
 * trusted for counts, because the tool recounts and rewrites them.
 */

import { splitText, joinText, type EditKind } from "./diff.ts";

interface ParsedLine {
  kind: EditKind;
  text: string;
  /** The preceding "\\ No newline at end of file" marker applies to this side. */
  noNewline: boolean;
}

export interface ParsedHunk {
  oldStart: number;
  newStart: number;
  lines: ParsedLine[];
}

export interface ParsedPatch {
  /** A path, `null` for `/dev/null`, or undefined when no header was written. */
  oldPath: string | null | undefined;
  /** A path, `null` for `/dev/null`, or undefined when no header was written. */
  newPath: string | null | undefined;
  hunks: ParsedHunk[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): ParsedPatch {
  const normalized = patch.replace(/\r\n/g, "\n");
  const lines = (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
  let oldPath: string | null | undefined;
  let newPath: string | null | undefined;
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | undefined;
  let last: ParsedLine | undefined;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (hunks.length > 0) {
        throw new Error("The patch changes more than one file; one block carries one file.");
      }
      continue;
    }
    if (!current && line.startsWith("--- ")) {
      oldPath = pathFromHeader(line.slice(4));
      continue;
    }
    if (!current && line.startsWith("+++ ")) {
      newPath = pathFromHeader(line.slice(4));
      continue;
    }
    if (
      !current &&
      (line.startsWith("index ") ||
        line.startsWith("new file mode ") ||
        line.startsWith("deleted file mode ") ||
        line.startsWith("similarity index ") ||
        line.startsWith("rename from ") ||
        line.startsWith("rename to "))
    ) {
      continue;
    }

    const header = HUNK.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        lines: [],
      };
      hunks.push(current);
      last = undefined;
      continue;
    }

    if (!current) {
      if (line.trim() === "") continue;
      throw new Error(`patch line outside a hunk: ${JSON.stringify(line)}`);
    }

    if (line.startsWith("\\")) {
      if (!last) throw new Error('patch has a "No newline" marker before any hunk line');
      last.noNewline = true;
      continue;
    }

    if (line === "") {
      // A blank context line whose single leading space was trimmed by the model.
      last = { kind: " ", text: "", noNewline: false };
      current.lines.push(last);
      continue;
    }

    const kind = line[0];
    if (kind !== " " && kind !== "+" && kind !== "-") {
      throw new Error(`patch hunk line must start with " ", "+" or "-": ${JSON.stringify(line)}`);
    }
    last = { kind, text: line.slice(1), noNewline: false };
    current.lines.push(last);
  }

  if (hunks.length === 0) throw new Error("patch contains no hunks");

  return { oldPath, newPath, hunks };
}

function pathFromHeader(value: string): string | null {
  const path = value.split("\t")[0]!.trim();
  if (path === "/dev/null") return null;
  return path.replace(/^[ab]\//, "");
}

/**
 * Apply parsed hunks to an old text. Context and deleted lines must match
 * exactly; a mismatch names the first line that failed.
 */
export function applyHunks(oldText: string, hunks: ParsedHunk[]): string {
  const old = splitText(oldText);
  const next: string[] = [];
  let cursor = 0;
  let lastNewLineHasNoNewline = false;

  for (const hunk of hunks) {
    // A hunk with no context or deletion inserts at `oldStart` (git writes
    // `-N,0` meaning "after line N"); otherwise its first old-side line is
    // 1-based line `oldStart`.
    const index = hunk.lines.some((line) => line.kind !== "+") ? hunk.oldStart - 1 : hunk.oldStart;
    if (index < cursor) {
      throw new Error(`patch hunk at old line ${hunk.oldStart} overlaps an earlier hunk`);
    }
    if (index > old.lines.length) {
      throw new Error(`patch hunk at old line ${hunk.oldStart} is past the end of the file`);
    }
    while (cursor < index) {
      next.push(old.lines[cursor]!);
      lastNewLineHasNoNewline = false;
      cursor += 1;
    }

    for (const line of hunk.lines) {
      if (line.kind !== "+") {
        const actual = old.lines[cursor];
        if (actual === undefined) {
          throw new Error(
            `patch hunk at old line ${hunk.oldStart} reads past the end of the file at line ${cursor + 1}`,
          );
        }
        if (actual !== line.text) {
          throw new Error(
            `patch hunk at old line ${hunk.oldStart} does not match line ${cursor + 1}:\n` +
              `  expected: ${JSON.stringify(line.text)}\n` +
              `  found:    ${JSON.stringify(actual)}`,
          );
        }
        cursor += 1;
        if (line.kind === " ") {
          next.push(line.text);
          lastNewLineHasNoNewline = line.noNewline;
        }
      } else {
        next.push(line.text);
        lastNewLineHasNoNewline = line.noNewline;
      }
    }
  }

  while (cursor < old.lines.length) {
    next.push(old.lines[cursor]!);
    lastNewLineHasNoNewline = false;
    cursor += 1;
  }

  return joinText(next, !lastNewLineHasNoNewline);
}
