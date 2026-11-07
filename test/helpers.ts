import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type HandoffBlock, renderBlock } from "../src/handoff.ts";
import type { SessionEntryLike } from "../src/session.ts";
import extension from "../src/index.ts";

/** A block fixture; a test overrides the one field it cares about. */
export function fixtureBlock(overrides: Partial<HandoffBlock> = {}): HandoffBlock {
  return {
    toolCallId: "call-1",
    kind: "code",
    form: "diff",
    path: "greet.py",
    body: "--- a/greet.py\n+++ b/greet.py\n@@ -1 +1 @@\n-old\n+new\n",
    lang: "diff",
    caption: "`greet.py` — 1 hunk",
    ...overrides,
  };
}

/** An assistant entry, with the `code_handoff` calls it made. */
export function assistantEntry(text: string, calls: string[] = []): SessionEntryLike {
  return {
    type: "message",
    message: {
      role: "assistant",
      content: [
        ...(text === "" ? [] : [{ type: "text", text }]),
        ...calls.map((id) => ({ type: "toolCall", id, name: "code_handoff" })),
      ],
    },
  };
}

/** A tool result entry carrying a block, the way `code_handoff` stores one. */
export function toolResultEntry(toolCallId: string, block: unknown): SessionEntryLike {
  return {
    type: "message",
    message: { role: "toolResult", toolCallId, details: { block } },
  };
}

/** A user entry: what opens a turn. */
export function userEntry(text = "hi"): SessionEntryLike {
  return { type: "message", message: { role: "user", content: [{ type: "text", text }] } };
}

const exec = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout;
}

export async function makeRepo(files: Record<string, string> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-code-handoff-test-"));
  await git(directory, "init", "-q");
  await git(directory, "config", "user.email", "test@example.com");
  await git(directory, "config", "user.name", "Test");
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(directory, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  await git(directory, "add", "-A");
  await git(directory, "commit", "-q", "--allow-empty", "-m", "fixture");
  return directory;
}

export async function makeDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-code-handoff-plain-"));
}

export async function remove(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

interface MessageEndHandler {
  (event: {
    type: "message_end";
    message: unknown;
  }): Promise<{ message?: unknown } | undefined> | undefined;
}

interface CommandOptions {
  description?: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

interface ShortcutOptions {
  description?: string;
  handler: (ctx: unknown) => Promise<void>;
}

export interface FakeContextOptions {
  branch?: unknown[];
  mode?: string;
  width?: number;
}

export interface CommandResult {
  notices: string[];
  /** What the picker rendered before the interaction was cancelled. */
  rendered: string[] | undefined;
}

export interface Harness {
  directory: string;
  tool: ToolDefinition;
  toolCalls: string[];
  /** Every block the tool produced, in call order, as `details` carried it. */
  blocks: HandoffBlock[];
  /** Custom entries the extension appended — it must append none. */
  entries: Array<{ type: "custom"; customType: string; data?: unknown }>;
  commands: Map<string, CommandOptions>;
  shortcuts: Map<string, ShortcutOptions>;
  execute(
    id: string,
    params: Record<string, unknown>,
    cwd?: string,
  ): Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  emit(message: unknown): Promise<{ message?: unknown } | undefined>;
  toolCallMessage(ids: string[]): unknown;
  finalMessage(text?: string): unknown;
  /** The last block as an expanded row draws it, fence and caption included. */
  drawnBlock(): string | undefined;
  /** Run a registered command or shortcut against a stand-in context. */
  runCommand(name: string, options?: FakeContextOptions): Promise<CommandResult>;
  runShortcut(key: string, options?: FakeContextOptions): Promise<CommandResult>;
}

const SELECT_KEYS: Record<string, string> = {
  "tui.select.up": "up",
  "tui.select.down": "down",
  "tui.select.pageUp": "pageup",
  "tui.select.pageDown": "pagedown",
  "tui.select.confirm": "enter",
  "tui.select.cancel": "escape",
};

function fakeTheme() {
  const pass = (text: string) => text;
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    style: (text: string) => text,
    bold: pass,
    italic: pass,
    underline: pass,
  };
}

function fakeKeybindings() {
  return {
    matches: (data: string, keybinding: string) => data === SELECT_KEYS[keybinding],
  };
}

function fakeContext(
  directory: string,
  options: FakeContextOptions,
  onRender: (lines: string[]) => void,
) {
  const branch = options.branch ?? [];
  const notices: string[] = [];
  return {
    notices,
    ctx: {
      mode: options.mode ?? "tui",
      cwd: directory,
      sessionManager: {
        getBranch: () => branch,
        getEntries: () => branch,
      },
      ui: {
        notify: (message: string) => {
          notices.push(message);
        },
        custom: async (factory: (...args: unknown[]) => unknown) => {
          const component = (await factory(
            { requestRender: () => {} },
            fakeTheme(),
            fakeKeybindings(),
            () => {},
          )) as { render(width: number): string[] };
          onRender(component.render(options.width ?? 80));
          return undefined;
        },
      },
    },
  };
}

export function loadExtension(directory: string): Harness {
  let tool: ToolDefinition | undefined;
  const handlers = new Map<string, MessageEndHandler>();
  const commands = new Map<string, CommandOptions>();
  const shortcuts = new Map<string, ShortcutOptions>();
  const entries: Array<{ type: "custom"; customType: string; data?: unknown }> = [];
  const blocks: HandoffBlock[] = [];
  let counter = 0;
  const toolCalls: string[] = [];

  const fakePi = {
    on(event: string, handler: MessageEndHandler) {
      handlers.set(event, handler);
    },
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
    registerCommand(name: string, options: CommandOptions) {
      commands.set(name, options);
    },
    registerShortcut(key: string, options: ShortcutOptions) {
      shortcuts.set(key, options);
    },
    appendEntry(customType: string, data?: unknown) {
      // Recorded so a test can assert nothing is ever appended: the block rides
      // on the tool result's details, and a side channel would be a regression.
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as ExtensionAPI;

  extension(fakePi);
  if (!tool) throw new Error("the extension did not register a tool");

  const emit = async (message: unknown) => {
    const handler = handlers.get("message_end");
    if (!handler) throw new Error("the extension did not register a message_end handler");
    return handler({ type: "message_end", message });
  };

  const toolCallMessage = (ids: string[]) => ({
    role: "assistant",
    content: ids.map((id) => ({
      type: "toolCall",
      id,
      name: "code_handoff",
      arguments: {},
    })),
  });

  const finalMessage = (text = "Done.") => ({
    role: "assistant",
    content: [{ type: "text", text }],
  });

  const execute = async (id: string, params: Record<string, unknown>, cwd = directory) => {
    toolCalls.push(id);
    await emit(toolCallMessage([id]));
    const result = (await tool!.execute(id, params as never, undefined, undefined, {
      cwd,
    } as never)) as unknown as {
      content: Array<{ text: string }>;
      details?: { block?: HandoffBlock };
      isError?: boolean;
    };
    const block = result.details?.block;
    if (block !== undefined) blocks.push(block);
    return result;
  };

  // The expanded row is the only place a block is drawn now, so this is what a
  // test reads when it wants the text a human would see.
  const drawnBlock = () => {
    const last = blocks[blocks.length - 1];
    return last === undefined ? undefined : renderBlock(last);
  };

  const runHandler = async (
    handler: (ctx: unknown) => Promise<void>,
    options: FakeContextOptions,
  ) => {
    let rendered: string[] | undefined;
    const { notices, ctx } = fakeContext(directory, options, (lines) => {
      rendered = lines;
    });
    await handler(ctx);
    return { notices, rendered };
  };

  const runCommand = async (name: string, options: FakeContextOptions = {}) => {
    const command = commands.get(name);
    if (!command) throw new Error(`no command named ${name}`);
    return runHandler((ctx) => command.handler("", ctx), options);
  };

  const runShortcut = async (key: string, options: FakeContextOptions = {}) => {
    const shortcut = shortcuts.get(key);
    if (!shortcut) throw new Error(`no shortcut bound to ${key}`);
    return runHandler((ctx) => shortcut.handler(ctx), options);
  };

  return {
    directory,
    tool,
    toolCalls,
    blocks,
    entries,
    commands,
    shortcuts,
    execute,
    emit,
    toolCallMessage,
    finalMessage,
    drawnBlock,
    runCommand,
    runShortcut,
  };
}

/**
 * Extract a block body between its fences, as an applier does. `renderBlock`
 * leaves one empty line before the closing fence because a fenced body cannot
 * otherwise carry a final newline: line-joining keeps that last empty line, so
 * the result ends in the body's trailing newline.
 */
export function blockBody(drawn: string): string {
  const lines = drawn.split("\n");
  const start = lines.findIndex((line) => /^`{3,}/.test(line));
  if (start < 0) throw new Error(`no fenced block in:\n${drawn}`);
  const fence = /^(`{3,})/.exec(lines[start]!)?.[1]!;
  const end = lines.findIndex((line, index) => index > start && line.startsWith(fence));
  if (end < 0) throw new Error(`unterminated fenced block in:\n${drawn}`);
  return lines.slice(start + 1, end).join("\n");
}
