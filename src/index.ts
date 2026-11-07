import { realpath, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { copyToClipboard, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { countDiff, splitText, unifiedDiff } from "./diff.ts";
import { checkCommand, checkPatch, repositoryRoot } from "./git.ts";
import {
  COMMAND_NAME,
  ROW_NOTE,
  TOOL_NAME,
  commandCaption,
  diffCaption,
  fullCaption,
  languageFor,
  plural,
  renderBlock,
  type HandoffBlock,
} from "./handoff.ts";
import { applyReplacements, type Replacement } from "./replace.ts";
import { applyHunks, parsePatch } from "./patch.ts";
import { payload, pickerFor, type PickerItem } from "./picker.ts";
import { createPickerView } from "./picker-view.ts";
import { handoffBlockOf, type SessionEntryLike } from "./session.ts";

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

type CodeHandoffInput = Static<typeof schema>;

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

function rejectPresent(params: CodeHandoffInput, names: (keyof CodeHandoffInput)[]): void {
  for (const name of names) {
    if (params[name] !== undefined) {
      throw new Error(`${name} does not apply to this call shape; remove it.`);
    }
  }
}

async function buildBlock(
  toolCallId: string,
  params: CodeHandoffInput,
  cwd: string,
  claimedPaths: Set<string>,
): Promise<BlockResult> {
  if (params.kind === "command") {
    if (params.form !== undefined) {
      throw new Error('A command block has no form; "diff" and "full" apply to code blocks only.');
    }
    rejectPresent(params, ["path", "replacements", "content", "patch"]);
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
      verdict: `Validated command "${purpose}": bash -n passed.`,
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
  params: CodeHandoffInput,
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
    if (content === "") {
      throw new Error(`form "full" content for "${path}" is empty; supply the file's text.`);
    }
    if (!content.endsWith("\n")) {
      throw new Error(
        'form "full" content must end with a newline, because a fenced Markdown body ' +
          'cannot hold a final line without one. Use form "diff" or a /dev/null patch ' +
          "to preserve a missing trailing newline.",
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
      verdict: `Validated ${path}: ${exists ? "full file" : "new file"}, ${plural(lines, "line")}.`,
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
    let newText: string;
    try {
      newText = applyHunks(oldText, parsed.hunks);
    } catch (error) {
      // A patch git can read gets git's own words even when this package's
      // stricter applier refused it first; a bare hunk has no headers to check.
      if (/^--- /m.test(params.patch) && /^\+\+\+ /m.test(params.patch)) {
        await checkPatch(root, params.patch);
      }
      throw error;
    }
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
      `${plural(counts.insertions, "insertion")}, ${plural(counts.deletions, "deletion")}; ` +
      `git apply --check passed.`,
  };
}

/** A row's fallback words: the result's own text, when there is no block to draw. */
function resultText(content: readonly unknown[]): string {
  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const piece = part as { type?: unknown; text?: unknown };
      return piece.type === "text" && typeof piece.text === "string" ? piece.text : "";
    })
    .filter((text) => text !== "")
    .join(" ");
}

/** A caption without the backticks it carries for the Markdown form. */
function plainCaption(caption: string): string {
  return caption.replace(/`/g, "");
}

/**
 * The picker for the last turn: `turnBlocks` picks the blocks, `pickerFor`
 * picks the tab. A reply with no blocks still opens, so the notice can say so.
 */
async function openHandoffPicker(ctx: ExtensionContext): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("The copy picker needs interactive mode.", "error");
    return;
  }

  const source = pickerFor(ctx.sessionManager.getBranch() as readonly SessionEntryLike[]);
  if (source === undefined) {
    ctx.ui.notify("No assistant reply to pick a block from.", "warning");
    return;
  }

  const item = await ctx.ui.custom<PickerItem | undefined>(
    (tui, theme, keybindings, done) =>
      createPickerView({
        source,
        theme,
        keybindings,
        requestRender: () => tui.requestRender(),
        done,
      }),
    {
      overlay: true,
      overlayOptions: { width: "80%", maxHeight: "80%", anchor: "center" },
    },
  );

  if (item === undefined) return;
  await copyToClipboard(payload(item));
  ctx.ui.notify(`Copied ${item.label}.`, "info");
}

/**
 * A validated hand-off block tool. A block is drawn in the row of the call that
 * produced it — one line until the row is expanded — and lives on as that tool
 * result's `details`, which is what the picker copies. The assistant message is
 * left alone: prose is prose, and a block is a row.
 */
export default function piCodeHandoff(pi: ExtensionAPI): void {
  let claimedPaths = new Set<string>();

  pi.on("session_start", async () => {
    claimedPaths = new Set();
  });

  // One block per path per reply: a second block for a file the first block is
  // about to change would be a guess, so the claim lasts until the human speaks.
  pi.on("message_end", async (event) => {
    if (event.message.role === "user") claimedPaths = new Set();
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "Pick a block from the last turn and copy it",
    handler: async (_args, ctx) => {
      await openHandoffPicker(ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+c", {
    description: "Pick a block from the last turn and copy it",
    handler: async (ctx) => {
      await openHandoffPicker(ctx);
    },
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "Code Handoff",
    description:
      "Validate a change, then draw a copyable hand-off block in this tool's row. " +
      `${ROW_NOTE} ` +
      'For kind "code", pass a repo-relative or absolute path and exactly one of: "replacements" ' +
      '(search/replace pairs, each matching the file exactly once), "content" (the whole file; form "full" ' +
      'emits it entire, form "diff" diffs it against the file on disk), ' +
      'or "patch" (raw unified-diff hunks). form defaults to "diff", which emits a counted unified diff and ' +
      'runs git apply --check; form "full" emits the whole file for a new file or a rewrite. ' +
      'For kind "command", pass "command" and a one-line "purpose"; the command is checked with bash -n. ' +
      "The target must be inside a git repository. On failure the applier's own error comes back so you can repair in this turn. " +
      "One block per path per reply.",
    promptSnippet: "Validate a change and draw a copyable hand-off block in the tool's row",
    promptGuidelines: [
      `Use ${TOOL_NAME} to hand off code or shell commands. ${ROW_NOTE} The human copies the block ` +
        "with the picker (ctrl+shift+c) or by expanding the row.",
    ],
    parameters: schema,
    async execute(
      toolCallId: string,
      params: CodeHandoffInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionToolContext,
    ) {
      try {
        const result = await buildBlock(toolCallId, params, ctx.cwd, claimedPaths);
        return {
          content: [{ type: "text" as const, text: result.verdict }],
          details: { block: result.block },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `${TOOL_NAME} failed: ${message}` }],
          details: undefined,
          isError: true,
        };
      }
    },
    renderCall() {
      // Empty on purpose: pi draws the call and the result as two stacked
      // regions, so a title here would make every block two lines. The one line
      // is drawn by renderResult, which is the slot that knows what happened.
      // Compose and Container render no lines, and Box adds no padding for it.
      return new Container();
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const block = handoffBlockOf(result.details?.block);
      const name = theme.fg("toolTitle", theme.bold(TOOL_NAME));
      if (isPartial || block === undefined) {
        // A refusal, or a stream that has not produced a block yet: the row says
        // what the result says, and pi's own error colouring carries the rest.
        const colour = context.isError ? "error" : "dim";
        return new Text(`${name} ${theme.fg(colour, resultText(result.content))}`, 0, 0);
      }
      if (expanded) {
        // Expanded, the row reads like any other tool's: its name, then the
        // block. The caption stays in the block rather than repeating it above.
        const row = new Container();
        row.addChild(new Text(theme.fg("success", "✓ ") + name, 0, 0));
        row.addChild(new Markdown(renderBlock(block), 0, 0, getMarkdownTheme()));
        return row;
      }
      const hint = context.keyHint("app.tools.expand", "to show the block");
      return new Text(
        theme.fg("success", "✓ ") +
          name +
          " " +
          plainCaption(block.caption) +
          theme.fg("dim", `  ${hint}`),
        0,
        0,
      );
    },
  });
}
