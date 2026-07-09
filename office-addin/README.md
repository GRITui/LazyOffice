# LazyOffice — Microsoft Office Add-in (prototype)

A third track alongside `apps-script/` (GAS Web App, paused) and `desktop-app/` (Electron,
in progress): the same describe → review → approve flow, this time running *inside* Word,
Excel, or PowerPoint as an Office Add-in — insert directly into the document you already
have open, instead of creating a separate file.

## Why this is architecturally different, not just another shell

Both earlier tracks control their own output: the webapp creates a Google Doc via
`DocumentApp`; the desktop app writes a `.docx`/`.xlsx`/`.pptx` to disk. An Office Add-in has
neither option — it runs as JavaScript inside a sandboxed webview hosted by the Office
application itself (Office.js), with no Node/Electron access and no filesystem access. Three
consequences that shaped every file in here:

1. **No direct LLM calls from the client.** The task pane is a webpage; Anthropic's API
   doesn't set CORS headers for browser origins, so a `fetch()` straight from `taskpane.js`
   to `api.anthropic.com` would be blocked. `server/` is a small local Express server the
   task pane talks to instead — same role as `desktop-app/main.js`'s IPC bridge, just over
   HTTP instead of Electron IPC.
2. **No files written to disk.** `server/content.js` (not `docgen.js` — deliberately renamed,
   since there's no "doc" being written) returns *structured content* for Word and Excel;
   `taskpane.js` inserts it into the live document/worksheet directly via `Word.run`/
   `Excel.run`. Nothing lands in a Documents folder.
3. **PowerPoint is the exception.** Office.js has no `Word.run`-style "write these slides"
   API — there's no direct way to add fully-themed slides with a chart the way you can write
   paragraphs or cells. So for presentations, the server still builds a real `.pptx` in memory
   (reusing the exact same `pptxgenjs` corporate-theme writer as `desktop-app/docgen.js` —
   accent title slide, branded footer, native chart) and hands it to the task pane as base64,
   which merges it into the open presentation via `context.presentation.insertSlidesFromBase64`.
   **This one API call is unverified** — see the caveat below.

## What's here

- `manifest.xml` — the Office Add-in manifest. Declares Word/Excel/PowerPoint hosts and
  points at `https://localhost:3000/taskpane/taskpane.html`.
- `server/`
  - `server.js` — Express server, HTTPS (Office requires it, even locally — see Running It
    below), serves the task pane + `manifest.xml`/`assets/` as static files, and exposes
    `/api/getPlan`, `/api/classifyAttachments`, `/api/generateContent`, `/api/settings`.
  - `engine.js` — same LLM logic as `desktop-app/engine.js` (`callLLM`/`callClaude`/
    `callOllama`, attachment role classification, the First Goal doc's 5-model
    `OLLAMA_ROLE_MODELS` mapping, output-type-aware `getPlan`).
  - `content.js` — the real divergence from `desktop-app/docgen.js`: returns
    `{ parsed, summary }` (plus `pptxBase64` for presentations) instead of a file path. Same
    Syntax Enforcer repair step and Generalist summary as the desktop app.
  - `config-store.js` — local JSON settings file (`~/.lazyoffice/config.json`) — same shape as
    the desktop app's, just without an Electron `app.getPath()` to ask.
- `taskpane/taskpane.html` + `taskpane.js` — the UI. Detects which Office host it's running
  in (`Office.onReady`) and locks the output type to match — a Word doc only offers to insert
  a document, Excel only a spreadsheet, PowerPoint only a presentation. This is a deliberate
  departure from the desktop app's three-way selector: you're already inside a specific
  document, so asking "what kind of file?" doesn't make sense here the way it does in a
  standalone app.
- `assets/icon-16.png` / `icon-32.png` / `icon-80.png` — placeholder icons (manifest
  validation requires the files to exist; replace with real branding before shipping).

## Running it

```
cd office-addin
npm install
npm start
```

First run installs a locally-trusted dev HTTPS certificate via `office-addin-dev-certs`
(standard tooling for every Office Add-in — Office refuses to load an `http://` task pane,
even on localhost). Then sideload it into Word/Excel/PowerPoint:

```
npx office-addin-debugging start manifest.xml
```

This launches the target Office application with the add-in already sideloaded. Open the
task pane from the ribbon, open Settings, add your Anthropic API key (or switch to local
Ollama), and try a request.

## Status

`engine.js` and `content.js` are logic-tested the same way as the desktop app: verified
against a local stand-in Claude server (both by calling the functions directly and by hitting
the real Express routes over plain HTTP), confirming `getPlan`/`classifyAttachments` and all
three `generateContent` paths work, including a genuinely valid, well-formed `.pptx` — with a
real chart part — built entirely in memory as base64.

**Not verified — needs a real Office host, which doesn't exist in this sandbox:**
- The manifest hasn't been sideloaded into an actual Word/Excel/PowerPoint installation.
- `Word.run`/`Excel.run` insertion (title/heading styles, range writes) is written from
  documented Office.js API shapes but never executed against a live document.
- `context.presentation.insertSlidesFromBase64` (PowerPoint insertion) is the least certain
  piece here — flagged in `taskpane.js` with the same note: if sideloading shows an API
  mismatch, check the current `PowerPoint.Presentation.insertSlidesFromBase64` reference and
  adjust the options object.
- `office-addin-dev-certs`' cert installation itself hasn't run in this sandbox (it installs
  into the OS trust store, which isn't something to do outside a real dev machine).

## Known gaps

- No packaging/distribution story yet (AppSource submission, or an internal add-in catalog).
- Settings are stored in plaintext JSON, same caveat as the desktop app.
- The output-type-locked-to-host design means there's currently no way to, say, insert a
  spreadsheet-shaped table into a Word document — worth revisiting if that turns out to be a
  real use case.
