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
- has hunk headers whose counts are correct, because code counted them. A block built from an
  escape hatch patch is recounted and re-headed by that same path before it is checked.

A `full` code block is the entire file, so it applies by being saved over the target.

A `command` block passes `bash -n`.

## Fences

Every hand-off block is fenced, and its fence is longer than any run of backticks inside it,
so a full-file block that contains fences of its own cannot terminate early. The length is
computed from the content rather than written by hand.

## Two copy paths

- **Picker path** (`pi-clip`): the block body arrives with the fences stripped, so a `diff`
  block's clipboard payload is a bare patch and needs no fence handling at all.
- **Whole-reply path** (`/copy`, `Ctrl+X`): the fences come along, so strip one leading fence
  together with the tag that follows it, and the trailing run, which is at least as long as
  the leading one.

Only a `diff` block is an applier's input. A `full` block is for saving over the target: on
the picker path its payload is file content, and on the whole-reply path its tag names a
language rather than a kind. No block body distinguishes the kinds, so the human chooses
which block to paste, and the caption above it says what it is.

## Boundaries

The extension never writes to disk, never applies a patch, and never picks a repository — it
only refuses to emit a block it could not validate. Whether a block was applied, and to which
checkout, is the applier's business.

A block is true against the working tree at the moment it was produced, so a block produced
before an intervening edit is stale: applying it is expected to fail rather than to merge. One
block per path per reply.
