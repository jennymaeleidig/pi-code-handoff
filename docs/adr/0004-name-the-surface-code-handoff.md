# Name the surface for what it hands off

`copy_paste` named the copy path. Since [the hand-off lives in its own
row](0003-the-hand-off-lives-in-its-own-row.md) that is no longer what the tool does: a block is
a row, the row is the reading path, and the picker is the copy path. The tool never touches the
clipboard at all — it validates a change and draws it where a human can reach it. A name that
promises the verb of some other component is a name that has to be explained.

It also contradicted the vocabulary the package enforces. `GLOSSARY.md` has said **hand-off
block** from the first release, and every claim in `docs/handoff-contract.md` is about "every
hand-off block". The one string the model is told to call said neither word. Meanwhile the three
surfaces spelled the idea three ways — `pi-copy-paste` the package, `/copy-paste` the command,
`copy_paste` the tool — so a search for one missed the others, and a rename meant three
decisions.

## Decision

All three surfaces take one name: `pi-code-handoff`, `/code-handoff`, `code_handoff`, and the
tool's label `Code Handoff`.

- **`code_handoff` over `hand_off_to_user`.** The audience is already implied: everything in pi
  is drawn for the human. What the model needs from a tool name is the act, and "hand off to the
  user" reads as "stop the turn and ask a question" — an affordance pi already has, and not this
  one. The rejected name would also stretch every collapsed row, where the name is the first
  thing on the line, before the caption and the `ctrl+o` hint.
- **`code_handoff` over `handoff`.** A `command` block is not a code block, so "code" does
  narrow: the tool takes `kind: "code"` and `kind: "command"` both. Shell is code, and the
  package and command are named `code-handoff` too; one name across three surfaces is worth more
  than the word "code" leaves out.
- **A hard cut.** Nothing answers to `copy_paste`, no alias is registered, and the session scan
  matches `TOOL_NAME` alone. A compatibility shim would keep the old word in the codebase for
  one release and would have to decide what an old turn's row is called.
- **One place for the name.** `TOOL_NAME` and `COMMAND_NAME` live in `src/handoff.ts`, which
  both `src/index.ts` and `src/session.ts` already import. Registration, the guideline the model
  reads, the row title, the refusal text and the session scan all read them: a mismatch between
  the first and the last is silent — the picker just finds nothing — so it must not be spellable.
- **The clipboard keeps its own words.** The overlay's title `Copy`, `enter` → `copy`, "Nothing
  to copy", and pi's own `/copy` are unchanged. They describe what the picker does with a block,
  which did not change, and renaming them would say "hand off" where the user's action is
  "copy".

## Consequences

- A turn recorded before 3.0.0 keeps its tool results, but the picker's hand-off tab scans for
  `code_handoff` calls and finds none, so a resumed pre-3.0.0 session opens on its Agent reply
  tab. The blocks are still in the transcript, and a new turn restores the tab.
- The install source changes, which is the one thing a rename cannot do quietly. GitHub
  redirects the old URL, so an existing clone keeps fetching; `pi remove` then `pi install`
  leaves one entry in `settings.json` rather than an old source and a new one, since pi keys its
  clone cache and its version record on the source string.
- The tests hold the literal name rather than `TOOL_NAME`: `test/code-handoff.test.ts` asserts
  what `registerTool` registered and `test/helpers.ts` builds session entries with the raw
  string, the way a recorded turn has it. Reading the constant there would let it drift and
  still pass.
- The git history, the ADRs before this one, and the reports in `docs/verification/` keep the
  old name. They are records of what was true when they were written, and rewriting them would
  make them lie.
