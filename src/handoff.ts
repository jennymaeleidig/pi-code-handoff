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

export const APPENDED_NOTE =
  "The block is appended to your reply by the harness; do not write it yourself.";

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
  // The picker joins the lines between fences without a final newline. Leave
  // one empty line before the closing fence so its payload keeps the body's
  // trailing newline; a patch without one is "corrupt patch" to git.
  const body =
    block.body === "" ? "" : `${block.body.endsWith("\n") ? block.body : `${block.body}\n`}\n`;
  return `${block.caption}\n\n${fence}${block.lang}\n${body}${fence}`;
}

export function renderSection(blocks: HandoffBlock[]): string {
  return `\n## Hand-off\n\n${blocks.map(renderBlock).join("\n\n")}\n`;
}

export function diffCaption(path: string, hunks: number): string {
  return `\`${path}\` — ${plural(hunks, "hunk")}`;
}

export function fullCaption(path: string, created: boolean, lines: number): string {
  return `\`${path}\` — ${created ? "new file" : "full file"}, ${plural(lines, "line")}`;
}

export function commandCaption(purpose: string): string {
  return `\`${purpose}\` — command`;
}
