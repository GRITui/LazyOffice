# LazyOffice

Office automation assistant: chat a request, review the plan, approve, get a real Google Doc.

This is Milestone 1 of the project described in `CLAUDE.md` — a thin end-to-end slice, not
the full multi-model pipeline from the First Goal doc.

## What's here

- `apps-script/` — a standalone Google Apps Script (GAS) Web App:
  - `Index.html` — chat UI: request box, plan preview, approve button, result link.
  - `Code.gs` — server logic: calls the Anthropic API to draft a plan, then (on approval) to
    draft document content, and creates the Google Doc via `DocumentApp`.
  - `appsscript.json` — manifest; deployed with `executeAs: USER_DEPLOYING` /
    `access: ANYONE` — any signed-in Google account can open the deployment (no domain
    restriction, no anonymous access).

## Deploying

1. Install [`clasp`](https://github.com/google/clasp) and log in:
   `npm i -g @google/clasp && clasp login`.
2. From `apps-script/`, create a new Apps Script project bound to this code:
   `clasp create --type webapp --title "LazyOffice"` (or `clasp clone <scriptId>` if a
   project already exists).
3. Set the Anthropic API key as a script property (Apps Script editor → Project Settings →
   Script Properties): key `ANTHROPIC_API_KEY`. (Skip this if you're using the local Ollama
   option below instead.)
4. `clasp push` to upload the code, then `clasp deploy` to publish a web app version.
5. Open the deployment URL, enter a request, review the plan, click Approve, confirm a
   Google Doc is created and the link works.

### Using a local Ollama server instead of Claude (prototyping only)

`Code.gs` defaults to the Claude API, but can be pointed at a local Ollama server for
iterating without an Anthropic API key. Set these script properties instead of
`ANTHROPIC_API_KEY`:

- `LLM_PROVIDER` = `ollama`
- `OLLAMA_URL` = your server's OpenAI-compatible chat endpoint, e.g.
  `http://localhost:11434/v1/chat/completions` (Ollama's default)

Then pull and configure the model(s) you want. Milestone 1 today only calls 3 of the First
Goal doc's 5 pipeline roles — set at least those. All 5 are listed here (with real, verified
Ollama tags) so a local setup has everything ready once TSK-002 wires up the remaining two:

| Role | Model (First Goal doc) | `ollama pull` | Script property | Called by (Milestone 1) |
| --- | --- | --- | --- | --- |
| Orchestrator | Qwen3.5-9B | `ollama pull qwen3.5:9b` | `OLLAMA_ORCHESTRATOR_MODEL` | `getPlan` |
| Planner | DeepSeek-R1-Distill-Qwen-7B | `ollama pull deepseek-r1:7b` | `OLLAMA_PLANNER_MODEL` | `classifyAttachments` |
| Syntax Enforcer | Phi-4-mini (3.8B) | `ollama pull phi4-mini:3.8b` | `OLLAMA_SYNTAX_MODEL` | *(not yet — TSK-002)* |
| Code Engine | IBM Granite 4.1 8B | `ollama pull granite4.1:8b` | `OLLAMA_CODE_ENGINE_MODEL` | `generateDoc` |
| Generalist | Llama 3.1 8B Instruct | `ollama pull llama3.1:8b` | `OLLAMA_GENERALIST_MODEL` | *(not yet — TSK-002)* |

Each `OLLAMA_*_MODEL` property is optional — if unset, that role falls back to the tag shown
above, then to the legacy `OLLAMA_MODEL` property (single model for everything) if you'd
rather not configure per-role models yet.

**Reachability caveat:** a deployed GAS Web App runs in Google's cloud, not on your machine
— it cannot reach `http://localhost:...` directly. To actually use this from a real
deployment, tunnel your local Ollama server (e.g. `cloudflared tunnel` or `ngrok http
11434`) and set `OLLAMA_URL` to the tunnel's public URL. Without a tunnel, this mode only
works when testing `Code.gs` locally outside of Apps Script (e.g. via a Node harness that
stubs the GAS services and lets `UrlFetchApp.fetch` reach `localhost`).

## Known gaps / next milestones

- The Anthropic API call in `Code.gs` is a **temporary stand-in** for the First Goal doc's
  5-model pipeline (Qwen/DeepSeek/Phi-4/Granite/Llama). Replacing it with the self-hosted
  inference server is its own follow-up milestone (`TSK-002`). The local-Ollama option above
  is a lightweight prototyping toggle only — it is not TSK-002's GPU-backed production
  pipeline and doesn't change the default provider.
- The GAS Web App's access model is confirmed: any signed-in Google account can open it
  (`access: ANYONE` in `appsscript.json`), not restricted to a Workspace domain and not
  open to anonymous/anyone-with-link access.
- Squad-driven backlog automation (`backlog-inbox.md`, `squad-handshake.md`) is seeded but
  this milestone was built directly rather than through automated squad execution.
