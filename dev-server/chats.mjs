import {promises as fs} from 'node:fs'
import path from 'node:path'

const chatIdPattern = /^[A-Za-z0-9_-]{1,80}$/
const taskIdPattern = /^Q-\d{4,}$/
const ignoredFiles = ['agent.env', 'chats.sqlite', 'chats.sqlite-wal', 'chats.sqlite-shm', 'dev-server.pid', 'dev-server.log']
const MAX_MESSAGES = 500
const MAX_CONTENT = 200_000
const LIST_LIMIT = 200

export async function openChatStore(queueDir) {
  let DatabaseSync
  try {
    ({DatabaseSync} = await import('node:sqlite'))
  } catch {
    return unavailableStore('Chat history needs Node.js 22.13 or newer (node:sqlite).')
  }
  await ensureIgnored(queueDir)
  const file = path.join(queueDir, 'chats.sqlite')
  const handle = await fs.open(file, 'a', 0o600)
  await handle.close()
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      message_count INTEGER NOT NULL,
      search_text TEXT NOT NULL,
      messages TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chats_updated_at ON chats (updated_at DESC);
  `)
  const columns = db.prepare('PRAGMA table_info(chats)').all().map(column => column.name)
  if (!columns.includes('task_id')) db.exec("ALTER TABLE chats ADD COLUMN task_id TEXT NOT NULL DEFAULT ''")
  db.exec('CREATE INDEX IF NOT EXISTS chats_task_id ON chats (task_id, updated_at DESC)')
  for (const suffix of ['', '-wal', '-shm']) {
    await fs.chmod(`${file}${suffix}`, 0o600).catch(() => {})
  }

  const upsert = db.prepare(`
    INSERT INTO chats (id, title, created_at, updated_at, provider, model, message_count, search_text, messages, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      updated_at = excluded.updated_at,
      provider = excluded.provider,
      model = excluded.model,
      message_count = excluded.message_count,
      search_text = excluded.search_text,
      messages = excluded.messages,
      task_id = excluded.task_id
    WHERE excluded.updated_at >= chats.updated_at
  `)
  const insertNewer = db.prepare(`
    INSERT INTO chats (id, title, created_at, updated_at, provider, model, message_count, search_text, messages, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      updated_at = excluded.updated_at,
      provider = excluded.provider,
      model = excluded.model,
      message_count = excluded.message_count,
      search_text = excluded.search_text,
      messages = excluded.messages,
      task_id = excluded.task_id
    WHERE excluded.updated_at > chats.updated_at
  `)
  const summaryColumns = 'id, title, created_at, updated_at, provider, model, message_count, task_id'
  const listAll = db.prepare(`SELECT ${summaryColumns} FROM chats ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`)
  const listMatching = db.prepare(`
    SELECT ${summaryColumns} FROM chats
    WHERE search_text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}
  `)
  const listForTask = db.prepare(`
    SELECT ${summaryColumns} FROM chats WHERE task_id = ? ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}
  `)
  const listRelated = db.prepare(`
    SELECT ${summaryColumns} FROM chats
    WHERE task_id = ? OR search_text LIKE ? ESCAPE '\\'
    ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}
  `)
  const getOne = db.prepare('SELECT * FROM chats WHERE id = ?')
  const removeOne = db.prepare('DELETE FROM chats WHERE id = ?')

  function write(chat, statement = upsert) {
    return statement.run(
      chat.id, chat.title, chat.createdAt, chat.updatedAt, chat.provider, chat.model,
      chat.messages.length, searchText(chat), JSON.stringify(chat.messages), chat.taskId,
    )
  }

  return {
    available: true,
    list(query, taskId) {
      if (taskId) return listForTask.all(requireTaskId(taskId)).map(summaryFromRow)
      const term = String(query || '').trim().toLowerCase().slice(0, 200)
      const rows = term ? listMatching.all(`%${escapeLike(term)}%`) : listAll.all()
      return rows.map(summaryFromRow)
    },
    related(taskId) {
      const id = requireTaskId(taskId)
      return listRelated.all(id, `%${escapeLike(id.toLowerCase())}%`).map(row => ({...summaryFromRow(row), linked: row.task_id === id}))
    },
    get(id) {
      const row = getOne.get(requireChatId(id))
      return row ? chatFromRow(row) : undefined
    },
    save(id, payload) {
      const existing = getOne.get(requireChatId(id))
      const now = Date.now()
      const chat = normalizeChat({
        title: payload.title,
        messages: payload.messages,
        taskId: payload.taskId === undefined && existing ? existing.task_id : payload.taskId,
        id,
        createdAt: existing ? existing.created_at : now,
        updatedAt: Math.max(now, existing ? existing.updated_at : 0),
      })
      write(chat)
      return summaryFromRow(getOne.get(chat.id))
    },
    remove(id) {
      return removeOne.run(requireChatId(id)).changes > 0
    },
    importMany(threads) {
      if (!Array.isArray(threads)) throw storeError(400, 'threads must be an array')
      let imported = 0
      db.exec('BEGIN')
      try {
        for (const thread of threads.slice(0, 1000)) {
          if (!thread || !chatIdPattern.test(String(thread.id || ''))) continue
          const chat = normalizeChat(thread)
          if (chat.messages.length === 0) continue
          if (write(chat, insertNewer).changes > 0) imported += 1
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return imported
    },
  }
}

function unavailableStore(message) {
  function fail() {
    throw storeError(501, message)
  }
  return {available: false, list: fail, related: fail, get: fail, save: fail, remove: fail, importMany: fail}
}

async function ensureIgnored(queueDir) {
  const file = path.join(queueDir, '.gitignore')
  let current = ''
  try {
    current = await fs.readFile(file, 'utf8')
  } catch {}
  const lines = new Set(current.split('\n').map(line => line.trim()))
  const missing = ignoredFiles.filter(name => !lines.has(name))
  if (missing.length === 0) return
  const prefix = current && !current.endsWith('\n') ? '\n' : ''
  await fs.appendFile(file, `${prefix}${missing.join('\n')}\n`)
}

function storeError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function requireChatId(id) {
  const value = String(id || '')
  if (!chatIdPattern.test(value)) throw storeError(400, 'invalid chat id')
  return value
}

function requireTaskId(value) {
  const id = String(value || '')
  if (!taskIdPattern.test(id)) throw storeError(400, 'invalid task id')
  return id
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`)
}

function normalizeChat(input) {
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .slice(-MAX_MESSAGES)
    .map(normalizeMessage)
    .filter(Boolean)
  const lastAgent = [...messages].reverse().find(message => message.agent)?.agent
  const updatedAt = toTimestamp(input.updatedAt, toTimestamp(input.createdAt, Date.now()))
  const createdAt = Math.min(toTimestamp(input.createdAt, updatedAt), updatedAt)
  return {
    id: String(input.id),
    title: chatTitle(input.title, messages),
    createdAt,
    updatedAt,
    provider: lastAgent?.provider || '',
    model: lastAgent?.model || '',
    taskId: taskIdPattern.test(String(input.taskId || '')) ? String(input.taskId) : '',
    messages,
  }
}

function normalizeMessage(message) {
  if (!message || typeof message.content !== 'string') return undefined
  const role = message.role === 'assistant' ? 'assistant' : 'user'
  const normalized = {role, content: message.content.slice(0, MAX_CONTENT)}
  if (role === 'assistant') {
    normalized.proposals = Array.isArray(message.proposals) ? message.proposals.slice(0, 3) : []
    if (message.usage && typeof message.usage === 'object') {
      normalized.usage = {
        inputTokens: Number(message.usage.inputTokens) || 0,
        outputTokens: Number(message.usage.outputTokens) || 0,
        cacheReadTokens: Number(message.usage.cacheReadTokens) || 0,
        totalTokens: Number(message.usage.totalTokens) || 0,
      }
      if (typeof message.usage.costUsd === 'number') normalized.usage.costUsd = message.usage.costUsd
    }
    if (message.agent && typeof message.agent === 'object') {
      normalized.agent = {
        provider: String(message.agent.provider || '').slice(0, 40),
        model: String(message.agent.model || '').slice(0, 200),
      }
    }
  }
  return normalized
}

function chatTitle(title, messages) {
  const explicit = String(title || '').replace(/\s+/g, ' ').trim()
  if (explicit && explicit !== 'New chat') return explicit.slice(0, 120)
  const first = messages.find(message => message.role === 'user')
  return (first?.content || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 120) || 'New chat'
}

function toTimestamp(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function searchText(chat) {
  return [chat.title, ...chat.messages.map(message => message.content)]
    .join('\n')
    .toLowerCase()
    .slice(0, 2_000_000)
}

function summaryFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    provider: row.provider,
    model: row.model,
    messageCount: Number(row.message_count),
    taskId: row.task_id || '',
  }
}

function chatFromRow(row) {
  let messages = []
  try {
    messages = JSON.parse(row.messages)
  } catch {}
  return {...summaryFromRow(row), messages: Array.isArray(messages) ? messages : []}
}
