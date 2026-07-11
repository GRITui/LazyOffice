# Dev Log

Append-only. One line per unit of work. Never edit or delete a past line — if something was
wrong, append a correcting line, don't rewrite history. This is the circuit breaker's source
of truth: count consecutive `QA:FAIL` lines for the same task-id to decide when to `BLOCKED`
a task (see `CLAUDE.md`, Circuit breaker).

Format:

```
<ISO-8601 timestamp> | <agent/squad> | <task-id> | <files touched, comma-separated> | QA:<PASS|FAIL(n/3)|SKIPPED> | <status after this line>
```

Adopted 2026-07-11 as part of consolidating this repo's squad-harness convention with the
rest of the GRITui portfolio (see `gritui/my-ai-crew`'s `squad-harness/` for the full spec and
`squad-harness/MIGRATION.md` for why LazyOffice specifically was missing this file — history
before this line lived only in `squad-handshake.md`'s "Recent Commits" prose section and this
repo's own git log; not backfilled here to avoid inventing timestamps/QA results that weren't
recorded at the time).

2026-07-11T00:00:00Z | owner-assistant | TSK-004 | CLAUDE.md, dev-log.md | QA:SKIPPED | DONE
