/**
 * Presentation of hand-off blocks: captions, fences, and the section that the
 * message_end handler splices into the assistant message.
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

export const SPLICED_NOTE =
  "The harness splices the block into your reply; do not write it yourself.";

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
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
  // A fenced body cannot otherwise carry a final newline, so leave one empty
  // line before the closing fence: a reader that strips the fences gets the
  // body's trailing newline back, and a patch without one is "corrupt patch"
  // to git.
  const body =
    block.body === "" ? "" : `${block.body.endsWith("\n") ? block.body : `${block.body}\n`}\n`;
  return `${block.caption}\n\n${fence}${block.lang}\n${body}${fence}`;
}

export function renderSection(blocks: HandoffBlock[]): string {
  // A rule above the heading separates the hand-off from the reply's prose: a
  // heading alone read as another paragraph of the answer. Three newlines, so
  // the rule has a blank line on both sides of the gap it opens.
  return `\n\n\n---\n\n## Hand-off\n\n${blocks.map(renderBlock).join("\n\n")}\n`;
}

export function diffCaption(path: string, hunks: number): string {
  return `\`${path}\` — ${plural(hunks, "hunk")}`;
}

/** What a block is, in a word, for the picker's list. */
export function blockBadge(block: HandoffBlock): string {
  if (block.kind === "command") return "cmd";
  return block.form ?? "diff";
}

export function fullCaption(path: string, created: boolean, lines: number): string {
  return `\`${path}\` — ${created ? "new file" : "full file"}, ${plural(lines, "line")}`;
}

export function commandCaption(purpose: string): string {
  return `\`${purpose}\` — command`;
}
