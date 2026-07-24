# Real-world MCP elicitation matrix (ContentKit)

Operator diagnostic — **not CI-wired**. Drives real `claude` (Claude Code) and
`codex` TUIs in tmux against a fully sandboxed local ContentKit and verifies
the native elicitation confirm flow (`confirm()` in `src/mcp/tools.mjs`) for
every outcome. Ground truth is always the engine log (JSON lines) plus the
audit REST surface (`GET /v1/audit-events`) — never the client's narrated
text. Ported from `subkit/tests/real-world/elicitation/`.

## Run

```bash
tests/real-world/elicitation/run-matrix.sh                # full matrix
tests/real-world/elicitation/run-matrix.sh claude-code    # one client
tests/real-world/elicitation/run-matrix.sh codex accept   # one cell
tests/real-world/elicitation.sh scripted                  # nocap cell only
```

Artifacts land in `shots/`: `.txt` (plain pane), `.ansi.txt` (colored),
`.png` (rendered via PIL), `*.verdict` (PASS/FAIL/OBSERVED with proving log
lines), `engine.log` (the sandboxed server's full JSON log).

## Sandbox

- Engine on **port 4571**, scratch database `contentkit_elicit` (dropped and
  recreated per run) in the shared `contentkit-local-postgres` container,
  storage/webhook boundary on **55434** — a normal dev instance on 4050/55433
  can keep running. Fail-fast if 4571 already answers.
- Run-specific bootstrap admin key (`CONTENTKIT_BOOTSTRAP_API_KEY`, scopes `*`).
- `CONTENTKIT_MCP_ELICITATION_TIMEOUT_MS=120000` — accept cells answer after
  ~65 s to prove the SDK's 60 s default is overridden; timeout cells wait
  ~130 s to observe the server-side expiry.
- Guarded mutation under test: `contentkit_content delete_draft` on a fresh
  scratch draft (audit action `content.delete_draft`; cannot touch published
  state). `~/.codex/config.toml` and the user's Claude config are never
  modified (temp `CODEX_HOME` / temp workdir with `--scope local`).

## Matrix

| # | client | scenario | drives | verdict source |
|---|--------|----------|--------|----------------|
| 1 | claude-code | accept | answer form `confirmed=true` after ~65 s | audit row `content.delete_draft` for the item; max `POST /mcp` `ms` > 65000 |
| 2 | claude-code | cancel | Esc after >2 s | `Operation cancelled` warn line; no audit row; `ms` > 2000 |
| 3 | claude-code | timeout | never answer, wait ~130 s | `Request timed out` warn line; no audit row |
| 4 | claude-code | fast-cancel | reuse instance: cancel round 1, `/clear`, retry | OBSERVED verdict: elicitation round-trip `ms` < 2000 = client auto-cancel reproduced; never a mutation |
| 5 | codex | accept | inline form, answer after ~65 s | audit row; no failure line |
| 6 | codex | cancel | Esc after >2 s | `Operation cancelled`; no audit row; `ms` > 2000 |
| 7 | codex | timeout | unanswered ~130 s | `Request timed out`; no audit row |
| 8 | scripted | nocap | SDK client without elicitation capability | tool `isError` mentioning form elicitation support; no `elicitation/create` sent; no audit row |

## Known client quirks (observed 2026-07, subkit/wikikit matrices)

- **Claude Code** (>= 2.1.76 required): renders the MCP form only at the END
  of its agent turn. A REUSED interactive instance (after `/clear`, or after
  the server restarted mid-session) may auto-cancel incoming elicitations in
  ~16 ms without rendering them — cell 4 reproduces this; a fresh process
  behaves correctly. Tool-permission dialogs are auto-approved by the cell
  scripts (they are not the elicitation under test).
- **Codex** (>= 0.144): renders the form INLINE while the tool call is live
  and re-renders a fresh form on every re-delivery — always answer the newest.
  `Enter` on an EMPTY optional text field does not submit; ContentKit's form
  has a single boolean field, so this quirk does not bite here. If a future
  codex gates elicitation behind `approval_policy = { granular = {
  mcp_elicitations = true } }`, add that to the generated temp `config.toml`
  in `clients/codex.sh`.
- If a production `contentkit` MCP server is configured globally, the model
  may call it instead of `ck-elicit-matrix`; verdicts grep the LOCAL engine
  log, so such a mix-up shows up as FAIL (no local calls), never as a false
  PASS.

## Prerequisites

- `claude` >= 2.1.76 and `codex` >= 0.144, both logged in
- `tmux`, `python3` + PIL (PNG rendering; text capture works without),
  `jq`, `curl`, `openssl`, Docker (local Postgres container), `node` >= 20.12
- Ports 4571 and 55434 free
