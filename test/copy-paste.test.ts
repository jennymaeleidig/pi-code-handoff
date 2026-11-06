import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { countDiff } from "../src/diff.ts";
import { makeDirectory, makeRepo, remove, git, loadExtension, blockBody } from "./helpers.ts";

test("the counts include a content line that starts like a file header", () => {
  const diff = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n one\n+++ inserted\n";
  assert.deepEqual(countDiff(diff), { hunks: 1, insertions: 1, deletions: 0 });
});

test("registers copy_paste and a message_end handler", () => {
  const harness = loadExtension("/tmp");
  assert.equal(harness.tool.name, "copy_paste");
  assert.match(harness.tool.description, /do not write it yourself/i);
  assert.ok(harness.tool.promptGuidelines?.some((rule) => rule.includes("copy_paste")));
});

test("code+diff emits a counted, validated diff and the splice carries it", async () => {
  const repo = await makeRepo({ "src/example.ts": "one\ntwo\nthree\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/example.ts",
      replacements: [{ search: "two", replace: "TWO" }],
    });

    assert.equal(result.isError, undefined);
    assert.match(result.content[0]!.text, /1 hunk/);
    assert.match(result.content[0]!.text, /git apply --check passed/);
    assert.equal(
      await readFile(join(repo, "src/example.ts"), "utf8"),
      "one\ntwo\nthree\n",
      "the tool never writes the target",
    );

    const section = await harness.appendHandoff();
    assert.equal(
      section,
      "\n\n---\n\n## Hand-off\n\n`src/example.ts` — 1 hunk\n\n" +
        "```diff\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n\n```\n",
    );
    assert.ok(
      blockBody(section!).endsWith("\n"),
      "the whole-reply section must keep the patch's trailing newline",
    );
  } finally {
    await remove(repo);
  }
});

test("the emitted diff applies to a clean checkout", async () => {
  const repo = await makeRepo({ "src/example.ts": "alpha\nbeta\ngamma\ndelta\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/example.ts",
      replacements: [{ search: "beta\ngamma", replace: "BETA\nGAMMA" }],
    });
    assert.equal(result.isError, undefined);
    const section = await harness.appendHandoff();
    const patch = blockBody(section!);

    await git(repo, "checkout", "--", ".");
    await writeFile(join(repo, "emitted.patch"), patch, "utf8");
    await git(repo, "apply", "-p1", "emitted.patch");
    assert.equal(
      await readFile(join(repo, "src/example.ts"), "utf8"),
      "alpha\nBETA\nGAMMA\ndelta\n",
    );
  } finally {
    await remove(repo);
  }
});

test("code+full creates a new file block without writing it", async () => {
  const repo = await makeRepo({ "README.md": "hi\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "new.txt",
      form: "full",
      content: "hello\nworld\n",
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0]!.text, /new file, 2 lines/);

    const section = await harness.appendHandoff();
    assert.match(section!, /`new\.txt` — new file, 2 lines\n\n```\nhello\nworld\n\n```/);
    await assert.rejects(readFile(join(repo, "new.txt"), "utf8"), /ENOENT/);
  } finally {
    await remove(repo);
  }
});

test("code+full rewrites an existing file and tags its language", async () => {
  const repo = await makeRepo({ "src/a.ts": "old\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      form: "full",
      content: "new\n",
    });
    assert.equal(result.isError, undefined);
    const section = await harness.appendHandoff();
    assert.match(section!, /`src\/a\.ts` — full file, 1 line/);
    assert.match(section!, /```ts\nnew\n\n```/);
  } finally {
    await remove(repo);
  }
});

test("command blocks are syntax-checked and captioned by purpose", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "command",
      command: "echo hi",
      purpose: "say hi",
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0]!.text, /bash -n passed/);
    const section = await harness.appendHandoff();
    assert.match(section!, /`say hi` — command\n\n```bash\necho hi\n\n```/);
  } finally {
    await remove(repo);
  }
});

test("command+form is rejected as meaningless", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "command",
      form: "diff",
      command: "echo hi",
      purpose: "say hi",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /A command block has no form/);
  } finally {
    await remove(repo);
  }
});

test("fence length grows past backticks in a full block", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const content = "before\n```\ninside\n```\nafter\n";
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "notes.md",
      form: "full",
      content,
    });
    assert.equal(result.isError, undefined);
    const section = await harness.appendHandoff();
    assert.match(section!, /\n````md\nbefore\n```\ninside\n```\nafter\n\n````\n$/);
  } finally {
    await remove(repo);
  }
});

test("zero-match replacements name the nearest lines", async () => {
  const repo = await makeRepo({
    "src/a.ts": "const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n",
  });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      replacements: [{ search: "const beta = 3;", replace: "const beta = 4;" }],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /did not match anything/);
    assert.match(result.content[0]!.text, /Nearest lines:/);
    assert.match(result.content[0]!.text, /2: const beta = 2;/);
    assert.equal(await harness.appendHandoff(), undefined);
  } finally {
    await remove(repo);
  }
});

test("multi-match replacements name the matching lines", async () => {
  const repo = await makeRepo({ "src/a.ts": "foo\nbar\nfoo\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      replacements: [{ search: "foo", replace: "baz" }],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /matches 2 times/);
    assert.match(result.content[0]!.text, /lines 1, 3/);
  } finally {
    await remove(repo);
  }
});

test("a target outside any git repository is refused", async () => {
  const plain = await makeDirectory();
  try {
    const harness = loadExtension(plain);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "notes.txt",
      form: "full",
      content: "hello\n",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /not inside a git repository/);
  } finally {
    await remove(plain);
  }
});

test("bash -n rejects a truncated command", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "command",
      command: 'echo "unterminated',
      purpose: "broken",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /bash -n rejected/);
  } finally {
    await remove(repo);
  }
});

test("a second call for the same path in one reply is refused", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\ntwo\n" });
  try {
    const harness = loadExtension(repo);
    const first = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      replacements: [{ search: "one", replace: "ONE" }],
    });
    assert.equal(first.isError, undefined);
    const second = await harness.execute("call-2", {
      kind: "code",
      path: "src/a.ts",
      replacements: [{ search: "two", replace: "TWO" }],
    });
    assert.equal(second.isError, true);
    assert.match(second.content[0]!.text, /already handed off in this reply/);
  } finally {
    await remove(repo);
  }
});

test("several blocks are spliced in tool-call order", async () => {
  const repo = await makeRepo({ "a.ts": "a\n", "b.ts": "b\n" });
  try {
    const harness = loadExtension(repo);
    await harness.emit(harness.toolCallMessage(["call-b", "call-a", "call-cmd"]));
    await harness.execute("call-cmd", {
      kind: "command",
      command: "echo hi",
      purpose: "third",
    });
    await harness.execute("call-a", {
      kind: "code",
      path: "a.ts",
      replacements: [{ search: "a", replace: "A" }],
    });
    await harness.execute("call-b", {
      kind: "code",
      path: "b.ts",
      replacements: [{ search: "b", replace: "B" }],
    });

    const section = await harness.appendHandoff();
    const b = section!.indexOf("`b.ts`");
    const a = section!.indexOf("`a.ts`");
    const cmd = section!.indexOf("`third`");
    assert.ok(b > 0 && a > b && cmd > a, `unexpected order:\n${section}`);
  } finally {
    await remove(repo);
  }
});

test("messages that are not assistant content do not throw", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    assert.equal(await harness.emit({ role: "system", content: "prompt" }), undefined);
    assert.equal(await harness.emit({ role: "user", content: "hello" }), undefined);
    assert.equal(
      await harness.emit({
        role: "toolResult",
        toolCallId: "x",
        toolName: "copy_paste",
        content: [],
      }),
      undefined,
    );
  } finally {
    await remove(repo);
  }
});

test("a turn with no blocks gets no hand-off section", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    assert.equal(await harness.appendHandoff("just prose"), undefined);
  } finally {
    await remove(repo);
  }
});

test("an escape-hatch patch is recounted and canonicalised", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\ntwo\nthree\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,99 +1,99 @@\n one\n-two\n+TWO\n three\n",
    });
    assert.equal(result.isError, undefined);
    const section = await harness.appendHandoff();
    const body = blockBody(section!);
    assert.match(body, /@@ -1,3 \+1,3 @@/);
    assert.doesNotMatch(body, /99/);

    await writeFile(join(repo, "emitted.patch"), body, "utf8");
    await git(repo, "apply", "-p1", "emitted.patch");
  } finally {
    await remove(repo);
  }
});

test("an escape-hatch /dev/null patch creates a new file", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "new.txt",
      patch: "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+hello\n+world\n",
    });
    assert.equal(result.isError, undefined);
    const section = await harness.appendHandoff();
    const body = blockBody(section!);
    assert.match(body, /@@ -0,0 \+1,2 @@/);

    await writeFile(join(repo, "emitted.patch"), body, "utf8");
    await git(repo, "apply", "-p1", "emitted.patch");
    assert.equal(await readFile(join(repo, "new.txt"), "utf8"), "hello\nworld\n");
  } finally {
    await remove(repo);
  }
});

test("a patch with headers whose context does not match returns git's own error", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\ntwo\nthree\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n one\n-NOPE\n+TWO\n three\n",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /patch does not apply/);
  } finally {
    await remove(repo);
  }
});

test("a bare-hunk patch whose context does not match names the line", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\ntwo\nthree\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      patch: "@@ -1,3 +1,3 @@\n one\n-NOPE\n+TWO\n three\n",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /does not match line 2/);
  } finally {
    await remove(repo);
  }
});

test("more than one input shape is refused", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      content: "two\n",
      replacements: [{ search: "one", replace: "two" }],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /Supply only one/);
  } finally {
    await remove(repo);
  }
});

test("a full block cannot be built from replacements", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      form: "full",
      replacements: [{ search: "one", replace: "two" }],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /takes only "content"/);
  } finally {
    await remove(repo);
  }
});

test("a file without a trailing newline keeps that fact in the diff", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\ntwo" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      replacements: [{ search: "two", replace: "TWO" }],
    });
    assert.equal(result.isError, undefined);
    const section = await harness.appendHandoff();
    const patch = blockBody(section!);
    assert.match(patch, /\\ No newline at end of file/);

    await writeFile(join(repo, "emitted.patch"), patch, "utf8");
    await git(repo, "apply", "-p1", "emitted.patch");
    assert.equal(await readFile(join(repo, "src/a.ts"), "utf8"), "one\nTWO");
  } finally {
    await remove(repo);
  }
});

test("a patch line whose content starts with +++ is not read as a header", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      patch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n one\n+++ foo\n",
    });
    assert.equal(result.isError, undefined);
    const section = await harness.appendHandoff();
    const patch = blockBody(section!);
    await writeFile(join(repo, "emitted.patch"), patch, "utf8");
    await git(repo, "apply", "-p1", "emitted.patch");
    assert.equal(await readFile(join(repo, "src/a.ts"), "utf8"), "one\n++ foo\n");
  } finally {
    await remove(repo);
  }
});

test("two separated edits produce two hunks that still apply", async () => {
  const original = Array.from({ length: 15 }, (_, index) => `line ${index + 1}\n`).join("");
  const repo = await makeRepo({ "src/a.ts": original });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      replacements: [
        { search: "line 1\n", replace: "LINE 1\n" },
        { search: "line 12\n", replace: "LINE 12\n" },
      ],
    });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0]!.text, /2 hunks/);

    const section = await harness.appendHandoff();
    const patch = blockBody(section!);
    await writeFile(join(repo, "emitted.patch"), patch, "utf8");
    await git(repo, "apply", "-p1", "emitted.patch");
    assert.equal(
      await readFile(join(repo, "src/a.ts"), "utf8"),
      original.replace("line 1\n", "LINE 1\n").replace("line 12\n", "LINE 12\n"),
    );
  } finally {
    await remove(repo);
  }
});

test("overlapping matches count as more than one", async () => {
  const repo = await makeRepo({ "src/a.ts": "aaa\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      replacements: [{ search: "aa", replace: "b" }],
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /matches 2 times/);
  } finally {
    await remove(repo);
  }
});

test("full content without a trailing newline is refused", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "new.txt",
      form: "full",
      content: "no newline",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /must end with a newline/);
  } finally {
    await remove(repo);
  }
});

test("a command purpose must be one line", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "command",
      command: "echo hi",
      purpose: "two\nlines",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /must be a single line/);
  } finally {
    await remove(repo);
  }
});

test("a patch naming a different file is refused", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "src/a.ts",
      patch: "--- a/src/other.ts\n+++ b/src/other.ts\n@@ -1 +1 @@\n-one\n+ONE\n",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /names "src\/other\.ts"/);
  } finally {
    await remove(repo);
  }
});

test("a multi-file patch is refused", async () => {
  const repo = await makeRepo({ "a.ts": "one\n", "b.ts": "two\n" });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "a.ts",
      patch:
        "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-one\n+ONE\n" +
        "diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-two\n+TWO\n",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /more than one file/);
  } finally {
    await remove(repo);
  }
});

test("each refusal names its own rule", async () => {
  const repo = await makeRepo({ "src/a.ts": "one\n" });
  try {
    const harness = loadExtension(repo);
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        "missing purpose",
        { kind: "command", command: "echo hi" },
        /purpose is required when kind is "command"/,
      ],
      [
        "empty command",
        { kind: "command", command: "", purpose: "say hi" },
        /command is required when kind is "command"/,
      ],
      [
        "missing target",
        { kind: "code", path: "src/missing.ts", replacements: [{ search: "a", replace: "b" }] },
        /"src\/missing\.ts" does not exist/,
      ],
      [
        "empty replacements",
        { kind: "code", path: "src/a.ts", replacements: [] },
        /"replacements" is empty/,
      ],
      [
        "no-op replacements",
        { kind: "code", path: "src/a.ts", replacements: [{ search: "one", replace: "one" }] },
        /replacements leave "src\/a\.ts" unchanged/,
      ],
      [
        "patch deletes the file",
        {
          kind: "code",
          path: "src/a.ts",
          patch: "--- a/src/a.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-one\n",
        },
        /Deleting a file with a patch is not supported/,
      ],
      [
        "patch creates an existing file",
        {
          kind: "code",
          path: "src/a.ts",
          patch: "--- /dev/null\n+++ b/src/a.ts\n@@ -0,0 +1 @@\n+two\n",
        },
        /The patch creates "src\/a\.ts", but the file already exists/,
      ],
    ];

    for (const [name, params, expected] of cases) {
      const result = await harness.execute("call-1", params);
      assert.equal(result.isError, true, `${name}: expected an error`);
      assert.match(result.content[0]!.text, expected, name);
    }
  } finally {
    await remove(repo);
  }
});

test("empty full content is refused with an error naming the rule", async () => {
  const repo = await makeRepo();
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "empty.txt",
      form: "full",
      content: "",
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /content for "empty\.txt" is empty/);
  } finally {
    await remove(repo);
  }
});

test("a change too large to diff reliably is refused with the way out", async () => {
  const oldLines = Array.from({ length: 1100 }, (_, index) => `old ${index}\n`).join("");
  const newLines = Array.from({ length: 1100 }, (_, index) => `new ${index}\n`).join("");
  const repo = await makeRepo({ "big.txt": oldLines });
  try {
    const harness = loadExtension(repo);
    const result = await harness.execute("call-1", {
      kind: "code",
      path: "big.txt",
      content: newLines,
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /too large to diff reliably/);
  } finally {
    await remove(repo);
  }
});
