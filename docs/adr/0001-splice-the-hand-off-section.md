# Splice the hand-off section into the assistant message

A hand-off block is placed by a `message_end` handler rather than written by the model, because
the block's whole claim is that the bytes `git apply --check` accepted are the bytes the human
pastes. `pi-clip`'s picker reads only assistant messages, so a block returned from a tool result is
unreachable; and a model asked to retype a validated block makes the validated text and the pasted
text two different objects — precisely what a small model corrupts. Splice keeps them one object.
The rewrite is supported: pi writes the `message_end` replacement back into agent state before
persisting, so the transcript, the session entry, and the picker all see the same text.

## Consequences

A hand-off block now re-enters the provider's context on every later turn. Condensing old blocks
before the next request is deferred, not solved. Spliced text is machine-written, so a reply's prose
and its blocks are authored by different parties; the `## Hand-off` heading marks the seam.
