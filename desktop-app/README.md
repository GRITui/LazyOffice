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
| Output | Real Google Doc via `DocumentApp` | Local `.docx` file (`~/Documents/LazyOffice/`) — no Google account needed |
| Settings | Apps Script Script Properties (editor UI) | In-app Settings panel → local `config.json` in the OS user-data dir |
| LLM backends | Claude API, or local Ollama (script properties) | Same: Claude API, or local Ollama (Settings panel) |

`engine.js` is a deliberate near-1:1 port of `Code.gs`'s LLM logic (same function names/
shapes, same 5-model `OLLAMA_ROLE_MODELS` mapping from the First Goal doc) so the two stay
easy to compare. The only real divergence is `docgen.js`, which has no GAS/`DocumentApp`
equivalent — it writes an actual `.docx` with the `docx` npm package instead.

## What's here

- `main.js` — Electron main process: creates the window, wires IPC handlers for
  `getPlan`/`classifyAttachments`/`generateDoc`/settings/`openInFinder`.
- `preload.js` — exposes a `window.desktop` bridge to the renderer (contextIsolation on,
  nodeIntegration off).
- `engine.js` — ported LLM logic (`callLLM`/`callClaude`/`callOllama`, attachment role
  classification, prompt building). No dead GAS-mock code — a desktop app always has a real
  backend, so the mock/`isGasEnv` branching from `Index.html` was dropped, not ported.
- `docgen.js` — turns the generated JSON into a real `.docx` on disk.
- `config-store.js` — local JSON-file settings store, same shape as GAS's
  `PropertiesService.getScriptProperties()` so `engine.js` didn't need restructuring.
- `renderer/index.html` — the UI, ported from `apps-script/Index.html` with the mock banner/
  `google.script.run` detection removed, the result card showing a file path + "Show in
  Finder" instead of a Drive link, and a new Settings panel (the desktop equivalent of
  Apps Script's Script Properties editor).

## Running it

```
cd desktop-app
npm install
npm start
```

On first launch, open **Settings** and either paste your Anthropic API key, or switch the
provider to "Local Ollama" and set the URL/models (defaults match `ollama serve`'s standard
port and the First Goal doc's model tags — see the root `README.md`'s Ollama table). Then
describe a document, review the plan, approve, and the `.docx` lands in
`~/Documents/LazyOffice/`.

## Status

Scaffolded and logic-tested (both the Claude and Ollama code paths, and real `.docx`
generation, were verified against local stand-in servers — see commit history for details).
**Not yet run inside an actual Electron window** — installing the `electron` binary needs
network access to its download CDN, which wasn't available in the sandbox this was built in.
Also not yet packaged for macOS distribution (no `electron-builder`/notarization setup yet).

## Known gaps

- No macOS packaging/code-signing/notarization yet (needed for real distribution outside your
  own machine).
- No automated tests beyond the manual verification during development.
- Settings are stored in plaintext JSON (`config.json` in the OS user-data dir) — fine for a
  prototype, not for a shipped app holding a real API key.
