# Changelog

All notable changes to this package. The format follows [Keep a Changelog][], and the version
follows [Semantic Versioning][].

[keep a changelog]: https://keepachangelog.com/en/1.1.0/
[semantic versioning]: https://semver.org/spec/v2.0.0.html

## [Unreleased]

## [3.0.0] - 2026-11-07

The package, the tool and the command are now named for what they hand off rather than for how
the result is copied. Nothing about a block moves: same schema, same validation, same row, same
picker, same payloads. Only the strings that name the surface changed.

### Changed

- **The tool is `code_handoff`, not `copy_paste`.** It names the artifact the model produces
  instead of the keystroke that later copies it, and it no longer claims a clipboard it never
  touches: the row is the reading path and the picker is the copy path, as they have been since
  2.0.0. A call to the old name is an unknown tool. See
  `docs/adr/0004-name-the-surface-code-handoff.md`.
- **The package is `pi-code-handoff`**, and with it the install source:
  `pi install git:github.com/jennymaeleidig/pi-code-handoff`. GitHub redirects the old URL, so an
  existing clone keeps fetching, but `pi remove` followed by `pi install` is what leaves one
  entry in `settings.json` rather than two.
- **The command is `/code-handoff`**, and the tool's label is `Code Handoff`. `Ctrl+Shift+C` is
  unchanged, and so is every word the overlay itself says: the tab still copies, `enter` still
  says `copy`, and the title still reads `Copy`. Those describe the clipboard, not the tool.
- **No compatibility for the old tool name.** A turn recorded before this release keeps its tool
  results, but the picker's hand-off tab scans for `code_handoff` calls, so a resumed pre-3.0.0
  session finds none and opens on its Agent reply tab instead. The blocks are still in the
  transcript; they are no longer one of the tab's sources.
- **The name lives in one place.** `TOOL_NAME` and `COMMAND_NAME` are exported from
  `src/handoff.ts`; the registration, the model-facing guideline, the row title, the refusal
  text and the session scan all read them, so the name the model is told and the name the picker
  scans for cannot drift apart.

## [2.0.0] - 2026-11-07

A hand-off block is its own row now, so the reply is prose and only prose. This is a major
version because the whole-reply path the contract used to promise is retired: `/copy` no longer
hands you a block to strip by hand, and the splice is gone.

### Changed

- **A hand-off block is a row now, not message text.** The spliced `## Hand-off` section is gone:
  a block travels as its `copy_paste` tool result's `details` and is drawn in that call's row.
  Collapsed, the row is one line — `✓ copy_paste`, the caption, and `ctrl+o to show the block`;
  expanded — `ctrl+o`, or a left click — it is the tool's name and then the block itself, caption,
  fence and payload, so it reads like any other row. `renderCall` draws nothing, because pi stacks the call region above the result region and two
  slots would mean two lines. The reply is prose and only prose, so a long hand-off no longer
  buries the answer, and a block no longer re-enters the model's context on every later turn.
- **The picker reads blocks out of the turn's tool results**, matched by call id, so there is no
  custom session entry to write, no timestamp to match, and no way for a stale entry to feed a
  newer turn. A turn is bounded by user messages, which is what a turn with several assistant
  messages needs; a branch with no user message falls back to its last assistant message rather
  than to every block it ever produced.
- **`/copy` and transcript selection no longer carry a block.** Intended: the row is the reading
  path and the picker is the copy path. Export and any reader that wants a block reads its result;
  an expanded row is Markdown on a screen, so a selection from it wraps and indents.
- **The picker's Agent reply tab copies a code block as code.** A fence tagged as anything but
  `md` — `diff`, `ts`, `bash`, or nothing at all — now contributes its body alone, with the
  trailing newline a fenced body cannot carry put back, so a patch or a snippet arrives
  pasteable instead of wrapped in backticks. An `md` fence is a document whose own fences are
  part of it and still copies whole, its nested blocks decorated as the message has them. The
  hand-off tab is untouched: it copies the validated body and has always done so.

## [1.0.0] - 2026-11-06

The first release: a change can be handed off, picked out of the reply and pasted into an
applier, with the text guaranteed to apply before it ever reaches the clipboard.

### Added

- **The `copy_paste` tool**, which validates a change against a real `git apply --check` before
  accepting it. Three input shapes: replacements against a file's current text, a unified patch
  for anything replacements cannot express, and whole-file content for a new file. Every refusal
  names the rule it broke and quotes the line, so the model can retry in the same turn.
- **The hand-off section**, spliced into the end of the assistant message as a run of fenced
  blocks under a counted heading — `## Hand-off — 2 blocks` — each with a caption naming the
  path it touches or the command it carries. The block body is fenced longer than any backtick
  run inside it, so a full-file block containing fences of its own cannot terminate early.
- **The picker** (`/copy-paste` or `Ctrl+Shift+C`), with a Hand-off tab that copies the block
  body alone — a bare patch, no fence to strip by hand — and an Agent reply tab that reads the
  message's own markdown back out of the text, ending with the whole reply as one item. Both
  tabs carry their block count, the list previews the highlighted block, and the selected row's
  position appears when the list outgrows its window.
- **Hand-off persistence**: the blocks are written to the session as a custom entry tied to the
  message's timestamp, so the picker survives `/reload` and a resumed session instead of
  degrading to the Agent reply tab.
- **`scripts/verify-live.sh`**, a seven-stage wizard for the part a test cannot reach: install
  the extension in a real session, hand off a change, pick the block, check that what reached
  the clipboard is a patch `git apply --check` accepts, and record the reflow. It works in a
  throwaway repository and reports to `docs/verification/`, which is gitignored.

### Documented

- `README.md`: install, asking for a hand-off, and what a human does with the block.
- `docs/handoff-contract.md`: what the reply promises — fences, trailing newlines, captions and
  the rule that separates the section from the prose.
- `GLOSSARY.md` and two ADRs: the vocabulary (Block, Form, Kind, Picker, Reflow) and the two
  design decisions behind the picker — the splice, and owning the picker rather than delegating
  to an external clipper.

[unreleased]: https://github.com/jennymaeleidig/pi-code-handoff/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/jennymaeleidig/pi-code-handoff/releases/tag/v3.0.0
[2.0.0]: https://github.com/jennymaeleidig/pi-code-handoff/releases/tag/v2.0.0
[1.0.0]: https://github.com/jennymaeleidig/pi-code-handoff/releases/tag/v1.0.0
