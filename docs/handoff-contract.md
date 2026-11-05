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
content ends with a newline (an empty file is the one exception), because a fenced Markdown
body cannot carry a final line without one; a file whose last line has no newline is handed
off as a `diff` instead.

A `command` block passes `bash -n`.

## Fences

Every hand-off block is fenced, and its fence is longer than any run of backticks inside it,
so a full-file block that contains fences of its own cannot terminate early. The length is
computed from the content rather than written by hand. A non-empty block leaves one empty
line before the closing fence, so a picker that joins the lines between fences still hands
over a body with its trailing newline — a patch without one is `corrupt patch` to git.

## Two copy paths

- **Picker path** (`pi-clip`): the block body arrives with the fences stripped, so a `diff`
  block's clipboard payload is a bare patch and needs no fence handling at all. The empty line
  before the closing fence is what preserves the payload's final newline.
- **Whole-reply path** (`/copy`, `Ctrl+X`): the fences come along, so strip one leading fence
  together with the tag that follows it, and the trailing run, which is at least as long as
  the leading one.

Only a `diff` block is an applier's input. A `full` block is for saving over the target: on
the picker path its payload is file content, and on the whole-reply path its tag names a
language rather than a kind. No block body distinguishes the kinds, so the human chooses
which block to paste, and the caption above it says what it is.

## Boundaries

The extension never writes to the target repository, never applies a patch, and never chooses
a checkout — it only refuses to emit a block it could not validate. (A `command` block is
syntax-checked through a temporary file outside the repository, which is validation, not a
change.) Whether a block was applied, and to which checkout, is the applier's business.

A block is true against the working tree at the moment it was produced. Staleness is only
detected where the diff overlaps it: an intervening edit to a diffed line or to its context
makes the block fail, while an edit elsewhere leaves it applying cleanly and possibly losing
what the second edit added. One block per path per reply.
