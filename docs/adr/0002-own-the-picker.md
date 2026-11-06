# Own the picker

The copy path for a hand-off block was an installed third-party clipper: its searchable block
picker was the only way to reach a block from inside pi. The original scope left the picker
outside this package — the package produced blocks, somebody else copied them.

Two things made that untenable. First, a coupling to an implementation detail: the external
extractor joins the lines between fences and drops the final newline, so
`src/handoff.ts:renderBlock` leaves one empty line before the closing fence of a non-empty
block. A guarantee of this package's contract rested on another package's string handling.
Second, a defect we could observe but not fix: the external fence scanner closes a shorter
block on a longer fence, then over-eats to the end of the message on the leftover fence. A
reply that shows fenced markdown — which `fenceLength` exists to support — ended with the
hand-off section buried inside one unlabelled item.

The slice of that tool this package actually needs is small: read the last assistant text,
find fenced blocks, copy. What made it a package was a table cell grid, a line-range selector,
and three block kinds this package never emits.

## Decision

Ship the picker here. `/copy-paste` and `ctrl+shift+c` always open it, on a **hand-off tab**
listing the blocks `copy_paste` validated during this reply, copied from memory as their exact
bodies, with an **Agent reply tab** listing the reply's own markdown blocks — fenced code, tables,
lists and blockquotes — for everything else.

Rejected:

- **Fork the external package.** It carries a cell grid and a line-range selector this package
  does not need, plus a maintenance duty towards code this repository does not control.
- **Vendor only the extractor.** Leaves the picker external, so the coupling stays and the
  scanner defect stays with it.
- **Fix it upstream.** Their tests pin the no-trailing-newline payload, so preserving the final
  newline is a semantics change to a tool this repository does not own.
- **Keep it external.** Makes the blank line before the closing fence permanent and
  unverifiable from here.

## Consequences

- The hand-off tab copies `HandoffBlock.body` directly, so the clipboard payload no longer
  depends on how any markdown scanner treats a fence. The blank line before the closing fence
  now serves the whole-reply path alone (`/copy`, `ctrl+x`); the contract states the rule and
  its reason.
- The hand-off tab reads blocks the extension holds in memory, so the list is written to the
  session once per assistant message. The Agent reply tab covers the case where that list is
  absent — a reply from before this extension was installed, or one whose entry does not match
  the message's timestamp — which makes it load-bearing rather than decorative.
- This repository now owns a fence scanner, so a close longer than its opener, a close carrying
  an info string, and an unterminated block each need a test.
- `Picker` in `GLOSSARY.md` stops meaning somebody else's overlay.

## Work

The fence scanner shipped as #9 and the picker as #10. #10 also expired the follow-ups these
claims listed: the contract's "not yet shipped" caveat is gone and `GLOSSARY.md` states the
picker in the present tense. Whether the external clipper can now be removed is the live
verification in #8.
