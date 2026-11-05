import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { scanFencedBlocks } from "../src/fences.ts";

const fixture = fileURLToPath(new URL("./fixtures/nested-fences.md", import.meta.url));

// A sanitised copy of the reply on which the lenient scan desynchronised: prose, a script's
// output carrying a four-backtick pair, then the hand-off section. The outer fence is five
// backticks — what `fenceLength` produces for that body — because the original wrapped the
// four-fence pair in three backticks, which CommonMark closes on the bare four-fence line
// (recorded in the last-but-one test below).
test("a reply from the fence-length session scans as three blocks in order", async () => {
  const text = await readFile(fixture, "utf8");
  const blocks = scanFencedBlocks(text);

  assert.deepEqual(
    blocks.map((block) => block.lang),
    ["", "bash", "diff"],
  );
  assert.ok(
    blocks.every((block) => block.terminated),
    "every block in the reply is terminated",
  );

  assert.match(blocks[0]!.body, /^--- python version/);
  assert.match(blocks[0]!.body, /````python\n```py\nprint\('hi'\)\n```\n````$/);
  assert.equal(blocks[1]!.body, "python3 /tmp/handoff_demo.py\n");
  assert.match(blocks[2]!.body, /^--- a\/greet\.py\n\+\+\+ b\/greet\.py\n@@ -1,2 \+1,4 @@\n/);
  assert.ok(blocks[2]!.body.endsWith('     return "hi " + name\n'));
});

test("an opener with no close runs to the end of the text, marked unterminated", () => {
  const [block, ...rest] = scanFencedBlocks("Intro.\n\n```ts\nconst a = 1;\nstill inside\n");

  assert.equal(rest.length, 0);
  assert.equal(block!.lang, "ts");
  assert.equal(block!.body, "const a = 1;\nstill inside");
  assert.equal(block!.terminated, false);
});

test("tildes fence a block, and the two characters never close each other", () => {
  const tildes = scanFencedBlocks("~~~js\nconst fence = '```';\n~~~\n");
  assert.deepEqual(tildes, [{ lang: "js", body: "const fence = '```';", terminated: true }]);

  const backticks = scanFencedBlocks("```\ntilde inside\n~~~\n```\n");
  assert.deepEqual(backticks, [{ lang: "", body: "tilde inside\n~~~", terminated: true }]);
});

test("a malformed close carrying an info string is content, and eats nothing", () => {
  const blocks = scanFencedBlocks("```js\none\n``` extra\n```\n```py\ntwo\n```\n");

  assert.deepEqual(
    blocks.map((block) => [block.lang, block.body, block.terminated]),
    [
      ["js", "one\n``` extra", true],
      ["py", "two", true],
    ],
  );
});

test("a close longer than its opener closes the block", () => {
  const blocks = scanFencedBlocks("```js\none\n`````\ntwo\n");

  assert.deepEqual(blocks, [{ lang: "js", body: "one", terminated: true }]);
});

test("fences indented by up to three spaces count; four do not", () => {
  // The opener's indentation comes off each body line, but only that much.
  const indented = scanFencedBlocks("  ```js\n  one\n    two\nnot three\n   ```\n");
  assert.deepEqual(indented, [{ lang: "js", body: "one\n  two\nnot three", terminated: true }]);

  const tooDeep = scanFencedBlocks("    ```js\n    one\n    ```\n");
  assert.deepEqual(tooDeep, []);
});

test("a backtick fence whose info string contains a backtick is not a fence", () => {
  const blocks = scanFencedBlocks("``` a`b\none\n```diff\n+x\n```\n");

  assert.deepEqual(blocks, [{ lang: "diff", body: "+x", terminated: true }]);
  assert.ok(
    !blocks.some((block) => block.body.includes("one")),
    "the prose line must not have been swallowed",
  );
});

test("the reported reply's own wrapper is malformed, and its tail is unterminated", () => {
  const blocks = scanFencedBlocks(
    "```\nscript output\n````python\n```py\n```\n````\n```\n\n## Hand-off\n\n```diff\n+x\n```\n",
  );

  assert.deepEqual(
    blocks.map((block) => block.terminated),
    [true, false],
  );
  assert.equal(blocks[1]!.body, "```\n\n## Hand-off\n\n```diff\n+x\n```");
});

test("CRLF line endings fence like any other", () => {
  assert.deepEqual(scanFencedBlocks("```js\r\none\r\n```\r\n"), [
    { lang: "js", body: "one", terminated: true },
  ]);
});
