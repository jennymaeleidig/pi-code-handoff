# The hand-off contract

What every hand-off block guarantees, and what an applier may therefore assume. The applier
itself (vim's `:DiffApply`) lives in the author's dotfiles, not in this package; this file is
the thing it is built against.

## Guarantees

A `diff` block:

- carries repo-relative paths behind `--- a/<path>` and `+++ b/<path>`, one file;
- passes `git apply --check -p1` from that repository's root against the working tree as it
  stands at the moment the block was produced;
- has three lines of context where the file provides them;
- has hunk headers whose counts are correct, because code counted them.

A `full` block carrying code is the entire file, so it applies by being saved over the target.

A `command` block passes `bash -n`.

## Fences

Every hand-off block is fenced, and the fence is the longest backtick run inside the block
plus one, never fewer than three. Nothing inside a hand-off block is fenced with tildes, and
no line inside it is fenced by hand.

Two copy paths exist and both work:

- **Picker path** (`pi-clip`): the block body arrives with the fences stripped, so the
  clipboard holds a bare patch. An applier receiving this needs no fence handling at all.
- **Whole-reply path** (`/copy`, `Ctrl+X`): the fences come along. An applier receiving this
  should strip one leading fence whose tag follows it, and its trailing partner.

## Boundaries

The extension never writes to disk, never applies a patch, and never picks a repository — it
only refuses to emit a block it could not validate. Whether a block was applied, and to which
checkout, is the applier's business.

A block is true against the working tree at the moment it was produced. A block produced
before an intervening edit is stale, and applying it is expected to fail rather than to
merge. One block per path per reply.
