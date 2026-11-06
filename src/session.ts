/**
 * Reading the picker's data back out of a session.
 *
 * The hand-off tab is written to the session once per assistant message, as a
 * custom entry carrying the blocks themselves. Reading it back requires tying
 * that entry to the message it belongs to: a custom entry from an older reply
 * must not feed the picker for a newer one, so the match is on the assistant
 * message's timestamp. When nothing matches, the caller falls back to the
 * Agent reply tab.
 */

import type { HandoffBlock } from "./handoff.ts";

export const HANDOFF_ENTRY = "copy-paste-handoff";

export interface StoredHandoff {
  /** The `timestamp` of the assistant message these blocks were spliced into. */
  messageTimestamp: number | null;
  blocks: HandoffBlock[];
}

/** The last reply's blocks, held in memory for the picker across the turn. */
export type HandoffMemory = StoredHandoff;

/** A structural slice of a session entry, so callers need not widen their types. */
export interface SessionEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
  message?: {
    role?: string;
    timestamp?: number;
    content?: unknown;
  };
}

export interface Reply {
  /** The assistant message's timestamp, or null when it has none. */
  timestamp: number | null;
  /** Its text blocks joined the way pi renders them. */
  text: string;
}

/** Normalise an optional message timestamp to `number | null`. */
export function messageTimestamp(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

/** The last assistant message with text on the branch, if there is one. */
export function lastReply(entries: readonly SessionEntryLike[]): Reply | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.type !== "message") continue;
    if (entry.message?.role !== "assistant") continue;
    const text = textOf(entry.message.content);
    if (text === "") continue;
    return { timestamp: messageTimestamp(entry.message.timestamp), text };
  }
  return undefined;
}

function handoffBlockOf(value: unknown): HandoffBlock | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const block = value as Record<string, unknown>;
  if (
    typeof block.toolCallId !== "string" ||
    (block.kind !== "code" && block.kind !== "command") ||
    typeof block.body !== "string" ||
    typeof block.lang !== "string" ||
    typeof block.caption !== "string"
  ) {
    return undefined;
  }
  // Rebuilding the block, rather than asserting its type, makes a new required
  // field on HandoffBlock a compile error here instead of a silent bypass.
  return {
    toolCallId: block.toolCallId,
    kind: block.kind,
    ...(block.form === "diff" || block.form === "full" ? { form: block.form } : {}),
    ...(typeof block.path === "string" ? { path: block.path } : {}),
    ...(typeof block.purpose === "string" ? { purpose: block.purpose } : {}),
    body: block.body,
    lang: block.lang,
    caption: block.caption,
  };
}

/**
 * The blocks stored for the reply with this timestamp. A stored entry for any
 * other reply is ignored, and malformed data is treated as absent. Without a
 * timestamp on both sides there is no way to tell the replies apart, so the
 * entry is not trusted.
 */
export function storedBlocks(
  entries: readonly SessionEntryLike[],
  timestamp: number | null,
): HandoffBlock[] | undefined {
  if (timestamp === null) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.type !== "custom" || entry.customType !== HANDOFF_ENTRY) continue;
    const data = entry.data as StoredHandoff | undefined;
    if (data === undefined || data === null || !Array.isArray(data.blocks)) continue;
    if (messageTimestamp(data.messageTimestamp) !== timestamp) continue;
    const blocks = data.blocks.map(handoffBlockOf);
    if (blocks.some((block) => block === undefined)) continue;
    return blocks as HandoffBlock[];
  }
  return undefined;
}

/**
 * The blocks for a reply: this session's memory first — byte-identical to what
 * validation accepted — then the entry written to the session (a `/reload` or
 * a resume), then nothing, so the Agent reply tab takes over.
 */
export function replyBlocks(
  entries: readonly SessionEntryLike[],
  reply: Reply,
  memory: HandoffMemory | undefined,
): HandoffBlock[] {
  if (
    memory !== undefined &&
    reply.timestamp !== null &&
    memory.messageTimestamp === reply.timestamp
  ) {
    return memory.blocks;
  }
  return storedBlocks(entries, reply.timestamp) ?? [];
}

export function handoffEntry(timestamp: number | null, blocks: HandoffBlock[]): StoredHandoff {
  return { messageTimestamp: timestamp, blocks };
}
