---
name: queue-manager
description: A plain-file task queue that lives in the repository (.queue/ plus a generated QUEUE.md) so work survives across agent sessions. Use it whenever the user wants to resume or "pick up where we left off", asks what to work on next, agrees on work that should be tracked for later, starts, blocks, unblocks, holds, resumes or finishes a task, records progress or decisions on a task, sets dependencies or a production gate, regenerates or verifies QUEUE.md, or wants to open the queue's browser UI (task pages, clarification chat, pitfalls browser, insights, dependency graph). Use it whenever the user asks about a known trap, a pitfall, `PITFALLS.md` or a `PIT-###` lesson. Use it even when the user just says "add this to the queue", "what's next?" or "continue". Not for Jira, Linear or GitHub Issues unless the user wants the local queue too.
license: MIT
compatibility: POSIX shell for the CLI. The optional browser UI needs Node.js 22.13+ and curl.
metadata:
  author: faouziMohamed
  version: '1.0.0'
  tags: 'task-queue, agents, project-management'
---

# Queue Manager

A task queue stored as plain files in the project, so any session (yours, a
colleague's, another agent's) can pick up work cold. Each task is one Markdown
file at `.queue/<status>/<id>.md`; the folder it sits in is its status. A small
POSIX CLI owns the state changes, and `QUEUE.md` is a generated overview for
humans.

The point is cheap, reliable resumption: one command finds the active task and
one file holds everything needed to continue it.

## Running the CLI

`<skill-dir>` below is the folder that contains this SKILL.md (for example
`.claude/skills/queue-manager`, `~/.claude/skills/queue-manager` or
`.agents/skills/queue-manager`). Run commands from inside the project:

```sh
sh <skill-dir>/scripts/queue.sh <command>
```

The CLI finds the project root by walking up to the first folder with `.queue/`,
`CLAUDE.md` or `AGENTS.md`. Set `WORKSPACE_ROOT=/path` to point it elsewhere. If
the project has no `.queue/` yet, run `init` first (see **Setting up a project**).

## Typical session

1. **Resume.** Run `active`. If a task is in progress, open the **Path** it prints
   and follow the protocol below. If it lists several, ask the user which one to
   continue; do not pick one yourself.
2. **Nothing active?** Run `next` to see up to five ready tasks, suggest one, and
   start it only once the user agrees: `start Q-0007`.
3. **New work agreed in conversation?** `add` it before you begin, so an
   interrupted session still leaves a trace. Record the scope and the first
   concrete step in the body.
4. **While working,** keep the body current with your normal file tools: tick
   progress checkboxes, add evidence, record decisions under **Settled**, and keep
   the `**Resume:**` line pointing at the very next action.
5. **Stuck on something else?** `block Q-0007 --by Q-0003`. When the blocker is
   done, `done` unblocks dependents automatically.
6. **Pausing work for now?** `hold Q-0007` parks it out of Ready and `next`;
   `resume Q-0007` returns it to Ready once its blockers are done.
7. **Finished?** Check the acceptance criteria and, when present, the
   **Definition of done**; then run
   `done Q-0007 --summary "What shipped and why it matters"`. An unchecked item
   means the task is not done: finish it, or record why it is deferred under
   **What is left** or **Known, accepted**.

## Resume protocol

1. `sh <skill-dir>/scripts/queue.sh active` prints each active task and its
   absolute **Path**. With more than one, ask the user which to resume.
2. Read that one file. Follow its `**Resume:**` line and read only the paths under
   **Context to load**.
3. Use the CLI for status changes; edit the body directly.

Avoid reading `QUEUE.md` or the whole `.queue/` tree to resume. The task file is
written to be self-sufficient, and scanning everything costs many tokens for no
gain.

## Commands

```sh
sh <skill-dir>/scripts/queue.sh active                 # active task and its path
sh <skill-dir>/scripts/queue.sh next                   # up to five ready tasks
sh <skill-dir>/scripts/queue.sh show Q-0001            # body plus dependencies
sh <skill-dir>/scripts/queue.sh path Q-0001            # absolute path of the body
sh <skill-dir>/scripts/queue.sh add "Short title" [--priority 1|2|3] [--blocked-by Q-0002,Q-0003] [--body-file path] [--resume "..."] [--start] [--on-hold]
sh <skill-dir>/scripts/queue.sh start Q-0001           # ready -> in-progress (up to the WIP limit)
sh <skill-dir>/scripts/queue.sh block Q-0001 --by Q-0002
sh <skill-dir>/scripts/queue.sh unblock Q-0001         # only when every blocker is done
sh <skill-dir>/scripts/queue.sh hold Q-0001            # park any open task
sh <skill-dir>/scripts/queue.sh resume Q-0001          # on hold -> ready, once blockers are done
sh <skill-dir>/scripts/queue.sh done Q-0001 --summary "..."
sh <skill-dir>/scripts/queue.sh deps Q-0001            # both dependency directions
sh <skill-dir>/scripts/queue.sh list [--all]           # table of open (or all) tasks
sh <skill-dir>/scripts/queue.sh index                  # regenerate QUEUE.md
sh <skill-dir>/scripts/queue.sh verify                 # check ids, statuses, edges, resume lines
sh <skill-dir>/scripts/queue.sh init                   # set up .queue/ in this project
sh <skill-dir>/scripts/queue.sh ui start|open|status|stop|restart|logs|run [port]
```

`add` prints the new stable `Q-NNNN` ID. Every transition regenerates
`QUEUE.md`; run `verify` after hand edits to frontmatter or dependencies.
`active`, `show`, `start` and the other per-task commands are constant-time;
only `list`, `index` and `verify` read the whole queue.

## Writing a good task body

Start from `assets/entry.md` (`add --body-file` accepts it; the CLI rewrites the
frontmatter, so IDs, dates and status stay authoritative). A body is good when a
fresh session can continue without searching the codebase:

- **Resume line** — one concrete next action, kept current.
- **Context to load** — the exact files that matter and why, plus the obvious
  files that do _not_ matter. This is what makes a cold pickup cheap.
- **Acceptance criteria and progress as checkboxes.** `- [x]` means done and
  verified (say how); `- [ ]` means open. Checkboxes are easier to scan and update
  than prose.
- **Definition of done (optional)** — the quality bar every task must clear
  (tests, lint, docs, review), as opposed to acceptance criteria, which say what
  this task must achieve. Link the project's standing definition of done (for
  example in `CLAUDE.md`) and add only task-specific items; drop the section when
  the project's definition already covers the task.
- **Settled decisions** with who decided and when, so they are not re-argued.
- **Related pitfalls** — link the project's known-traps file by `PIT-` ID when a
  recorded trap applies, instead of repeating its explanation in the body.
- **Outline only.** Describe the approach and file list, not implementation code;
  code belongs in the repository, where it is reviewed and tested.

## Rules and why they exist

- **Stable IDs.** Never renumber or reuse an ID: commits, notes and other tasks
  refer to them.
- **A small work-in-progress limit.** `wipLimit` in `.queue/config.json`
  (default `1`) caps how many tasks are in progress; `start` and `add --start`
  refuse past it, `.queue/active` lists the active IDs and `verify` enforces it.
  Keep the default unless the user asks: with one task, "what am I doing?" always
  has one answer. A task that is only waiting belongs on hold or blocked, not
  in progress.
- **Dependencies are explicit.** `deps/<id>.blocked-by` and `deps/<id>.blocks`
  hold both directions; use `block`/`unblock` rather than writing prose like
  "waiting on X", so `done` can unblock dependents for you.
- **On hold is a deliberate pause.** `hold` parks any open task and frees its
  active slot; `resume` returns it to ready but still refuses while a blocker is
  open. Unlike `blocked`, the pause is the reason, not a dependency.
- **Archive, don't delete.** `done/` keeps the full body; history is how the next
  person learns what was decided.
- **`QUEUE.md` is generated.** Edit `.queue/header.md` for its static header and
  task files for content, then `index`.
- **One queue at the root** of a multi-repository workspace; a single repository
  keeps its own.
- **Status is not permission.** A task being in progress never authorizes Git
  writes, deployments or other side effects; the project's own rules still apply.
- **Recurring lessons go to the pitfalls file.** Once a trap is verified and
  likely to recur, record it once in the project's `PITFALLS.md` (or its
  equivalent) with a stable `PIT-` ID, then link it from the tasks it affects.
  Task bodies keep decisions and evidence; they do not duplicate the lesson.
  This keeps the queue about _this_ work and the trap file about the codebase.

## Data layout

```
.queue/
  header.md              static header for QUEUE.md
  next-id                next numeric ID
  active                 active task IDs, one per line, or absent
  ready/ in-progress/ blocked/ on-hold/ done/    <id>.md task bodies
  deps/<id>.blocked-by   one blocker ID per line
  deps/<id>.blocks       one dependent ID per line
  config.json            optional settings (name, layout, repositories, wipLimit)
```

Moving a task is one `mv`, atomic on the same filesystem. `QUEUE_DIR` and
`QUEUE_INDEX` override where the data and the generated view live.

**Production gate.** Set `prod_gate: true` in one task's frontmatter (typically a
release approval). Open tasks blocked by it are listed under **Awaiting
production** in `QUEUE.md`, using the ordinary `block --by <gate>` edges.

## Setting up a project

```sh
sh <skill-dir>/scripts/queue.sh init
```

`init` creates the `.queue/` folders, copies `assets/header.md` with the project
name, writes `.queue/.gitignore` (UI keys, chat database, server PID and log),
adds an owner-only `.queue/agent.env` placeholder for optional assistant API
keys, and generates `QUEUE.md`. Existing queue files are left alone; only the
generated `QUEUE.md` is rewritten. Whether to commit `.queue/` and `QUEUE.md` is
the project's choice.

## Browser UI and assistant (optional)

`ui open` starts a localhost UI with a Jira-style board or classic list view
(the default and the Jira-style/classic layout are chosen in Queue settings), a
quick-look drawer, a full task page
with a per-task clarification chat and related agent sessions, a pitfalls browser
linked to the tasks that mention each `PIT-` ID, insights charts and a zoomable
dependency graph. Status changes still go through the CLI; body edits write the
task file directly.

- For running, using or changing the UI, read `references/dev-server.md`.
- For the in-browser assistant (providers, API keys, chat history, Clarify
  mode), read `references/assistant.md`.

Neither is needed for managing tasks from the command line.
