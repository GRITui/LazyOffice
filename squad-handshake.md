# Handshake: Engineer-Squad

Last Updated: 2026-07-09T16:32:28Z

<squad_metadata>
  <squad_name>Engineer-Squad</squad_name>
  <current_status>EXECUTING</current_status>
  <active_task_id>TSK-003</active_task_id>
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
* `desktop-app/` first real Electron run + P1 fixes (TSK-003, same branch, not yet committed):
  confirmed the app launches (`npm start` and packaged `.app`); added the missing
  `OLLAMA_SYNTAX_MODEL`/`OLLAMA_GENERALIST_MODEL` Settings fields so all 5 roles are
  configurable; added `electron-builder` packaging (`npm run pack`/`dist`). Documented the
  Node-26 `extract-zip` install gotcha in the README.

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
* Still open before TSK-003 is "done": full GUI click-through (request → plan → approve →
  file) on a machine with a live API key/Ollama has not been driven — only the underlying
  code paths are verified headlessly. Build is unsigned with the default Electron icon.
* No QA-Squad pass has run against either track yet.

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
