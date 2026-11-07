# The hand-off lives in its own row

[Splice the hand-off section into the assistant message](0001-splice-the-hand-off-section.md)
put a turn's blocks at the end of the assistant message, so the bytes `git apply --check`
accepted and the bytes a human picked were one object. It worked, and it cost the transcript:
the section is message text, so it can only be read, never folded away. A reply handing off a
200-line file buried its own prose under the diff, and a long enough section pushed the answer
off the screen at the moment the turn ended.

Message text cannot be collapsed. Pi's `AssistantMessageComponent` has no `setExpanded`, so
`ctrl+o` — the one gesture that folds a row — never reaches it, and a display-only Markdown
transformer has no `expanded` to read and nothing that repaints it. A block that can be folded
has to be a _row_: a tool result, a custom entry, or a custom message. Everything else about the
splice was working, so what moves is where the block is drawn, not what validates it.

## Decision

A block belongs to the `copy_paste` call that produced it, and is drawn in that call's row. The
assistant message keeps its prose and nothing else.

- The block travels as the tool result's `details`, which is already the shape a result uses to
  describe itself and already persisted with the turn. No custom entry, no splice, no key tying
  the block to a message.
- Collapsed, the row is one line: `✓ copy_paste`, the caption the picker already lists, and the
  keybinding hint in the user's own binding. pi stacks the call region above the result region,
  so the call slot renders nothing — `renderCall` returns an empty `Container` — and the single
  line is the result's. Expanded, the row reads like any other tool's — `✓ copy_paste`, then the
  block: caption, fence, payload, formatted by the same `renderBlock` the row has always used, so
  nothing is retyped for display. The picker copies `HandoffBlock.body`, the payload under that
  caption.
- Expansion is pi's own: `ctrl+o`, and a left click on the row. No new keybinding, no patched
  component, no private field.
- The picker reads the last turn's blocks out of its tool results, matched by call id. A turn is
  what a user message opens, because a tool-using turn has several assistant messages and the
  calls live in an earlier one than the prose.

## Consequences

- Transcript selection and `/copy` no longer carry a block; the block is a row, and rows are not
  message text. Intended: prose is prose. The picker is the copy path, and `ctrl+shift+c` copies
  a payload the extension validated rather than one scraped back out of rendered Markdown. An
  expanded row is Markdown on a screen, so it wraps and indents: it is the reading path.
- Another extension may still decline to draw this row. `pi-zentui`'s tool display takes a custom
  tool only when that tool defines no renderers, and only then if the user opted the tool in; a
  user who forces `overrideExistingRenderers` gets zentui's `output:` view of the verdict instead
  of the block. `pi-compact-transcript` collapses the row to one line and hands expansion to
  `renderResult`, which is this renderer.
- A block no longer re-enters the provider's context on every later turn. ADR 0001 recorded that
  as a consequence it deferred; moving the block out of the message resolves it.
- Export and any tool reading the message see prose only. A reader that wants a block reads the
  tool result.
- The row is the only place a block is drawn, so `renderBlock` has one consumer: our renderer.
  A renderer that replaces this row — `pi-compact-transcript` does while the row is collapsed —
  shows the result's text instead, which is why that text is short and about validation alone.
