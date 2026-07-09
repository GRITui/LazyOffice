# Handshake: Engineer-Squad

Last Updated: 2026-07-09T13:00:00Z

<squad_metadata>
  <squad_name>Engineer-Squad</squad_name>
  <current_status>EXECUTING</current_status>
  <active_task_id>TSK-004</active_task_id>
  <sprint_completion_percentage>100</sprint_completion_percentage>
</squad_metadata>

## Branch note

This copy of `squad-handshake.md` lives on **`claude/office-plugin`**, forked from the
`claude/quick-update-1z30aj` state (which itself merges into `claude/squad-setup-goals-5hitql`).
TSK-003 (desktop app) commits after the fork point won't appear here automatically — check
`claude/quick-update-1z30aj`'s copy of this file for TSK-003's latest status, and reconcile
both copies when/if the branches merge back together.

## Current Focus

Milestone 1 (TSK-001) is built and merged: a standalone GAS Web App (`apps-script/`) that
takes a chat request, shows an LLM-drafted plan, and on approval creates a real Google Doc
via `DocumentApp`. That track is now **paused** per Owner request — work moved first to
TSK-003 (a parallel macOS desktop app prototype, `desktop-app/`, Electron), and this branch
now adds TSK-004: a third parallel track, a Microsoft Office Add-in (`office-addin/`) running
as a task pane inside Word/Excel/PowerPoint via Office.js instead of as a standalone app.
Unlike TSK-003 (added alongside `apps-script/` on the same branch), TSK-004 was explicitly
forked to its own branch — see `backlog-inbox.md` for why. The full 5-stage/5-model pipeline
and squad-driven backlog automation described in the Squad Setup doc still have not been
built — all three tracks so far were implemented directly to prove the end-to-end flow first.

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
* `desktop-app/docgen.js` corporate theme (TSK-003, same branch, after this branch's fork
  point): `writePptx` now applies an accent title slide, branded footer, and real native
  pptxgenjs charts. Not present in this branch's copy of `desktop-app/` — see the branch note
  above.
* `office-addin/` scaffold (TSK-004, `claude/office-plugin`, not yet merged): `manifest.xml`,
  `server/` (Express + HTTPS via `office-addin-dev-certs`, `engine.js` ported from
  `desktop-app/engine.js`, `content.js` — the file-writing equivalent, returns structured
  content instead of writing to disk, reuses `desktop-app/docgen.js`'s pptxgenjs writer for
  the PowerPoint base64-insert path), `taskpane/` (host-aware UI, locks output type to the
  detected Office application instead of the desktop app's selector).

## Blockers & QA Failures

* TSK-003 (`desktop-app/`): not yet run inside an actual Electron window — installing the
  `electron` binary needs network access to its download CDN, unavailable in the sandbox
  this was built in. `engine.js`/`docgen.js` were instead logic-tested directly under plain
  Node against local stand-in Claude/Ollama servers, for all three output types — each
  generated `.docx`/`.xlsx`/`.pptx` was unzipped and its actual content checked (headers/
  rows for the spreadsheet, slide text for the presentation), not just confirmed to exist.
  Needs a real run on the Owner's machine to confirm the Electron window/IPC/Settings-panel
  layer itself works before calling TSK-003 done.
* TSK-004 (`office-addin/`): no real Office application exists in this sandbox — the
  manifest has never been sideloaded, and `Word.run`/`Excel.run`/`PowerPoint.run` have never
  executed against a live document. `engine.js`/`content.js` were logic-tested the same way
  as TSK-003 (stand-in Claude server, both direct calls and real HTTP routes through
  Express), including a genuinely valid `.pptx` with a real chart part built entirely in
  memory. `context.presentation.insertSlidesFromBase64` (PowerPoint insertion) is the least
  certain piece — flagged in code and README as needing verification against the live
  Office.js reference during real sideloading.
* No QA-Squad pass has run against any track yet.

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
