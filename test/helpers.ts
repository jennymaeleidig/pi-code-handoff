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

export interface Harness {
  directory: string;
  tool: ToolDefinition;
  toolCalls: string[];
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
}

export function loadExtension(directory: string): Harness {
  let tool: ToolDefinition | undefined;
  const handlers = new Map<string, MessageEndHandler>();
  let counter = 0;
  const toolCalls: string[] = [];

  const fakePi = {
    on(event: string, handler: MessageEndHandler) {
      handlers.set(event, handler);
    },
    registerTool(definition: ToolDefinition) {
      tool = definition;
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

  return {
    directory,
    tool,
    toolCalls,
    execute,
    emit,
    toolCallMessage,
    finalMessage,
    appendHandoff,
  };
}

/** Extract a block body between its fences, as the picker would. */
export function blockBody(section: string): string {
  const start = /^(`{3,})[^\n]*\n/m.exec(section);
  if (!start) throw new Error(`no fenced block in:\n${section}`);
  const fence = start[1]!;
  const rest = section.slice(start.index + start[0].length);
  const end = new RegExp(`^${fence}$`, "m").exec(rest);
  if (!end) throw new Error(`unterminated fenced block in:\n${section}`);
  return rest.slice(0, end.index);
}
