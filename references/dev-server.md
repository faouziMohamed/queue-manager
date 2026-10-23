# Dev server (browser UI)

Read this when the user asks to open, start, debug or change the browser UI,
or asks what a page in it does. Managing tasks never needs the UI: the CLI in
SKILL.md is the source of truth, and every status change goes through it.

Contents: Running it · Board and list views · Task drawer and page (with
Discussions) · Pitfalls · Insights and graph · Files and privacy

## Running it

The queue stays file-based and the POSIX CLI stays authoritative. An optional
localhost UI lives in `dev-server/` and ships with the skill: every install
gets the same pages, charts, graph and assistant, with no build step.

```sh
sh <skill-dir>/scripts/queue.sh ui start   # background, port 4317
sh <skill-dir>/scripts/queue.sh ui open    # start if needed, open the browser
sh <skill-dir>/scripts/queue.sh ui status|stop|restart|logs|run [port]
```

`ui run` stays in the foreground. The PID, chosen port and log live in
`.queue/dev-server.pid`, `.queue/dev-server.port` and `.queue/dev-server.log`
(git-ignored). `start` remembers the port, so later `status`, `stop` and `open`
use it without repeating the number. A workspace Makefile can wrap these
commands; the logic stays in `dev-server/queue-ui.sh`.

Requirements: Node.js 22.13+ for the server (built-in `node:sqlite` stores the
chats), `curl` for `ui` health checks, and optionally the `claude`/`codex` CLIs
or API keys for the assistant. Every other `queue.sh` command needs only a POSIX
shell.

- Read side: tasks, statuses, dependencies, frontmatter and bodies.
- Write side: `start`, `block`, `unblock`, `done` and `add` call `queue.sh`, so
  the lock, single-in-progress rule, dependency edges, gate task and index stay
  authoritative.
- Body edits write the task Markdown file atomically below its frontmatter; done
  records are immutable.
- It detects a workspace, monorepo or single repository and shows the project
  name plus repository chips in workspace and monorepo layouts.
- On a folder without `.queue`, the UI offers initialization (the same as
  `queue.sh init`) and writes `.queue/config.json`. The gear button edits the
  name, layout, repository list and default assistant later.
- It runs no Git or database commands and refuses non-loopback clients.

## Board and list views

Queue settings → **Design** switches between **Jira-style** (the project
header and tabs, full-width layout) and **Classic** (the original sidebar
layout). Queue settings → **Queue view** chooses the default **List** or
**Board**. The choices are stored in `.queue/config.json` as
`"design": "jira" | "classic"` and `"view": "list" | "board"`.

In Jira-style, the project header and tabs (Board, List, Insights, Pitfalls,
Graph) sit above every queue page and the topbar carries search, settings,
theme and New task. The List view adds status pills for In progress, Ready,
Blocked, On hold, Awaiting production and Done, with live counts. In Classic,
the sidebar keeps the same navigation and the board remains available from its
**Board** entry; `b` opens the board in either design.

The board shows one column per status. Cards open the normal task drawer.
Drag a card to transition it through the CLI:

- **Ready → In progress** calls `start`.
- **Blocked → Ready** calls `unblock`; it fails while a blocker is still open.
- **Any open task → Blocked** opens the blocker picker.
- **Any open task → On hold** calls `hold`; **On hold → Ready** calls `resume`
  (which still fails while a blocker is open).
- **Any open task → Done** opens the shipped-summary dialog.
- **Awaiting production** is derived from a production gate, so it is not a
  meaningful drop target; the UI explains that instead of moving the task.

**Show done** expands the collapsed Done column. In workspace mode, the
repository filter narrows every column. On touch devices the columns swipe
horizontally, dragging is disabled, and tapping a card opens the drawer where
the same transitions are available.

## Definition of done

A task body may carry an optional `## Definition of done` checklist (the task
template includes one). The UI reads its top-level `- [ ]` / `- [x]` items; plain
`-` bullets count as unchecked:

- Board cards and list rows show a **DoD 2/4** chip, green when complete.
- The task page side panel shows a progress bar and the checklist.
- **Mark done** lists any unchecked items before you confirm, so a task is not
  closed with its quality bar silently unmet. It warns; it does not block.

## Task drawer and page

- Clicking a task anywhere (lists, insights, graph) opens a quick-look drawer
  at `/<section>?task=Q-0001`. Its **Open full page** button goes to
  `/tasks/Q-0001`.
- The full page has a breadcrumb back to the list, the actions, a wide
  Markdown body with View/Edit, and a side panel with details (status,
  priority, dates, repository, file), **Blocked by** and **Blocks** as linked
  tasks, and an outline of the body's headings.
- **Discussions** (under the body) lists everything associated with the task,
  newest first: **Clarify** threads saved for it, **Assistant** chats that
  mention it, and local **Claude Code** / **Codex** sessions whose working
  directory is inside this workspace and that mention the task id (automated
  `claude -p` / SDK runs are skipped). **New discussion** starts a fresh thread.
  - A Clarify or Assistant chat opens below and can be continued; continuing
    attaches it to the task.
  - An agent session opens read-only (your and the agent's messages, with
    injected harness text removed, mentions highlighted) with a copyable
    `cd <dir> && claude --resume <id>` / `codex resume <id>` command.
  - Sessions are read from `~/.claude/projects` and `~/.codex/sessions`
    (`CLAUDE_CONFIG_DIR` / `CODEX_HOME` override them), indexed in the
    background and refreshed every 30 s. Set `QUEUE_AGENT_SESSIONS=off` to
    disable the lookup.
- The Clarify chat asks the questions needed to remove ambiguity and, once you
  agree, proposes section updates such as **Clarifications** (dated, agreed
  answers), **Before continuing** (a checklist of what is still needed) and
  **Open questions**. **Apply** replaces that one section of the task file, or
  adds it if missing, and keeps the rest of the body.
- Every view has a real URL (`/ready`, `/on-hold`, `/insights`, `/graph`,
  `/tasks/Q-0001`), so refresh, back/forward, new tabs and copied links work.
  Old `#task/Q-0001` links still open the drawer.
- Edit with Ctrl+S to save and Esc to leave; navigating away with unsaved
  edits is refused with a notice, closing the tab asks first, and chat updates
  wait until body edits are saved or cancelled.

## Pitfalls

**Pitfalls** (`/pitfalls`, shortcut `p`) reads `PITFALLS.md` at the workspace
root (or `docs/PITFALLS.md`) and shows every lesson with its symptom, cause,
remedy, applies-to, cost and verified date. Search filters by ID, text or task;
the filters separate lessons linked to tasks from unlinked or undated ones.

A task links to a lesson by mentioning its `PIT-###` ID in the body. The lesson
then lists that task under **Linked tasks** (clicking opens the task drawer), and
the task page's **Related pitfalls** card links back to the lesson. A lesson
whose `**Verified:**` line names a case or repository shows those names under
**Verified in**.

Write lessons as `### PIT-001 — Title` with `**Symptom:**`, `**Cause:**`,
`**Remedy:**`, `**Applies to:**` and `**Verified:**`; `**Cost:**` is shown as a
callout. Older unnumbered `## Title` lessons still render, with a note to add an
ID. In a multi-repository workspace, keep one root file and turn repository-level
files into pointers, so the whole workspace shares one searchable record.

## Insights and graph

- **Insights** (`i`): status tiles, then charts for open work by status, tasks
  shipped per week (12 weeks), open work by priority and by repository, plus
  "Most blocking" and "Longest untouched" lists. Clicking a tile, slice or bar
  opens that section; list rows open the task.
- **Dependency graph** (`g`): arrows run from a blocker to the task it holds
  back, laid out left to right. Scroll or pinch to zoom, drag to pan, `+`/`-`/`0`
  /`1` and arrow keys from the keyboard, Fit and 100% buttons. Hovering a task
  highlights everything upstream and downstream; clicking opens it. Filters:
  repository, show done, tasks without dependencies; the top search highlights
  matching tasks.
- Charts use Apache ECharts and the graph uses Cytoscape.js with the dagre
  layout. Pinned copies live in `dev-server/vendor/` (versions and licenses in
  its README) and load only when one of these views opens, so the UI stays
  offline-capable with no build step.
- Status colors are the `--status-*` tokens in `styles.css` (blue in progress,
  green ready, red blocked, amber on hold, purple awaiting production, gray
  done). The graph legend, node borders, task rails and insights all read them
  through `statusOrder`, so changing one token updates every view.

## Files and privacy

- Everything runs on `127.0.0.1`; non-loopback clients are refused.
- The server reads the queue, `.queue/config.json`, `.queue/chats.sqlite`, and,
  for Discussions, local Claude Code (`~/.claude/projects`) and Codex
  (`~/.codex/sessions`) transcripts whose working directory is inside this
  project. `QUEUE_AGENT_SESSIONS=off` turns the transcript lookup off.
- It writes only inside `.queue/` and the task files, never runs Git or
  database commands, and loads no code from the network (`dev-server/vendor/`
  holds pinned copies of its libraries).
