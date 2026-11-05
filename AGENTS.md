## Local testing

`.pi/settings.json` does not commit a dogfood install: a normal pi session in this checkout does
not load the extension. Load it for one run with:

```sh
pi -e ./src/index.ts
```

To dogfood interactively, `pi install --local .` writes `"packages": [".."]` into
`.pi/settings.json`; restart pi or `/reload`, then revert `.pi/settings.json` before committing.
Treat that declaration as a temporary harness, not repo state.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `jennymaeleidig/pi-copy-paste`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default names: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
