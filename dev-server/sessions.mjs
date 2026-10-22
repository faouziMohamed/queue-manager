import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Matches queue task ids such as Q-0147.
const taskIdPattern = /\bQ-\d{4,}\b/g
// Matches injected harness blocks that are not part of what the person or agent said.
const injectedPattern = /<(system-reminder|command-[a-z-]+|local-command-[a-z-]+)>[\s\S]*?<\/\1>/g
const sessionIdPattern = /^[A-Za-z0-9-]{8,80}$/
const REFRESH_MS = 30_000
const MAX_MESSAGES = 300
const MAX_TEXT = 6000

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
    const content = record.message?.content
    const parts = typeof content === 'string' ? [content] : (Array.isArray(content) ? content : [])
      .filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
    const cleaned = clean(parts.join('\n\n'))
    if (!cleaned) continue
    const timestamp = Date.parse(record.timestamp) || 0
    if (!session.startedAt && timestamp) session.startedAt = timestamp
    if (record.type === 'user' && !firstPrompt) firstPrompt = cleaned
    session.messages.push({role: record.type, text: cleaned.slice(0, MAX_TEXT), timestamp})
  }
  session.title = titleFrom(session.title || firstPrompt)
  return session
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
    if (record.type !== 'response_item' || payload.type !== 'message') continue
    if (payload.role !== 'user' && payload.role !== 'assistant') continue
    const raw = (Array.isArray(payload.content) ? payload.content : [])
      .filter(part => typeof part?.text === 'string')
      .map(part => part.text)
      .join('\n\n')
    if (payload.role === 'user' && /^\s*<[a-z_ -]+>/i.test(raw)) continue
    const cleaned = clean(raw)
    if (!cleaned) continue
    if (payload.role === 'user' && !firstPrompt) firstPrompt = cleaned
    session.messages.push({role: payload.role, text: cleaned.slice(0, MAX_TEXT), timestamp: Date.parse(record.timestamp) || 0})
  }
  if (!session.id) session.id = path.basename(file, '.jsonl').slice(-36)
  session.title = titleFrom(firstPrompt)
  return session
}

function parseLine(line) {
  if (!line) return undefined
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function clean(value) {
  return String(value || '').replace(injectedPattern, '').trim()
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
