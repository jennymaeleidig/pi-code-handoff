import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

const exec = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout;
}

export async function makeRepo(files: Record<string, string> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-copy-paste-test-"));
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
  return mkdtemp(join(tmpdir(), "pi-copy-paste-plain-"));
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
  /** Custom entries the extension appended with `pi.appendEntry`. */
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
  /** The appended hand-off section, or undefined when none was spliced. */
  appendHandoff(text?: string): Promise<string | undefined>;
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
      name: "copy_paste",
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
    return (await tool!.execute(id, params as never, undefined, undefined, {
      cwd,
    } as never)) as unknown as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
  };

  const appendHandoff = async (text = "Done.") => {
    const result = await emit(finalMessage(text));
    if (!result?.message) return undefined;
    const content = (result.message as { content: Array<{ type: string; text: string }> }).content;
    const last = content[content.length - 1];
    return last?.type === "text" ? last.text : undefined;
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
    entries,
    commands,
    shortcuts,
    execute,
    emit,
    toolCallMessage,
    finalMessage,
    appendHandoff,
    runCommand,
    runShortcut,
  };
}

/**
 * Extract a block body between its fences, as the whole-reply path's applier
 * does. `renderBlock` leaves one empty line before the closing fence because a
 * fenced body cannot otherwise carry a final newline: line-joining keeps that
 * last empty line, so the result ends in the body's trailing newline.
 */
export function blockBody(section: string): string {
  const lines = section.split("\n");
  const start = lines.findIndex((line) => /^`{3,}/.test(line));
  if (start < 0) throw new Error(`no fenced block in:\n${section}`);
  const fence = /^(`{3,})/.exec(lines[start]!)?.[1]!;
  const end = lines.findIndex((line, index) => index > start && line.startsWith(fence));
  if (end < 0) throw new Error(`unterminated fenced block in:\n${section}`);
  return lines.slice(start + 1, end).join("\n");
}
