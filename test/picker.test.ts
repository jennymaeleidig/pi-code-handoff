import assert from "node:assert/strict";
import { test } from "node:test";
import type { HandoffBlock } from "../src/handoff.ts";
import {
  createPicker,
  currentItem,
  pickerNotice,
  eraseFilter,
  handoffItems,
  moveSelection,
  parsedItems,
  payload,
  pickerSource,
  switchTab,
  typeFilter,
  visibleItems,
} from "../src/picker.ts";

function block(overrides: Partial<HandoffBlock> = {}): HandoffBlock {
  return {
    toolCallId: "call-1",
    kind: "code",
    form: "diff",
    path: "greet.py",
    body: "--- a/greet.py\n+++ b/greet.py\n@@ -1 +1 @@\n-old\n+new\n",
    lang: "diff",
    caption: "`greet.py` — 1 hunk",
    ...overrides,
  };
}

test("the hand-off tab copies the block body alone, never its label", () => {
  const item = handoffItems([block()])[0]!;
  assert.equal(item.label, "`greet.py` — 1 hunk");
  assert.equal(payload(item), block().body);
  assert.ok(!payload(item).includes("1 hunk"));
});

test("the hand-off tab keeps call order and carries no fence handling", () => {
  const items = handoffItems([
    block({ toolCallId: "a", body: "first\n", caption: "`a` — 1 hunk" }),
    block({ toolCallId: "b", body: "second\n", caption: "`b` — 1 hunk" }),
  ]);
  assert.deepEqual(
    items.map((item) => item.body),
    ["first\n", "second\n"],
  );
});

test("a body containing its own fenced block is copied byte for byte", () => {
  const body = ["# Notes", "", "```sh", "echo hi", "```", ""].join("\n");
  const item = handoffItems([block({ form: "full", path: "notes.md", body, lang: "md" })])[0]!;
  assert.equal(payload(item), body);
});

test("the parsed tab copies raw markdown, fences included", () => {
  const items = parsedItems("Text.\n\n```diff\n+x\n```\n");
  assert.equal(items.length, 1);
  assert.equal(payload(items[0]!), "```diff\n+x\n```");
});

test("the picker opens on the hand-off tab when it has blocks", () => {
  const source = pickerSource([block()], "```ts\nx\n```\n");
  assert.equal(createPicker(source).tab, "handoff");
  assert.equal(pickerNotice(source), undefined);
});

test("no hand-off blocks: the picker opens on parsed and says why", () => {
  const source = pickerSource([], "```ts\nx\n```\n");
  const state = createPicker(source);
  assert.equal(state.tab, "parsed");
  assert.equal(visibleItems(source, state).length, 1);
  assert.match(pickerNotice(source)!, /No hand-off blocks/);
});

test("a reply with no blocks at all still opens, on parsed, and says so", () => {
  const source = pickerSource([], "Just prose.");
  const state = createPicker(source);
  assert.equal(state.tab, "parsed");
  assert.equal(visibleItems(source, state).length, 0);
  assert.match(pickerNotice(source)!, /No blocks in this reply/);
});

test("typing filters labels and bodies, and resets the selection", () => {
  const source = pickerSource(
    [
      block({ toolCallId: "a", caption: "`a.txt` — 1 hunk", body: "alpha\n" }),
      block({ toolCallId: "b", caption: "`greet.py` — 1 hunk", body: "def greet():\n" }),
    ],
    "",
  );
  let state = createPicker(source);
  state = moveSelection(source, state, 1);
  assert.equal(state.selected, 1);

  state = typeFilter(state, "greet");
  assert.equal(state.selected, 0);
  assert.deepEqual(
    visibleItems(source, state).map((item) => item.label),
    ["`greet.py` — 1 hunk"],
  );

  state = eraseFilter(state);
  assert.equal(state.filter, "gree");
  assert.equal(visibleItems(source, state).length, 1);

  state = typeFilter(state, "zzz");
  assert.equal(visibleItems(source, state).length, 0);
  assert.equal(currentItem(source, state), undefined);
});

test("filtering searches the body as well as the label", () => {
  const source = pickerSource(
    [
      block({ toolCallId: "a", caption: "`a.txt` — 1 hunk", body: "alpha\n" }),
      block({ toolCallId: "b", caption: "`b.txt` — 1 hunk", body: "bravo\n" }),
    ],
    "",
  );
  const state = typeFilter(createPicker(source), "bravo");
  assert.equal(currentItem(source, state)?.label, "`b.txt` — 1 hunk");
});

test("moving the selection wraps and survives an empty filter result", () => {
  const source = pickerSource(
    [
      block({ toolCallId: "a", caption: "`a` — 1 hunk" }),
      block({ toolCallId: "b", caption: "`b` — 1 hunk" }),
    ],
    "",
  );
  let state = createPicker(source);
  state = moveSelection(source, state, -1);
  assert.equal(state.selected, 1);
  state = moveSelection(source, state, 1);
  assert.equal(state.selected, 0);

  state = typeFilter(state, "nothing matches");
  assert.equal(moveSelection(source, state, 1).selected, 0);
});

test("switching tabs keeps the filter and resets the selection", () => {
  const source = pickerSource(
    [block({ caption: "`greet.py` — 1 hunk" })],
    "```py\ndef greet():\n```\n",
  );
  let state = createPicker(source);
  state = moveSelection(source, state, 0);
  state = switchTab(state, "parsed");
  assert.equal(state.tab, "parsed");
  assert.equal(state.selected, 0);
  assert.match(currentItem(source, state)?.body ?? "", /def greet/);
});

test("the hand-off tab badges each block by what it carries", () => {
  const command: HandoffBlock = {
    toolCallId: "c",
    kind: "command",
    purpose: "list the files",
    body: "ls\n",
    lang: "bash",
    caption: "`list the files` — command",
  };
  const items = handoffItems([
    block({ toolCallId: "a" }),
    block({ toolCallId: "b", form: "full", path: "notes.md" }),
    command,
  ]);
  assert.deepEqual(
    items.map((item) => item.badge),
    ["diff", "full", "cmd"],
  );
});
