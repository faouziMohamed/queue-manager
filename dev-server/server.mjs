#!/usr/bin/env node
import {execFile} from 'node:child_process'
import {createServer} from 'node:http'
import {promises as fs, readdirSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {agentAvailability, agentModels, runAgent} from './agent.mjs'
import {openChatStore} from './chats.mjs'
import {createSessionIndex} from './sessions.mjs'
import {
  detectWorkspace,
  normalizeWorkspaceConfig,
  pathExists,
  readWorkspaceConfig,
  withWorkspaceIdentity,
  writeWorkspaceConfig,
} from './workspace.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.resolve(here, '..')
const queueScript = path.join(skillDir, 'scripts', 'queue.sh')
const root = path.resolve(
  process.argv[2] || process.env.WORKSPACE_ROOT || process.cwd(),
)
const port = Number(process.argv[3] || process.env.PORT || 4317)
const queueDir = path.join(root, '.queue')
const statuses = ['in-progress', 'ready', 'blocked', 'done']
const idPattern = /^Q-\d{4,}$/
const contentTypes = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}
const staticAssets = new Map(
  [
    ...readdirSync(here).map(file => [file, file]),
    ...readdirSync(path.join(here, 'vendor')).map(file => [`vendor/${file}`, `vendor/${file}`]),
  ]
    .filter(([file]) => contentTypes[path.extname(file)])
    .map(([url, file]) => [`/${url}`, [file, contentTypes[path.extname(file)]]]),
)

async function loadAgentEnv(file) {
  try {
    const text = await fs.readFile(file, 'utf8')
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value
    }
  } catch {}
}

await loadAgentEnv(path.join(queueDir, 'agent.env'))

const detectedWorkspace = await detectWorkspace(root)
let workspace = await readWorkspaceConfig(root, detectedWorkspace)
let initialized = await pathExists(queueDir)

let mutations = Promise.resolve()

function serialize(operation) {
  const next = mutations.then(operation, operation)
  mutations = next.catch(() => {})
  return next
}

function parseTask(text, status, file) {
  const sections = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!sections) return undefined

  const meta = {}
  for (const line of sections[1].split('\n')) {
    const separator = line.indexOf(': ')
    if (separator > 0) meta[line.slice(0, separator)] = line.slice(separator + 2)
  }

  const body = sections[2]
  const resume = (body.match(/^\*\*Resume:\*\* (.*)$/m) || [])[1] || ''

  return {
    id: meta.id,
    status,
    file,
    title: meta.title || '',
    priority: meta.priority || '',
    updated: meta.updated || '',
    shipped: meta.shipped || '',
    prodGate: meta.prod_gate === 'true',
    sourceRepository: meta.source_repository || '',
    resume,
    body,
  }
}

async function readBlockedBy(id) {
  try {
    const text = await fs.readFile(path.join(queueDir, 'deps', `${id}.blocked-by`), 'utf8')
    return text.split('\n').map(line => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function listTasks() {
  const tasks = []
  for (const status of statuses) {
    let entries = []
    try {
      entries = await fs.readdir(path.join(queueDir, status))
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const file = path.join(queueDir, status, entry)
      const parsed = parseTask(await fs.readFile(file, 'utf8'), status, file)
      if (!parsed) continue
      const task = withWorkspaceIdentity(parsed, workspace)
      task.body = ''
      task.blockedBy = await readBlockedBy(task.id)
      tasks.push(task)
    }
  }
  const gates = tasks.filter(task => task.prodGate).map(task => task.id)
  for (const task of tasks) {
    task.awaitingProduction = task.blockedBy.some(id => gates.includes(id))
  }
  tasks.sort((left, right) => left.id.localeCompare(right.id))
  return {root, initialized: true, workspace, tasks, gates}
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function runQueue(args) {
  return new Promise((resolve, reject) => {
    execFile(
      'sh',
      [queueScript, ...args],
      {cwd: root, env: {...process.env, WORKSPACE_ROOT: root}, maxBuffer: 1_000_000},
      (error, stdout, stderr) => {
        if (error) {
          reject(httpError(409, (stderr || stdout || error.message).trim()))
          return
        }
        resolve(stdout.trim())
      },
    )
  })
}

async function readJson(request, limit = 1_000_000) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw httpError(413, 'request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError(400, 'invalid JSON body')
  }
}

async function findTask(id) {
  for (const status of statuses) {
    const file = path.join(queueDir, status, `${id}.md`)
    try {
      const parsed = parseTask(await fs.readFile(file, 'utf8'), status, file)
      if (parsed) return withWorkspaceIdentity(parsed, workspace)
    } catch {
      continue
    }
  }
  return undefined
}

async function replaceBody(id, body) {
  if (typeof body !== 'string') throw httpError(400, 'body must be a string')
  const task = await findTask(id)
  if (!task) throw httpError(404, `unknown task: ${id}`)
  if (task.status === 'done') throw httpError(409, 'done records are immutable')

  const text = await fs.readFile(task.file, 'utf8')
  const closing = text.indexOf('\n---\n', 4)
  if (closing === -1) throw httpError(500, `cannot find frontmatter in ${task.file}`)

  const next = `${text.slice(0, closing + 5)}${body.replace(/\s+$/, '')}\n`
  const temporary = `${task.file}.tmp.${process.pid}`
  await fs.writeFile(temporary, next, 'utf8')
  await fs.rename(temporary, task.file)
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

async function sendAsset(response, filename, contentType) {
  const body = await fs.readFile(path.join(here, filename), 'utf8')
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

async function sendIndex(response) {
  await sendAsset(response, 'index.html', 'text/html; charset=utf-8')
}

let chatStorePromise
const sessionIndex = createSessionIndex(root)

function chatStore() {
  if (!initialized) throw httpError(409, 'initialize the queue first')
  chatStorePromise ??= openChatStore(queueDir).catch(error => {
    chatStorePromise = undefined
    throw error
  })
  return chatStorePromise
}

async function handleChats(request, response, url) {
  const store = await chatStore()
  if (url.pathname === '/api/chats' && request.method === 'GET') {
    sendJson(response, 200, {chats: store.list(url.searchParams.get('q'), url.searchParams.get('task'))})
    return true
  }
  if (url.pathname === '/api/chats/import' && request.method === 'POST') {
    const payload = await readJson(request, 16_000_000)
    sendJson(response, 200, {imported: store.importMany(payload.threads)})
    return true
  }
  const match = url.pathname.match(/^\/api\/chats\/([^/]+)$/)
  if (!match) return false
  const id = decodeURIComponent(match[1])
  if (request.method === 'GET') {
    const chat = store.get(id)
    if (!chat) throw httpError(404, 'chat not found')
    sendJson(response, 200, chat)
    return true
  }
  if (request.method === 'PUT') {
    const payload = await readJson(request, 8_000_000)
    sendJson(response, 200, store.save(id, payload))
    return true
  }
  if (request.method === 'DELETE') {
    if (!store.remove(id)) throw httpError(404, 'chat not found')
    sendJson(response, 200, {ok: true})
    return true
  }
  return false
}

const pageRoutes = ['/', '/in-progress', '/ready', '/blocked', '/awaiting', '/done', '/insights', '/graph']

function isPageRoute(pathname) {
  return pageRoutes.includes(pathname) || /^\/tasks\/Q-\d{4,}$/.test(pathname)
}

function isLoopback(request) {
  const address = request.socket.remoteAddress
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
}

const server = createServer(async (request, response) => {
  try {
    if (!isLoopback(request)) {
      sendJson(response, 403, {error: 'the queue dev server is localhost-only'})
      return
    }

    const url = new URL(request.url, `http://${request.headers.host}`)

    if (request.method === 'GET' && isPageRoute(url.pathname)) {
      await sendIndex(response)
      return
    }

    if (request.method === 'GET' && staticAssets.has(url.pathname)) {
      const [filename, contentType] = staticAssets.get(url.pathname)
      await sendAsset(response, filename, contentType)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/config') {
      sendJson(response, 200, {root, initialized, workspace})
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/config') {
      if (!initialized) throw httpError(409, 'initialize the queue first')
      const payload = await readJson(request)
      const config = normalizeWorkspaceConfig(payload, workspace.name)
      await writeWorkspaceConfig(root, config)
      workspace = {...config, mode: config.layout === 'single-repo' ? 'repo' : 'workspace'}
      sendJson(response, 200, {ok: true, workspace})
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/init') {
      if (initialized) throw httpError(409, 'the queue is already initialized')
      const payload = await readJson(request)
      const config = normalizeWorkspaceConfig(payload, path.basename(root))
      await serialize(() => runQueue(['init']))
      await writeWorkspaceConfig(root, config)
      workspace = {...config, mode: config.layout === 'single-repo' ? 'repo' : 'workspace'}
      initialized = true
      sendJson(response, 201, {ok: true, workspace})
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/agent') {
      const available = await agentAvailability()
      sendJson(response, 200, {
        config: workspace.agent || {provider: 'auto', model: ''},
        available,
        models: await agentModels(available),
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/agent/config') {
      if (!initialized) throw httpError(409, 'initialize the queue first')
      const payload = await readJson(request)
      const config = normalizeWorkspaceConfig(
        {...workspace, agent: {provider: payload.provider, model: payload.model}},
        workspace.name,
      )
      await writeWorkspaceConfig(root, config)
      workspace = config
      const available = await agentAvailability()
      sendJson(response, 200, {
        config: workspace.agent,
        available,
        models: await agentModels(available),
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/agent/chat') {
      if (!initialized) throw httpError(409, 'initialize the queue first')
      const payload = await readJson(request)
      const messages = (Array.isArray(payload.messages) ? payload.messages : [])
        .slice(-12)
        .map(message => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: String(message.content || '').slice(0, 4000),
        }))
      if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
        throw httpError(400, 'a user message is required')
      }
      let activeTask
      if (payload.taskId) {
        if (!idPattern.test(String(payload.taskId))) throw httpError(400, 'invalid task id')
        activeTask = await findTask(String(payload.taskId))
        if (!activeTask) throw httpError(404, `unknown task: ${payload.taskId}`)
      }
      if (payload.mode === 'clarify' && !activeTask) throw httpError(400, 'a task id is required to clarify a task')
      const tasksPayload = await listTasks()
      const answer = await runAgent({
        workspace,
        tasks: tasksPayload.tasks,
        activeTask,
        messages,
        root,
        mode: payload.mode === 'clarify' ? 'clarify' : 'assistant',
        provider: payload.provider === undefined ? undefined : String(payload.provider),
        model: payload.model === undefined ? undefined : String(payload.model).slice(0, 200),
      })
      sendJson(response, 200, answer)
      return
    }

    if (url.pathname === '/api/chats' || url.pathname.startsWith('/api/chats/')) {
      if (await handleChats(request, response, url)) return
      throw httpError(405, 'method not allowed')
    }

    if (request.method === 'GET' && url.pathname === '/api/tasks') {
      if (!initialized) {
        sendJson(response, 200, {root, initialized: false, workspace, tasks: [], gates: []})
        return
      }
      sendJson(response, 200, await listTasks())
      return
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/(claude|codex)\/([A-Za-z0-9-]{8,80})$/)
    if (request.method === 'GET' && sessionMatch) {
      const session = await sessionIndex.read(sessionMatch[1], sessionMatch[2])
      if (!session) throw httpError(404, 'session not found in this workspace')
      sendJson(response, 200, session)
      return
    }

    const match = url.pathname.match(/^\/api\/tasks\/(Q-\d{4,})(?:\/(action|body|discussions))?$/)
    if (match) {
      const [, id, action] = match
      if (!initialized) throw httpError(404, 'queue not initialized')
      if (!idPattern.test(id)) throw httpError(400, 'invalid task id')
      if (request.method === 'GET' && !action) {
        const task = await findTask(id)
        if (!task) throw httpError(404, `unknown task: ${id}`)
        task.blockedBy = await readBlockedBy(id)
        sendJson(response, 200, task)
        return
      }
      if (request.method === 'GET' && action === 'discussions') {
        const store = await chatStore()
        const [chats, sessions] = await Promise.all([
          store.available ? store.related(id) : [],
          sessionIndex.forTask(id),
        ])
        sendJson(response, 200, {chats, sessions, sessionsEnabled: sessionIndex.enabled})
        return
      }
      if (request.method === 'POST' && action === 'body') {
        const payload = await readJson(request)
        await serialize(() => replaceBody(id, payload.body))
        sendJson(response, 200, {ok: true})
        return
      }
      if (request.method === 'POST' && action === 'action') {
        const payload = await readJson(request)
        const args = buildActionArgs(id, payload)
        const output = await serialize(() => runQueue(args))
        sendJson(response, 200, {ok: true, output})
        return
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      if (!initialized) throw httpError(409, 'initialize the queue first')
      const payload = await readJson(request)
      const title = String(payload.title || '').trim()
      if (!title) throw httpError(400, 'title is required')
      if (title.startsWith('-')) throw httpError(400, 'title cannot start with -')
      const priority = ['1', '2', '3'].includes(String(payload.priority))
        ? String(payload.priority)
        : '2'
      const args = ['add', title, '--priority', priority]
      if (payload.resume) args.push('--resume', String(payload.resume))
      const output = await serialize(() => runQueue(args))
      const id = (output.match(/Q-\d{4,}/) || [])[0]
      sendJson(response, 201, {ok: true, id, output})
      return
    }

    throw httpError(404, 'not found')
  } catch (error) {
    const statusCode = error.statusCode || 500
    sendJson(response, statusCode, {error: error.message})
  }
})

function buildActionArgs(id, payload) {
  const action = String(payload.action || '')
  if (action === 'start') return ['start', id]
  if (action === 'unblock') return ['unblock', id]
  if (action === 'done') {
    const summary = String(payload.summary || '').trim()
    return summary ? ['done', id, '--summary', summary] : ['done', id]
  }
  if (action === 'block') {
    const blockers = (Array.isArray(payload.by) ? payload.by : [payload.by])
      .map(value => String(value || '').trim())
      .filter(Boolean)
    if (blockers.length === 0) throw httpError(400, 'block needs at least one blocker')
    for (const blocker of blockers) {
      if (!idPattern.test(blocker)) throw httpError(400, `invalid blocker: ${blocker}`)
    }
    return ['block', id, '--by', blockers.join(',')]
  }
  throw httpError(400, `unknown action: ${action}`)
}

server.listen(port, '127.0.0.1', () => {
  console.log(`queue dev server: http://127.0.0.1:${port} (${root})`)
})
