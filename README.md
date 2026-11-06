# pi-copy-paste

Turns a proposed change into a validated, copyable artifact — a **hand-off block** — and puts
it in the assistant's reply, where a picker can reach it and an applier outside pi can consume
it. The extension never writes to the target repository and never applies anything.

````text
you:    Move parseKey into src/keys.ts and hand it off.

pi:     Validated src/index.ts: 2 hunks, 3 insertions, 4 deletions. git apply --check passed.
        Validated src/keys.ts: new file, 18 lines.

        ---

        ## Hand-off

        `src/index.ts` — 2 hunks

        --- a/src/index.ts
        +++ b/src/index.ts
        ...

        `src/keys.ts` — new file, 18 lines

        ```ts
        ...
        ```
````

## Install

From this checkout:

```sh
pi install "$PWD"          # personal install, recorded in ~/.pi/agent/settings.json
pi install --local "$PWD"  # this project, recorded in .pi/settings.json
pi -e ./src/index.ts       # one run only, with no install recorded
```

An absolute path, because a relative local path in a settings file resolves against that file
rather than against the shell you typed it in. `pi -e` caches the extension under
`~/.pi/agent/tmp/extensions/` and writes nothing to settings.

An installed package loads on the next start, and `/reload` picks it up in a running session.
`pi list` shows what is configured, and `pi remove <source>` undoes an install. A project
install only loads once project trust is granted.

## Ask for a hand-off

The extension registers one tool, `copy_paste`, and the assistant calls it. You ask in words:

> Rename `countDiff` to `countHunks` and hand it off.

> Add a `--strict` flag to `src/git.ts`, then hand me the command to try it.

The tool validates before it emits, so a block in the reply is a block that already passed:

| The change                          | The block                                          |
| ----------------------------------- | -------------------------------------------------- |
| `replacements`, or `content` diffs  | `diff` — counted hunks, `git apply --check -p1` ok |
| `content` with `form: "full"`       | the whole file, for a new file or a rewrite        |
| `patch` — raw unified-diff hunks    | `diff` — recounted, re-headed, and checked         |
| `command` with a one-line `purpose` | a `bash` block that passed `bash -n`               |

If validation fails, the assistant gets the failure back inside the same turn — this package's
refusal, or git's and bash's own words when they have them — and repairs instead of handing you
a block that will not apply. The target must sit inside a git repository. One block per path
per reply: the second block for the same file would be a guess about a file the first block is
about to change.

Every block carries a one-line caption above its fence naming the path it touches, or the
purpose of the command it carries. That caption is what the picker lists.

## Take the block

**The picker.** Press `Ctrl+Shift+C` or run `/copy-paste`. The overlay opens on the **hand-off
tab** when this reply has validated blocks, and on the Agent reply tab when it does not.

- `↑` `↓` move, `enter` copies, `esc` cancels.
- Type to filter; `backspace` erases.
- `tab` toggles to the **Agent reply tab**, `1` and `2` jump straight to either.

The hand-off tab copies the block's body and nothing else: a diff arrives on the clipboard as a
bare patch, with no fences to strip. A preview under the list shows the highlighted block's
first lines, so two similarly named paths are told apart before `enter`. The blocks are
restored from the session entry written with the reply, so the tab survives `/reload` and a
resumed session; it is empty only when that entry is missing or does not match the reply — one
from before the install, or a message
with no timestamp — and then the Agent reply tab is what is left. That tab copies markdown read
back out of the message, fences included.

**The applier.** What you paste into is yours:

- A `diff` block is a patch: `git apply -p1` from the repository root, or an applier of your
  own that consumes a patch from the clipboard. This package ships no applier.
- A `full` block is file content: save it over the path on its caption. The caption says
  "new file" when the path does not exist yet.
- A `command` block is shell: read it, then run it.

**The whole reply.** `/copy`, or `Ctrl+X` when nothing is selected in fullscreen mode, copies
the last assistant message with its fences intact, so the fence handling is the applier's or
yours. To strip it by hand, drop the leading fence and its tag line, the closing run of
backticks, and the empty line the block leaves before that run — what remains is the body byte
for byte, trailing newline included.

## What a block guarantees

The standing statement is [`docs/handoff-contract.md`](docs/handoff-contract.md), and the
vocabulary is [`GLOSSARY.md`](GLOSSARY.md). Read them there rather than in a second summary
that can drift.

Two things are worth knowing before you paste. A block is true against the working tree at the
moment it was produced: a later edit to a diffed line or its context makes it fail, while an
edit elsewhere leaves it applying and possibly losing what that edit added. And the extension
neither writes to the repository nor applies anything — it refuses to emit a block it could not
validate, and that is the whole of its authority.

## Development

Node 22 (see `mise.toml`). `npm install`, then `npm test`, `npm run typecheck`, or
`npm run format:check`. `AGENTS.md` covers loading the working copy for a session.

### Live verification

`scripts/verify-live.sh` walks a human through the part a test cannot reach: install the
extension in a real session, hand off a change, pick the block with the picker, and see that
what lands on the clipboard is a patch git accepts and that the whole-reply path strips to the
same bytes. It works in a scratch repository, so nothing under version control changes: the
report it writes to `docs/verification/` is gitignored, and `.pi/settings.json` is untouched.
Applying a block is the applier's business — that code lives in your dotfiles, not here — so it
is out of scope. Re-run it whenever the picker, the hand-off section or the splice changes.

The wizard exits non-zero when a check it can make fails. Anything the run contradicted in
`docs/handoff-contract.md` is different: it is written into the report and left to you, because
whether a guarantee held is a judgement about prose, not a check.
