import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkdownBlocks } from "../src/markdown.ts";

test("a code fence copies as its code, fences dropped", () => {
  const blocks = parseMarkdownBlocks("Intro.\n\n```diff\n--- a/x\n+++ b/x\n```\n\nOutro.\n");
  assert.deepEqual(blocks, [{ label: "[diff] — line 3", body: "--- a/x\n+++ b/x\n" }]);
});

test("an untagged fence is code too, so its fences come off", () => {
  assert.deepEqual(parseMarkdownBlocks("```\n$ ls\n```\n"), [
    { label: "[code] — line 1", body: "$ ls\n" },
  ]);
});

test("a code block ends in a newline, because the code line does", () => {
  assert.equal(parseMarkdownBlocks("```diff\n+x\n```")[0]!.body, "+x\n");
});

test("a hand-off block drawn in its row reads back as the body the hand-off tab copies", () => {
  // renderBlock leaves one empty line before the closer so the body keeps its
  // trailing newline; with the fences off, that blank line is the body's own.
  const body = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n";
  const drawn = "\`\`\`diff\n" + body + "\n\`\`\`";
  assert.equal(parseMarkdownBlocks(drawn)[0]!.body, body);
});

test("an md fence keeps its fences, so nested blocks stay decorated", () => {
  const text = ["````md", "Intro.", "", "```ts", "const a = 1;", "```", "````", ""].join("\n");
  assert.deepEqual(parseMarkdownBlocks(text), [
    { label: "[md] — line 1", body: "````md\nIntro.\n\n```ts\nconst a = 1;\n```\n````" },
  ]);
});

test("nested fences stay one item, because the outer fence is longer", () => {
  const text = [
    "Before",
    "",
    "`````markdown",
    "````python",
    "```py",
    "print('hi')",
    "```",
    "````",
    "`````",
    "",
    "After",
  ].join("\n");
  const blocks = parseMarkdownBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.label, "[markdown] — line 3");
  assert.ok(blocks[0]!.body.startsWith("`````markdown"));
  assert.ok(blocks[0]!.body.includes("```py"));
  assert.ok(blocks[0]!.body.endsWith("`````"));
});

test("a table is one item with every row, and no cell grid", () => {
  const text = ["| a | b |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |", "", "done"].join("\n");
  const blocks = parseMarkdownBlocks(text);
  assert.deepEqual(blocks, [
    { label: "[table] — 2 rows, line 1", body: "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |" },
  ]);
});

test("a pipe line without a delimiter row is not a table", () => {
  assert.deepEqual(parseMarkdownBlocks("a | b\nnot a table\n"), []);
});

test("a list keeps its items and loose blank lines", () => {
  const text = ["- one", "- two", "", "- three", "", "After the list."].join("\n");
  const blocks = parseMarkdownBlocks(text);
  assert.deepEqual(blocks, [
    { label: "[list] — 3 items, line 1", body: "- one\n- two\n\n- three" },
  ]);
});

test("an ordered list with continuation lines stays one item", () => {
  const text = ["1. first", "   continued", "2. second", "", "Done."].join("\n");
  const blocks = parseMarkdownBlocks(text);
  assert.deepEqual(blocks, [
    { label: "[list] — 2 items, line 1", body: "1. first\n   continued\n2. second" },
  ]);
});

test("a blockquote is copied with its marks", () => {
  const text = ["> one", "> two", "", "After."].join("\n");
  assert.deepEqual(parseMarkdownBlocks(text), [
    { label: "[quote] — line 1", body: "> one\n> two" },
  ]);
});

test("a fence's content is not re-read as a table, list or quote", () => {
  const text = ["```md", "| a | b |", "| --- | --- |", "- not a list", "> not a quote", "```"].join(
    "\n",
  );
  const blocks = parseMarkdownBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.label, "[md] — line 1");
});

test("blocks keep source order across kinds", () => {
  const text = ["```ts", "const a = 1;", "```", "", "- item", "", "| a |", "| --- |", "| 1 |"].join(
    "\n",
  );
  assert.deepEqual(
    parseMarkdownBlocks(text).map((block) => block.label),
    ["[ts] — line 1", "[list] — 1 item, line 5", "[table] — 1 row, line 7"],
  );
});
