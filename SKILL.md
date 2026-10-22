---
name: queue-manager
description: Manage a repository or workspace task queue. Use when resuming the active task, adding or prioritizing work, setting blockers, updating status, finishing tasks, regenerating QUEUE.md, verifying queue integrity, or starting the browser UI (task pages, clarification chat, insights, dependency graph). The CLI works without Node.js using plain files and a POSIX shell.
---

# Queue Manager

The queue is the workspace's shared memory. This skill is the system; the data
lives in `.queue/` at the workspace root; `QUEUE.md` is a generated human view.
The queue works with any POSIX shell and standard file tools — no Node.js, no
SQLite, no `jq`. The optional browser UI needs Node.js; see **Optional dev server**.

## Resume protocol

1. Run `sh .claude/skills/queue-manager/scripts/queue.sh active`.
2. Read the absolute **Path** it prints with your normal file tools.
3. Follow its `**Resume:**` line. Read only the paths under **Context to load**.
4. Edit the body directly with file tools; use the CLI for state transitions.
5. Never scan `QUEUE.md` or the whole `.queue/` tree to resume a task.

## Data layout

```
.queue/
  header.md                 static content copied into QUEUE.md
  next-id                   next stable numeric ID
  active                    active task ID, or absent
  ready/<id>.md             task body, status = ready
  in-progress/<id>.md       task body, status = in-progress (at most one)
  blocked/<id>.md           task body, status = blocked
  done/<id>.md              task body, status = done
  deps/<id>.blocked-by      one blocker ID per line
  deps/<id>.blocks          one dependent ID per line
  config.json               optional project name, layout and repository list
```

Status is the directory. Moving a task is one `mv`, atomic on the same
filesystem. The active task is one file read. A lookup checks four status
directories — four constant path checks, no scan.

### Production gate

Set `prod_gate: true` in one task's frontmatter (the gate, usually a tech-lead
approval). Every open task blocked by that gate appears under **Awaiting
production** in the generated `QUEUE.md`; the section is driven by the existing
`deps/<id>.blocked-by` edges, so no extra status or per-task metadata is needed.
Use the normal `block <id> --by <gate>` and `unblock <id>` transitions.

## Complexity

| Operation | Cost |
|---|---|
| `active`, `path <id>`, `show <id>` | O(1) — fixed path checks |
| `start`, `block`, `unblock`, `done` | O(1) + k dependency edges |
| `add` | O(1) + k dependency edges |
| `next` | O(k log k), k = ready tasks |
| `list`, `index`, `verify` | O(n) by design; never on the resume path |

SQLite would give indexed lookups and transactions, but it requires Node or the
`sqlite3` binary. The plain-file layout is portable and already constant-time on
the hot path. If a SQLite index is added later, it must remain a cache: these
files stay the source of truth.

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
sh .claude/skills/queue-manager/scripts/queue.sh init
sh .claude/skills/queue-manager/scripts/queue.sh ui start|open|status|stop|restart|logs|run [port]
```

`add` allocates the next stable `Q-NNNN` ID and prints it. `done` moves the task
to `done/` and records its shipped date and summary; completed tickets are not
listed in the generated view. Nothing is deleted. A task whose frontmatter has
`prod_gate: true` is treated as a production gate; tasks blocked by it are listed
under **Awaiting production**.

## Optional dev server

The queue stays file-based and the POSIX CLI stays authoritative. An optional
localhost UI lives in `dev-server/` and ships with the skill: every install
gets the same pages, charts, graph and assistant, with no build step.

```sh
sh .claude/skills/queue-manager/scripts/queue.sh ui start   # background, port 4317
sh .claude/skills/queue-manager/scripts/queue.sh ui open    # start if needed, open the browser
sh .claude/skills/queue-manager/scripts/queue.sh ui status|stop|restart|logs|run [port]
```

`ui run` stays in the foreground. The PID and log live in
`.queue/dev-server.pid` and `.queue/dev-server.log` (git-ignored). A workspace
Makefile can wrap these commands; the logic stays in `dev-server/queue-ui.sh`.

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

### Task drawer and task page

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
- Every view has a real URL (`/ready`, `/insights`, `/graph`, `/tasks/Q-0001`),
  so refresh, back/forward, new tabs and copied links work. Old `#task/Q-0001`
  links still open the drawer.
- Edit with Ctrl+S to save and Esc to leave; navigating away with unsaved
  edits is refused with a notice, closing the tab asks first, and chat updates
  wait until body edits are saved or cancelled.

### Insights and dependency graph

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

### Assistant

The assistant appears only when at least one provider is configured: an
installed `claude` or `codex` CLI, the `cdk` DeepSeek route, or an API key.
With none, the Assistant button and drawer, the assistant settings, and the
Discussions composer and **New discussion** button are hidden; the
Discussions list stays, read-only (chats open in a viewer, agent sessions keep
their resume command). Saving settings re-checks availability; adding a key to
an env file needs a server restart.

The assistant header always shows the active provider, with inline agent/model
selectors and a chat history. The provider is one of `auto`, `claude-cli`,
`claude-api`, `codex-cli`, `codex-api`, `deepseek-cli` or `deepseek`; the
provider and optional model live in `.queue/config.json`, credentials never do.
Chats are stored server-side in `.queue/chats.sqlite` (Node's built-in
`node:sqlite`, Node 22.13+; owner-only file, git-ignored by `.queue/.gitignore`),
so every browser sees the same history. The History panel lists chats grouped
by date, searches titles and message text, reopens a chat, and deletes one with
a two-step confirm. Chats left in a browser's local storage by older versions
are imported automatically the first time that browser opens the page.

Each reply records the provider and model that answered it and, when the
provider reports usage, the session total (`↓ 84.8k tokens`) with input/output
in its tooltip. The provider selector lists Auto plus only providers whose CLI
or key is configured; a saved provider that is no longer available resets to
Auto. An amber dot and `not configured` mark the case where no provider is
available at all.

- `claude-cli` uses the installed `claude` login in plan mode with permission
  prompts disabled. `codex-cli` uses `codex exec` with a read-only sandbox.
  Both use the existing subscription login.
- `claude-api` uses the same Claude CLI transport with `ANTHROPIC_API_KEY`;
  `codex-api` uses Codex CLI with `OPENAI_API_KEY`.
- `deepseek-cli` uses the existing `cdk` function in `~/.bashrc`, which routes
  Claude Code to DeepSeek; the key never leaves that shell.
- `deepseek` uses `DEEPSEEK_API_KEY` and optional `DEEPSEEK_BASE_URL`.
- Key providers read the server environment. Keep keys in the workspace
  `.queue/agent.env` (created next to a `.gitignore` entry) or in
  `~/.config/queue-agent.env`; `serve.sh` sources the home file, and the server
  loads `.queue/agent.env`. `QUEUE_AGENT_ENV` overrides the home file path.
  The browser only receives availability, never a key.
- The assistant receives the open-task summary and the selected task body. Its
  answer is read-only; proposed task creation, body edits and actions are
  rendered as cards and applied only when the user clicks Apply.
- Keys are never written to the queue, logged by the dev server, or sent to the
  browser.

```dotenv
# ~/.config/queue-agent.env or <workspace>/.queue/agent.env — chmod 600
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export DEEPSEEK_API_KEY=...
```

Restart the dev server after changing the file. Select the matching
`claude-api`, `codex-api` or `deepseek` provider in the assistant toolbar.
Claude/Codex subscriptions need no key: select `claude-cli` or `codex-cli`.
Model choices come from the provider: Claude aliases, the live Codex catalog
from `codex debug models`, and the two DeepSeek models.

## Setup and portability

Install on another repository or machine by placing this skill folder in the
agent's skills directory (or symlinking it to `.claude/skills/queue-manager`),
then, from the repository root:

```sh
sh .claude/skills/queue-manager/scripts/queue.sh init
sh .claude/skills/queue-manager/scripts/queue.sh ui open
```

`init` creates `.queue/` (status folders, `deps/`, `next-id`), copies
`assets/header.md` to `.queue/header.md`, writes `.queue/.gitignore` (assistant
keys, chat database, server PID/log), creates an owner-only `.queue/agent.env`
placeholder from `assets/agent.env.example`, and generates `QUEUE.md`. Existing
files are never overwritten.

The CLI finds the root by walking up from the current directory to the first
folder holding `.queue/`, `CLAUDE.md` or `AGENTS.md`; `init` falls back to the
Git top level or the current directory. Set `WORKSPACE_ROOT` to run from
elsewhere.

What ships in the skill: `scripts/queue.sh` (CLI), `dev-server/` (server, UI
modules and `queue-ui.sh`), `dev-server/vendor/` (pinned ECharts, Cytoscape.js,
dagre and cytoscape-dagre with their licenses), and `assets/` (header, entry
template, key placeholder). Nothing is downloaded at install or run time.

- Override `QUEUE_DIR` to run against another queue data directory.
- Override `QUEUE_INDEX` to write the generated view elsewhere.
- Keep `QUEUE.md` generated; never hand-edit it. Edit `.queue/header.md` for the
  static header, or a task body for content.

## Rules

- **One queue at the workspace root** for cross-repo work. A repository keeps its
  own queue only for work that never leaves it.
- **Stable IDs.** `Q-0001`, `Q-0002`, … Never renumber or reuse an ID.
- **Write the entry when the work is agreed**, before starting.
- **Single in-progress.** `.queue/active` names it; `verify` enforces it.
- **Cold-pickup-able.** The body, context paths, resume line and dependencies must
  let a fresh session continue without a codebase sweep.
- **Checkboxes, not prose.** `- [x]` means done and verified; `- [ ]` means open.
- **Outline only.** No implementation code in an entry.
- **Dependencies are explicit.** `deps/` holds both directions; `queue deps <id>`
  prints them.
- **Archive, don't delete.** `done/` keeps the full body.
- **Lessons go to `PITFALLS.md`**, not the queue. Promote only verified, recurring
  traps with stable `PIT-` IDs.

## Entry shape

Use `assets/entry.md`. The CLI writes the frontmatter and preserves the body; if a
body file already carries frontmatter, it is stripped and regenerated so IDs,
dates and status stay authoritative in the queue.
