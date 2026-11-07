# pi-code-handoff

Turns a proposed change into a validated, copyable artifact — a **hand-off block** — and puts
it in a row of its own under the reply, where a picker can reach it and an applier outside pi
can consume it. The extension never writes to the target repository and never applies anything.

````text
you:    Move parseKey into src/keys.ts and hand it off.

pi:     ✓ code_handoff src/index.ts — 2 hunks        ctrl+o to show the block
        ✓ code_handoff src/keys.ts — new file, 18 lines   ctrl+o to show the block

        Both files are ready. `parseKey` moved without changing what it parses.

        — expanded by ctrl+o —

        `src/index.ts` — 2 hunks

        ```diff
        --- a/src/index.ts
        +++ b/src/index.ts
        ...
        ```
````

## Install

The usual way, from anywhere — pi clones the repository and reconciles the tag:

```sh
pi install git:github.com/jennymaeleidig/pi-code-handoff@v3.0.0
```

A tag or commit pins the install; omit it to follow the default branch. This is a personal
install, recorded in `~/.pi/agent/settings.json`, so it loads in every project.

From a checkout, which is what you want while changing the extension:

```sh
pi install "$PWD"          # personal install, recorded in ~/.pi/agent/settings.json
pi install --local "$PWD"  # this project, recorded in .pi/settings.json
pi -e ./src/index.ts       # one run only, with no install recorded
```

An absolute path, because a relative local path in a settings file resolves against that file
rather than against the shell you typed it in. `pi -e` caches the extension under
`~/.pi/agent/tmp/extensions/` and writes nothing to settings.

An installed package loads on the next start, and `/reload` picks it up in a running session.
`pi list` shows what is configured, `pi update --extensions` reconciles a git install, and
`pi remove <source>` undoes one. A project install only loads once project trust is granted.

## Ask for a hand-off

The extension registers one tool, `code_handoff`, and the assistant calls it. You ask in words:

> Rename `countDiff` to `countHunks` and hand it off.

> Add a `--strict` flag to `src/git.ts`, then hand me the command to try it.

The tool validates before it emits, so a block in a row is a block that already passed:

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

**The picker.** Press `Ctrl+Shift+C` or run `/code-handoff`. The overlay opens on the **hand-off
tab** when this reply has validated blocks, and on the Agent reply tab when it does not.

- `↑` `↓` move, `enter` copies, `esc` cancels.
- Type to filter; `backspace` erases.
- `tab` toggles to the **Agent reply tab**, `1` and `2` jump straight to either.

Each tab states how many blocks it holds, and the list's foot carries the position when there
is more than one to step through.

The hand-off tab copies the block's body and nothing else: a diff arrives on the clipboard as a
bare patch, with no fences to strip. A preview under the list shows the highlighted block's
first lines, so two similarly named paths are told apart before `enter`, and a `2/5` counter at
the list's foot appears once a reply holds more than one block, so a list you have scrolled is
not mistaken for the whole of it. The blocks are read back out of the turn's tool results, so
the tab survives `/reload` and a resumed session; it is empty when the turn handed nothing off,
and then the Agent reply tab is what is left. That tab lists what the message itself
is made of — each fenced block, table, list and quote, tagged with its kind and where it
starts — and ends with the whole reply as one item, so there is always something to take. A
fence tagged as anything but `md` — `diff`, `ts`, `bash`, or nothing at all — copies as the
code inside it: the fences are decoration around the payload, so they come off and the trailing
newline a fenced body cannot carry is put back, which is what a patch or a saved snippet wants.
An `md` fence holds a document, often one that fences blocks of its own, so it keeps its outer
fence and the blocks nested inside it arrive decorated exactly as the message has them.

**The applier.** What you paste into is yours:

- A `diff` block is a patch: `git apply -p1` from the repository root, or an applier of your
  own that consumes a patch from the clipboard. This package ships no applier.
- A `full` block is file content: save it over the path on its caption. The caption says
  "new file" when the path does not exist yet.
- A `command` block is shell: read it, then run it.

**The block on screen.** A block is a row, not message text, so nothing about it lands in the
reply's prose. `ctrl+o` expands every row (and a left click expands one), showing the block
itself — caption, fence and payload. Collapsed, the row is one line: `✓ code_handoff`, the caption,
and the hint. The reply's own text is untouched: the model did not write the block, and the block
is not written into what the model said.

**The whole reply.** `/copy`, or `Ctrl+X` when nothing is selected in fullscreen mode, copies
the last assistant message — its prose, since a block is a row rather than message text. An
expanded row is Markdown on a screen, so selecting it gives wrapped, indented text rather than
the payload: read it there, but copy it with the picker.

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

`scripts/verify-live.sh` walks a human through the part a test cannot reach: start a session
on this checkout, hand off a change, read the block in its row, expand it with `ctrl+o`, pick it
with the picker, and see that what lands on the clipboard is a patch git accepts — and that the
reply's own copy carries none of it. It works in a scratch repository, so nothing under version
control changes: the report it writes to `docs/verification/` is gitignored, and
`.pi/settings.json` is untouched. Applying a block is the applier's business — that code lives
in your dotfiles, not here — so it is out of scope. Re-run it whenever the picker or the
hand-off row changes.

The wizard exits non-zero when a check it can make fails. Anything the run contradicted in
`docs/handoff-contract.md` is not a check: the report is the record, and whether a guarantee
held is a judgement you make reading it.
