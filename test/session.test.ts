import assert from "node:assert/strict";
import { test } from "node:test";
import type { HandoffBlock } from "../src/handoff.ts";
import {
  HANDOFF_ENTRY,
  handoffEntry,
  lastReply,
  replyBlocks,
  type SessionEntryLike,
  storedBlocks,
} from "../src/session.ts";

const block: HandoffBlock = {
  toolCallId: "call-1",
  kind: "code",
  form: "diff",
  path: "greet.py",
  body: "--- a/greet.py\n+++ b/greet.py\n@@ -1 +1 @@\n-old\n+new\n",
  lang: "diff",
  caption: "`greet.py` — 1 hunk",
};

function assistant(timestamp: number, text: string): SessionEntryLike {
  return {
    type: "message",
    message: { role: "assistant", timestamp, content: [{ type: "text", text }] },
  };
}

function stored(timestamp: number | null, blocks: HandoffBlock[]): SessionEntryLike {
  return { type: "custom", customType: HANDOFF_ENTRY, data: handoffEntry(timestamp, blocks) };
}

test("the last reply is the last assistant message with text on the branch", () => {
  const entries = [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    assistant(100, "first"),
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall" }] } },
    assistant(200, "second"),
    stored(200, [block]),
  ];
  assert.deepEqual(lastReply(entries), { timestamp: 200, text: "second" });
});

test("no assistant reply yields undefined", () => {
  assert.equal(lastReply([]), undefined);
  assert.equal(
    lastReply([
      { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    ]),
    undefined,
  );
});

test("stored blocks survive a JSON round trip byte for byte", () => {
  const data = JSON.parse(JSON.stringify(handoffEntry(200, [block]))) as unknown;
  const entries = [assistant(200, "reply"), { type: "custom", customType: HANDOFF_ENTRY, data }];
  const blocks = storedBlocks(entries, 200);
  assert.deepEqual(blocks, [block]);
  assert.equal(blocks![0]!.body, block.body);
});

test("blocks stored for a different assistant message are ignored", () => {
  const entries = [assistant(200, "newer reply"), stored(100, [block])];
  assert.equal(storedBlocks(entries, 200), undefined);
});

test("the newest matching entry wins, and malformed data is treated as absent", () => {
  const older = { ...block, body: "older\n" };
  const entries = [assistant(200, "reply"), stored(200, [older]), stored(200, [block])];
  assert.equal(storedBlocks(entries, 200)![0]!.body, block.body);

  const malformed: SessionEntryLike[] = [
    assistant(200, "reply"),
    {
      type: "custom",
      customType: HANDOFF_ENTRY,
      data: { messageTimestamp: 200, blocks: [{ nope: true }] },
    },
  ];
  assert.equal(storedBlocks(malformed, 200), undefined);
});

test("memory wins only when it belongs to the same reply", () => {
  const branch = [assistant(200, "reply"), stored(200, [block])];
  const reply = lastReply(branch)!;
  const memory = { ...block, body: "from memory\n" };

  assert.equal(replyBlocks(branch, reply, handoffEntry(200, [memory]))[0]!.body, "from memory\n");
  assert.equal(replyBlocks(branch, reply, handoffEntry(100, [memory]))[0]!.body, block.body);
  assert.equal(replyBlocks(branch, reply, handoffEntry(null, [memory]))[0]!.body, block.body);
  assert.equal(replyBlocks(branch, reply, undefined)[0]!.body, block.body);
});

test("a reply without a timestamp falls back to the parsed tab, not to stale memory", () => {
  const entries = [
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
    stored(null, [block]),
  ];
  const reply = lastReply(entries)!;
  assert.equal(reply.timestamp, null);
  assert.deepEqual(replyBlocks(entries, reply, handoffEntry(null, [block])), []);
});

test("a null timestamp is not trusted to identify a reply", () => {
  const entries = [stored(null, [block])];
  assert.equal(storedBlocks(entries, null), undefined);
  assert.deepEqual(storedBlocks(entries, 1), undefined);

  const numbered: SessionEntryLike[] = [stored(1, [block])];
  assert.deepEqual(storedBlocks(numbered, 1), [block]);
});
