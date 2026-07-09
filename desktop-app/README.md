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
  `getPlan`/`classifyAttachments`/`generateOutput`/settings/`openInFinder` and the first-run
  `llmStatus`/`llmSetup` flow.
- `setup-llm.js` — first-run local-model detection + pulling (Ollama HTTP API).
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
headings/rows/slides, and a native chart in the deck), not just its existence. On macOS (this
app's target) the API key is encrypted at rest via the OS keychain (Electron `safeStorage`);
a pre-existing plaintext key is migrated to encrypted on first launch. On a platform with no
credential store available, it falls back to plaintext with a console warning rather than
refusing to start — so the encrypted-at-rest guarantee holds on macOS/Windows but not
necessarily on a bare Linux box.

Remaining before public distribution: code-signing + notarization (needs an Apple Developer
ID — see below), and a formal QA pass.

## Installing (Apple Silicon)

Download the `.dmg` from the [Releases](https://github.com/GRITui/LazyOffice/releases) page,
open it, and drag **LazyOffice** to Applications.

> ⚠️ **"LazyOffice is damaged and can't be opened"** — this is expected on the current
> **unsigned** build, not an actual problem and not a chip mismatch (the app is native
> arm64). macOS shows this for any app that isn't notarized by Apple once a browser has
> flagged it as downloaded. **Fix it once:**
>
> ```
> xattr -dr com.apple.quarantine /Applications/LazyOffice.app
> ```
>
> Then open it normally. (A notarized build — see below — removes this step entirely.)

Requires [Ollama](https://ollama.com/download) installed and running for the local default;
or switch to the Claude API in Settings.

## Building a macOS app

```
npm install
npm run pack   # unpacked LazyOffice.app in release/mac-arm64/ (no signing — fastest)
npm run dist   # .dmg + .zip in release/ (unsigned unless Apple creds are set — see below)
```

Without Apple credentials this produces an **unsigned** app (see the install note above for
the Gatekeeper workaround). The signing/notarization config is already wired — supplying a
cert + credentials is all that's needed to get a notarized build.

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

## Code-signing & notarization (turnkey — just add a cert)

The build config is **fully wired for notarization** — hardened runtime, entitlements
(`build/entitlements.mac.plist`), and an env-gated `afterSign` notarize hook
(`scripts/notarize.js`, using `@electron/notarize`). With no credentials it cleanly no-ops
and produces today's unsigned build; with credentials, `npm run dist` signs **and** notarizes
automatically. To turn it on:

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/yr;
   ~1–2 days to approve) and install a **"Developer ID Application"** certificate in your
   login keychain (Xcode → Settings → Accounts → Manage Certificates, or download from the
   developer portal). `electron-builder` auto-detects it.
2. Create an **app-specific password** at [appleid.apple.com](https://appleid.apple.com) →
   Sign-In & Security → App-Specific Passwords, and note your **Team ID**
   (developer.apple.com → Membership).
3. Set the env vars and build:

   ```
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="XXXXXXXXXX"
   npm run dist          # signs with hardened runtime, then notarizes (a few minutes)
   ```

   (Or use an App Store Connect API key: `APPLE_API_KEY` / `APPLE_API_KEY_ID` /
   `APPLE_API_ISSUER` instead of the Apple ID trio.)

The resulting `.dmg` opens with a normal double-click on any Mac — no `xattr`, no "damaged"
prompt. Nothing else in the build needs to change.

## Known gaps

- Unsigned build (see above) — the only blocker to distributing outside your own machine.
- No automated test suite yet — verification so far is manual + the end-to-end renderer drive
  described under Status.
- No formal QA-Squad pass has run against the app.
