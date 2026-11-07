# Splice the hand-off section into the assistant message

> Superseded by [The hand-off lives in its own row](0003-the-hand-off-lives-in-its-own-row.md).
> The splice gave a block no way to be folded away, so the section buried the reply's prose;
> the block now travels as the tool result's `details` and is drawn in its own row.

A hand-off block is placed by code at the end of the assistant message rather than written by
the model, because the block's whole claim is that the bytes `git apply --check` accepted are
the bytes the human pastes: the picker reads only assistant messages, and a model asked to
retype a validated block makes the validated text and the pasted text two objects — exactly
what a small model corrupts. Pi supports the rewrite, since a `message_end` replacement is
written back into agent state before persistence, leaving the transcript, the session entry
and the picker holding the same text.

## Consequences

A hand-off block re-enters the provider's context on every later turn. Condensing old blocks
before the next request is deferred, not solved. Spliced text is machine-written, so a
reply's prose and its blocks are authored by different parties; the heading marks the seam.
