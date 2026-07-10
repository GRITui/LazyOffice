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
| LLM backends | Claude API, or local Ollama (script properties) | **Per-role backends** — each of the First Goal doc's 5 roles independently wired to Ollama, the Claude CLI, or a custom OpenAI-compatible endpoint (Settings panel) — no Claude API/API-key option here |

`engine.js` started as a near-1:1 port of `Code.gs`'s LLM logic and has been through several
iterations since: the First Goal doc's original multi-model, per-role pipeline
(`OLLAMA_ROLE_MODELS`) was collapsed to a single verified model (Llama 3.1 8B Instruct) at one
point, then **restored** — see "Per-role backends" below — once it became clear "one model for
everything" and "no way to pick per-role backends" were in tension with actually wanting the
flexibility back. `docgen.js` has no GAS equivalent — it's the other real divergence, and it
goes further than the webapp: the First Goal doc's mission covers documents, spreadsheets, *and*
presentations, so this desktop track implements all three (the webapp still only does
documents). Pick the output type in the UI; `docgen.js` writes a real `.docx` (`docx`
package), `.xlsx` (`xlsx`/SheetJS), or `.pptx` (`pptxgenjs`) accordingly — no
`DocumentApp`/`SpreadsheetApp`/`SlidesApp` involved.

## The flow, in detail

The chat → plan → approve loop from the webapp is extended here with two extra checkpoints,
both aimed at catching mistakes before a file gets written rather than after:

1. **Describe.** Type a request (and optionally attach reference files/links).
2. **Clarify (only if needed).** Before drafting a plan, the **Orchestrator** role judges whether
   the request has enough detail — using whatever backend/model Settings has that role pointed
   at (Ollama by default, `qwen3.5:9b`). If something material is missing (subject, scope,
   audience, data source, length) and it can't make a reasonable assumption, it asks 1-3 short
   questions instead of guessing — answer them and it re-checks, repeating until it has enough
   (capped at 3 rounds, after which it drafts its best plan with reasonable assumptions rather
   than looping forever). Most clear requests skip this step entirely.
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

## Per-role backends

Each of the First Goal doc's 5 roles — **Orchestrator, Planner, Syntax Enforcer, Code Engine,
Generalist** — is independently wired to a backend in Settings. This went through two prior
states worth knowing about: the original design had this same 5-role flexibility but only
within Ollama (a tick-box fallback chain of *models*, one fixed backend); that was then
collapsed to a single verified model (Llama 3.1 8B Instruct) for everything. This is the third
state — real per-role flexibility again, generalized beyond just Ollama tags.

**Out of the box**, every role defaults to Ollama with the First Goal doc's original
recommended model — no API key, nothing sent to the cloud unless you point a role somewhere
else:

| Role | Default model | Ollama tag |
| --- | --- | --- |
| Orchestrator | Qwen3.5-9B | `qwen3.5:9b` |
| Planner | DeepSeek-R1-Distill-Qwen-7B | `deepseek-r1:7b` |
| Syntax Enforcer | Phi-4-mini (3.8B) | `phi4-mini:3.8b` |
| Code Engine | IBM Granite 4.1 8B | `granite4.1:8b` |
| Generalist | Llama 3.1 8B Instruct | `llama3.1:8b` |

**Each role can be switched independently** to one of three backend types (see
`engine.js`'s `BACKEND_TYPES`/`ROLE_DEFAULTS`, and the Settings panel's per-role fieldsets):

- **Ollama (local)** — any model tag, against the shared `OLLAMA_URL` server (or a per-role
  override, if ever set directly in `ROLE_BACKEND_CONFIG` — the UI only exposes the shared URL
  today, not a per-role one, to keep the form from growing a 4th field per role).
- **Claude CLI** — shells out to a locally-installed `claude` binary (see "Claude CLI backend"
  below); path and model are per-role.
- **Custom (OpenAI-compatible endpoint)** — any server speaking the OpenAI chat-completions
  shape (LM Studio, OpenRouter, a different local Ollama instance, etc.): URL, optional API key,
  model, all per-role. This is what makes it genuinely "any model," not just the two backends
  already built for this app.

A role with no stored override at all behaves exactly like a fresh install — the table above is
the fallback, not just a UI placeholder (see `engine.js`'s `resolveRoleConfig`).

**Known gap:** a custom endpoint's API key, if you set one, is stored in plaintext in
`config.json` — the same as `OLLAMA_URL`/a Claude CLI path. There's no separately-managed
Anthropic API key in this app to justify safeStorage-encrypting one field again, but a
genuinely secret third-party key typed into this form isn't protected at rest. Worth fixing
before this leaves prototype status.

### First-run model setup

On first launch, the app checks the local Ollama server (`setup-llm.js`) against whichever
roles are *currently* configured for the Ollama backend — computed dynamically
(`engine.computeOllamaRequiredModels`), not a fixed list, so switching a role to Claude CLI or a
custom endpoint removes it from what gets checked/downloaded:

- If Ollama **isn't running** but at least one role needs it, the panel points you to
  https://ollama.com/download and offers a Recheck button (the Ollama runtime itself is a
  system component — the app never installs it for you). You can also just switch those roles
  to a different backend in Settings.
- If Ollama **is running**, it lists which of the currently-required tags are missing and
  downloads only those, streaming progress. **Already installed is detected and kept** — it
  never re-downloads what you have. "Skip for now" dismisses the panel; completion is
  remembered (`LLM_SETUP_DONE`).
- If **no role** is currently set to Ollama, the panel never appears — there's nothing to check.

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
none of that is confirmed against the genuine binary yet. There is no special-cased bypass
anymore for any role — Orchestrator, Planner, Syntax Enforcer, Code Engine, and Generalist are
all equally free to be pointed at Claude CLI (or any other backend type) independently; see
"Per-role backends" above.

## What's here

- `main.js` — Electron main process: creates the window, wires IPC handlers for
  `getPlan`/`classifyAttachments`/`buildContent`/`createOutput`/settings/`openInFinder`, the
  first-run `llmStatus`/`llmSetup` flow, and `getRoleCatalog` (hands the renderer
  `engine.ROLE_DEFAULTS`/`engine.BACKEND_TYPES` so the Settings UI is always built from the same
  data `engine.js` actually dispatches on, not a hand-maintained copy).
- `setup-llm.js` — first-run local-model detection + pulling (Ollama HTTP API). Takes the list of
  required tags as a parameter now rather than a hardcoded constant — `main.js` computes it fresh
  from `engine.computeOllamaRequiredModels()` on every call, so it always reflects whichever
  roles are currently pointed at Ollama.
- `preload.js` — exposes a `window.desktop` bridge to the renderer (contextIsolation on,
  nodeIntegration off).
- `engine.js` — LLM logic, restructured around per-role dispatch. `ROLE_DEFAULTS` maps each of
  the First Goal doc's 5 roles (Orchestrator, Planner, Syntax Enforcer, Code Engine, Generalist)
  to a default backend type + model; `resolveRoleConfig(role)` merges that default with whatever
  override is stored in `ROLE_BACKEND_CONFIG`; `callRole(role, systemPrompt, userPrompt)` resolves
  and dispatches a single role's call to `callOpenAiStyle` (used for both the Ollama and
  OpenAI-compatible-custom backend types) or `callClaudeCliProcess` (shells out to a local
  `claude` CLI — see "Claude CLI backend" above), and wraps any failure with the role's label and
  backend so errors are traceable to which role/backend failed. `computeOllamaRequiredModels()`
  derives the first-run download list dynamically from whichever roles currently resolve to
  Ollama. `getPlan`'s clarification loop and every content-drafting call in `docgen.js` all go
  through `callRole` now — there's no more special-cased bypass for any one role. No dead GAS-mock
  code — a desktop app always has a real backend, so the mock/`isGasEnv` branching from
  `Index.html` was dropped, not ported.
- `docgen.js` — turns the generated JSON into a real file on disk. `buildDocumentContent`/
  `buildSpreadsheetContent`/`buildPresentationContent` (+ the `buildContent` dispatcher) draft
  content only, for the preview step, via `callRole('code_engine', ...)`; `createDocument`/
  `createSpreadsheet`/`createPresentation` (+ the `createOutput` dispatcher) write the
  already-previewed content to disk. `generateDocument`/`generateSpreadsheet`/
  `generatePresentation` remain as one-shot build+create helpers. JSON repair goes through
  `callRole('syntax_enforcer', ...)`; result summaries go through `callRole('generalist', ...)`.
- `config-store.js` — local JSON-file settings store, same shape as GAS's
  `PropertiesService.getScriptProperties()` so `engine.js` didn't need restructuring. Plaintext —
  an earlier version encrypted the Anthropic API key at rest via Electron's `safeStorage`; that
  machinery was removed along with the Claude API option. `ROLE_BACKEND_CONFIG` (including any
  custom endpoint's API key) is stored the same plaintext way — see "Known gap" above.
- `renderer/index.html` — the UI, ported from `apps-script/Index.html` with the mock banner/
  `google.script.run` detection removed, a Document/Spreadsheet/Presentation type selector, a
  clarification card, a content-preview card, the result card showing a file path + "Show in
  Finder" instead of a Drive link, and a Settings panel built from `getRoleCatalog`: a shared
  Ollama URL field plus one fieldset per role (backend-type selector + the fields relevant to
  that type — model tag for Ollama, path/model for Claude CLI, url/API key/model for a custom
  endpoint).

## Running it

```
cd desktop-app
npm install
npm start
```

On first launch every role is already set to its Ollama default (default port matches
`ollama serve`'s standard `11434`); open **Settings** to switch any individual role to "Claude
CLI" (needs the `claude` CLI installed and logged in on this machine — set a custom path there if
it's not on `PATH`) or to a custom OpenAI-compatible endpoint (URL + optional API key + model).
Pick Document, Spreadsheet, or Presentation, describe what you want, answer any clarifying
questions if asked, review the plan, approve to see a preview, then Create File — it lands in
`~/Documents/LazyOffice/`.

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

The per-role backend rebuild is the newest change: the single-global-model architecture (one
model, `LLM_PROVIDER`-selected) has been replaced with independent per-role backend config for
all 5 First Goal doc roles, plus a third backend type (a generic OpenAI-compatible endpoint) —
see "Per-role backends" above. Verified via a logic-test harness: two fake OpenAI-compatible
HTTP servers (standing in for "the shared Ollama server" and "a custom endpoint") plus a fake
`claude` CLI, asserting that (1) a fresh install's defaults exactly match the First Goal doc's
5-role mapping, (2) an unconfigured role calls the shared Ollama URL with its default model, (3)
overriding one role's type/model/url/path in `ROLE_BACKEND_CONFIG` redirects only that role,
leaving the others on their defaults, (4) `computeOllamaRequiredModels()` correctly drops a role
out once it's pointed elsewhere, and (5) the full `buildContent` → `createOutput` pipeline still
produces a valid `.docx` when Code Engine is routed through a completely different backend than
the rest of the app. **Not verified: a real Electron window, a real Ollama server, a real
`claude` CLI, or a real third-party OpenAI-compatible endpoint** — this sandbox has none of
those, so the logic tests above confirm the dispatch/routing/config-merge code paths are correct,
not that every backend type actually works end-to-end against genuine infrastructure. Treat the
Claude CLI and custom-endpoint backends as frameworks to validate on the Owner's machine, not
finished features.

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
- Claude CLI and custom-endpoint backends are framework-only — never run against a real `claude`
  binary or a real third-party server (see Status).
- A custom endpoint's API key is stored in plaintext in `config.json`, same as the other
  settings — see "Per-role backends" above.
- No automated test suite yet — verification so far is manual + the end-to-end renderer drive
  described under Status.
- No formal QA-Squad pass has run against the app.
