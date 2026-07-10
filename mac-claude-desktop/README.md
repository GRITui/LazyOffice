# LazyOffice — Mac / Claude Desktop (prototype, high-risk track)

A third Electron track alongside `desktop-app/` (local Ollama + Claude CLI) and `apps-script/`
(GAS webapp, paused): the same chat → plan → approve → preview → create flow, but every LLM
call is answered by the user's own **Claude Desktop app** instead of a local model or a CLI.
LazyOffice keeps its own chat/plan/approve window — Claude Desktop is not the UI here, it's the
backend, silently answering behind the scenes.

## Read this before anything else: how this actually works, and why it's risky

**There is no supported, documented way for a third-party app to send Claude Desktop a prompt
and get an answer back.** Unlike Ollama (a real local HTTP API) or the Claude CLI (a real
documented headless mode — see `desktop-app/README.md`), Claude Desktop exposes nothing of the
kind. The only way to drive it externally is:

1. Launch it with `--remote-debugging-port=<port>`, which turns on Chrome DevTools Protocol
   (CDP) — the same low-level control interface Playwright normally uses to drive a browser
   it launched itself. Claude Desktop is an Electron app, so this works, but it is not a feature
   Anthropic built for this purpose — it's a side effect of Electron being Chromium underneath.
2. Attach a CDP client (`playwright-core`, no bundled browser needed — we connect to Claude
   Desktop's *own* embedded Chromium, we never launch a browser ourselves), find the chat input
   in the DOM, type into it, click Send, and poll the DOM for a new message to appear and stop
   changing.

This is scraping a live product's UI through undocumented CSS selectors, not calling an API.
Concretely, `engine.js` in this track is built from a third-party proof-of-concept
([github.com/epiccoleman/claude-automator](https://github.com/epiccoleman/claude-automator)),
not from anything Anthropic documents, and its own author's disclaimer is: *"Claude wrote this
whole thing for me, I've pushed it up only as a POC / example that this kind of thing can be
done, and otherwise take no credit or responsibility for this code."*

**Concretely, that means:**

- The selectors (`div[contenteditable="true"]` for the input, `button[aria-label*="Send"]` for
  Send, `div.font-claude-message` for a response) are a snapshot of one build of Claude
  Desktop's UI. Any Anthropic UI update can silently break every call this track makes — there's
  no version check, no fallback, just a wrong selector and a confusing failure (or worse, a
  silent wrong result).
- There's no "response finished" event. `waitForResponse` polls the DOM every second and treats
  a message whose text hasn't changed across two consecutive polls as done. This is a heuristic,
  not a guarantee — a genuinely slow-but-still-streaming response could be read as finished
  early.
- Automating a consumer chat product to answer programmatic requests instead of a human typing
  in it sits in a gray area against the product's intended use. This document takes no position
  on Anthropic's Terms of Service for your account — read them yourself before relying on this
  for anything beyond a personal experiment.
- **Full loss of context/session control.** Every `engine.callLLM` call starts a fresh Claude
  Desktop conversation (clicking "New chat" before sending) so that unrelated LazyOffice
  requests never bleed into each other — but that also means every single call (classify
  attachments, draft a plan, generate content, summarize) pays the cost of a brand-new
  conversation, with no shared context between them even within one user request.

If any of this changes your mind about wanting this track, `desktop-app/`'s Claude CLI backend
(`callClaudeCli`) is the closest alternative that's actually documented and supported by
Anthropic — see `desktop-app/README.md`.

## What's here

Reused unmodified from `desktop-app/`: `docgen.js` (the `.docx`/`.xlsx`/`.pptx` writers,
including the corporate `.pptx` theme), `renderer/index.html`'s chat/plan/clarify/preview/result
cards, `main.js`'s IPC shape, `preload.js`, `config-store.js`. The one real divergence is
`engine.js`:

- `engine.js` has exactly one LLM entry point, `callLLM(systemPrompt, userPrompt)` — no provider
  switch, because there's only one backend. Every role (attachment classification, plan
  drafting/clarification, content generation, delivery summary, JSON repair) calls it directly.
  There's no separate "prompt auditor" bypass like `desktop-app/engine.js` has, because there's
  no second backend to bypass here.
- `getBrowser()`/`getClaudeDesktopPage()` attach to Claude Desktop over CDP (`playwright-core`).
  `startNewConversation()`/`sendPrompt()`/`waitForResponse()` do the actual UI-scraping.
  `checkStatus()` is a lightweight connectivity check for the renderer's status panel.
- Settings holds only `CLAUDE_DESKTOP_CDP_HOST`/`CLAUDE_DESKTOP_CDP_PORT` (default
  `127.0.0.1:9222`) — no API key, no model choice, nothing else to configure.

## Running it

```
cd mac-claude-desktop
npm install
```

Claude Desktop must already be running with remote debugging enabled — LazyOffice never
launches or reconfigures it for you (deliberately: silently relaunching a user's chat app with a
debug port open is not something to do without them knowing). Quit Claude Desktop if it's
already open, then from a terminal:

```
"/Applications/Claude.app/Contents/MacOS/Claude" --remote-debugging-port=9222
```

Then, separately:

```
npm start
```

Open the app — the connection panel checks the port automatically and shows the exact command
above again if it can't connect. Once connected, the flow is identical to `desktop-app/`:
Document/Spreadsheet/Presentation → describe → answer any clarifying questions → review the plan
→ approve → preview → Create File.

## Status

**Logic-tested against a stand-in only, never against the real Claude Desktop app.** Built a
fake "Claude Desktop" page (a plain HTML file with the same `contenteditable` input / `Send` /
`font-claude-message` DOM shape, launched in a real Chromium window via
`--remote-debugging-port` so the CDP attach path is exercised for real, not mocked) that
reveals canned responses gradually over ~2-3 seconds to mimic streaming. Against that stand-in,
verified: `checkStatus` reports connected, the clarification loop asks then drafts a plan across
two rounds, attachment classification, and the full `buildContent`/`createOutput` path producing
a real, valid `.docx` — and confirmed `waitForResponse`'s stability-polling only returns once
the streamed text actually stops changing, not mid-stream.

**Not verified, and can't be from this sandbox:**
- The real Claude Desktop app doesn't exist here — none of the actual CSS selectors have been
  checked against it. They may already be wrong.
- `startNewConversation`'s "New chat" button selector, `getClaudeDesktopPage`'s assumption about
  how Claude Desktop's window shows up among CDP targets, and how a real multi-paragraph
  streamed response behaves are all unverified against the genuine app.
- No packaging/build (`electron-builder`) has been run for this track.

This track should be treated as a working proof of the *mechanism* (CDP attach → type → poll →
scrape, wired end-to-end through the same plan/approve/preview UI as `desktop-app/`), not a
finished, reliable feature — expect to need real debugging against the actual Claude Desktop app
before this is usable day-to-day.
