# pi-code-handoff

Turns a proposed change into a validated, copyable artifact — a hand-off block — and puts it
in a row of its own under the reply, where a picker can reach it and an applier can consume it.
The extension never writes to the target repository.

## Language

**Hand-off block**:
One fenced artifact, drawn in the tool row of the `code_handoff` call that produced it, that a
human copies out and applies outside pi.
_Avoid_: Snippet, patch output, copy block

**Hand-off row**:
The tool row that draws one block: a single line while collapsed, the block itself when
expanded. The block's only presentation, and never message text.
_Avoid_: Section, footer, appendix, block dump

**Expanded**:
Whether a hand-off row is showing its block. Pi's `ctrl+o` toggles every row at once, and a left
click toggles one.
_Avoid_: Open, unfolded, shown

**Caption**:
The one line immediately above a block's fence, naming the path the block touches or the
purpose of the command it carries. Every block has its own.
_Avoid_: Title, label, header

**Splice**:
What this package used to do: place a hand-off block into the assistant message itself. Retired
— see `docs/adr/0003-the-hand-off-lives-in-its-own-row.md`; a block is a row now.
_Avoid_: Append, inject, patch message

**Turn**:
What a user message opens and the next one closes. A tool-using turn has several assistant
messages, so the turn — not the last message — is the unit the picker reads blocks from.
_Avoid_: Reply, exchange, round

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
`/code-handoff`'s overlay, the copy path that reaches a block from inside pi: a hand-off tab
listing this reply's validated blocks, an Agent reply tab listing the reply's own markdown
blocks, a count in brackets on each tab, a preview of the highlighted block, and a position
counter once there is more than one block to tell apart.
_Avoid_: Clip, copy menu

**Hand-off tab**:
The picker's default tab: this reply's hand-off blocks by caption, each copied as its bare
body — its payload.
_Avoid_: Block list, picker list

**Payload**:
The exact text a picker item copies: a hand-off block's body alone, without its caption or
fences; on the Agent reply tab, a fenced block's body — fences off for code, fences on for a
document — and the source of a table, list or quote.
_Avoid_: Content, clipboard text

**Agent reply tab**:
The picker's second tab, keyed `parsed` in the code: the reply's own fenced code, tables, lists
and blockquotes, read back out of the message text, followed by the whole reply as one item.
Its fenced blocks split by tag: a code fence copies as code, its own fences dropped, while an
`md` fence is a document and copies whole, its nested blocks still decorated. The whole-reply
item is a copy of the message rather than one of its blocks, so it is not counted in the tab's
total. The fallback when the hand-off tab has nothing.
_Avoid_: Parsed tab, raw view, fallback tab

**Fence length**:
How many backticks a block's fence carries — a property of the block's content, not a house
style.
_Avoid_: Fence, delimiter, backtick count
