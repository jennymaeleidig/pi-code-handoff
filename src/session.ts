/**
 * Reading the picker's hand-off tab back out of a session.
 *
 * A block *is* the `details` of the `copy_paste` tool result that produced it,
 * so the picker needs no side channel and no correlation key: the blocks of the
 * last turn are the blocks of the calls that turn made, in call order. A
 * `/reload` or a resume reads the same bytes the turn wrote.
 *
 * Nothing identifies a turn by timestamp any more. The assistant message no
 * longer carries the blocks, so there is nothing to tie to it: its tool calls
 * are the tie, and they are what a tool result already points at.
 */

import type { HandoffBlock } from "./handoff.ts";

/** A structural slice of a session entry, so callers need not widen their types. */
export interface SessionEntryLike {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
    toolCallId?: string;
    details?: unknown;
  };
}

export interface Turn {
  /** Its text blocks joined the way pi renders them. */
  text: string;
  /** The ids of its `copy_paste` calls, in message order. */
  calls: string[];
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

/** The ids of a message's `copy_paste` calls, in the order it made them. */
function handoffCalls(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const call = block as { type?: unknown; id?: unknown; name?: unknown };
    if (call.type !== "toolCall" || call.name !== "copy_paste") continue;
    if (typeof call.id === "string") ids.push(call.id);
  }
  return ids;
}

function roleOf(entry: SessionEntryLike): string | undefined {
  return entry.type === "message" ? entry.message?.role : undefined;
}

/** Where the last assistant message sits, or -1 when the branch has none. */
function lastAssistantIndex(entries: readonly SessionEntryLike[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (roleOf(entries[index]!) === "assistant") return index;
  }
  return -1;
}

/**
 * The last turn's hand-off: the prose it wrote and the `copy_paste` calls it
 * made. A turn is what a user message opens, so a turn that handed off and then
 * spoke still has both halves — a tool-using turn has several assistant
 * messages, and the blocks belong to the turn rather than to the last of them.
 *
 * A branch with no user message has no turn to bound, so the reply alone is its
 * last assistant message. Borrowing every block the branch ever produced would
 * fill the picker with blocks the human has already dealt with.
 */
export function lastTurn(entries: readonly SessionEntryLike[]): Turn | undefined {
  let start = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (roleOf(entries[index]!) === "user") {
      start = index + 1;
      break;
    }
  }
  if (start === 0) {
    // No user message closed a turn, so the reply is the whole bound there is.
    start = lastAssistantIndex(entries);
    if (start < 0) return undefined;
  }

  let text: string | undefined;
  const calls: string[] = [];
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (roleOf(entry) !== "assistant") continue;
    const spoken = textOf(entry.message?.content);
    if (spoken !== "") text = spoken;
    calls.push(...handoffCalls(entry.message?.content));
  }
  if (text === undefined && calls.length === 0) return undefined;
  return { text: text ?? "", calls };
}

/**
 * Rebuild a block from its stored form, rather than asserting its type, so a
 * new required field on `HandoffBlock` is a compile error here instead of a
 * silent bypass. A malformed value reads as absent.
 */
export function handoffBlockOf(value: unknown): HandoffBlock | undefined {
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
 * This turn's blocks, in call order, as its tool results stored them. A call
 * whose result is missing or malformed contributes nothing; the rest keep their
 * order, so the picker lists blocks as the turn produced them.
 */
export function turnBlocks(entries: readonly SessionEntryLike[], turn: Turn): HandoffBlock[] {
  if (turn.calls.length === 0) return [];
  const wanted = new Set(turn.calls);
  const found = new Map<string, HandoffBlock>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message?.role !== "toolResult") continue;
    const toolCallId = message.toolCallId;
    if (typeof toolCallId !== "string" || !wanted.has(toolCallId)) continue;
    if (found.has(toolCallId)) continue;
    const details = message.details as { block?: unknown } | undefined;
    const block = handoffBlockOf(details?.block);
    if (block !== undefined) found.set(toolCallId, block);
  }
  return turn.calls
    .map((id) => found.get(id))
    .filter((block): block is HandoffBlock => block !== undefined);
}
