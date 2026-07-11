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
- `dev-log.md` — append-only, one line per unit of work (timestamp, agent, task-id, files
  touched, QA result, status). Added 2026-07-11: the audit trail the circuit breaker below
  counts against, kept separate from `squad-handshake.md` because that file is overwritten
  in place and can't answer "how many consecutive QA failures on this task" on its own.

Follow the Squad Setup doc's crash-proofing convention for these files: extract data with
regex/tag matching, not strict JSON parsing, and fail soft (log a warning, skip, retry)
rather than crashing on malformed content.

## Circuit breaker

If a task fails validation/QA 3 times in a row, mark it `<status>BLOCKED</status>` in the
relevant file and move on to the next priority item — do not stall the whole loop on one
blocked task. Count consecutive `QA:FAIL` lines for a task-id in `dev-log.md` to decide when
this fires.

## Model / Effort policy

Pattern borrowed from FreeLanz (`gritui/freelanz`'s `project-changelog-handshake.md`) — pick
the cheapest tier that can do the task correctly rather than defaulting to the most expensive
model for everything:

| Task kind | Model | Effort |
| --- | --- | --- |
| Routine implementation (a single script, a UI tweak) | Sonnet | low/medium |
| Architecture / cross-cutting decisions (pipeline design, provider routing) | Opus | high |
| Verification / adversarial QA review | Sonnet or Opus | high |

## Reuse Ledger

Pattern borrowed from FreeLanz. Log every time code or convention crosses a repo boundary, at
the time it happens, not retroactively:

| Component | Borrowed From | Notes |
| --- | --- | --- |
| Squad-harness process convention (`backlog-inbox.md`/`squad-handshake.md`/circuit breaker) | — (this repo is the origin; referenced by `gritui/my-ai-crew`, not borrowed from it) | my-ai-crew's README originally claimed to have inherited `apps-script/`, `desktop-app/`, and `tools/validate-harness.js` as literal files — none of those exist there, and `tools/validate-harness.js` never existed in this repo either. Corrected 2026-07-11 to point to the consolidated `squad-harness/` package in `gritui/my-ai-crew` instead of claiming inherited code. |
| Model/Effort policy table + this Reuse Ledger section | `gritui/freelanz`'s `project-changelog-handshake.md` | Adopted here as part of the portfolio-wide squad-harness consolidation (TSK-004). |

## Current milestone

Milestone 1 (`TSK-001` in `backlog-inbox.md`) is a thin end-to-end slice living in
`apps-script/` — see `README.md` for what it does and how to deploy it. The full
5-stage/5-model pipeline and self-hosted inference server from the First Goal doc are
intentionally deferred to later milestones (`TSK-002` onward).
