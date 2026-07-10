# Handshake: Engineer-Squad

Last Updated: 2026-07-10T15:10:00Z

<squad_metadata>
  <squad_name>Engineer-Squad</squad_name>
  <current_status>EXECUTING</current_status>
  <active_task_id>TSK-003</active_task_id>
  <sprint_completion_percentage>100</sprint_completion_percentage>
</squad_metadata>

## Branch note

This copy of `squad-handshake.md` lives on **`mac-arm64-local-llm`**, branched from
`claude/quick-update-1z30aj`'s tip (commit `ba64fbf`) with no code changes at the fork point —
its content is currently identical to that branch's `desktop-app/`. Purpose: give TSK-003 (the
Electron app running fully on local Ollama, one model, `llama3.1:8b`, with the Claude CLI as its
only opt-in cloud backend) its own dedicated branch to keep developing on, separate from
`claude/quick-update-1z30aj` (which still also carries the paused `apps-script/` webapp) and
separate from the two higher-risk/different-architecture forks (`claude/office-plugin`'s Office
Add-in, `Mac-claude-cloud-desktop`'s Claude-Desktop-via-CDP track). Future `desktop-app/` work
should land here; check `claude/quick-update-1z30aj`'s copy of this file if reconciling history
later.

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

* `desktop-app/` Owner-requested flow upgrade (TSK-003, not yet committed), scoped after the
  Owner confirmed the app runs for real on their machine: (1) proactive clarification loop —
  `engine.getPlan` now returns `{status:'ready', plan}` or `{status:'needs_clarification',
  questions}`; the Orchestrator only asks (max 3 rounds, then drafts anyway) when a request is
  genuinely under-specified, and the renderer's new clarify-box collects answers and re-calls
  `getPlan` with the growing Q&A history. (2) Local-model tick boxes per pipeline role,
  replacing the free-text model fields — Settings now renders all 5 pipeline models as tick
  boxes under each of the 5 roles (`window.desktop.getRoleModels()`, sourced from `engine.js`'s
  `OLLAMA_ROLE_MODELS` so the UI can't drift from the backend); ticking more than one sets a
  fallback chain, and `callOllama` now tries each ticked model in order via the new
  `resolveOllamaCandidates`, falling through on failure. Settings storage changed from 5
  separate `OLLAMA_*_MODEL` keys to one `OLLAMA_ROLE_MODEL_SELECTION` object. (3) Content
  preview before file creation — `docgen.js` split into `buildDocumentContent`/
  `buildSpreadsheetContent`/`buildPresentationContent` (+ `buildContent` dispatcher, draft
  only, no disk write) and `createDocument`/`createSpreadsheet`/`createPresentation` (+
  `createOutput` dispatcher, writes exactly what was previewed). Approving a plan now shows a
  new preview card — rendered document text, a real `<table>` for spreadsheets, or a slide-by-
  slide breakdown for presentations — with Create File / Back, instead of writing immediately.
  (Local-first default and full per-role Settings fields, requested in the same batch, had
  already landed in the two commits above this one.)

* `desktop-app/` prompt-auditor follow-up (TSK-003, not yet committed): the Owner asked for the
  clarification-loop stage above to run on exactly one pinned local model — Llama 3.1 8B
  Instruct — rather than being routed through `LLM_PROVIDER`/the tick-box fallback chain like
  the rest of the pipeline. Added `engine.callPromptAuditor`, always calling Ollama with
  `PROMPT_AUDITOR_MODEL` (reuses the Generalist's `llama3.1:8b` tag — no extra download) and
  ignoring the provider setting and role selection entirely; `getPlan` now calls this instead of
  `callLLM(..., 'orchestrator')`. Consequence: the Orchestrator entry was removed from
  `OLLAMA_ROLE_MODELS` (no longer has a call site, so it's gone from the Settings tick-box grid,
  which is data-driven from that map) and `setup-llm.js`'s required-download list dropped
  `qwen3.5:9b` — first-run setup now pulls 4 models instead of 5. Renderer copy in the
  clarify/plan cards now names the prompt auditor explicitly. Verified: confirmed the auditor
  is still called even with `LLM_PROVIDER='claude'` and no API key set, and that ticking a
  different model for another role has no effect on which model the auditor uses — same
  not-yet-run-in-a-real-window caveat as the batch above.

* `desktop-app/` single-local-model collapse + Claude CLI framework (TSK-003, not yet
  committed): Owner verified the whole pipeline works on Llama 3.1 8B Instruct alone and asked
  to (1) remove every other local model from the codebase, (2) remove the Claude API option
  entirely, (3) start a Claude CLI integration. Landed:
  - `OLLAMA_ROLE_MODELS`, the per-role tick-box grid, `resolveOllamaCandidates`, and the
    fallback-chain loop are all gone. `engine.js` now has one constant, `OLLAMA_MODEL =
    'llama3.1:8b'`, and `callOllama`/`callPromptAuditor` both just call it directly — no role
    parameter left anywhere in `callLLM`/`callOllama`/`classifyAttachments`/`docgen.js`'s calls.
    `setup-llm.js`'s `REQUIRED_MODELS` is down to that one entry.
  - `callClaude`, `CLAUDE_MODEL`, `CLAUDE_API_URL`, the `ANTHROPIC_API_KEY` setting, and the
    `safeStorage`-based at-rest encryption in `config-store.js` (its only purpose was protecting
    that key) are all removed — `config-store.js` is back to a plain JSON store.
  - New `engine.callClaudeCli`: spawns a local `claude` CLI in one-shot mode
    (`--bare -p "<user>" --append-system-prompt "<system>" --output-format json --allowedTools
    "" --model <model>`) as the new cloud-optional backend, wired into `callLLM`'s provider
    switch as `'claude-cli'` (replacing `'claude'`). `--allowedTools ""`/`--bare`/scratch-dir
    `cwd` are deliberate safety choices — researched via the claude-code-guide agent first,
    since a wrong flag here could leave a headless spawn hung on an unanswerable permission
    prompt or let it take a real Bash/file side effect. Settings gets `CLAUDE_CLI_PATH`/
    `CLAUDE_CLI_MODEL` fields in place of the old API key field.
  - Verified against a fake `claude` binary stand-in: the exact argv shape, successful JSON
    parsing, a non-zero-exit error path, and an ENOENT ("not installed") error path all check
    out, and the prompt auditor was reconfirmed to bypass this entirely and stay on local
    Ollama even with the backend set to `claude-cli`. **Never run against a real installed
    `claude` CLI** — flagged in `desktop-app/README.md` as framework-stage, not finished.

* `desktop-app/` per-role backend rebuild (TSK-003, not yet committed): Owner asked whether the
  First Goal doc's dedicated Orchestrator role (Qwen3.5-9B) could come back while still letting
  any role be wired to any backend, not just Ollama. Scoped via two clarifying questions — all 5
  First Goal doc roles get independent backend config (not Orchestrator alone), and a third
  backend type, a generic OpenAI-compatible endpoint (URL + optional API key + model), joins
  Ollama and Claude CLI. Rebuilt:
  - `engine.js`: `ROLE_DEFAULTS` restores the 5-role mapping (Orchestrator/Qwen3.5-9B,
    Planner/DeepSeek-R1-Distill-Qwen-7B, Syntax Enforcer/Phi-4-mini, Code Engine/Granite 4.1 8B,
    Generalist/Llama 3.1 8B), each defaulting to Ollama. `resolveRoleConfig(role)` merges a
    role's stored override (new `ROLE_BACKEND_CONFIG` JSON setting) with its default.
    `callRole(role, systemPrompt, userPrompt)` is the single dispatch point every call site now
    goes through — `callPromptAuditor`'s old local-Ollama-only bypass is gone, Orchestrator is
    just another independently-configurable role like the other 4.
    `computeOllamaRequiredModels()` derives the first-run download list dynamically from
    whichever roles currently resolve to Ollama.
  - `docgen.js`'s four LLM call sites (JSON repair, result summary, and all three
    content-drafting functions) route through `callRole` to `syntax_enforcer`/`generalist`/
    `code_engine` respectively.
  - `setup-llm.js`: `REQUIRED_MODELS` constant removed; `status`/`ensureModels` take the
    required-models list as a parameter instead.
  - `main.js`: new `getRoleCatalog` IPC handler hands the renderer `ROLE_DEFAULTS`/
    `BACKEND_TYPES` so Settings can't drift from what `engine.js` dispatches on;
    `llmStatus`/`llmSetup` now compute the required-models list fresh via
    `computeOllamaRequiredModels()` on every call; `SETTINGS_KEYS` collapsed to
    `['OLLAMA_URL', 'ROLE_BACKEND_CONFIG']`.
  - `renderer/index.html`: Settings panel rebuilt — one fieldset per role (backend-type
    selector + type-appropriate fields: model tag for Ollama, path/model for Claude CLI,
    url/API key/model for a custom endpoint), replacing the old single global provider
    selector. Fixed a bug caught during the rewrite: the first-run-setup check still read the
    now-removed `st.provider` field, which would have permanently hidden the first-run Ollama
    panel; changed to check `st.required === 0` instead.
  - Verified via a logic-test harness: two fake OpenAI-compatible HTTP servers (standing in for
    the shared Ollama server and a custom endpoint) plus a fake `claude` CLI, confirming
    fresh-install defaults match the First Goal doc's 5-role mapping, an unconfigured role uses
    the shared Ollama URL, overriding one role's config redirects only that role and leaves the
    rest on defaults, `computeOllamaRequiredModels` correctly drops a role once it's pointed
    elsewhere, and the full `buildContent`→`createOutput` pipeline still produces a valid
    `.docx` with Code Engine routed through a completely different backend than the rest of the
    app. **Never run against a real Electron window, a real Ollama server, a real `claude` CLI,
    or a real third-party OpenAI-compatible endpoint** — flagged in `desktop-app/README.md`.
  - Separately, Owner asked to "delete old app asset"; asked to name the exact target, Owner
    said nothing should be deleted — `apps-script/` and everything else left untouched.

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
* The clarify-loop/preview/tick-box batch above is logic-tested only (stand-in Ollama server:
  the proactive clarify → answer → re-plan round-trip, a first-model-fails/second-succeeds
  fallback chain, and `buildContent`/`createOutput` for all 3 output types with each written
  file inspected) — not yet driven through a real Electron window. Needs the same kind of CDP
  pass the base flow got before this is called done.
* Same caveat for the prompt-auditor follow-up directly below.
* Same caveat again for the single-model collapse + Claude CLI framework directly below that:
  the CLI wiring was verified against a fake `claude` binary (exact argv shape, JSON-result
  parsing, non-zero-exit and ENOENT error paths), never against a real installed CLI.
* Same caveat again for the per-role backend rebuild directly above: logic-tested against fake
  HTTP backends and a fake `claude` binary only, never against a real Electron window or real
  Ollama/Claude CLI/third-party endpoint infrastructure. Also carried forward: a custom
  endpoint's API key is stored in plaintext in `config.json`, same as the rest of
  `ROLE_BACKEND_CONFIG` — flagged as a known gap in `desktop-app/README.md`, not yet fixed.

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
