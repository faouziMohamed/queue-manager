import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Matches queue task ids such as Q-0147.
const taskIdPattern = /\bQ-\d{4,}\b/g
// Matches injected harness blocks that are not part of what the person or agent said.
const injectedPattern = /<(system-reminder|command-[a-z-]+|local-command-caveat|task-notification)>[\s\S]*?<\/\1[^>]*>/gi
// Matches harness wrappers whose inner text is real content; only the tags are dropped.
const wrapperPattern = /<\/?(pasted_content|cross-session-message|local-command-stdout|local-command-stderr)[^>]*>/gi
const sessionIdPattern = /^[A-Za-z0-9-]{8,80}$/
const REFRESH_MS = 30_000
const MAX_MESSAGES = 1000
const MAX_TEXT = 20_000
const MAX_TOOL_TEXT = 8_000

export function createSessionIndex(root) {
  const enabled = process.env.QUEUE_AGENT_SESSIONS !== 'off'
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const files = new Map()
  let refreshedAt = 0
  let refreshing

  async function refresh() {
    if (!enabled) return
    if (Date.now() - refreshedAt < REFRESH_MS) return
    refreshing ??= (async () => {
      const candidates = [...await claudeFiles(claudeHome, root), ...await codexFiles(codexHome)]
      const seen = new Set()
      for (const candidate of candidates) {
        seen.add(candidate.file)
        const stat = await fs.stat(candidate.file).catch(() => undefined)
        if (!stat) continue
        const cached = files.get(candidate.file)
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue
        const parsed = await parseSession(candidate.tool, candidate.file).catch(() => undefined)
        files.set(candidate.file, {mtimeMs: stat.mtimeMs, size: stat.size, session: accept(parsed, root, stat)})
      }
      for (const file of files.keys()) if (!seen.has(file)) files.delete(file)
      refreshedAt = Date.now()
    })().finally(() => { refreshing = undefined })
    await refreshing
  }

  async function current() {
    if (files.size === 0) await refresh()
    else refresh().catch(() => {})
  }

  if (enabled) refresh().catch(() => {})

  return {
    enabled,
    get ready() { return refreshedAt > 0 },
    async forTask(taskId) {
      await current()
      return [...files.values()]
        .map(entry => entry.session)
        .filter(session => session?.mentions.has(taskId))
        .map(session => summary(session, taskId))
        .sort((left, right) => right.updatedAt - left.updatedAt)
    },
    async read(tool, id) {
      if (!['claude', 'codex'].includes(tool) || !sessionIdPattern.test(String(id))) return undefined
      await current()
      const entry = [...files.entries()].find(([, value]) => value.session?.tool === tool && value.session.id === id)
      if (!entry) return undefined
      const parsed = await parseSession(tool, entry[0])
      return {...summary(entry[1].session), messages: parsed.messages.slice(-MAX_MESSAGES)}
    },
  }
}

function accept(parsed, root, stat) {
  if (!parsed || parsed.automated || parsed.messages.length === 0) return undefined
  if (parsed.cwd !== root && !parsed.cwd.startsWith(`${root}/`)) return undefined
  const mentions = new Map()
  for (const message of parsed.messages) {
    for (const match of message.text.matchAll(taskIdPattern)) mentions.set(match[0], (mentions.get(match[0]) || 0) + 1)
  }
  return {
    tool: parsed.tool,
    id: parsed.id,
    title: parsed.title,
    cwd: parsed.cwd,
    startedAt: parsed.startedAt || stat.birthtimeMs || stat.mtimeMs,
    updatedAt: stat.mtimeMs,
    messageCount: parsed.messages.length,
    mentions,
  }
}

function summary(session, taskId) {
  const resume = session.tool === 'claude' ? `claude --resume ${session.id}` : `codex resume ${session.id}`
  return {
    tool: session.tool,
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    mentionCount: taskId ? session.mentions.get(taskId) || 0 : undefined,
    resumeCommand: `cd ${shellQuote(session.cwd)} && ${resume}`,
  }
}

async function claudeFiles(home, root) {
  const projects = path.join(home, 'projects')
  const prefix = root.replace(/[^A-Za-z0-9]/g, '-')
  const directories = (await fs.readdir(projects).catch(() => [])).filter(name => name.startsWith(prefix))
  const found = []
  for (const directory of directories) {
    for (const name of await fs.readdir(path.join(projects, directory)).catch(() => [])) {
      if (name.endsWith('.jsonl')) found.push({tool: 'claude', file: path.join(projects, directory, name)})
    }
  }
  return found
}

async function codexFiles(home) {
  const found = []
  async function walk(directory, depth) {
    for (const entry of await fs.readdir(directory, {withFileTypes: true}).catch(() => [])) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory() && depth < 4) await walk(target, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push({tool: 'codex', file: target})
    }
  }
  await walk(path.join(home, 'sessions'), 0)
  return found
}

async function parseSession(tool, file) {
  const text = await fs.readFile(file, 'utf8')
  return tool === 'claude' ? parseClaude(text, file) : parseCodex(text, file)
}

function parseClaude(text, file) {
  const session = {tool: 'claude', id: path.basename(file, '.jsonl'), title: '', cwd: '', startedAt: 0, automated: false, messages: []}
  let firstPrompt = ''
  for (const line of text.split('\n')) {
    const record = parseLine(line)
    if (!record) continue
    if (record.entrypoint && record.entrypoint !== 'cli') session.automated = true
    if (record.cwd && !session.cwd) session.cwd = record.cwd
    if (record.type === 'ai-title' && record.aiTitle) session.title = String(record.aiTitle)
    if (record.type === 'summary' && record.summary && !session.title) session.title = String(record.summary)
    if ((record.type !== 'user' && record.type !== 'assistant') || record.isMeta || record.isSidechain) continue
    const timestamp = Date.parse(record.timestamp) || 0
    if (!session.startedAt && timestamp) session.startedAt = timestamp
    for (const segment of claudeSegments(record.type, record.message?.content)) {
      const cleaned = clean(segment.text)
      if (!cleaned) continue
      if (segment.role === 'user' && !firstPrompt) firstPrompt = cleaned
      session.messages.push({role: segment.role, ...describe(segment.role, cleaned), text: cleaned.slice(0, MAX_TEXT), timestamp})
    }
  }
  session.title = titleFrom(session.title || firstPrompt)
  return session
}

function claudeSegments(role, content) {
  const parts = typeof content === 'string' ? [{type: 'text', text: content}] : (Array.isArray(content) ? content : [])
  const segments = []
  for (const part of parts) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      segments.push({role, text: part.text})
    } else if (part?.type === 'thinking' && typeof part.thinking === 'string') {
      segments.push({role, text: `**Thinking**\n\n${quoteBlock(part.thinking)}`})
    } else if (part?.type === 'tool_use') {
      segments.push({role: 'tool', text: toolUseText(part.name, part.input)})
    } else if (part?.type === 'tool_result') {
      segments.push({role: 'tool', text: toolResultText(part)})
    }
  }
  return segments
}

function parseCodex(text, file) {
  const session = {tool: 'codex', id: '', title: '', cwd: '', startedAt: 0, automated: false, messages: []}
  let firstPrompt = ''
  for (const line of text.split('\n')) {
    const record = parseLine(line)
    if (!record) continue
    const payload = record.payload || {}
    if (record.type === 'session_meta') {
      session.id = String(payload.id || '')
      session.cwd = String(payload.cwd || '')
      session.startedAt = Date.parse(payload.timestamp) || 0
      if (/sdk|exec/i.test(String(payload.originator || ''))) session.automated = true
      continue
    }
    if (record.type !== 'response_item') continue
    const timestamp = Date.parse(record.timestamp) || 0
    for (const segment of codexSegments(payload)) {
      const cleaned = clean(segment.text)
      if (!cleaned) continue
      if (segment.role === 'user' && !firstPrompt) firstPrompt = cleaned
      session.messages.push({role: segment.role, ...describe(segment.role, cleaned), text: cleaned.slice(0, MAX_TEXT), timestamp})
    }
  }
  if (!session.id) session.id = path.basename(file, '.jsonl').slice(-36)
  session.title = titleFrom(firstPrompt)
  return session
}

function codexSegments(payload) {
  if (payload.type === 'message') {
    if (payload.role !== 'user' && payload.role !== 'assistant') return []
    const raw = (Array.isArray(payload.content) ? payload.content : [])
      .filter(part => typeof part?.text === 'string')
      .map(part => part.text)
      .join('\n\n')
    if (!raw.trim()) return []
    if (payload.role === 'user' && /^\s*<[a-z_ -]+>/i.test(raw)) return []
    return [{role: payload.role, text: raw}]
  }
  if (payload.type === 'function_call' || payload.type === 'local_shell_call') {
    return [{role: 'tool', text: codexCallText(payload)}]
  }
  if (payload.type === 'function_call_output') {
    const output = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '')
    return output.trim() ? [{role: 'tool', text: `**Tool result**\n\n${codeFence(output)}`}] : []
  }
  if (payload.type === 'reasoning') {
    const summary = Array.isArray(payload.summary)
      ? payload.summary.map(item => item?.text).filter(Boolean).join('\n')
      : ''
    const raw = summary || (typeof payload.content === 'string' ? payload.content : '')
    return raw.trim() ? [{role: 'assistant', text: `**Thinking**\n\n${quoteBlock(raw)}`}] : []
  }
  return []
}

function codexCallText(payload) {
  const name = String(payload.name || payload.action?.type || 'Tool')
  let args = {}
  try {
    args = JSON.parse(String(payload.arguments || '')) || {}
  } catch {}
  const command = args.command ?? args.cmd ?? payload.action?.command
  if (typeof command === 'string' || Array.isArray(command)) {
    return `**${name}**\n\n${codeFence(Array.isArray(command) ? command.join(' ') : command, 'sh')}`
  }
  const detail = command ?? args.description ?? ''
  if (detail) return `**${name}** · \`${inlineCode(clip(String(detail), 200))}\``
  const raw = String(payload.arguments || '').trim()
  return raw ? `**${name}** · \`${inlineCode(clip(raw, 200))}\`` : `**${name}**`
}

function parseLine(line) {
  if (!line) return undefined
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

// Classifies a message so the viewer can collapse tool steps and thinking the way the CLI does.
function describe(role, text) {
  if (role === 'tool') {
    const result = text.startsWith('**Tool result')
    const firstLine = result ? '' : text.split('\n').find(line => line.trim()) || ''
    const command = !result && text.startsWith('**Bash**') ? (text.match(/```[a-z]*\n([^\n]*)/) || [])[1] || '' : ''
    const summary = result
      ? (text.includes('· error') ? 'Result · error' : 'Result')
      : (command ? `Bash · ${command}` : firstLine.replace(/\*\*/g, '').replace(/`/g, ''))
    return {kind: result ? 'result' : 'call', summary: summary.slice(0, 160)}
  }
  if (text.startsWith('**Thinking**')) return {kind: 'thinking', summary: 'Thinking'}
  return {kind: 'text', summary: ''}
}

function clean(value) {
  return String(value || '')
    .replace(injectedPattern, '')
    .replace(wrapperPattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const toolDetailFields = {
  Read: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  Glob: 'pattern',
  Grep: 'pattern',
  Task: 'description',
  Agent: 'description',
  WebFetch: 'url',
  WebSearch: 'query',
  Skill: 'skill',
}

function toolUseText(name, input) {
  const label = String(name || 'Tool')
  const values = input && typeof input === 'object' ? input : {}
  const field = toolDetailFields[label]
  const detail = field ? values[field] : values.command ?? values.description ?? values.path ?? values.query
  if (detail == null || detail === '') return `**${label}**`
  if (label === 'Bash') return `**Bash**\n\n${codeFence(Array.isArray(detail) ? detail.join(' ') : detail, 'sh')}`
  const text = String(Array.isArray(detail) ? detail.join(' ') : detail).replace(/\s+/g, ' ').trim()
  return text ? `**${label}** · \`${inlineCode(clip(text, 200))}\`` : `**${label}**`
}

function toolResultText(part) {
  const content = part?.content
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(item => typeof item?.text === 'string').map(item => item.text).join('\n\n')
      : ''
  if (!text.trim()) return ''
  return `**Tool result${part.is_error ? ' · error' : ''}**\n\n${codeFence(text)}`
}

function codeFence(value, language = '') {
  const body = clip(value, MAX_TOOL_TEXT).replace(/```/g, '``​`')
  return `\`\`\`${language}\n${body}\n\`\`\``
}

function inlineCode(value) {
  return String(value).replace(/`/g, "'")
}

function quoteBlock(value) {
  return clip(value, MAX_TOOL_TEXT).split('\n').map(line => `> ${line}`).join('\n')
}

function clip(value, limit) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}\n… +${text.length - limit} more characters` : text
}

function titleFrom(value) {
  const line = String(value || '')
    .replace(/<\/?pasted_content[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return line.slice(0, 90) || 'Untitled session'
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}
