import assert from "node:assert/strict";
import { test } from "node:test";
import { loadExtension, makeRepo, remove } from "./helpers.ts";

const block = {
  toolCallId: "call-1",
  kind: "code" as const,
  form: "diff" as const,
  path: "greet.py",
  body: "--- a/greet.py\n+++ b/greet.py\n@@ -1 +1 @@\n-old\n+new\n",
  lang: "diff",
  caption: "`greet.py` — 1 hunk",
};

function reply(text: string, timestamp = 42) {
  return {
    type: "message",
    message: { role: "assistant", timestamp, content: [{ type: "text", text }] },
  };
}

test("registers /copy-paste and ctrl+shift+c", () => {
  const harness = loadExtension("/tmp");
  assert.ok(harness.commands.has("copy-paste"));
  assert.ok(harness.shortcuts.has("ctrl+shift+c"));
  assert.match(harness.commands.get("copy-paste")!.description!, /copy/i);
});

test("the hand-off tab opens over blocks persisted for the last reply", async () => {
  const harness = loadExtension("/tmp");
  const branch = [
    reply("Here you go."),
    {
      type: "custom",
      customType: "copy-paste-handoff",
      data: { messageTimestamp: 42, blocks: [block] },
    },
  ];

  const { notices, rendered } = await harness.runCommand("copy-paste", { branch });

  assert.deepEqual(notices, [], "opening the picker is not itself a notification");
  assert.ok(rendered, "the picker did not render");
  assert.ok(rendered!.some((line) => line.includes(block.caption)));
  assert.ok(rendered!.some((line) => /type to filter/.test(line)));
});

test("no hand-off blocks: the picker opens on the Agent reply tab and says so", async () => {
  const harness = loadExtension("/tmp");
  const branch = [reply("Text.\n\n```ts\nconst a = 1;\n```\n")];

  const { rendered } = await harness.runCommand("copy-paste", { branch });

  assert.ok(rendered!.some((line) => /No hand-off blocks/.test(line)));
  assert.ok(rendered!.some((line) => /ts code block/.test(line)));
});

test("no assistant reply at all: the picker refuses", async () => {
  const harness = loadExtension("/tmp");
  const { notices } = await harness.runCommand("copy-paste", { branch: [] });
  assert.match(notices.join("\n"), /No assistant reply/);
});

test("a reply with no blocks still opens, and the picker says there is nothing to copy", async () => {
  const harness = loadExtension("/tmp");
  const { notices, rendered } = await harness.runCommand("copy-paste", {
    branch: [reply("Just prose, no blocks.")],
  });
  assert.deepEqual(notices, []);
  assert.ok(rendered!.some((line) => /No blocks in this reply/.test(line)));
});

test("outside interactive mode the command declines instead of copying", async () => {
  const harness = loadExtension("/tmp");
  const { notices } = await harness.runCommand("copy-paste", { mode: "print" });
  assert.match(notices.join("\n"), /interactive mode/);
});

test("the shortcut runs the same picker", async () => {
  const harness = loadExtension("/tmp");
  const branch = [reply("Text.\n\n```ts\nx\n```\n")];
  const { rendered } = await harness.runShortcut("ctrl+shift+c", { branch });
  assert.ok(rendered!.some((line) => /ts code block/.test(line)));
});

test("the spliced reply is persisted as a hand-off entry for its message", async () => {
  const repo = await makeRepo({ "old.txt": "hi\n" });
  try {
    const harness = loadExtension(repo);
    await harness.execute("call-1", {
      kind: "code",
      path: "old.txt",
      replacements: [{ search: "hi", replace: "hello" }],
    });
    await harness.appendHandoff();

    const stored = harness.entries.find((entry) => entry.customType === "copy-paste-handoff");
    assert.ok(stored, "no hand-off entry was appended");
    const data = stored!.data as { messageTimestamp: number | null; blocks: (typeof block)[] };
    assert.equal(data.messageTimestamp, null);
    assert.equal(data.blocks.length, 1);
    assert.equal(data.blocks[0]!.body, "--- a/old.txt\n+++ b/old.txt\n@@ -1 +1 @@\n-hi\n+hello\n");
  } finally {
    await remove(repo);
  }
});
