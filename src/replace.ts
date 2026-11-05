/**
 * The `replacements` input shape: sequential search/replace pairs over one
 * file's text, each of which must match exactly once. Mismatches carry enough
 * detail for the model to repair the call in the same turn.
 */

export interface Replacement {
  search: string;
  replace: string;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const previous = new Array<number>(b.length + 1);
  for (let index = 0; index <= b.length; index++) previous[index] = index;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = saved;
    }
  }
  return previous[b.length]!;
}

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) if (text[index] === "\n") line += 1;
  return line;
}

/** The three lines of the file closest to any line of the search text. */
export function nearestLines(content: string, search: string): string[] {
  const contentLines = content.split("\n");
  const searchLines = search.split("\n").filter((line) => line.trim() !== "");
  if (searchLines.length === 0) searchLines.push(search);

  const scored = contentLines.map((line, index) => {
    let score = Number.POSITIVE_INFINITY;
    for (const wanted of searchLines) {
      score = Math.min(score, levenshtein(line, wanted));
    }
    return { line: line.trimEnd(), number: index + 1, score };
  });

  return scored
    .sort((a, b) => a.score - b.score || a.number - b.number)
    .slice(0, 3)
    .sort((a, b) => a.number - b.number)
    .map((candidate) => `  ${candidate.number}: ${candidate.line}`);
}

/**
 * Apply replacements in order against the evolving content. Every search text
 * must match exactly once; zero matches name the nearest lines, several name
 * the line numbers. Overlapping matches count separately.
 */
export function applyReplacements(
  content: string,
  replacements: Replacement[],
  path: string,
): string {
  let next = content;
  for (const [index, replacement] of replacements.entries()) {
    if (replacement.search === "") {
      throw new Error(`replacement ${index + 1} has empty search text; it would match everywhere`);
    }
    const occurrences: number[] = [];
    for (
      let at = next.indexOf(replacement.search);
      at >= 0;
      at = next.indexOf(replacement.search, at + 1)
    ) {
      occurrences.push(at);
    }

    if (occurrences.length === 0) {
      const candidates = nearestLines(next, replacement.search);
      const hint = candidates.length === 0 ? "" : `\nNearest lines:\n${candidates.join("\n")}`;
      throw new Error(
        `replacement ${index + 1} did not match anything in "${path}".` +
          ` Use the file's exact text, including whitespace.${hint}`,
      );
    }
    if (occurrences.length > 1) {
      const lines = occurrences.map((offset) => lineAt(next, offset)).join(", ");
      throw new Error(
        `replacement ${index + 1} matches ${occurrences.length} times in "${path}" (lines ${lines}).` +
          ` Include enough surrounding text to make the search unique.`,
      );
    }

    const offset = occurrences[0]!;
    next =
      next.slice(0, offset) + replacement.replace + next.slice(offset + replacement.search.length);
  }
  return next;
}
