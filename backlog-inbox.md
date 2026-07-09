# Global Backlog Inbox

Do not edit outside the XML tags. PM Agents must only parse items marked READY_FOR_PM.

<task_item>
  <id>TSK-001</id>
  <source>OWNER_POPUP</source>
  <status>DONE</status>
  <priority>HIGH</priority>
  <title>Milestone 1: thin end-to-end slice for document generation</title>
  <description>Stand up a single GAS Web App: chat textbox -> LLM-drafted plan -> owner approval -> real Google Doc created via DocumentApp, returning the Doc URL. Uses a temporary Claude API stand-in call instead of the full 5-model pipeline; squad/backlog automation is seeded but not yet driving execution.</description>
  <researcher_notes>Feasible with GAS UrlFetchApp calling the Anthropic Messages API. Full 5-model self-hosted pipeline explicitly deferred to a follow-up milestone.</researcher_notes>
</task_item>

<task_item>
  <id>TSK-002</id>
  <source>RESEARCHER_SQUAD</source>
  <status>READY_FOR_PM</status>
  <priority>MEDIUM</priority>
  <title>Provision self-hosted inference server for the 5-stage pipeline</title>
  <description>Stand up a GPU-backed inference server on owned/on-prem hardware (e.g. vLLM/Ollama) reachable over HTTP from Google Apps Script, serving the First Goal doc's pipeline models. Load Qwen3.5-9B (Orchestrator) first, then the remaining models (DeepSeek-R1-Distill-Qwen-7B Planner, Phi-4-mini Syntax Enforcer, Granite 4.1 8B Code Engine, Llama 3.1 8B Generalist), then replace the Milestone 1 Claude stand-in.</description>
  <researcher_notes>Owner decision (2026-07-09): host on own hardware (not cloud GPU); load Qwen3.5-9B Orchestrator first to prove the routing/coordination layer, then the remaining 4 models. Networking so GAS can reach the on-prem server is still open and owned by Researcher-Squad/Engineer-Squad.</researcher_notes>
</task_item>

<task_item>
  <id>TSK-003</id>
  <source>OWNER_POPUP</source>
  <status>IN_PROGRESS</status>
  <priority>MEDIUM</priority>
  <title>Desktop app prototype (macOS) — parallel track alongside the GAS Web App</title>
  <description>Electron-based desktop prototype living in desktop-app/, reusing the chat -> plan -> approve UI. engine.js ports Code.gs's LLM logic (same callLLM/callClaude/callOllama shape, same 5-model OLLAMA_ROLE_MODELS mapping from the First Goal doc). No Google Drive/Docs/Sheets/Slides dependency: docgen.js writes real local files instead — .docx (docx package), .xlsx (xlsx/SheetJS), or .pptx (pptxgenjs), covering all three output types from the First Goal doc's mission (the webapp track still only does documents). A Document/Spreadsheet/Presentation selector in the UI picks which. Settings (API key, LLM_PROVIDER, Ollama URL/models) are entered in an in-app panel backed by a local JSON config store instead of GAS Script Properties.</description>
  <researcher_notes>Owner decision (2026-07-09): work this as a parallel project, not blocking or replacing the GAS webapp track — webapp work is paused and resumes later (see squad-handshake.md). Chose local file output over the Google Docs/Sheets/Slides APIs to avoid adding Google OAuth to a desktop app. Owner also asked (same day) for real spreadsheet/presentation generation, not just document — implemented and verified, not left as a mockup. Then wired the two remaining First Goal doc roles that had models configured but no call site: Syntax Enforcer (Phi-4-mini) now runs as a one-shot JSON repair step in docgen.js's parseWithSchema when the Code Engine's output fails to parse, before falling back to the soft-degrade; Generalist (Llama 3.1 8B) drafts a short delivery summary shown in the result card after the file is written, soft-failing to a plain default message rather than blocking delivery. All 5 First Goal doc roles now have a real call site. Owner then confirmed the app runs for real on their own machine (packaged .app + npm start both work), and requested a batch of flow upgrades: local Ollama is now the default provider (was Claude API); Settings exposes all 5 pipeline roles; a proactive clarification loop (engine.getPlan judges whether a request has enough detail before drafting a plan, asks up to 3 rounds of short questions otherwise); per-role model tick boxes with multi-select fallback chains (replacing single free-text model fields; callOllama tries each ticked model in order); and a content-preview step between plan approval and file creation (docgen.js split into build*Content/create* dispatchers so the preview shows exactly what gets written, and creating never re-runs the LLM). See squad-handshake.md for the full breakdown. Everything through the local-first + first-run-setup commit was CDP-verified in a real Electron window; the newest batch (clarify loop, tick boxes, preview) is logic-tested against a stand-in Ollama server only (proactive clarify/re-plan round-trip, fallback-chain model switch, build/create split for all 3 output types with each file inspected) and still needs a real-Electron-window pass. Follow-up: the Owner asked the clarification stage to run on exactly one pinned local model (Llama 3.1 8B Instruct, reusing the Generalist tag) rather than the tick-box/provider-routed system used by the rest of the pipeline — added as engine.callPromptAuditor, which getPlan now calls instead of the old Orchestrator role. Orchestrator was removed from OLLAMA_ROLE_MODELS (no call site left) and from setup-llm.js's required downloads (qwen3.5:9b no longer pulled); verified the auditor still runs even with LLM_PROVIDER set to claude and no key configured, and that it ignores role tick-box selections. Same not-yet-run-in-a-real-window caveat applies.</researcher_notes>
</task_item>
