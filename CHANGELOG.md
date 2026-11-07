# Changelog

All notable changes to this package. The format follows [Keep a Changelog][], and the version
follows [Semantic Versioning][].

[keep a changelog]: https://keepachangelog.com/en/1.1.0/
[semantic versioning]: https://semver.org/spec/v2.0.0.html

## [Unreleased]

### Changed

- **A hand-off block is a row now, not message text.** The spliced `## Hand-off` section is gone:
  a block travels as its `copy_paste` tool result's `details` and is drawn in that call's row.
  Collapsed, the row is one line — `✓ copy_paste`, the caption, and `ctrl+o to show the block`;
  expanded — `ctrl+o`, or a left click — it is the block itself, caption, fence and payload.
  `renderCall` draws nothing, because pi stacks the call region above the result region and two
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

[unreleased]: https://github.com/jennymaeleidig/pi-copy-paste/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jennymaeleidig/pi-copy-paste/releases/tag/v1.0.0
