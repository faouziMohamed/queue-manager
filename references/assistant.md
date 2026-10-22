# Assistant (dev server)

Read this when the user asks about the in-browser assistant: choosing a
provider, adding API keys, chat history, the per-task Clarify chat, or why the
assistant is hidden. The CLI never uses an assistant.


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

## Clarify mode

On a task page, the Clarify chat runs the assistant with the task body as
context. It asks short, specific questions about scope, acceptance, owners,
environments, dependencies and risks, and never records a decision the user did
not state. When the user agrees, it proposes `upsert_section` updates for that
task (for example **Clarifications**, **Before continuing**, **Open
questions**). **Apply** replaces that one section of the task file, or appends
it, and leaves the rest of the body untouched.

## What the CLIs are allowed to do

- `claude-cli` / `claude-api` run `claude -p` in plan mode with permission
  prompts set to `none`, so the run can read the project but cannot edit files
  or run commands.
- `codex-cli` / `codex-api` run `codex exec --sandbox read-only --ephemeral`.
- Every proposed change (new task, section update, body replacement, status
  action) is shown as a card and applied only when the user clicks Apply.
