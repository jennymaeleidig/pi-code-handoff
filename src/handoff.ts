/**
 * Presentation of hand-off blocks and the text transformations behind the
 * `replacements` input shape. Everything here is reached through the tool's
 * execute (and the message_end splice), never exported from the package.
 */

export interface HandoffBlock {
  toolCallId: string;
  kind: "code" | "command";
  form?: "diff" | "full";
  path?: string;
  purpose?: string;
  body: string;
  /** Fence tag: `diff`, a language name, `bash`, or the empty string. */
  lang: string;
  caption: string;
}

const LANGUAGES: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "js",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  lua: "lua",
  md: "md",
  mjs: "js",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  txt: "",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

export function languageFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return LANGUAGES[path.slice(dot + 1).toLowerCase()] ?? "";
}

/** Longest backtick run in the body plus one, never fewer than three. */
export function fenceLength(body: string): number {
  let longest = 0;
  let current = 0;
  for (const character of body) {
    if (character === "`") {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return Math.max(3, longest + 1);
}

export function renderBlock(block: HandoffBlock): string {
  const fence = "`".repeat(fenceLength(block.body));
  const body = block.body.endsWith("\n") ? block.body : `${block.body}\n`;
  return `${block.caption}\n\n${fence}${block.lang}\n${body}${fence}`;
}

export function renderSection(blocks: HandoffBlock[]): string {
  return `\n## Hand-off\n\n${blocks.map(renderBlock).join("\n\n")}\n`;
}

export function diffCaption(path: string, hunks: number): string {
  return `\`${path}\` — ${hunks} hunk${hunks === 1 ? "" : "s"}`;
}

export function fullCaption(path: string, created: boolean, lines: number): string {
  return `\`${path}\` — ${created ? "new file" : "full file"}, ${lines} line${lines === 1 ? "" : "s"}`;
}

export function commandCaption(purpose: string): string {
  return `\`${purpose}\` — command`;
}

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
 * the line numbers. Either error leaves the file untouched.
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
    let at = next.indexOf(replacement.search);
    while (at >= 0) {
      occurrences.push(at);
      at = next.indexOf(replacement.search, at + replacement.search.length);
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
