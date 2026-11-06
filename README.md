# pi-copy-paste

Turns a proposed change into a validated, copyable artifact — a **hand-off block** — and puts
it in the assistant's reply, where a picker can reach it and an applier outside pi can consume
it. The extension never writes to the target repository and never applies anything.

````text
you:    Move parseKey into src/keys.ts and hand it off.

pi:     Validated src/index.ts: 2 hunks, 3 insertions, 4 deletions. git apply --check passed.
        Validated src/keys.ts: full file, 18 lines.

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

From this checkout, one of:

```sh
pi install ./pi-copy-paste          # personal: writes ~/.pi/agent/settings.json
pi install --local ./pi-copy-paste  # this project: writes .pi/settings.json
pi -e ./pi-copy-paste/src/index.ts  # one run only, nothing written
```

An installed package loads on the next start; `/reload` picks it up in a running session.
`pi list` shows what is configured, and `pi remove <source>` undoes an install.

A project install (`.pi/settings.json`) only loads after project trust is granted. Adding
`./pi-copy-paste` to this repository's own `.pi/settings.json` is a temporary dogfooding
harness, not repo state — revert it before committing.

## Ask for a hand-off

The extension registers one tool, `copy_paste`, and the assistant calls it. You ask in words:

> Rename `countDiff` to `countHunks` and hand it off.

> Add a `--strict` flag to `src/git.ts`, then hand me the command to try it.

The tool validates before it emits, so a block in the reply is a block that already passed:

| The change                          | The block                                          |
| ----------------------------------- | -------------------------------------------------- |
| `replacements`, or `content` diffs  | `diff` — counted hunks, `git apply --check -p1` ok |
| `content` with `form: "full"`       | the whole file, for a new file or a rewrite        |
| `command` with a one-line `purpose` | a `bash` block that passed `bash -n`               |

If validation fails, the assistant gets git's or bash's own error back and repairs inside the
same turn instead of handing you a block that will not apply. The target has to sit inside a
git repository. One block per path per reply: the second block for the same file would be a
guess about a file the first block is about to change.

Every block carries a one-line caption above its fence naming the path it touches, or the
purpose of the command it carries. That caption is what the picker lists.

## Take the block

**The picker.** Press `Ctrl+Shift+C` or run `/copy-paste`. The overlay opens on the **hand-off
tab**, listing this reply's validated blocks by caption.

- `↑` `↓` move, `enter` copies, `esc` cancels.
- Type to filter; `backspace` erases.
- `tab` toggles to the **parsed tab**, `1` and `2` jump straight to either.

The hand-off tab copies the block's body and nothing else: a diff arrives on the clipboard as a
bare patch, with no fences to strip. The parsed tab is the fallback for a reply whose hand-off
list is not available — a reply from before the install, a resumed session — and it copies
markdown read back out of the message, fences included.

**The applier.** What you paste into is yours:

- A `diff` block is a patch: `git apply -p1` from the repository root, or an applier of your
  own that consumes a patch from the clipboard. This package ships no applier.
- A `full` block is file content: save it over the path on its caption. The caption says
  "new file" when the path does not exist yet.
- A `command` block is shell: read it, then run it.

**The whole reply.** `/copy` or `Ctrl+X` copies the last assistant message with its fences
intact. To get a bare patch, strip the leading fence together with its tag line and the
closing run of backticks. A non-empty block leaves one empty line before its closing fence, so
the stripped body still ends with the newline a patch needs.

## What a block guarantees

The standing statement is [`docs/handoff-contract.md`](docs/handoff-contract.md); the
vocabulary is [`GLOSSARY.md`](GLOSSARY.md). In short:

- A `diff` block passes `git apply --check -p1` against the working tree as it stands when the
  block was produced. A later edit that touches a diffed line or its context makes it fail; an
  edit elsewhere leaves it applying and possibly losing what the other edit added.
- A `full` block is non-empty and ends with a newline. A file whose last line has no newline
  is handed off as a `diff`.
- A `command` block passes `bash -n`.
- Fences are computed from the content, so a full-file block containing fences of its own
  cannot terminate early.

## Development

Node 22 (see `mise.toml`).

```sh
npm install
npm test              # node --test over test/**/*.test.ts
npm run typecheck     # tsc --noEmit
npm run format:check  # prettier
```

Load the working copy for one session with `pi -e ./src/index.ts`.
