# Handshake: Engineer-Squad

Last Updated: 2026-07-10T17:10:00Z

<squad_metadata>
  <squad_name>Engineer-Squad</squad_name>
  <current_status>IDLE</current_status>
  <active_task_id>NONE</active_task_id>
  <sprint_completion_percentage>100</sprint_completion_percentage>
</squad_metadata>

## Current Focus

Milestone 1 (TSK-001) is built and merged: a standalone GAS Web App (`apps-script/`) that
takes a chat request, shows an LLM-drafted plan, and on approval creates a real Google Doc
via `DocumentApp`. That track is now **paused** per Owner request — work has shifted to
TSK-003, a parallel macOS desktop app prototype (`desktop-app/`, Electron) reusing the same
UI/engine shape but with no Google dependency: local file output (`.docx`/`.xlsx`/`.pptx`,
picked via a UI selector) instead of `DocumentApp`/`SpreadsheetApp`/`SlidesApp`, a local JSON
config store instead of Script Properties. TSK-003 now covers all three of the First Goal
doc's output types; the webapp track still only does documents. The full 5-stage/5-model
pipeline and squad-driven backlog automation described in the Squad Setup doc still have not
been built — both tracks so far were implemented directly to prove the end-to-end flow first.

## Recent Commits (Staging Only)

* Initial commit: `apps-script/` (`Code.gs`, `Index.html`, `appsscript.json`),
  `backlog-inbox.md`, `squad-handshake.md`, `CLAUDE.md`, `README.md`.
* GAS webapp iteration (merged PRs #1-#3): TSK-002 hosting/model decision, access model,
  frontend polish, file attachments + role classification, local Ollama option with the
  First Goal doc's 5-model role mapping.
* `desktop-app/` scaffold (TSK-003, not yet merged): `main.js`/`preload.js` (Electron IPC),
  `engine.js` (ported LLM logic), `docgen.js` (local `.docx` writer), `config-store.js`
  (local settings), `renderer/index.html` (ported UI, GAS-mock dead code removed).
* `desktop-app/` output-type expansion (TSK-003, same branch): `docgen.js` now generates
  `.xlsx` (`xlsx`) and `.pptx` (`pptxgenjs`) alongside `.docx`, behind a
  Document/Spreadsheet/Presentation selector in `renderer/index.html`. `generateOutput`
  replaces the single-format `generateDoc` as the IPC entry point.
* `desktop-app/` remaining-role wiring (TSK-003, same branch): Syntax Enforcer (Phi-4-mini)
  now runs as a JSON-repair step when the Code Engine's output fails to parse; Generalist
  (Llama 3.1 8B) drafts the delivery summary now shown in the result card. All 5 First Goal
  doc roles have a real call site (previously 3 of 5).
* `desktop-app/` first real Electron run + P1 fixes (TSK-003, committed 3787e8c): confirmed
  the app launches (`npm start` and packaged `.app`); added the missing
  `OLLAMA_SYNTAX_MODEL`/`OLLAMA_GENERALIST_MODEL` Settings fields so all 5 roles are
  configurable; added `electron-builder` packaging (`npm run pack`/`dist`). Documented the
  Node-26 `extract-zip` install gotcha in the README.
* `desktop-app/` end-to-end GUI verification (TSK-003): drove the real renderer over Electron's
  remote-debugging port (CDP) for all 3 output types — Get Plan → Approve & Generate → file —
  each producing a valid OOXML file on disk (docx headings/body, xlsx headers+rows, pptx with
  a native chart). Full stack exercised: DOM → preload → IPC → engine → docgen → disk.
* `desktop-app/` polish (TSK-003, not yet committed): added a custom app icon
  (`build/icon.icns` + generator in `build/make_icon.py`), wired via `build.mac.icon`;
  hardened the API key at rest — `config-store.js` now encrypts `ANTHROPIC_API_KEY` via
  Electron `safeStorage` (OS keychain), transparent to callers, with plaintext fallback when
  encryption is unavailable (verified with an 8-assertion headless Electron test). README now
  documents the code-signing/notarization steps that remain (owner-provided Apple cert).

* `desktop-app/` QA pass + fixes (TSK-003, not yet committed): ran a high-effort multi-agent
  code review over the P1 + polish commits; it found 8 confirmed issues, all in the just-added
  code. Fixed all: the serious ones were in the `safeStorage` change — a decrypt-failure +
  blank-Save combination that could permanently clobber a stored key, plus a present-but-
  unreadable key reading as unset. Redesign: secrets are never sent to the renderer (getSettings
  returns SET/UNREADABLE flags only), a blank API-key field is omitted from Save so it never
  overwrites a stored key, `maybeDecrypt` now gates on `encryptionAvailable()` symmetrically,
  a startup `migrateSecrets()` encrypts any legacy plaintext key, `setProperties`/`getProperties`
  batch to one read/write, plaintext fallback now warns, and dead icon-drawing code was removed.
  Verified: 16-assertion headless config-store test + 9-assertion CDP Settings-flow test (incl.
  the no-clobber scenario) all pass.

* `desktop-app/` local-first + first-run model setup (TSK-003, not yet committed): default
  provider flipped to local Ollama (`engine.js` `LLM_PROVIDER_DEFAULT='ollama'`, renderer
  fallbacks); cloud (Claude) stays opt-in via Settings. New `setup-llm.js` talks to Ollama's
  native HTTP API (`/api/tags`, `/api/pull`) — on first run it detects which of the 5 pipeline
  models are already installed and pulls ONLY the missing ones (never re-downloads), streaming
  progress to a new first-run panel in the renderer; if Ollama isn't running it guides the user
  to install it (the runtime itself is never auto-installed). Completion is remembered
  (`LLM_SETUP_DONE`). Secret scan of the repo came back clean (no keys committed); added
  defensive `.gitignore` (`config.json`, `*.env`, `*.log`). Caught + fixed a packaging bug:
  `setup-llm.js` was missing from `build.files`, so the packaged app.asar omitted it and the
  window failed to open — added it and re-verified the packaged app launches. Verified:
  14-assertion setup-llm unit test + 7-assertion first-run CDP test (against a fake Ollama),
  passing on BOTH the dev binary and the packaged `.app`.

* `desktop-app/` v0.1.1 — notarization prep (TSK-003, branch `claude/notarize-prep`): wired the
  full code-signing/notarization path so it's turnkey once an Apple Developer ID cert exists —
  `build/entitlements.mac.plist` (hardened-runtime entitlements), `hardenedRuntime`/`entitlements`/
  `gatekeeperAssess` in `build.mac`, and an env-gated `afterSign` hook (`scripts/notarize.js`,
  `@electron/notarize`) that no-ops without Apple creds (so the unsigned build still works) and
  auto-notarizes when `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` are set. Verified
  the unsigned v0.1.1 build still succeeds and the app still launches. README now has a prominent
  "damaged app" install workaround (`xattr -dr com.apple.quarantine`) — the exact Gatekeeper block
  the owner hit downloading the unsigned v0.1.0 dmg — plus turnkey signing steps. Version bumped
  to 0.1.1. Remaining: owner enrolls in Apple Developer Program, then one `npm run dist` produces
  a notarized dmg that opens with a normal double-click.

* TSK-004 (2026-07-10, DONE): first task executed through the full squad loop for real —
  Ingestion (owner popup) → Triage (researcher notes, READY_FOR_PM) → Execution (Engineer
  agent built `tools/validate-harness.js` + `tools/validate-harness.test.js`: fail-soft,
  block-scoped backlog parser per the CLAUDE.md crash-proofing convention, plus a 7-case
  test suite and CLI) → QA (independent agent: re-ran the suite, exit 0, and ran adversarial
  probes incl. repeated malformed blocks, unclosed block tags, duplicate fields, and a ~1MB
  synthetic backlog parsed in 74ms) → Commit. QA verdict PASS, zero criteria violations;
  3 non-blocking notes filed on degenerate inputs (dangling open blocks absorb a sibling
  silently; literal `</task_item>` in a description truncates it; quadratic scan on
  pathological all-open-tag input). This completes the harness validation started with the
  2026-07-10 synthetic run (parsing/circuit-breaker/phase-isolation tests, 4/4 PASS) — the
  loop conventions are now exercised end-to-end on real state files, not just test copies.

## Blockers & QA Failures

* RESOLVED (2026-07-09): TSK-003 now runs in a real Electron window. `npm start` and the
  `electron-builder`-packaged `LazyOffice.app` both launch; the renderer/IPC/Settings layer
  loads from `app.asar` without error (verified via the live renderer helper process). Setup
  gotcha found and documented: on Node 26, electron's bundled `extract-zip` fails mid-extract
  and leaves a broken ~256K stub — the binary must be extracted with macOS `ditto` + a manual
  `path.txt` (see `desktop-app/README.md`); `electron-builder`'s own extractor is fine.
* Two P1 fixes landed alongside the run: (1) the Settings panel now exposes all 5 First Goal
  roles — `OLLAMA_SYNTAX_MODEL` and `OLLAMA_GENERALIST_MODEL` were called in `docgen.js` but
  had no UI/IPC field (added to `main.js` `SETTINGS_KEYS` and `renderer/index.html`);
  (2) `electron-builder` packaging config added to `package.json` (`npm run pack`/`dist`).
* RESOLVED (2026-07-09): the full GUI flow (request → Get Plan → Approve & Generate → file)
  is now driven end-to-end for all 3 output types via CDP against the real renderer; icon and
  at-rest key encryption added. A high-effort code-review QA pass ran over the desktop track
  and its 8 findings were all fixed and re-verified (see the QA entry above). The single
  remaining item before TSK-003 is fully "done": code-signing + notarization, blocked on an
  owner-provided Apple Developer ID cert (steps documented in `desktop-app/README.md`).
* QA status: the desktop track (TSK-003) has had a code-review pass (fixes verified). The GAS
  webapp track (TSK-001) has not had a dedicated QA pass yet.

## Cross-Squad Requests

* Resolved (2026-07-09): Owner decided TSK-002's hosting target (own hardware) and first
  model to load (Qwen3.5-9B Orchestrator) — see `backlog-inbox.md`. TSK-002 is now
  `READY_FOR_PM`. Still need `Researcher-Squad`/`Engineer-Squad` to scope the on-prem
  networking so GAS can reach the server.
* Resolved (2026-07-09): Owner confirmed the GAS Web App access model — sign-in required
  (any Google account), i.e. `access: ANYONE` in `appsscript.json`. Not domain-restricted,
  not anyone-with-link.
* Resolved (2026-07-09): Owner confirmed the Milestone 1 stand-in stays on the Claude API
  (not swapping to another hosted LLM API as an interim step). `callClaude` in `Code.gs` is
  annotated to be replaced by the self-hosted inference server (TSK-002), not by a different
  hosted LLM API.

All three outstanding Owner cross-squad requests are now resolved. No open blockers.
