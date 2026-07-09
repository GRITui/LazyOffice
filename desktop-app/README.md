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
| LLM backends | Claude API, or local Ollama (script properties) | Same: Claude API, or local Ollama (Settings panel) |

`engine.js` is a deliberate near-1:1 port of `Code.gs`'s LLM logic (same function names/
shapes, same 5-model `OLLAMA_ROLE_MODELS` mapping from the First Goal doc) so the two stay
easy to compare. `docgen.js` has no GAS equivalent — it's the one real divergence, and it
goes further than the webapp: the First Goal doc's mission covers documents, spreadsheets,
*and* presentations, so this desktop track implements all three (the webapp still only does
documents). Pick the output type in the UI; `docgen.js` writes a real `.docx` (`docx`
package), `.xlsx` (`xlsx`/SheetJS), or `.pptx` (`pptxgenjs`) accordingly — no
`DocumentApp`/`SpreadsheetApp`/`SlidesApp` involved.

## What's here

- `main.js` — Electron main process: creates the window, wires IPC handlers for
  `getPlan`/`classifyAttachments`/`generateOutput`/settings/`openInFinder`.
- `preload.js` — exposes a `window.desktop` bridge to the renderer (contextIsolation on,
  nodeIntegration off).
- `engine.js` — ported LLM logic (`callLLM`/`callClaude`/`callOllama`, attachment role
  classification, prompt building, output-type-aware plan drafting). No dead GAS-mock code —
  a desktop app always has a real backend, so the mock/`isGasEnv` branching from
  `Index.html` was dropped, not ported.
- `docgen.js` — turns the generated JSON into a real file on disk: `generateDocument`,
  `generateSpreadsheet`, `generatePresentation`, and a `generateOutput(request, attachments,
  outputType)` dispatcher that picks between them.
- `config-store.js` — local JSON-file settings store, same shape as GAS's
  `PropertiesService.getScriptProperties()` so `engine.js` didn't need restructuring.
- `renderer/index.html` — the UI, ported from `apps-script/Index.html` with the mock banner/
  `google.script.run` detection removed, a Document/Spreadsheet/Presentation type selector
  added, the result card showing a file path + "Show in Finder" instead of a Drive link, and
  a new Settings panel (the desktop equivalent of Apps Script's Script Properties editor).

## Running it

```
cd desktop-app
npm install
npm start
```

On first launch, open **Settings** and either paste your Anthropic API key, or switch the
provider to "Local Ollama" and set the URL/models (defaults match `ollama serve`'s standard
port and the First Goal doc's model tags — see the root `README.md`'s Ollama table). Pick
Document, Spreadsheet, or Presentation, describe what you want, review the plan, approve, and
the file lands in `~/Documents/LazyOffice/`.

## Status

Scaffolded and logic-tested (the Claude and Ollama code paths, and real `.docx`/`.xlsx`/
`.pptx` generation for all three output types, were verified against local stand-in
servers — see commit history for details; each generated file was unzipped and its actual
content checked, not just its existence). **Now confirmed to launch in a real Electron
window** and **packaged into a `.app`** via `electron-builder` (see Building below); the
window renders and the renderer/IPC/Settings layer loads without error. Not yet exercised:
driving a full request → plan → approve → file generation *through the GUI* on a machine with
a real API key or Ollama configured (the code paths behind it are verified headlessly, but
the end-to-end click-through hasn't been done).

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

## Known gaps

- Unsigned build only — no code-signing/notarization yet (needed for distribution outside your
  own machine); no app icon (uses the default Electron icon).
- Full GUI click-through (request → plan → approve → file) not yet driven on a machine with a
  live API key; only the underlying code paths are verified headlessly.
- No automated tests beyond the manual verification during development.
- Settings are stored in plaintext JSON (`config.json` in the OS user-data dir) — fine for a
  prototype, not for a shipped app holding a real API key.
