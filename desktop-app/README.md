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
| LLM backends | Claude API, or local Ollama (script properties) | **Local Ollama (one model) by default**; Claude CLI opt-in (Settings panel) — no Claude API/API-key option here |

`engine.js` started as a near-1:1 port of `Code.gs`'s LLM logic and has since diverged: the
First Goal doc's multi-model, per-role pipeline (`OLLAMA_ROLE_MODELS`, a tick-box fallback
chain) was tried and then deliberately simplified away once it was verified that a single local
model (Llama 3.1 8B Instruct) is all this app actually needs — see "Local backend: one model"
below. `docgen.js` has no GAS equivalent — it's the other real divergence, and it goes further
than the webapp: the First Goal doc's mission covers documents, spreadsheets, *and*
presentations, so this desktop track implements all three (the webapp still only does
documents). Pick the output type in the UI; `docgen.js` writes a real `.docx` (`docx`
package), `.xlsx` (`xlsx`/SheetJS), or `.pptx` (`pptxgenjs`) accordingly — no
`DocumentApp`/`SpreadsheetApp`/`SlidesApp` involved.

## The flow, in detail

The chat → plan → approve loop from the webapp is extended here with two extra checkpoints,
both aimed at catching mistakes before a file gets written rather than after:

1. **Describe.** Type a request (and optionally attach reference files/links).
2. **Clarify (only if needed).** Before drafting a plan, a dedicated **prompt auditor** judges
   whether the request has enough detail. This step always runs on the one local model
   (Llama 3.1 8B Instruct via Ollama), regardless of the backend selected in Settings — it stays
   fast, free, and available even when the backend that drafts the actual output is pointed at
   the Claude CLI. If something material is missing (subject, scope, audience, data source,
   length) and it can't make a reasonable assumption, it asks 1-3 short questions instead of
   guessing — answer them and it re-checks, repeating until it has enough (capped at 3 rounds,
   after which it drafts its best plan with reasonable assumptions rather than looping forever).
   Most clear requests skip this step entirely.
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

## Local backend: one model

Out of the box the app runs entirely on a **local Ollama server running exactly one model**,
Llama 3.1 8B Instruct (`engine.js`'s `OLLAMA_MODEL`) — no API key, nothing sent to the cloud.
Earlier prototypes routed different pipeline stages (Orchestrator, Planner, Syntax Enforcer,
Code Engine, Generalist) to different First Goal doc models via a Settings tick-box grid; once
it was verified that Llama 3.1 8B alone handles every stage well enough, that whole per-role
selection system (`OLLAMA_ROLE_MODELS`, the fallback-chain tick boxes, the other four model
downloads) was removed rather than left as unused complexity. There is now exactly one local
model to install, configure, or reason about.

The **Claude API option is gone too** — no API key field, no key encrypted at rest. The cloud
option is now the **Claude CLI** (see below): it shells out to a `claude` binary you already
have installed and logged in locally, instead of LazyOffice managing its own separately-issued
API key.

### First-run model setup

On first launch, if the backend is the local default, the app checks the local Ollama server
(`setup-llm.js`) and shows a one-time setup panel:

- If Ollama **isn't running**, it points you to https://ollama.com/download and offers a
  Recheck button (the Ollama runtime itself is a system component — the app never installs it
  for you). You can also just switch to Claude CLI in Settings.
- If Ollama **is running** but `llama3.1:8b` isn't pulled yet, it downloads it, streaming
  progress. **Already installed is detected and kept** — it never re-downloads what you have.
  "Skip for now" dismisses the panel; completion is remembered (`LLM_SETUP_DONE`).

Uses Ollama's native HTTP API (`GET /api/tags`, `POST /api/pull`); the host is derived from
the `OLLAMA_URL` setting (default `http://127.0.0.1:11434`).

## Claude CLI backend (framework stage)

An alternative backend for the content-generation stage: instead of a separately-managed
Anthropic API key, `engine.callClaudeCli` shells out to a locally-installed `claude` CLI in
one-shot mode, riding on whatever login/subscription that CLI already has configured. Select
"Claude CLI" in Settings and optionally set a custom binary path/model.

Invocation shape (see `engine.js` for the exact argv):

```
claude --bare -p "<user prompt>" --append-system-prompt "<system prompt>" \
  --output-format json --allowedTools "" --model <model>
```

- `--allowedTools ""` and `--bare` are deliberate safety choices, not defaults: a plain "draft
  this content" call has no business running Bash or editing files, and since it's spawned
  headlessly there is no TTY to answer a permission prompt if the CLI decided it needed one —
  without `--allowedTools ""` a call could simply hang forever waiting for approval that will
  never come. `--bare` also skips this repo's own hooks/MCP/skills, since the call runs with
  `cwd` set to a scratch temp directory, not the LazyOffice project.
- `--output-format json` gives a `{"result": "...", ...}` shape parsed for the `result` field,
  rather than scraping plain-text stdout.
- Non-zero exit and "binary not found" (ENOENT) both surface as a descriptive rejected promise
  (see `callClaudeCli`'s error handling) rather than a raw stack trace.

**Status: framework only, not run against a real installed CLI.** This was built from the
documented headless-mode flags (`code.claude.com/docs/en/headless.md`,
`code.claude.com/docs/en/permission-modes.md`) and logic-tested against a fake `claude` binary
stand-in — asserting the exact argv shape (`--bare`/`--allowedTools ""`/`--output-format json`),
successful JSON-result parsing, a non-zero-exit error path, and an ENOENT/not-installed error
path — but this sandbox has no real `claude` CLI to spawn the way the Owner's machine does, so
none of that is confirmed against the genuine binary yet. Also unverified: the prompt-auditor
step still bypasses this backend entirely and always calls local Ollama (confirmed in the same
test), which is intentional (see "The flow, in detail" above) but worth knowing if you're
expecting every LLM call to go through the CLI once it's selected.

## What's here

- `main.js` — Electron main process: creates the window, wires IPC handlers for
  `getPlan`/`classifyAttachments`/`buildContent`/`createOutput`/settings/`openInFinder` and the
  first-run `llmStatus`/`llmSetup` flow.
- `setup-llm.js` — first-run local-model detection + pulling (Ollama HTTP API); checks for the
  one required model, `llama3.1:8b`.
- `preload.js` — exposes a `window.desktop` bridge to the renderer (contextIsolation on,
  nodeIntegration off).
- `engine.js` — LLM logic. `callLLM` dispatches on the `LLM_PROVIDER` setting to `callOllama`
  (always `OLLAMA_MODEL`, i.e. `llama3.1:8b` — no role/model choice left to make) or
  `callClaudeCli` (shells out to a local `claude` CLI — see "Claude CLI backend" above).
  `getPlan`'s clarification loop calls `callPromptAuditor` directly instead of going through
  `callLLM`, so it always stays on local Ollama regardless of which backend is selected. No dead
  GAS-mock code — a desktop app always has a real backend, so the mock/`isGasEnv` branching from
  `Index.html` was dropped, not ported.
- `docgen.js` — turns the generated JSON into a real file on disk. `buildDocumentContent`/
  `buildSpreadsheetContent`/`buildPresentationContent` (+ the `buildContent` dispatcher) draft
  content only, for the preview step; `createDocument`/`createSpreadsheet`/`createPresentation`
  (+ the `createOutput` dispatcher) write the already-previewed content to disk.
  `generateDocument`/`generateSpreadsheet`/`generatePresentation` remain as one-shot build+create
  helpers.
- `config-store.js` — local JSON-file settings store, same shape as GAS's
  `PropertiesService.getScriptProperties()` so `engine.js` didn't need restructuring. Plaintext —
  an earlier version encrypted the Anthropic API key at rest via Electron's `safeStorage`; that
  machinery was removed along with the Claude API option, since nothing left stored here is a
  secret.
- `renderer/index.html` — the UI, ported from `apps-script/Index.html` with the mock banner/
  `google.script.run` detection removed, a Document/Spreadsheet/Presentation type selector, a
  clarification card, a content-preview card, the result card showing a file path + "Show in
  Finder" instead of a Drive link, and a Settings panel (backend selector, Ollama URL, Claude
  CLI path/model — no API key field).

## Running it

```
cd desktop-app
npm install
npm start
```

On first launch the app is already set to "Local Ollama" (default port matches `ollama serve`'s
standard `11434`); open **Settings** to switch the backend to "Claude CLI" instead (needs the
`claude` CLI installed and logged in on this machine — set a custom path there if it's not on
`PATH`). Pick Document, Spreadsheet, or Presentation, describe what you want, answer any
clarifying questions if asked, review the plan, approve to see a preview, then Create File — it
lands in `~/Documents/LazyOffice/`.

## Status

Runs in a real Electron window and is **packaged into a `.app`** (with a custom icon) via
`electron-builder` (see Building below) — confirmed working on the Owner's machine. The base
flow has been **driven end-to-end through the real renderer** — for each of the three output
types, a request → plan (Get Plan) → approve → file-write cycle was exercised against a local
stand-in LLM, and each resulting `.docx`/`.xlsx`/`.pptx` was opened and its content verified
(real headings/rows/slides, and a native chart in the deck), not just its existence.

The clarification loop and content-preview step (see "The flow, in detail" above) are logic-
tested — a stand-in Ollama server exercising the proactive clarify/re-plan round-trip and the
`buildContent`/`createOutput` split for all three output types (each written file inspected,
not just checked for existence) — but **not yet driven through a real Electron window** since
this sandbox can't run one. Worth a real run before calling this batch done.

The single-local-model collapse and the Claude API → Claude CLI swap are the newest changes.
Verified: `engine.OLLAMA_MODEL` is the only local model referenced anywhere in the codebase now
(`callClaude` is gone entirely); the prompt auditor still runs on local Ollama even when
`LLM_PROVIDER` is `claude-cli` (confirmed via the actual model name sent); `callClaudeCli`'s
argv shape, successful-response parsing, non-zero-exit handling, and "binary not found" handling
were all exercised against a fake `claude` binary standing in for the real thing. **Not
verified: the real `claude` CLI itself** — this sandbox has none installed, so nothing here
confirms the assumed flags (`--append-system-prompt`, `--allowedTools`, `--output-format json`,
`--model`, `--bare`) still match a real installation, or that a real response actually looks
like `{"result": "..."}`. Treat the Claude CLI backend as a framework to validate on the Owner's
machine, not a finished feature.

Remaining before public distribution: code-signing + notarization (needs an Apple Developer
ID — see below), a real run of the Claude CLI backend, and a formal QA pass.

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
- Claude CLI backend is framework-only — never spawned a real `claude` binary (see Status).
- No automated test suite yet — verification so far is manual + the end-to-end renderer drive
  described under Status.
- No formal QA-Squad pass has run against the app.
