# Handshake: Engineer-Squad

Last Updated: 2026-07-09T11:35:00Z

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

## Blockers & QA Failures

* TSK-003 (`desktop-app/`): not yet run inside an actual Electron window — installing the
  `electron` binary needs network access to its download CDN, unavailable in the sandbox
  this was built in. `engine.js`/`docgen.js` were instead logic-tested directly under plain
  Node against local stand-in Claude/Ollama servers, for all three output types — each
  generated `.docx`/`.xlsx`/`.pptx` was unzipped and its actual content checked (headers/
  rows for the spreadsheet, slide text for the presentation), not just confirmed to exist.
  Needs a real run on the Owner's machine to confirm the Electron window/IPC/Settings-panel
  layer itself works before calling TSK-003 done.
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
