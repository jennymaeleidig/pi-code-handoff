# pi-copy-paste

Turns a proposed change into a validated, copyable artifact — a hand-off block — and puts it
in the assistant's reply, where a picker can reach it and an applier can consume it. The
extension never writes to the target repository.

## Language

**Hand-off block**:
One fenced artifact in an assistant reply that a human copies out and applies outside pi.
_Avoid_: Snippet, patch output, copy block

**Hand-off section**:
The rule, the heading, and every block placed in one assistant message, in tool-call order.
Absent when a turn produced no blocks.
_Avoid_: Footer, appendix, block dump

**Caption**:
The one line immediately above a block's fence, naming the path the block touches or the
purpose of the command it carries. Every block has its own.
_Avoid_: Title, label, header

**Splice**:
Placing a hand-off block into the assistant message itself, so the bytes validated and the
bytes picked are one object.
_Avoid_: Append, inject, patch message

**Reflow**:
What the screen does when the spliced hand-off section replaces the message at the end of a
turn — a jump, a scroll, a repaint — and whether it is acceptable.
_Avoid_: Repaint, flicker, re-render

**Kind**:
What a block carries: code or command.
_Avoid_: Type, category

**Form**:
For code, whether a block carries hunks (`diff`) or the file entire (`full`).
_Avoid_: Format, shape, mode

**Replacement**:
One search/replacement pair supplied for a `diff` block, which must match exactly once.
_Avoid_: Edit, patch hunk, search-replace

**Escape hatch patch**:
Raw unified-diff hunks written by the model for a change replacements cannot express,
validated like any other block.
_Avoid_: Raw diff, manual patch, fallback

**Verdict**:
The tool's short answer: what the call produced, and whether validation passed. Never the
block.
_Avoid_: Result, output, summary

**Contract**:
`docs/handoff-contract.md`, the standing statement of what every block guarantees; a block
meets the contract when those guarantees hold.
_Avoid_: Spec, format rules

**Applier**:
The command outside pi that consumes a block from the clipboard. It lives in the author's
dotfiles; this package only promises what it receives.
_Avoid_: Consumer, patcher, DiffApply

**Picker**:
`/copy-paste`'s overlay, the copy path that reaches a block from inside pi: a hand-off tab
listing this reply's validated blocks, and an Agent reply tab listing the reply's own markdown
blocks.
_Avoid_: Clip, copy menu

**Hand-off tab**:
The picker's default tab: this reply's hand-off blocks by caption, each copied as its bare
body — its payload.
_Avoid_: Block list, picker list

**Payload**:
The exact text a picker item copies: a hand-off block's body alone, without its caption or
fences; on the Agent reply tab, the block's source markdown.
_Avoid_: Content, clipboard text

**Agent reply tab**:
The picker's second tab, keyed `parsed` in the code: the reply's own fenced code, tables, lists
and blockquotes, read back out of the message text. The fallback when the hand-off tab has
nothing.
_Avoid_: Parsed tab, raw view, fallback tab

**Fence length**:
How many backticks a block's fence carries — a property of the block's content, not a house
style.
_Avoid_: Fence, delimiter, backtick count
