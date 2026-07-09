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
   Script Properties): key `ANTHROPIC_API_KEY`.
4. `clasp push` to upload the code, then `clasp deploy` to publish a web app version.
5. Open the deployment URL, enter a request, review the plan, click Approve, confirm a
   Google Doc is created and the link works.

## Known gaps / next milestones

- The Anthropic API call in `Code.gs` is a **temporary stand-in** for the First Goal doc's
  5-model pipeline (Qwen/DeepSeek/Phi-4/Granite/Llama). Replacing it with the self-hosted
  inference server is its own follow-up milestone (`TSK-002`).
- The GAS Web App's access model is confirmed: any signed-in Google account can open it
  (`access: ANYONE` in `appsscript.json`), not restricted to a Workspace domain and not
  open to anonymous/anyone-with-link access.
- Squad-driven backlog automation (`backlog-inbox.md`, `squad-handshake.md`) is seeded but
  this milestone was built directly rather than through automated squad execution.
