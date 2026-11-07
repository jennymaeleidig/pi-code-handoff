import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assistantEntry,
  fixtureBlock,
  loadExtension,
  makeRepo,
  remove,
  toolResultEntry,
} from "./helpers.ts";

const block = fixtureBlock();

function reply(text: string, calls: string[] = []) {
  return {
    type: "message",
    message: {
      role: "assistant",
      content: [
        ...(text === "" ? [] : [{ type: "text", text }]),
        ...calls.map((id) => ({ type: "toolCall", id, name: "copy_paste" })),
      ],
    },
  };
}

function result(id: string, value: unknown) {
  return {
    type: "message",
    message: { role: "toolResult", toolCallId: id, details: { block: value } },
  };
}

test("registers /copy-paste and ctrl+shift+c", () => {
  const harness = loadExtension("/tmp");
  assert.ok(harness.commands.has("copy-paste"));
  assert.ok(harness.shortcuts.has("ctrl+shift+c"));
  assert.match(harness.commands.get("copy-paste")!.description!, /copy/i);
});

test("the hand-off tab opens over the blocks the last turn's calls produced", async () => {
  const harness = loadExtension("/tmp");
  const branch = [assistantEntry("Here you go.", ["call-1"]), toolResultEntry("call-1", block)];

  const { notices, rendered } = await harness.runCommand("copy-paste", { branch });

  assert.deepEqual(notices, [], "opening the picker is not itself a notification");
  assert.ok(rendered, "the picker did not render");
  assert.ok(rendered!.some((line) => line.includes(block.caption)));
  assert.ok(rendered!.some((line) => /type to filter/.test(line)));
});

test("no hand-off blocks: the picker opens on the Agent reply tab and says so", async () => {
  const harness = loadExtension("/tmp");
  const branch = [assistantEntry("Text.\n\n```ts\nconst a = 1;\n```\n")];

  const { rendered } = await harness.runCommand("copy-paste", { branch });

  assert.ok(rendered!.some((line) => /No hand-off blocks/.test(line)));
  assert.ok(rendered!.some((line) => /\[ts\] — line 3/.test(line)));
});

test("no assistant reply at all: the picker refuses", async () => {
  const harness = loadExtension("/tmp");
  const { notices } = await harness.runCommand("copy-paste", { branch: [] });
  assert.match(notices.join("\n"), /No assistant reply/);
});

test("a reply with no blocks still opens, offering the whole response", async () => {
  const harness = loadExtension("/tmp");
  const { notices, rendered } = await harness.runCommand("copy-paste", {
    branch: [assistantEntry("Just prose, no blocks.")],
  });
  assert.deepEqual(notices, []);
  assert.ok(rendered!.some((line) => /\[md\] — full response/.test(line)));
});

test("outside interactive mode the command declines instead of copying", async () => {
  const harness = loadExtension("/tmp");
  const { notices } = await harness.runCommand("copy-paste", { mode: "print" });
  assert.match(notices.join("\n"), /interactive mode/);
});

test("the shortcut runs the same picker", async () => {
  const harness = loadExtension("/tmp");
  const branch = [assistantEntry("Text.\n\n```ts\nx\n```\n")];
  const { rendered } = await harness.runShortcut("ctrl+shift+c", { branch });
  assert.ok(rendered!.some((line) => /\[ts\] — line 3/.test(line)));
});

test("a block is the tool result's details, with no side channel", async () => {
  const repo = await makeRepo({ "old.txt": "hi\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "old.txt",
      replacements: [{ search: "hi", replace: "hello" }],
    });

    assert.deepEqual(harness.entries, [], "the extension appends no custom entry");
    assert.equal(harness.blocks.length, 1);
    assert.equal(
      harness.blocks[0]!.body,
      "--- a/old.txt\n+++ b/old.txt\n@@ -1 +1 @@\n-hi\n+hello\n",
      "the block that reached the picker is the one validation accepted",
    );
    assert.match(result.content[0]!.text, /git apply --check passed/);
  } finally {
    await remove(repo);
  }
});
