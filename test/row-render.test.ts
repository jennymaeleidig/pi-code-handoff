import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { loadExtension, makeRepo, remove } from "./helpers.ts";

// The expanded row is Markdown, and Markdown reads the process-wide theme.
initTheme("dark");

interface Renderable {
  render(width: number): string[];
}

function fakeTheme() {
  const pass = (text: string) => text;
  return {
    fg: (_colour: string, text: string) => text,
    bold: pass,
    italic: pass,
    underline: pass,
  };
}

function fakeOptions(expanded: boolean) {
  return {
    expanded,
    isPartial: false,
    args: {},
    toolCallId: "call-1",
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd: "/tmp",
    executionStarted: true,
    argsComplete: true,
    showImages: false,
    isError: false,
    durationMs: 0,
    outputPad: 1,
    keyText: () => "ctrl+o",
    keyHint: (_keybinding: string, description: string) => `ctrl+o ${description}`,
  };
}

test("collapsed, a row is one line naming the block", async () => {
  const repo = await makeRepo({ "a.ts": "one\ntwo\n" });
  try {
    const harness = loadExtension(repo);
    await harness.execute("call-1", {
      kind: "code",
      path: "a.ts",
      replacements: [{ search: "two", replace: "TWO" }],
    });
    const result = {
      content: [{ type: "text", text: "Validated a.ts." }],
      details: { block: harness.blocks[0]! },
    };
    const call = harness.tool.renderCall!(
      { kind: "code", path: "a.ts" } as never,
      fakeTheme() as never,
      fakeOptions(false) as never,
    ) as unknown as Renderable;
    const component = harness.tool.renderResult!(
      result as never,
      fakeOptions(false) as never,
      fakeTheme() as never,
      fakeOptions(false) as never,
    ) as unknown as Renderable;

    // pi stacks the call region above the result region, so the call slot must
    // draw nothing for the row to stay one line.
    assert.deepEqual(call.render(80), [], "the call slot draws no line of its own");

    const lines = component.render(80);
    assert.equal(lines.length, 1, `a collapsed row is one line:\n${lines.join("\n")}`);
    const line = lines[0]!;
    assert.match(line, /copy_paste/);
    assert.match(line, /a\.ts/);
    assert.match(line, /1 hunk/);
    assert.match(line, /ctrl\+o to show the block/);
    assert.doesNotMatch(line, /`/, "the caption's backticks are decoration for Markdown only");
    assert.doesNotMatch(line, /@@/, "the payload belongs to the expanded row");
  } finally {
    await remove(repo);
  }
});

test("expanded, the row is the block, in its own fence", async () => {
  const repo = await makeRepo({ "a.ts": "one\ntwo\n" });
  try {
    const harness = loadExtension(repo);
    await harness.execute("call-1", {
      kind: "code",
      path: "a.ts",
      replacements: [{ search: "two", replace: "TWO" }],
    });
    const result = {
      content: [{ type: "text", text: "Validated a.ts." }],
      details: { block: harness.blocks[0]! },
    };
    const component = harness.tool.renderResult!(
      result as never,
      fakeOptions(true) as never,
      fakeTheme() as never,
      fakeOptions(true) as never,
    ) as unknown as Renderable;

    const lines = component.render(80);
    const text = lines.join("\n");
    assert.match(text, /copy_paste/, "an expanded row keeps the tool's name, like any other row");
    assert.match(text, /a\.ts/);
    assert.match(text, /@@ -1,2 \+1,2 @@/);
    assert.match(text, /\+TWO/);
    assert.doesNotMatch(text, /ctrl\+o/, "an expanded row does not offer to expand");
  } finally {
    await remove(repo);
  }
});

test("a refusal renders as the result's own words", async () => {
  const repo = await makeRepo({ "a.ts": "one\n" });
  try {
    const harness = loadExtension(repo);
    const response = await harness.execute("call-1", {
      kind: "code",
      path: "missing.ts",
      replacements: [{ search: "one", replace: "two" }],
    });
    assert.equal(response.isError, true);

    const options = { ...fakeOptions(false), isError: true };
    const component = harness.tool.renderResult!(
      { content: response.content, details: undefined } as never,
      options as never,
      fakeTheme() as never,
      options as never,
    ) as unknown as Renderable;

    const text = component.render(80).join("\n");
    assert.match(text, /copy_paste failed/);
    assert.match(text, /missing\.ts/);
  } finally {
    await remove(repo);
  }
});
