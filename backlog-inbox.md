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
