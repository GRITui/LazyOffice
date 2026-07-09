# LazyOffice Desktop (prototype)

A parallel track to the `apps-script/` GAS Web App: the same chat → plan → approve flow,
packaged as a macOS desktop app (Electron) instead of a Google Apps Script Web App. Started
as an experiment while the webapp track is paused — see the root `README.md`/`CLAUDE.md` for
that track.

## How it differs from the webapp

| | `apps-script/` (webapp) | `desktop-app/` (this) |
| --- | --- | --- |
| Runtime | Google Apps Script (GAS) | Electron (local Node + Chromium) |
| UI ↔ backend | `google.script.run` | Electron IPC (`preload.js` → `main.js`) |
| Output | Real Google Doc via `DocumentApp` | Local `.docx`/`.xlsx`/`.pptx` file (`~/Documents/LazyOffice/`) — no Google account needed |
| Settings | Apps Script Script Properties (editor UI) | In-app Settings panel → local `config.json` in the OS user-data dir |
| LLM backends | Claude API, or local Ollama (script properties) | **Local Ollama by default**; Claude API opt-in (Settings panel) |

`engine.js` is a deliberate near-1:1 port of `Code.gs`'s LLM logic (same function names/
shapes, same 5-model `OLLAMA_ROLE_MODELS` mapping from the First Goal doc) so the two stay
easy to compare. `docgen.js` has no GAS equivalent — it's the one real divergence, and it
goes further than the webapp: the First Goal doc's mission covers documents, spreadsheets,
*and* presentations, so this desktop track implements all three (the webapp still only does
documents). Pick the output type in the UI; `docgen.js` writes a real `.docx` (`docx`
package), `.xlsx` (`xlsx`/SheetJS), or `.pptx` (`pptxgenjs`) accordingly — no
`DocumentApp`/`SpreadsheetApp`/`SlidesApp` involved.

## The flow, in detail

The chat → plan → approve loop from the webapp is extended here with two extra checkpoints,
both aimed at catching mistakes before a file gets written rather than after:

1. **Describe.** Type a request (and optionally attach reference files/links).
2. **Clarify (only if needed).** Before drafting a plan, the Orchestrator judges whether the
   request has enough detail. If something material is missing (subject, scope, audience, data
   source, length) and it can't make a reasonable assumption, it asks 1-3 short questions
   instead of guessing — answer them and it re-checks, repeating until it has enough (capped at
   3 rounds, after which it drafts its best plan with reasonable assumptions rather than looping
   forever). Most clear requests skip this step entirely.
3. **Review the plan.** A short plain-language description of what will be created. Approve, or
   Start Over.
4. **Preview.** Approving doesn't write a file yet — it drafts the actual content (document
   sections, spreadsheet rows, or slides) and shows it in a preview card: the real text/table/
   slide-by-slide breakdown, not a placeholder. Create File to write it for real, or Back to
   return to the plan.
5. **Done.** The file lands in `~/Documents/LazyOffice/`.

`engine.getPlan` implements step 2 (returns `{status: 'ready', plan}` or
`{status: 'needs_clarification', questions}`); `docgen.buildContent`/`docgen.createOutput` split
step 4 into "draft content" and "write file" so the preview shows exactly what gets created,
and Create File never re-runs the LLM (so it can't drift from what was previewed).

## Local-first by default

Out of the box the app runs entirely on a **local Ollama server** — no API key, nothing sent
to the cloud (`LLM_PROVIDER` defaults to `ollama` in `engine.js`). To use a cloud model
instead, open Settings, switch the provider to "Claude API", and enter a key (encrypted at
rest — see below). The key is never sent to the cloud until you opt in.

### First-run model setup

On first launch, if the provider is the local default, the app checks the local Ollama server
(`setup-llm.js`) and shows a one-time setup panel:

- If Ollama **isn't running**, it points you to https://ollama.com/download and offers a
  Recheck button (the Ollama runtime itself is a system component — the app never installs it
  for you). You can also just switch to a cloud model in Settings.
- If Ollama **is running**, it lists which of the five First Goal pipeline models
  (`qwen3.5:9b`, `deepseek-r1:7b`, `phi4-mini:3.8b`, `granite4.1:8b`, `llama3.1:8b`) are
  missing and downloads only those, streaming progress. **Models already on the device are
  detected and kept** — it never re-downloads what you have. "Skip for now" dismisses the
  panel; completion is remembered (`LLM_SETUP_DONE`).

Uses Ollama's native HTTP API (`GET /api/tags`, `POST /api/pull`); the host is derived from
the `OLLAMA_URL` setting (default `http://127.0.0.1:11434`).

## What's here

- `main.js` — Electron main process: creates the window, wires IPC handlers for
  `getPlan`/`classifyAttachments`/`buildContent`/`createOutput`/`getRoleModels`/settings/
  `openInFinder` and the first-run `llmStatus`/`llmSetup` flow.
- `setup-llm.js` — first-run local-model detection + pulling (Ollama HTTP API).
- `preload.js` — exposes a `window.desktop` bridge to the renderer (contextIsolation on,
  nodeIntegration off).
- `engine.js` — ported LLM logic (`callLLM`/`callClaude`/`callOllama`, attachment role
  classification, prompt building). `getPlan` is the proactive clarification loop described
  above. `callOllama` resolves each role's ticked models (`OLLAMA_ROLE_MODEL_SELECTION`) and
  tries them in order, falling through on failure — the fallback chain behind the Settings tick
  boxes. No dead GAS-mock code — a desktop app always has a real backend, so the mock/
  `isGasEnv` branching from `Index.html` was dropped, not ported.
- `docgen.js` — turns the generated JSON into a real file on disk. `buildDocumentContent`/
  `buildSpreadsheetContent`/`buildPresentationContent` (+ the `buildContent` dispatcher) draft
  content only, for the preview step; `createDocument`/`createSpreadsheet`/`createPresentation`
  (+ the `createOutput` dispatcher) write the already-previewed content to disk.
  `generateDocument`/`generateSpreadsheet`/`generatePresentation` remain as one-shot build+create
  helpers.
- `config-store.js` — local JSON-file settings store, same shape as GAS's
  `PropertiesService.getScriptProperties()` so `engine.js` didn't need restructuring.
- `renderer/index.html` — the UI, ported from `apps-script/Index.html` with the mock banner/
  `google.script.run` detection removed, a Document/Spreadsheet/Presentation type selector, a
  clarification card, a content-preview card, the result card showing a file path + "Show in
  Finder" instead of a Drive link, and a Settings panel with per-role model tick boxes (the
  desktop equivalent of Apps Script's Script Properties editor).

## Running it

```
cd desktop-app
npm install
npm start
```

On first launch the app is already set to "Local Ollama" (defaults match `ollama serve`'s
standard port and the First Goal doc's model tags — see the root `README.md`'s Ollama table);
open **Settings** to tick different models per pipeline role (tick more than one for a fallback
chain) or switch the provider to "Claude API" and paste a key. Pick Document, Spreadsheet, or
Presentation, describe what you want, answer any clarifying questions if asked, review the
plan, approve to see a preview, then Create File — it lands in `~/Documents/LazyOffice/`.

## Status

Runs in a real Electron window and is **packaged into a `.app`** (with a custom icon) via
`electron-builder` (see Building below) — confirmed working on the Owner's machine. The base
flow has been **driven end-to-end through the real renderer** — for each of the three output
types, a request → plan (Get Plan) → approve → file-write cycle was exercised against a local
stand-in LLM, and each resulting `.docx`/`.xlsx`/`.pptx` was opened and its content verified
(real headings/rows/slides, and a native chart in the deck), not just its existence. On macOS
(this app's target) the API key is encrypted at rest via the OS keychain (Electron
`safeStorage`); a pre-existing plaintext key is migrated to encrypted on first launch. On a
platform with no credential store available, it falls back to plaintext with a console warning
rather than refusing to start — so the encrypted-at-rest guarantee holds on macOS/Windows but
not necessarily on a bare Linux box.

The clarification loop, content-preview step, and per-role model tick boxes (see "The flow, in
detail" above) are the newest additions. They've been logic-tested the same way as the base
flow — a stand-in Ollama server exercising the proactive clarify/re-plan round-trip, a
first-model-fails/second-model-succeeds fallback chain, and the `buildContent`/`createOutput`
split for all three output types (each written file inspected, not just checked for existence)
— but **not yet driven through a real Electron window**, since this sandbox can't run one.
Worth a real run before calling this batch done.

Remaining before public distribution: code-signing + notarization (needs an Apple Developer
ID — see below), and a formal QA pass.

## Building a macOS app

```
npm install
npm run pack   # unpacked LazyOffice.app in release/mac-arm64/ (no signing — fastest)
npm run dist   # .dmg + .zip in release/ (still unsigned)
```

Both produce an **unsigned** app. macOS Gatekeeper will warn on first open (right-click →
Open, or `xattr -dr com.apple.quarantine <app>`). Real distribution needs a Developer ID
cert + notarization — not set up yet.

### Setup gotcha (Node 26)

`npm install` alone does **not** produce a working `electron` binary here: electron's bundled
`extract-zip` (yauzl) fails partway through extraction on Node 26, leaving a ~256K stub and no
`node_modules/electron/path.txt`. The cached zip itself is intact (`unzip -t` passes) — only
the JS extractor is broken. Workaround: extract with macOS-native `ditto` and write `path.txt`
manually:

```
ZIP=$(find ~/Library/Caches/electron -name 'electron-v*-darwin-arm64.zip' | head -1)
rm -rf node_modules/electron/dist && mkdir -p node_modules/electron/dist
ditto -x -k "$ZIP" node_modules/electron/dist
printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
```

(`electron-builder`'s own extractor is unaffected — `npm run pack`/`dist` work fine.)

## Code-signing & notarization

The build is currently **unsigned** (`electron-builder` reports "0 identities found"), so
macOS Gatekeeper warns on first open (right-click → Open, or
`xattr -dr com.apple.quarantine <app>`). To sign + notarize for real distribution you need an
Apple Developer ID:

1. Enroll in the Apple Developer Program and install a "Developer ID Application" certificate
   in your login keychain.
2. `electron-builder` auto-detects the identity; for notarization add an
   `afterSign` notarize hook (`@electron/notarize`) with an app-specific password or an App
   Store Connect API key, plus `"hardenedRuntime": true` under `build.mac`.

Everything else (icon, packaging, entitlements-free runtime) is already in place — only the
cert + notarize credentials are missing, and those are owner-provided.

## Known gaps

- Unsigned build (see above) — the only blocker to distributing outside your own machine.
- No automated test suite yet — verification so far is manual + the end-to-end renderer drive
  described under Status.
- No formal QA-Squad pass has run against the app.
