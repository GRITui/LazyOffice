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

Runs in a real Electron window and is **packaged into a `.app`** (with a custom icon) via
`electron-builder` (see Building below). The full flow has been **driven end-to-end through
the real renderer** — for each of the three output types, a request → plan (Get Plan) →
approve (Approve & Generate) → file-write cycle was exercised against a local stand-in LLM,
and each resulting `.docx`/`.xlsx`/`.pptx` was opened and its content verified (real
headings/rows/slides, and a native chart in the deck), not just its existence. The API key is
encrypted at rest via the OS keychain (Electron `safeStorage`), not stored in plaintext.

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
