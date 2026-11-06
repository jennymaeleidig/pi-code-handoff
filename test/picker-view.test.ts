import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { HandoffBlock } from "../src/handoff.ts";
import { createPicker, pickerSource, typeFilter } from "../src/picker.ts";
import { renderPicker, type PickerTheme } from "../src/picker-view.ts";

/** A theme that adds no escape codes, so the frame is readable in the test. */
const plain: PickerTheme = {
  fg: (_color: ThemeColor, text: string) => text,
  bold: (text: string) => text,
  underline: (text: string) => text,
};

const WIDTH = 60;

function block(overrides: Partial<HandoffBlock> = {}): HandoffBlock {
  return {
    toolCallId: "call-1",
    kind: "code",
    form: "diff",
    path: "greet.py",
    body: "--- a/greet.py\n+++ b/greet.py\n@@ -1 +1 @@\n-old\n+new",
    lang: "diff",
    caption: "`greet.py` — 1 hunk",
    ...overrides,
  };
}

function frame(source: ReturnType<typeof pickerSource>, state = createPicker(source)): string[] {
  return renderPicker(source, state, WIDTH, plain);
}

test("the overlay is a closed frame the surrounding text cannot bleed through", () => {
  const lines = frame(pickerSource([block()], "```ts\nx\n```\n"));
  assert.match(lines[0]!, /^╭.* Copy .*╮$/);
  assert.match(lines.at(-1)!, /^╰─*╯$/);
  for (const line of lines) {
    assert.equal(visibleWidth(line), WIDTH, `line is not frame width: ${JSON.stringify(line)}`);
  }
});

test("each section is named in the rule above it", () => {
  const lines = frame(pickerSource([block()], "```ts\nx\n```\n"));
  assert.ok(lines.some((line) => /^├─* Preview · 5 lines ─*┤$/.test(line)));
});

test("the selected row is marked, badged, and the preview follows it", () => {
  const source = pickerSource(
    [
      block({ body: "first body\n" }),
      block({
        toolCallId: "call-2",
        form: "full",
        path: "notes.md",
        caption: "`notes.md` — new file, 2 lines",
        body: "line one\nline two\n",
      }),
    ],
    "",
  );
  const lines = frame(source);
  const first = lines.find((line) => line.includes("`greet.py`"))!;
  const second = lines.find((line) => line.includes("`notes.md`"))!;
  assert.match(first, /^│ → \[diff\]/);
  assert.match(second, /^│ {3}\[full\]/);
  assert.ok(lines.some((line) => line.includes("first body")));
});

test("the preview counts the body's lines and says how many it did not show", () => {
  const body = Array.from({ length: 8 }, (_, index) => `row ${index + 1}`).join("\n");
  const lines = frame(pickerSource([block({ body })], ""));
  assert.ok(lines.some((line) => /Preview · 8 lines/.test(line)));
  assert.ok(lines.some((line) => line.includes("row 5")));
  assert.ok(!lines.some((line) => line.includes("row 6")));
  assert.ok(lines.some((line) => line.includes("… 3 more lines")));
});

test("a trailing newline is not counted as an extra blank line", () => {
  const lines = frame(pickerSource([block({ body: "one\ntwo\n" })], ""));
  assert.ok(lines.some((line) => /Preview · 2 lines/.test(line)));
});

test("both tabs' counts are in the frame, and the empty one is switched away", () => {
  const source = pickerSource([], "```ts\nx\n```\n");
  const lines = frame(source);
  assert.ok(lines.some((line) => line.includes("Hand-off 0")));
  assert.ok(lines.some((line) => line.includes("Agent reply 1")));
});

test("a filter that matches nothing says so instead of showing an empty list", () => {
  const source = pickerSource([block()], "");
  const state = typeFilter(createPicker(source), "zzz");
  const lines = frame(source, state);
  assert.ok(lines.some((line) => line.includes("Nothing matches “zzz”.")));
  assert.ok(!lines.some((line) => line.includes("Preview ·")));
});

test("the footer names the keys the overlay answers to, dropping the rarest first", () => {
  const source = pickerSource([block()], "");
  const wide = renderPicker(source, createPicker(source), 90, plain).at(-2)!;
  for (const hint of ["↑↓", "tab", "1/2", "enter", "esc"]) {
    assert.ok(wide.includes(hint), `footer is missing ${hint}: ${wide}`);
  }
  const narrow = frame(source).at(-2)!;
  for (const hint of ["enter", "esc"]) {
    assert.ok(narrow.includes(hint), `narrow footer is missing ${hint}: ${narrow}`);
  }
});

test("a narrow overlay still closes the frame and keeps every line the same width", () => {
  const source = pickerSource([block()], "```ts\nx\n```\n");
  for (const width of [24, 40]) {
    const lines = renderPicker(source, createPicker(source), width, plain);
    for (const line of lines) {
      assert.equal(visibleWidth(line), width, `width ${width}: ${JSON.stringify(line)}`);
    }
    assert.match(lines.at(-1)!, /^╰─*╯$/);
  }
});
