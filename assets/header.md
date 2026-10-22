<!-- Static header template. Edit this file, then run:
     sh .claude/skills/queue-manager/scripts/queue.sh index
     Task state lives in .queue/ (plain files); QUEUE.md is generated from this header. -->

# QUEUE — Social Connect 🗂️

> **Generated view.** The source of truth is the `.queue/` directory, keyed by stable
> `Q-NNNN` IDs. Each task body is a Markdown file at `.queue/<status>/<id>.md`.
> Do not hand-edit `QUEUE.md`; run `sh .claude/skills/queue-manager/scripts/queue.sh index`.
>
> **Resume in O(1):** run `sh .claude/skills/queue-manager/scripts/queue.sh active`, then read the **Path** it
> prints with your normal file tools. Follow its **Resume** line.
> `sh .claude/skills/queue-manager/scripts/queue.sh show <id>` prints the body instead.
>
> **No runtime dependency.** The queue works with any POSIX shell and standard
> file tools. Node.js and SQLite are not required. The CLI is a convenience; the
> directory layout is the contract.
>
> **Token budget:** one `active` lookup plus one task file. `list`, `index` and
> `verify` are the only O(n) operations; they are never on the resume path.
>
> **Authority:** `CLAUDE.md` and repo rulebooks govern. Queue status never grants
> permission for git writes, database mutations, deployments or publishing.
> Recurring traps live in `PITFALLS.md`; task state lives here.

## Layout

```
.queue/
  header.md                 static content for this view
  next-id                   next stable numeric ID
  active                    active task ID, or absent
  ready/                    ready/<id>.md
  in-progress/              in-progress/<id>.md  (at most one)
  blocked/                  blocked/<id>.md
  done/                     done/<id>.md
  deps/<id>.blocked-by      one blocker ID per line
  deps/<id>.blocks          one dependent ID per line
```

Status is the directory. Moving a task is a single `mv`, atomic on the same
filesystem. The active task is one file read. A task lookup checks the four
status directories — four constant path checks, no scan.

## Complexity

| Operation | Cost |
|---|---|
| `active`, `path <id>`, `show <id>` | O(1) — fixed path checks |
| `start`, `block`, `unblock`, `done` | O(1) + k dependency edges |
| `add` | O(1) + k dependency edges |
| `next` | O(k log k), k = ready tasks |
| `list`, `index`, `verify` | O(n) by design; never on the resume path |

## CLI

```sh
sh .claude/skills/queue-manager/scripts/queue.sh active
sh .claude/skills/queue-manager/scripts/queue.sh path Q-0001
sh .claude/skills/queue-manager/scripts/queue.sh show Q-0001
sh .claude/skills/queue-manager/scripts/queue.sh add "Short title" [--priority 1|2|3] [--blocked-by Q-0001,Q-0002] [--body-file path] [--resume "..."] [--start]
sh .claude/skills/queue-manager/scripts/queue.sh start Q-0001
sh .claude/skills/queue-manager/scripts/queue.sh block Q-0001 --by Q-0002,Q-0003
sh .claude/skills/queue-manager/scripts/queue.sh unblock Q-0001
sh .claude/skills/queue-manager/scripts/queue.sh done Q-0001 --summary "What shipped and why it matters"
sh .claude/skills/queue-manager/scripts/queue.sh next
sh .claude/skills/queue-manager/scripts/queue.sh list [--all]
sh .claude/skills/queue-manager/scripts/queue.sh deps Q-0001
sh .claude/skills/queue-manager/scripts/queue.sh index
sh .claude/skills/queue-manager/scripts/queue.sh verify
```

`add` allocates the next stable ID. `done` moves the task to `done/` and appends a
one-line pointer to **Shipped**. Nothing is deleted.

## Queue rules

- **One queue at the root** for work spanning repositories. A repository keeps its
  own queue only for work that never leaves it.
- **Stable IDs.** `Q-0001`, `Q-0002`, … Never renumber or reuse an ID.
- **Write when agreed.** Add the entry before starting, so an interrupted session
  leaves a trace.
- **Single in-progress.** The `active` file names it; `verify` enforces it.
- **Cold-pickup-able.** The body, context paths, resume line and dependencies must
  let a fresh session continue without a codebase sweep.
- **One body, one file.** Edit `.queue/<status>/<id>.md` directly with file tools.
  The CLI owns state transitions and the generated view; the body is yours.
- **Checkboxes, not prose.** `- [x]` means done and verified; `- [ ]` means open.
- **Outline only.** No implementation code in an entry.
- **Dependencies are explicit.** `deps/` holds both directions; `queue deps <id>`
  prints them.
- **Lessons go to `PITFALLS.md`**, not here. Promote only verified, recurring traps
  with stable `PIT-` IDs.

## Entry shape

```markdown
---
id: {{id}}
title: {{title}}
priority: 2
created: {{date}}
updated: {{date}}
shipped:
summary:
---

# {{id}} — {{title}}

**Resume:** One concrete next action.

**Blocked by:** none · **Blocks:** none.

## Context to load

- `exact/path` — why it matters.

Not in the working set, despite being the obvious guess: `path` — why not.

## What was asked

Goal and agreed scope, in a few short sentences.

## Acceptance criteria

- [ ] A verifiable outcome, not an activity.

## Related pitfalls

- [PIT-000: title](PITFALLS.md#pit-000) — applicable rule.

## Progress

- [x] Completed work and the evidence that verified it.

## What is left

- [ ] A concrete remaining action.

## Settled (decision maker, YYYY-MM-DD)

- Approved decision or constraint, with the reasoning that would otherwise be
  re-litigated.

## Known, accepted, not a new defect

- Deliberate limitation and why it remains.
```
