import { realpath, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { countDiff, splitText, unifiedDiff } from "./diff.ts";
import { checkCommand, checkPatch, repositoryRoot } from "./git.ts";
import {
  APPENDED_NOTE,
  commandCaption,
  diffCaption,
  fullCaption,
  languageFor,
  plural,
  renderSection,
  type HandoffBlock,
} from "./handoff.ts";
import { applyReplacements, type Replacement } from "./replace.ts";
import { applyHunks, parsePatch } from "./patch.ts";

const schema = Type.Object({
  kind: StringEnum(["code", "command"] as const),
  path: Type.Optional(Type.String()),
  form: Type.Optional(StringEnum(["diff", "full"] as const)),
  replacements: Type.Optional(
    Type.Array(
      Type.Object({
        search: Type.String(),
        replace: Type.String(),
      }),
    ),
  ),
  content: Type.Optional(Type.String()),
  patch: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  purpose: Type.Optional(Type.String()),
});

type CopyPasteInput = Static<typeof schema>;

interface BlockResult {
  block: HandoffBlock;
  verdict: string;
}

function relativePath(root: string, absolute: string): string {
  const path = relative(root, absolute).split(sep).join("/");
  if (path === "" || path.startsWith("../") || path === ".." || isAbsolute(path)) {
    throw new Error(`"${absolute}" is outside the git repository at "${root}".`);
  }
  return path;
}

/** Resolve symlinks in the existing part of a path, keeping any missing suffix. */
async function canonicalPath(absolute: string): Promise<string> {
  const suffix: string[] = [];
  let current = absolute;
  while (!existsSync(current)) {
    suffix.unshift(basename(current));
    const parent = dirname(current);
    if (parent === current) return absolute;
    current = parent;
  }
  return join(await realpath(current), ...suffix);
}

function requireText(value: string | undefined, field: string, kind: string): string {
  if (value === undefined || value === "") {
    throw new Error(`${field} is required when kind is "${kind}".`);
  }
  return value;
}

function rejectPresent(params: CopyPasteInput, names: (keyof CopyPasteInput)[]): void {
  for (const name of names) {
    if (params[name] !== undefined) {
      throw new Error(`${name} does not apply to this call shape; remove it.`);
    }
  }
}

async function buildBlock(
  toolCallId: string,
  params: CopyPasteInput,
  cwd: string,
  claimedPaths: Set<string>,
): Promise<BlockResult> {
  if (params.kind === "command") {
    rejectPresent(params, ["path", "form", "replacements", "content", "patch"]);
    const command = requireText(params.command, "command", "command");
    const purpose = requireText(params.purpose, "purpose", "command");
    if (purpose.includes("\n")) {
      throw new Error('"purpose" must be a single line; it is the block\'s caption.');
    }
    await checkCommand(command);
    return {
      block: {
        toolCallId,
        kind: "command",
        purpose,
        body: command,
        lang: "bash",
        caption: commandCaption(purpose),
      },
      verdict: `Validated command "${purpose}": bash -n passed. ${APPENDED_NOTE}`,
    };
  }

  if (params.kind !== "code") {
    throw new Error(`kind must be "code" or "command".`);
  }

  rejectPresent(params, ["command", "purpose"]);
  const requestedPath = requireText(params.path, "path", "code").replace(/^@/, "");
  const form = (params.form ?? "diff") as "diff" | "full";
  const shapes = [params.replacements, params.content, params.patch].filter(
    (value) => value !== undefined,
  ).length;
  if (shapes === 0) {
    throw new Error('Supply exactly one of "replacements", "content", or "patch".');
  }
  if (shapes > 1) {
    throw new Error('Supply only one of "replacements", "content", or "patch" in one call.');
  }

  let absolute = resolve(cwd, requestedPath);
  absolute = await canonicalPath(absolute);
  const root = await repositoryRoot(absolute);
  const path = relativePath(root, absolute);
  const exists = existsSync(absolute);

  if (claimedPaths.has(path)) {
    throw new Error(
      `"${path}" was already handed off in this reply. Only the first block is true against the file as it stands.`,
    );
  }
  claimedPaths.add(path);
  try {
    return await buildCodeBlock(toolCallId, params, absolute, path, exists, root, form);
  } catch (error) {
    claimedPaths.delete(path);
    throw error;
  }
}

async function buildCodeBlock(
  toolCallId: string,
  params: CopyPasteInput,
  absolute: string,
  path: string,
  exists: boolean,
  root: string,
  form: "diff" | "full",
): Promise<BlockResult> {
  if (form === "full") {
    if (params.replacements !== undefined || params.patch !== undefined) {
      throw new Error(
        'form "full" takes only "content"; use form "diff" for replacements or patch.',
      );
    }
    const content = params.content ?? "";
    if (content !== "" && !content.endsWith("\n")) {
      throw new Error(
        'form "full" content must end with a newline (an empty file is the one exception), ' +
          'because a fenced Markdown body cannot hold a final line without one. Use form "diff" ' +
          "or a /dev/null patch to preserve a missing trailing newline.",
      );
    }
    const lines = splitText(content).lines.length;
    return {
      block: {
        toolCallId,
        kind: "code",
        form: "full",
        path,
        body: content,
        lang: languageFor(path),
        caption: fullCaption(path, !exists, lines),
      },
      verdict:
        `Validated ${path}: ${exists ? "full file" : "new file"}, ${plural(lines, "line")}. ` +
        APPENDED_NOTE,
    };
  }

  if (form !== "diff") {
    throw new Error(`form must be "diff" or "full".`);
  }

  let oldText = "";
  if (params.patch !== undefined) {
    const parsed = parsePatch(params.patch);
    if (parsed.newPath === null) {
      throw new Error(
        "Deleting a file with a patch is not supported; hand off the new content instead.",
      );
    }
    for (const [header, name] of [
      [parsed.oldPath, "---"],
      [parsed.newPath, "+++"],
    ] as const) {
      if (typeof header === "string" && header !== path) {
        throw new Error(
          `The patch's ${name} header names "${header}", but path is "${path}". ` +
            "One block carries one file; make them agree.",
        );
      }
    }
    const creates = parsed.oldPath === null;
    if (creates && exists) {
      throw new Error(`The patch creates "${path}", but the file already exists.`);
    }
    if (!creates && !exists) {
      throw new Error(
        `"${path}" does not exist. Use form "full" to create it, or a /dev/null patch.`,
      );
    }
    oldText = creates ? "" : await readFile(absolute, "utf8");
    const newText = applyHunks(oldText, parsed.hunks);
    if (newText === oldText) throw new Error(`The patch leaves "${path}" unchanged.`);
    return await diffResult(toolCallId, path, oldText, newText, root);
  }

  if (!exists) {
    throw new Error(`"${path}" does not exist. Use form "full" with "content" to create it.`);
  }
  oldText = await readFile(absolute, "utf8");

  if (params.replacements !== undefined) {
    if (params.replacements.length === 0) {
      throw new Error('"replacements" is empty; supply at least one search/replace pair.');
    }
    const replacements: Replacement[] = params.replacements.map((pair) => ({
      search: pair.search,
      replace: pair.replace,
    }));
    const newText = applyReplacements(oldText, replacements, path);
    if (newText === oldText) throw new Error(`The replacements leave "${path}" unchanged.`);
    return await diffResult(toolCallId, path, oldText, newText, root);
  }

  const content = params.content ?? "";
  if (content === oldText) throw new Error(`The new content leaves "${path}" unchanged.`);
  return await diffResult(toolCallId, path, oldText, content, root);
}

async function diffResult(
  toolCallId: string,
  path: string,
  oldText: string,
  newText: string,
  root: string,
): Promise<BlockResult> {
  const diff = unifiedDiff(path, oldText, newText);
  if (diff === "") throw new Error(`The change leaves "${path}" unchanged.`);
  await checkPatch(root, diff);
  const counts = countDiff(diff);
  return {
    block: {
      toolCallId,
      kind: "code",
      form: "diff",
      path,
      body: diff,
      lang: "diff",
      caption: diffCaption(path, counts.hunks),
    },
    verdict:
      `Validated ${path}: ${plural(counts.hunks, "hunk")}, ` +
      `${plural(counts.insertions, "insertion")}, ${plural(counts.deletions, "deletion")}. ` +
      `git apply --check passed. ${APPENDED_NOTE}`,
  };
}

/**
 * A validated hand-off block tool. Blocks live only in memory until the
 * assistant message ends; the extension then splices them into that message,
 * so the text a human copies is exactly the text git accepted.
 */
export default function piCopyPaste(pi: ExtensionAPI): void {
  let pending: HandoffBlock[] = [];
  let callOrder: string[] = [];
  let claimedPaths = new Set<string>();

  pi.on("session_start", async () => {
    pending = [];
    callOrder = [];
    claimedPaths = new Set();
  });

  pi.on("message_end", async (event) => {
    const message = event.message;

    if (message.role === "user") {
      pending = [];
      callOrder = [];
      claimedPaths = new Set();
      return;
    }
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;

    for (const block of message.content) {
      if (
        block.type === "toolCall" &&
        block.name === "copy_paste" &&
        !callOrder.includes(block.id)
      ) {
        callOrder.push(block.id);
      }
    }

    if (pending.length === 0) return;
    if (message.content.some((block) => block.type === "toolCall")) return;

    const ordered = pending
      .map((block, index) => ({ block, index }))
      .sort((a, b) => {
        const aOrder = callOrder.indexOf(a.block.toolCallId);
        const bOrder = callOrder.indexOf(b.block.toolCallId);
        const aKey = aOrder < 0 ? Number.MAX_SAFE_INTEGER : aOrder;
        const bKey = bOrder < 0 ? Number.MAX_SAFE_INTEGER : bOrder;
        return aKey - bKey || a.index - b.index;
      })
      .map((entry) => entry.block);

    const text = renderSection(ordered);
    pending = [];
    callOrder = [];
    claimedPaths = new Set();

    return {
      message: {
        ...message,
        content: [...message.content, { type: "text", text }],
      },
    };
  });

  pi.registerTool({
    name: "copy_paste",
    label: "Copy Paste",
    description:
      "Validate a change, then append a copyable hand-off block to your reply. " +
      `${APPENDED_NOTE} ` +
      'For kind "code", pass a repo-relative or absolute path and exactly one of: "replacements" ' +
      '(search/replace pairs, each matching the file exactly once), "content" (the whole file; form "full" ' +
      'emits it entire, form "diff" diffs it against the file on disk), ' +
      'or "patch" (raw unified-diff hunks). form defaults to "diff", which emits a counted unified diff and ' +
      'runs git apply --check; form "full" emits the whole file for a new file or a rewrite. ' +
      'For kind "command", pass "command" and a one-line "purpose"; the command is checked with bash -n. ' +
      "The target must be inside a git repository. On failure the applier's own error comes back so you can repair in this turn. " +
      "One block per path per reply.",
    promptSnippet: "Validate a change and append a copyable hand-off block",
    promptGuidelines: [`Use copy_paste to hand off code or shell commands. ${APPENDED_NOTE}`],
    parameters: schema,
    async execute(
      toolCallId: string,
      params: CopyPasteInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionToolContext,
    ) {
      try {
        const result = await buildBlock(toolCallId, params, ctx.cwd, claimedPaths);
        pending.push(result.block);
        return {
          content: [{ type: "text" as const, text: result.verdict }],
          details: { path: result.block.path ?? "", form: result.block.form ?? "command" },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `copy_paste failed: ${message}` }],
          details: undefined,
          isError: true,
        };
      }
    },
  });
}
