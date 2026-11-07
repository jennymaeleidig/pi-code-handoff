# The hand-off contract

What every hand-off block guarantees, and what an applier may therefore assume. The applier
itself (vim's `:DiffApply`) lives in the author's dotfiles, not in this package; this file is
the thing it is built against.

## Guarantees

A `diff` block:

- carries repo-relative paths behind `--- a/<path>` and `+++ b/<path>`, one file per block;
- passes `git apply --check -p1` from that repository's root, against the working tree as it
  stands;
- has three lines of context where the file provides them;
- has hunk headers whose counts are correct, because code counted them. That is a promise to
  the reader rather than a condition git checks, since it applies a wrong count as readily as a
  right one. A block built from an escape hatch patch is recounted and re-headed by that same
  path before it is checked.

A `full` code block is the entire file, so it applies by being saved over the target. Its
content is non-empty and ends with a newline, because a fenced Markdown body cannot carry a
final line without one; a file whose last line has no newline is handed off as a `diff`
instead. Empty content is refused rather than emitted as a block with no body.

A `command` block passes `bash -n`.

## Fences

Every hand-off block is fenced, and its fence is longer than any run of backticks inside it,
so a full-file block that contains fences of its own cannot terminate early. The length is
computed from the content rather than written by hand. A non-empty block leaves one empty
line before the closing fence, because a fenced body cannot otherwise carry a final newline:
a reader that strips the fences gets the body's trailing newline back, and a patch that lost
one is `corrupt patch` to git. That blank line serves the expanded row, where the fence is
drawn as Markdown; the picker's hand-off tab copies the body from the block itself and never
reads the fences.

The block is drawn in the row of the call that produced it: one line while collapsed, the
caption and its fence when expanded. It is never part of the reply's prose, so nothing about
the heading a section would need — its count, its rule — exists here.

## Two copy paths

- **Picker path** (`/code-handoff`, `Ctrl+Shift+C`): the hand-off tab copies the block the
  extension validated rather than re-reading rendered markdown, so a `diff` block's clipboard
  payload is a bare patch and needs no fence handling at all. That promise covers the hand-off
  tab alone: the picker's Agent reply tab reads markdown back out of the message text and promises
  no more than the message contains. It does read fences by tag, though — a code fence copies as
  its code, the fences decoration around it, while an `md` fence is a document whose own fences
  are part of it and copies whole.
- **Row path** (`ctrl+o`, or a left click): the expanded row draws the block for a human to read
  — Markdown on a screen, so its lines are wrapped and indented, and a selection is reading
  material rather than bytes. The picker is the copy path; the row is the reading path.

Only a `diff` block is an applier's input. A `full` block is for saving over the target: on
the picker path its payload is file content, and in its row its tag names a
language rather than a kind. No block body distinguishes the kinds, so the human chooses
which block to paste, and the caption above it says what it is.

## Boundaries

The extension never writes to the target repository, never applies a patch, and never chooses
a checkout — it only refuses to emit a block it could not validate. (A `command` block is
syntax-checked through a temporary file outside the repository, which is validation, not a
change.) Every code block also requires its path to sit inside a git repository, because a
`diff` block's only validation is `git apply --check`; a `full` block carries that requirement
too, so one call shape does not behave differently from another. Whether a block was applied,
and to which checkout, is the applier's business.

A block is true against the working tree at the moment it was produced. Staleness is only
detected where the diff overlaps it: an intervening edit to a diffed line or to its context
makes the block fail, while an edit elsewhere leaves it applying cleanly and possibly losing
what the second edit added. One block per path per reply.
