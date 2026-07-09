# LazyOffice — Squad Harness Conventions

This repo is developed using a Claude Code multi-agent convention derived from two source docs:

- **Squad Setup** (process): https://docs.google.com/document/d/1yPKJMR5wDqwRII-Bu-0JcyKggkm4HcO7zjuNhgyVzvA
- **First Goal** (product): https://docs.google.com/document/d/1uwIf6bRwaxKr2qdgNLjm2XJdV1aszLcSbED252N8uXQ

## Squad → Claude Code mapping

Squad Setup's four execution squads plus the Owner-Assistant bridge are not a separate
backend service — they map onto this Claude Code session's own subagents and the Workflow
tool, coordinated through files committed to this repo rather than through direct
conversation between agents:

| Squad | Role | Claude Code equivalent |
| --- | --- | --- |
| Researcher-Squad | Feasibility, validation, data gathering | `Explore`/`general-purpose` Agent runs, or a Workflow research phase |
| Engineer-Squad | Draft, build, commit code | Direct implementation in-session, or an `Agent`/`Workflow` build phase |
| QA-Tester-Squad | Test code & UX against requirements | The `code-review` / `verify` skills, or a Workflow verify phase |
| UX-UI-Designer-Squad | Design tokens, layouts, assets | `artifact-design`/`dataviz` skills or a dedicated design Agent |
| Owner-Assistant-Agent | Read-only bridge to the human owner | The main Claude Code session talking directly to the user |

## State files

- `backlog-inbox.md` — append-only global backlog. New owner ideas get logged here as
  `<task_item>` entries; only items marked `READY_FOR_PM` should be picked up for execution.
- `squad-handshake.md` — current status per squad, updated after each unit of work: active
  task, recent commits, blockers, cross-squad requests.

Follow the Squad Setup doc's crash-proofing convention for these files: extract data with
regex/tag matching, not strict JSON parsing, and fail soft (log a warning, skip, retry)
rather than crashing on malformed content.

## Circuit breaker

If a task fails validation/QA 3 times in a row, mark it `<status>BLOCKED</status>` in the
relevant file and move on to the next priority item — do not stall the whole loop on one
blocked task.

## Current milestone

Milestone 1 (`TSK-001` in `backlog-inbox.md`) is a thin end-to-end slice living in
`apps-script/` — see `README.md` for what it does and how to deploy it. The full
5-stage/5-model pipeline and self-hosted inference server from the First Goal doc are
intentionally deferred to later milestones (`TSK-002` onward).
