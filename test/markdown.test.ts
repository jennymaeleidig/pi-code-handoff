import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkdownBlocks } from "../src/markdown.ts";

test("fenced blocks come back whole, fences included", () => {
  const blocks = parseMarkdownBlocks("Intro.\n\n```diff\n--- a/x\n+++ b/x\n```\n\nOutro.\n");
  assert.deepEqual(blocks, [
    { label: "diff code block — line 3", body: "```diff\n--- a/x\n+++ b/x\n```" },
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
  assert.equal(blocks[0]!.label, "markdown code block — line 3");
  assert.ok(blocks[0]!.body.includes("```py"));
  assert.ok(blocks[0]!.body.endsWith("`````"));
});

test("a table is one item with every row, and no cell grid", () => {
  const text = ["| a | b |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |", "", "done"].join("\n");
  const blocks = parseMarkdownBlocks(text);
  assert.deepEqual(blocks, [
    { label: "table — 2 rows, line 1", body: "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |" },
  ]);
});

test("a pipe line without a delimiter row is not a table", () => {
  assert.deepEqual(parseMarkdownBlocks("a | b\nnot a table\n"), []);
});

test("a list keeps its items and loose blank lines", () => {
  const text = ["- one", "- two", "", "- three", "", "After the list."].join("\n");
  const blocks = parseMarkdownBlocks(text);
  assert.deepEqual(blocks, [{ label: "list — 3 items, line 1", body: "- one\n- two\n\n- three" }]);
});

test("an ordered list with continuation lines stays one item", () => {
  const text = ["1. first", "   continued", "2. second", "", "Done."].join("\n");
  const blocks = parseMarkdownBlocks(text);
  assert.deepEqual(blocks, [
    { label: "list — 2 items, line 1", body: "1. first\n   continued\n2. second" },
  ]);
});

test("a blockquote is copied with its marks", () => {
  const text = ["> one", "> two", "", "After."].join("\n");
  assert.deepEqual(parseMarkdownBlocks(text), [
    { label: "blockquote — line 1", body: "> one\n> two" },
  ]);
});

test("a fence's content is not re-read as a table, list or quote", () => {
  const text = ["```md", "| a | b |", "| --- | --- |", "- not a list", "> not a quote", "```"].join(
    "\n",
  );
  const blocks = parseMarkdownBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.label, "md code block — line 1");
});

test("blocks keep source order across kinds", () => {
  const text = ["```ts", "const a = 1;", "```", "", "- item", "", "| a |", "| --- |", "| 1 |"].join(
    "\n",
  );
  assert.deepEqual(
    parseMarkdownBlocks(text).map((block) => block.label),
    ["ts code block — line 1", "list — 1 item, line 5", "table — 1 row, line 7"],
  );
});
