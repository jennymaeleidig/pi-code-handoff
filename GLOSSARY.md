# pi-copy-paste

Turns a proposed change into a validated, copyable artifact — a hand-off block — and puts it
in the assistant's reply, where a picker can reach it and an applier can consume it. The
extension never writes to disk.

## Language

**Hand-off block**:
One fenced artifact in an assistant reply that a human copies out and applies outside pi.
_Avoid_: Snippet, patch output, copy block

**Hand-off section**:
The `## Hand-off` heading plus every block spliced into one assistant message, in tool-call
order. Absent when a turn produced no blocks.
_Avoid_: Footer, appendix, block dump

**Caption**:
The single line between the hand-off heading and a block's fence, naming the path the block
touches or the purpose of the command it carries.
_Avoid_: Title, label, header

**Splice**:
The `message_end` rewrite that places the hand-off section into the finalized assistant
message, so the validated bytes and the pickable bytes are one object.
_Avoid_: Append, inject, patch message

**Kind**:
What a block carries: code or command. It selects the validator.
_Avoid_: Type, mode

**Form**:
For `code`, whether the block carries hunks (`diff`) or the file entire (`full`).
_Avoid_: Format, shape, mode

**Replacement**:
One search/replacement pair supplied for a `diff` block. It must match exactly once.
_Avoid_: Edit, patch hunk, search-replace

**Escape hatch patch**:
Raw unified-diff hunks written by the model itself, for a change replacements cannot express.
Validated identically to a generated one.
_Avoid_: Raw diff, manual patch, fallback

**Verdict**:
The tool's short result: counts, and the applier's answer. Never the block.
_Avoid_: Result, output, summary

**Contract**:
The guarantee every block satisfies — repo-relative `a/`/`b/` paths, and `git apply --check`
passes against the working tree as it stands.
_Avoid_: Spec, format rules

**Applier**:
The command outside pi that consumes a block from the clipboard. Lives in the user's
dotfiles; this package only guarantees what it receives.
_Avoid_: Consumer, patcher, DiffApply

**Picker**:
`pi-clip`'s block selector, the only path reaching a hand-off block. It reads assistant
messages, never tool results.
_Avoid_: Clip, copy menu

**Fence length**:
The number of backticks in a block's fence: the longest run of backticks inside the block,
plus one, never fewer than three.
_Avoid_: Fence, delimiter, backtick count
