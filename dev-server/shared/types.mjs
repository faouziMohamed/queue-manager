/**
 * Shared JSDoc types for the dev server and the browser UI. The file has no
 * runtime code; modules reference these with `import('…/types.mjs').Name`.
 */

/** @typedef {'ready' | 'in-progress' | 'blocked' | 'on-hold' | 'done'} TaskStatus */

/**
 * Status key used for display: a task waiting on a production gate shows as
 * `awaiting` whatever its folder status.
 * @typedef {TaskStatus | 'awaiting'} StatusKey
 */

/**
 * @typedef {object} DefinitionOfDone
 * @property {boolean} present Whether the body has a "Definition of done" heading.
 * @property {number} total Checklist items under the heading.
 * @property {number} done Checked items.
 * @property {{done: boolean, text: string}[]} items
 */

/**
 * A task as the browser uses it, normalized by `toTask`.
 * @typedef {object} Task
 * @property {string} id Stable `Q-NNNN` id.
 * @property {string} title
 * @property {TaskStatus} status
 * @property {string} priority `'1'`, `'2'` or `'3'`.
 * @property {string} updated `YYYY-MM-DD`.
 * @property {string} shipped `YYYY-MM-DD` once done, else empty.
 * @property {string} resume The `**Resume:**` line.
 * @property {string} body Markdown below the frontmatter; empty in list payloads.
 * @property {string[]} blockedBy Ids of open blockers.
 * @property {boolean} awaitingProduction Blocked by a production gate task.
 * @property {boolean} prodGate This task is a production gate.
 * @property {string} repo Repository chip in workspace layouts, else empty.
 * @property {string} file Absolute path of the task file.
 * @property {DefinitionOfDone} dod
 */

/**
 * A task file as the server parses it, before workspace identity is applied.
 * @typedef {object} TaskRecord
 * @property {string} id
 * @property {TaskStatus} status
 * @property {string} file
 * @property {string} title
 * @property {string} priority
 * @property {string} updated
 * @property {string} shipped
 * @property {boolean} prodGate
 * @property {string} sourceRepository
 * @property {string} resume
 * @property {DefinitionOfDone} dod
 * @property {string} body
 * @property {string[]} [blockedBy]
 * @property {boolean} [awaitingProduction]
 * @property {string} [repo]
 */

/**
 * @typedef {'auto' | 'claude-cli' | 'claude-api' | 'codex-cli' | 'codex-api' | 'deepseek-cli' | 'deepseek'} AgentProvider
 */

/**
 * @typedef {object} AgentConfig
 * @property {AgentProvider} provider
 * @property {string} model Empty for the provider's default model.
 */

/**
 * Which assistant providers this machine can use.
 * @typedef {object} AgentAvailability
 * @property {boolean} claudeCli
 * @property {boolean} claudeApi
 * @property {boolean} codexCli
 * @property {boolean} codexApi
 * @property {boolean} deepseekCli
 * @property {boolean} deepseek
 */

/** @typedef {{value: string, label: string}} ModelChoice */

/**
 * Queue settings: shared ones from `.queue/config.json`, display ones
 * (`view`, `design`) from the local preferences table.
 * @typedef {object} Workspace
 * @property {number} [version]
 * @property {string} name
 * @property {'workspace' | 'monorepo' | 'single-repo'} layout
 * @property {'workspace' | 'repo'} mode
 * @property {'list' | 'board'} view
 * @property {'jira' | 'classic'} design
 * @property {number} wipLimit Tasks allowed in progress at once.
 * @property {string[]} repos
 * @property {AgentConfig} agent
 */

/**
 * @typedef {object} TokenUsage
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} cacheReadTokens
 * @property {number} totalTokens
 * @property {number} [costUsd]
 */

/**
 * A change the assistant proposes; it reaches the queue only on Apply.
 * @typedef {object} Proposal
 * @property {'create_task' | 'upsert_section' | 'update_body' | 'action'} type
 * @property {string} [task_id]
 * @property {string} [title]
 * @property {string} [priority]
 * @property {string} [resume]
 * @property {string} [heading]
 * @property {string} [content]
 * @property {string} [body]
 * @property {'start' | 'unblock' | 'hold' | 'resume' | 'done' | 'block'} [action]
 * @property {string} [summary]
 * @property {string[]} [by]
 * @property {boolean} [applied] Set in the browser once applied.
 */

/**
 * @typedef {object} ChatMessage
 * @property {'user' | 'assistant'} role
 * @property {string} content
 * @property {Proposal[]} [proposals]
 * @property {TokenUsage} [usage]
 * @property {{provider: string, model: string}} [agent]
 */

/**
 * @typedef {object} ChatSummary
 * @property {string} id
 * @property {string} title
 * @property {number} createdAt Epoch milliseconds.
 * @property {number} updatedAt Epoch milliseconds.
 * @property {string} provider
 * @property {string} model
 * @property {number} messageCount
 * @property {string} taskId Linked task, or empty.
 * @property {boolean} [linked] In discussions: the chat is linked to the task, not just mentioning it.
 */

/** @typedef {ChatSummary & {messages: ChatMessage[]}} Chat */

/**
 * @typedef {object} SessionMessage
 * @property {'user' | 'assistant' | 'tool'} role
 * @property {'text' | 'thinking' | 'call' | 'result'} kind
 * @property {string} summary One-line label for collapsed steps.
 * @property {string} text Markdown.
 * @property {number} timestamp Epoch milliseconds, or 0.
 */

/**
 * A Claude Code or Codex transcript found for this project.
 * @typedef {object} SessionSummary
 * @property {'claude' | 'codex'} tool
 * @property {string} id
 * @property {string} title
 * @property {string} cwd
 * @property {number} startedAt
 * @property {number} updatedAt
 * @property {number} messageCount
 * @property {number} [mentionCount] Times the requested task id appears.
 * @property {string} resumeCommand Shell command that resumes the session.
 */

/**
 * The browser's application state (`client/core/state.js`).
 * @typedef {object} AppState
 * @property {Task[]} tasks
 * @property {string[]} gates
 * @property {Workspace} workspace
 * @property {boolean} initialized
 * @property {boolean} loading
 * @property {string} error
 * @property {boolean} forbidden
 * @property {string} section
 * @property {string} query
 * @property {'list' | 'task'} view
 * @property {string} [pageTaskId]
 * @property {string} [returnSection]
 * @property {number} queueVersion
 */

export {};
