import assert from "node:assert/strict";
import { test } from "node:test";
import { lastTurn, turnBlocks } from "../src/session.ts";
import { assistantEntry, fixtureBlock, toolResultEntry, userEntry } from "./helpers.ts";

const block = fixtureBlock();

test("the last turn is what the last user message opened", () => {
  const entries = [userEntry(), assistantEntry("first"), assistantEntry("second")];
  assert.deepEqual(lastTurn(entries), { text: "second", calls: [] });
});

test("a turn that handed off and then spoke keeps both halves", () => {
  const entries = [userEntry(), assistantEntry("here you go", ["call-1"])];
  entries.push(assistantEntry("Anything else?"));
  assert.deepEqual(lastTurn(entries), { text: "Anything else?", calls: ["call-1"] });
});

test("a turn that handed off without prose is still the turn", () => {
  assert.deepEqual(lastTurn([userEntry(), assistantEntry("", ["call-1"])]), {
    text: "",
    calls: ["call-1"],
  });
});

test("a user message starts a new turn, and the previous turn's calls are gone", () => {
  const entries = [
    userEntry(),
    assistantEntry("here you go", ["call-old"]),
    toolResultEntry("call-old", block),
    userEntry("again"),
    assistantEntry("working on it"),
  ];
  assert.deepEqual(lastTurn(entries), { text: "working on it", calls: [] });
});

test("with no user message, only the last assistant message's calls count", () => {
  const entries = [
    assistantEntry("older", ["call-old"]),
    toolResultEntry("call-old", block),
    assistantEntry("newer", ["call-new"]),
    toolResultEntry("call-new", { ...block, toolCallId: "call-new" }),
  ];
  assert.deepEqual(lastTurn(entries), { text: "newer", calls: ["call-new"] });
});

test("only code_handoff calls count as hand-off calls", () => {
  const entries = [
    userEntry(),
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "read-1", name: "read" },
          { type: "toolCall", id: "call-1", name: "code_handoff" },
        ],
      },
    },
  ];
  assert.deepEqual(lastTurn(entries)?.calls, ["call-1"]);
});

test("no turn yields undefined", () => {
  assert.equal(lastTurn([]), undefined);
  assert.equal(lastTurn([userEntry()]), undefined);
  assert.equal(lastTurn([userEntry(), assistantEntry("")]), undefined);
});

test("a block survives a JSON round trip byte for byte", () => {
  const entries = [userEntry(), assistantEntry("reply", ["call-1"])];
  const stored = JSON.parse(JSON.stringify(toolResultEntry("call-1", block))) as never;
  const turn = lastTurn(entries)!;
  const blocks = turnBlocks([...entries, stored], turn);
  assert.deepEqual(blocks, [block]);
  assert.equal(blocks[0]!.body, block.body);
});

test("blocks come back in call order, not in entry order", () => {
  const entries = [
    userEntry(),
    assistantEntry("reply", ["call-b", "call-a"]),
    toolResultEntry("call-a", { ...block, toolCallId: "call-a", caption: "`a.txt` — 1 hunk" }),
    toolResultEntry("call-b", { ...block, toolCallId: "call-b", caption: "`b.txt` — 1 hunk" }),
  ];
  const turn = lastTurn(entries)!;
  assert.deepEqual(
    turnBlocks(entries, turn).map((found) => found.caption),
    ["`b.txt` — 1 hunk", "`a.txt` — 1 hunk"],
  );
});

test("a missing or malformed result contributes nothing, and the rest keep order", () => {
  const entries = [
    userEntry(),
    assistantEntry("reply", ["call-a", "call-b", "call-c"]),
    toolResultEntry("call-a", { ...block, toolCallId: "call-a", caption: "`a.txt` — 1 hunk" }),
    toolResultEntry("call-b", { nope: true }),
    toolResultEntry("call-c", { ...block, toolCallId: "call-c", caption: "`c.txt` — 1 hunk" }),
  ];
  const turn = lastTurn(entries)!;
  assert.deepEqual(
    turnBlocks(entries, turn).map((found) => found.caption),
    ["`a.txt` — 1 hunk", "`c.txt` — 1 hunk"],
  );
});

test("a call from an earlier message in the turn keeps its block", () => {
  const entries = [
    userEntry(),
    assistantEntry("handing off", ["call-1"]),
    toolResultEntry("call-1", block),
    assistantEntry("here you go"),
  ];
  const turn = lastTurn(entries)!;
  assert.deepEqual(turnBlocks(entries, turn), [block]);
});

test("an earlier turn's results are not borrowed", () => {
  const entries = [
    userEntry(),
    assistantEntry("older reply", ["call-old"]),
    toolResultEntry("call-old", { ...block, toolCallId: "call-old" }),
    userEntry("again"),
    assistantEntry("newer reply"),
  ];
  const turn = lastTurn(entries)!;
  assert.deepEqual(turnBlocks(entries, turn), []);
});

test("a result is read once even when the branch repeats it", () => {
  const entries = [
    userEntry(),
    assistantEntry("reply", ["call-1"]),
    toolResultEntry("call-1", block),
    toolResultEntry("call-1", { ...block, body: "second\n" }),
  ];
  const turn = lastTurn(entries)!;
  assert.equal(turnBlocks(entries, turn)[0]!.body, block.body);
});
