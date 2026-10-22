# queue-manager

A task queue for coding agents that lives in your repository as plain files.
Each task is one Markdown file, its folder is its status, and a small POSIX
shell CLI moves tasks between states. Any session, yours, a colleague's or
another agent's, can resume work with one command and one file read.

An optional localhost browser UI adds task pages, a per-task clarification
chat, a Jira-style board or the classic list, insights charts, a zoomable
dependency graph and a pitfalls browser linked to the tasks that hit each
lesson. Queue settings → **Design** switches between the Jira-style layout and
the original classic sidebar.

## Skill

| Name | Use it for |
| --- | --- |
| `queue-manager` | Resuming, adding, blocking, unblocking and finishing tasks; keeping `QUEUE.md` current; opening the browser UI, including the pitfalls browser. |

## Install

```sh
npx skills add faouziMohamed/queue-manager
```

Or copy this folder into your agent's skills directory, for example
`.claude/skills/queue-manager/` in a project or `~/.claude/skills/queue-manager/`
for every project.

## Quick start

From the root of your project:

```sh
sh .claude/skills/queue-manager/scripts/queue.sh init
sh .claude/skills/queue-manager/scripts/queue.sh add "Add rate limiting to the login endpoint"
sh .claude/skills/queue-manager/scripts/queue.sh start Q-0001
sh .claude/skills/queue-manager/scripts/queue.sh active
```

Then just talk to your agent: "what's next?", "add this to the queue",
"we're blocked on Q-0003", "mark it done". The skill tells the agent how to
keep each task's body cold-pickup-able.

Optional browser UI:

```sh
sh .claude/skills/queue-manager/scripts/queue.sh ui open
```

## Requirements

- **CLI:** any POSIX shell and standard tools (no Node.js, no database).
- **Browser UI:** Node.js 22.13+ and `curl`. No `npm install`; chart and graph
  libraries are vendored in `dev-server/vendor/`.
- **In-browser assistant (optional):** an installed `claude` or `codex` CLI, or
  an API key for Anthropic, OpenAI or DeepSeek. With none configured, the
  assistant is hidden.

## What is stored where

| Path | Content |
| --- | --- |
| `.queue/<status>/<id>.md` | One file per task (`ready`, `in-progress`, `blocked`, `done`) |
| `.queue/deps/` | Dependency edges in both directions |
| `.queue/header.md` | Static header of the generated `QUEUE.md` |
| `QUEUE.md` | Generated overview; never edit it by hand |
| `PITFALLS.md` | Durable `PIT-###` lessons; tasks link to them by ID |
| `.queue/config.json` | Optional UI settings |
| `.queue/chats.sqlite`, `.queue/agent.env` | UI chat history and optional API keys (git-ignored) |

Whether you commit `.queue/` and `QUEUE.md` is up to you.

## Privacy and permissions

- The CLI writes only `.queue/` data and `QUEUE.md`; it never touches project
  source.
- The browser UI listens on `127.0.0.1` only and refuses other clients. It
  writes only inside `.queue/` and task files, and runs no Git or database
  commands.
- To show which agent sessions discussed a task, the UI reads local Claude Code
  (`~/.claude/projects`) and Codex (`~/.codex/sessions`) transcripts, limited to
  sessions whose working directory is inside this project. Set
  `QUEUE_AGENT_SESSIONS=off` to turn this off.
- The assistant runs `claude -p` in plan mode with permission prompts set to
  `none`, or `codex exec` in a read-only sandbox, so it cannot edit files or run
  commands. Every change it proposes needs your click on **Apply**.
- API keys stay on the server side (`.queue/agent.env` or
  `~/.config/queue-agent.env`) and are never sent to the browser or logged.

## Documentation

- `SKILL.md` — what the agent follows: workflow, commands and rules.
- `references/dev-server.md` — the browser UI.
- `references/assistant.md` — the in-browser assistant and its providers.

## Testing

The eval suite in `evals/` is kept local: the folder is git-ignored and is not
part of the published skill. With the suite present, it runs the skill against
fixture projects and grades the resulting queue files and tool use:

```sh
claude plugin eval . --scaffold --allow-tools Bash Write Edit
```

It reports each case twice: with the skill loaded and against a no-skill
baseline, so the delta shows what the skill actually contributes.

## Development

The skills used to author this repo are pinned in `skills-lock.json` (the
`.claude/` directory that holds them is git-ignored). Restore them with:

```sh
npx skills experimental_install
```

## License

MIT. Bundled libraries keep their own licenses (ECharts is Apache-2.0;
Cytoscape.js, dagre and cytoscape-dagre are MIT); see `dev-server/vendor/README.md`.
