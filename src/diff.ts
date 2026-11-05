/**
 * Line diffing and canonical unified-diff rendering.
 *
 * A generated diff always carries three lines of context where the file
 * provides them, and its hunk headers are counted here rather than supplied by
 * the model. Paths are repo-relative and written as `a/<path>` and `b/<path>`.
 */

export type EditKind = " " | "-" | "+";

interface RawEdit {
  kind: EditKind;
  text: string;
}

export interface Edit extends RawEdit {
  /** 1-based line number on the old side, or the insertion point. */
  oldLine: number;
  /** 1-based line number on the new side, or the insertion point. */
  newLine: number;
}

export interface SplitText {
  lines: string[];
  /** False when the text's last line has no trailing newline. */
  endsWithNewline: boolean;
}

export function splitText(text: string): SplitText {
  if (text === "") return { lines: [], endsWithNewline: true };
  const endsWithNewline = text.endsWith("\n");
  const body = endsWithNewline ? text.slice(0, -1) : text;
  return { lines: body.split("\n"), endsWithNewline };
}

export function joinText(lines: string[], endsWithNewline: boolean): string {
  if (lines.length === 0) return "";
  return lines.join("\n") + (endsWithNewline ? "\n" : "");
}

/**
 * Myers diff. The search is abandoned past `limit` edits, where the two sides
 * are treated as wholly different: a valid, if noisier, patch is still a
 * truthful one, and the alternative is quadratic memory on a whole-file
 * rewrite that `form: "full"` should have been used for.
 */
function myers(oldLines: string[], newLines: string[]): RawEdit[] {
  const n = oldLines.length;
  const m = newLines.length;
  const max = n + m;
  const limit = Math.min(max, 2000);
  const trace: Map<number, number>[] = [];
  let found = false;
  let v = new Map<number, number>();

  for (let d = 0; d <= limit; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const down = v.get(k + 1) ?? Number.NEGATIVE_INFINITY;
      const right = v.get(k - 1) ?? Number.NEGATIVE_INFINITY;
      let x: number;
      if (k === -d || (k !== d && right < down)) {
        x = v.get(k + 1) ?? 0;
      } else {
        x = (v.get(k - 1) ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x += 1;
        y += 1;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    return [
      ...oldLines.map((text) => ({ kind: "-" as const, text })),
      ...newLines.map((text) => ({ kind: "+" as const, text })),
    ];
  }

  const reversed: { kind: EditKind; text: string }[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d--) {
    const snapshot = trace[d]!;
    const k = x - y;
    const right = snapshot.get(k - 1) ?? Number.NEGATIVE_INFINITY;
    const down = snapshot.get(k + 1) ?? Number.NEGATIVE_INFINITY;
    const prevK = k === -d || (k !== d && right < down) ? k + 1 : k - 1;
    const prevX = snapshot.get(prevK) ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      reversed.push({ kind: " ", text: oldLines[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (d === 0) break;
    if (x === prevX) {
      reversed.push({ kind: "+", text: newLines[y - 1]! });
      y -= 1;
    } else {
      reversed.push({ kind: "-", text: oldLines[x - 1]! });
      x -= 1;
    }
  }

  reversed.reverse();
  return reversed;
}

function annotate(raw: RawEdit[]): Edit[] {
  let oldLine = 1;
  let newLine = 1;
  return raw.map((edit) => {
    const result: Edit = { ...edit, oldLine, newLine };
    if (edit.kind !== "+") oldLine += 1;
    if (edit.kind !== "-") newLine += 1;
    return result;
  });
}

interface Hunk {
  start: number;
  end: number;
}

function groupHunks(edits: Edit[], context: number): Hunk[] {
  const changes: number[] = [];
  for (let index = 0; index < edits.length; index++) {
    if (edits[index]!.kind !== " ") changes.push(index);
  }
  if (changes.length === 0) return [];

  const ranges: Hunk[] = [];
  let start = changes[0]!;
  let end = changes[0]!;
  for (const index of changes.slice(1)) {
    if (index - end - 1 <= context * 2) {
      end = index;
    } else {
      ranges.push({ start, end });
      start = index;
      end = index;
    }
  }
  ranges.push({ start, end });

  return ranges.map((range) => ({
    start: Math.max(0, range.start - context),
    end: Math.min(edits.length, range.end + context + 1),
  }));
}

function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

/**
 * Render a canonical unified diff for one file. Returns an empty string when
 * the two texts are identical.
 */
export function unifiedDiff(path: string, oldText: string, newText: string, context = 3): string {
  const oldSide = splitText(oldText);
  const newSide = splitText(newText);
  const edits = annotate(myers(oldSide.lines, newSide.lines));
  const hunks = groupHunks(edits, context);
  if (hunks.length === 0) return "";

  const output = [`--- a/${path}`, `+++ b/${path}`];

  for (const hunk of hunks) {
    const lines = edits.slice(hunk.start, hunk.end);
    const oldCount = lines.filter((line) => line.kind !== "+").length;
    const newCount = lines.filter((line) => line.kind !== "-").length;
    const first = lines[0]!;
    const oldStart = oldCount === 0 ? first.oldLine - 1 : first.oldLine;
    const newStart = newCount === 0 ? first.newLine - 1 : first.newLine;
    output.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`);

    for (const line of lines) {
      output.push(`${line.kind}${line.text}`);
      const oldEndsHere =
        line.kind !== "+" && line.oldLine === oldSide.lines.length && !oldSide.endsWithNewline;
      const newEndsHere =
        line.kind !== "-" && line.newLine === newSide.lines.length && !newSide.endsWithNewline;
      if (oldEndsHere || newEndsHere) output.push("\\ No newline at end of file");
    }
  }

  return `${output.join("\n")}\n`;
}

export interface Counts {
  hunks: number;
  insertions: number;
  deletions: number;
}

export function countDiff(diff: string): Counts {
  let hunks = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@ ")) hunks += 1;
    else if (line.startsWith("+") && !line.startsWith("+++ ")) insertions += 1;
    else if (line.startsWith("-") && !line.startsWith("--- ")) deletions += 1;
  }
  return { hunks, insertions, deletions };
}
