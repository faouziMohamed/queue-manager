import {api} from './api.js'
import {agentLabel, firstAvailable, providerShort} from './assistant.js'
import {createChatThread} from './chat-thread.js'
import {renderMarkdown} from './markdown.js'
import {escapeHtml} from './render.js'

const suggestions = [
  ['What is unclear?', 'What is unclear or ambiguous in this task? Ask me the questions you need answered.'],
  ['What is needed before continuing?', 'List what is still needed before this task can continue, as a checklist.'],
  ['Summarize agreed decisions', 'Summarize what we have agreed so far and propose a Clarifications section.'],
]
const COLLAPSED_ROWS = 5
const sourceLabels = {clarify: 'Clarify', assistant: 'Assistant', claude: 'Claude Code', codex: 'Codex'}

export function initTaskChat({showToast, reloadTask, hasUnsavedEdits, openSettings}) {
  const root = document.querySelector('#task-page-detail [data-detail="chat-slot"]')
  root.innerHTML = template()
  const element = name => root.querySelector(`[data-chat="${name}"]`)
  const viewer = element('viewer')
  const view = {
    task: null,
    chats: [],
    sessions: [],
    sessionsEnabled: true,
    status: 'idle',
    error: '',
    expanded: false,
    agent: {config: undefined, available: undefined},
    request: 0,
    viewerSession: null,
  }

  const chat = createChatThread({
    messagesElement: element('messages'),
    emptyElement: element('empty'),
    form: element('form'),
    input: element('input'),
    status: element('status'),
    showToast,
    request: () => ({taskId: view.task?.id, mode: 'clarify'}),
    agentLabel: agent => agentLabel(agent, view.agent.config, view.agent.available),
    failedAgent: () => {
      const config = view.agent.config || {provider: 'auto', model: ''}
      const provider = config.provider === 'auto' ? firstAvailable(view.agent.available) : config.provider
      return {provider, model: config.model || ''}
    },
    chatMeta: () => ({taskId: view.task?.id}),
    onSaved: summary => {
      if (!summary?.id || summary.taskId !== view.task?.id) return
      view.chats = [{...summary, linked: true}, ...view.chats.filter(item => item.id !== summary.id)]
      renderList()
    },
    onApplied: proposal => reloadTask(proposal.task_id),
    canApply: () => {
      if (!hasUnsavedEdits()) return true
      showToast('Save or cancel your body edits before applying a chat update.', 'error')
      return false
    },
  })

  async function setTask(task) {
    if (!task) {
      view.task = null
      return
    }
    const switching = view.task?.id !== task.id
    view.task = task
    element('task-id').textContent = task.id
    if (!switching) return
    chat.reset()
    view.expanded = false
    refreshAgent()
    await loadDiscussions({openLatest: true})
  }

  async function loadDiscussions({openLatest = false} = {}) {
    if (!view.task) return
    const request = ++view.request
    const taskId = view.task.id
    view.status = 'loading'
    renderList()
    try {
      const payload = await api(`/api/tasks/${encodeURIComponent(taskId)}/discussions`)
      if (request !== view.request) return
      view.chats = Array.isArray(payload.chats) ? payload.chats : []
      view.sessions = Array.isArray(payload.sessions) ? payload.sessions : []
      view.sessionsEnabled = payload.sessionsEnabled !== false
      view.status = 'ready'
      renderList()
      const latest = view.chats.find(item => item.linked)
      if (openLatest && latest && !chat.chatId && chat.messages.length === 0) await openChat(latest.id)
    } catch (error) {
      if (request !== view.request) return
      view.status = 'error'
      view.error = error.message
      renderList()
    }
  }

  async function openChat(id) {
    if (chat.refuseWhileBusy()) return
    try {
      chat.load(await api(`/api/chats/${encodeURIComponent(id)}`))
      renderList()
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  async function openChatReadOnly(id) {
    resetViewer()
    try {
      const saved = await api(`/api/chats/${encodeURIComponent(id)}`)
      view.viewerSession = null
      viewer.querySelector('[data-viewer="kind"]').textContent = 'Queue chat · read-only'
      viewer.querySelector('[data-resume]').hidden = true
      renderViewer({
        tool: 'chat',
        title: saved.title,
        messageCount: saved.messages.length,
        updatedAt: saved.updatedAt,
        messages: saved.messages.map(message => ({role: message.role, text: message.content, timestamp: 0})),
      })
    } catch (error) {
      viewer.querySelector('[data-viewer="body"]').innerHTML = `<div class="state-panel error" role="alert">
        <h2>Chat unavailable</h2><p>${escapeHtml(error.message)}</p></div>`
    }
  }

  function resetViewer() {
    viewer.querySelector('[data-viewer="body"]').innerHTML = '<p class="muted" role="status">Loading…</p>'
    viewer.querySelector('[data-viewer="title"]').textContent = 'Discussion'
    viewer.querySelector('[data-viewer="meta"]').textContent = ''
    viewer.querySelector('[data-viewer="kind"]').textContent = 'Agent session · read-only'
    viewer.querySelector('[data-resume]').hidden = false
    if (!viewer.open) viewer.showModal()
  }

  function newDiscussion() {
    if (chat.refuseWhileBusy()) return
    chat.reset()
    renderList()
    element('input').focus()
  }

  async function openSession(tool, id) {
    resetViewer()
    try {
      const session = await api(`/api/sessions/${tool}/${encodeURIComponent(id)}`)
      view.viewerSession = session
      renderViewer(session)
    } catch (error) {
      viewer.querySelector('[data-viewer="body"]').innerHTML = `<div class="state-panel error" role="alert">
        <h2>Session unavailable</h2><p>${escapeHtml(error.message)}</p></div>`
    }
  }

  function renderViewer(session) {
    const taskId = view.task?.id || ''
    viewer.querySelector('[data-viewer="title"]').textContent = session.title
    viewer.querySelector('[data-viewer="meta"]').textContent =
      `${sourceLabels[session.tool] || 'Queue chat'} · ${session.messageCount} messages · updated ${new Date(session.updatedAt).toLocaleString()}`
    viewer.querySelector('[data-viewer="command"]').textContent = session.resumeCommand || ''
    const messages = session.messages.map(message => {
      const mentions = taskId && message.text.includes(taskId) ? ' mentions' : ''
      const time = message.timestamp ? `<time>${escapeHtml(new Date(message.timestamp).toLocaleString())}</time>` : ''
      return `<article class="session-message ${message.role}${mentions}">
        <header><strong>${message.role === 'user' ? 'You' : sourceLabels[session.tool] || 'Assistant'}</strong>${time}</header>
        <div class="markdown">${renderMarkdown(message.text)}</div>
      </article>`
    }).join('')
    const body = viewer.querySelector('[data-viewer="body"]')
    body.innerHTML = messages || '<p class="muted">No readable messages in this session.</p>'
    const firstMention = body.querySelector('.session-message.mentions')
    if (firstMention) firstMention.scrollIntoView({block: 'start'})
  }

  async function refreshAgent() {
    try {
      const payload = await api('/api/agent')
      view.agent = {config: payload.config, available: payload.available}
      const config = payload.config || {provider: 'auto', model: ''}
      const resolved = config.provider === 'auto' ? firstAvailable(payload.available) : config.provider
      element('provider').textContent = resolved ? providerShort(resolved) : 'No assistant configured'
      element('model').textContent = config.model || 'default model'
      element('dot').classList.toggle('warn', !resolved)
    } catch {
      element('provider').textContent = 'Assistant unavailable'
      element('dot').classList.add('warn')
    }
  }

  function rows() {
    const chatRows = view.chats.map(item => ({
      kind: 'chat',
      source: item.linked ? 'clarify' : 'assistant',
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      detail: `${item.messageCount} message${item.messageCount === 1 ? '' : 's'}`,
    }))
    const sessionRows = view.sessions.map(item => ({
      kind: 'session',
      source: item.tool,
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      detail: `mentions ${view.task?.id} ×${item.mentionCount}`,
    }))
    return [...chatRows, ...sessionRows].sort((left, right) => right.updatedAt - left.updatedAt)
  }

  function renderList() {
    const list = element('list')
    const count = element('count')
    if (view.status === 'loading' && view.chats.length + view.sessions.length === 0) {
      count.textContent = ''
      list.innerHTML = '<p class="discussion-state" role="status">Loading discussions…</p>'
      return
    }
    if (view.status === 'error') {
      count.textContent = ''
      list.innerHTML = `<div class="discussion-state" role="alert">Discussions could not load: ${escapeHtml(view.error)}
        <button class="btn" type="button" data-chat-retry>Retry</button></div>`
      return
    }
    const all = rows()
    count.textContent = all.length ? String(all.length) : ''
    if (all.length === 0) {
      const note = view.sessionsEnabled ? '' : ' Agent session lookup is off (QUEUE_AGENT_SESSIONS=off).'
      list.innerHTML = `<p class="discussion-state">No discussion mentions ${escapeHtml(view.task?.id || 'this task')} yet. Start one below.${note}</p>`
      return
    }
    const visible = view.expanded ? all : all.slice(0, COLLAPSED_ROWS)
    const more = all.length > COLLAPSED_ROWS
      ? `<button class="link-button discussion-more" type="button" data-chat-expand>${view.expanded ? 'Show fewer' : `Show all ${all.length}`}</button>`
      : ''
    list.innerHTML = `<ul class="discussion-list">${visible.map(rowHtml).join('')}</ul>${more}`
  }

  function rowHtml(row) {
    const current = row.kind === 'chat' && row.id === chat.chatId
    const action = row.kind === 'chat' ? `data-open-discussion="${escapeHtml(row.id)}"` : `data-open-session="${escapeHtml(row.source)}:${escapeHtml(row.id)}"`
    const hint = hintFor(row, current)
    return `<li><button class="discussion-row${current ? ' current' : ''}" type="button" ${action}${current ? ' aria-current="true"' : ''}>
      <span class="discussion-source source-${row.source}">${sourceLabels[row.source]}</span>
      <span class="discussion-title">${escapeHtml(row.title)}</span>
      <span class="discussion-meta">${escapeHtml(`${row.detail} · ${relativeTime(row.updatedAt)}`)}</span>
      <span class="discussion-hint">${hint}</span>
    </button></li>`
  }

  root.addEventListener('click', event => {
    if (event.target.closest('[data-chat="new"]')) { newDiscussion(); return }
    if (event.target.closest('[data-chat-retry]')) { loadDiscussions(); return }
    if (event.target.closest('[data-chat-expand]')) { view.expanded = !view.expanded; renderList(); return }
    if (event.target.closest('[data-chat="settings"]')) { openSettings(); return }
    const discussion = event.target.closest('[data-open-discussion]')
    if (discussion) {
      if (aiEnabled()) openChat(discussion.dataset.openDiscussion)
      else openChatReadOnly(discussion.dataset.openDiscussion)
      return
    }
    const session = event.target.closest('[data-open-session]')
    if (session) {
      const [tool, id] = session.dataset.openSession.split(':')
      openSession(tool, id)
    }
  })

  viewer.addEventListener('click', async event => {
    if (event.target.closest('[data-close]')) { viewer.close(); return }
    if (event.target.closest('[data-viewer="copy"]') && view.viewerSession) {
      try {
        await navigator.clipboard.writeText(view.viewerSession.resumeCommand)
        showToast('Resume command copied. Paste it in a terminal.', 'success')
      } catch {
        showToast('Could not copy the command.', 'error')
      }
    }
  })

  window.addEventListener('queue-agent-config-changed', refreshAgent)
  return {setTask, refresh: () => loadDiscussions()}
}

function aiEnabled() {
  return document.documentElement.dataset.ai === 'on'
}

function hintFor(row, current) {
  if (row.kind !== 'chat') return 'Read-only · resume in terminal'
  if (!aiEnabled()) return 'Read-only'
  return current ? 'Open below' : 'Continue here'
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(timestamp).toLocaleDateString(undefined, {day: 'numeric', month: 'short'})
}

function template() {
  const chips = suggestions
    .map(([label, prompt]) => `<button class="suggestion" type="button" data-suggest="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`)
    .join('')
  return `<section class="task-chat" aria-labelledby="task-chat-title">
    <header class="task-chat-head">
      <div>
        <h3 id="task-chat-title">Discussions <span data-chat="task-id"></span> <span class="discussion-count" data-chat="count"></span></h3>
        <p data-requires-ai>Clarify this task with the assistant, and find the agent sessions that worked on it.</p>
        <p data-without-ai>Agent sessions and earlier chats about this task. Configure an assistant to start a new discussion.</p>
      </div>
      <button class="btn" type="button" data-chat="new" data-requires-ai><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg> New discussion</button>
    </header>
    <div data-chat="list"></div>
    <div class="task-chat-thread" data-requires-ai>
      <div class="agent-identity task-chat-identity">
        <span class="agent-dot" data-chat="dot" aria-hidden="true"></span>
        <span class="task-chat-provider" data-chat="provider">Checking assistant…</span>
        <span class="task-chat-model" data-chat="model"></span>
        <button class="link-button" type="button" data-chat="settings">Change</button>
      </div>
      <div class="agent-messages task-chat-messages" data-chat="messages" aria-live="polite"></div>
      <div class="task-chat-empty" data-chat="empty">${chips}</div>
      <form class="agent-composer" data-chat="form">
        <div class="agent-input-wrap">
          <textarea data-chat="input" rows="2" placeholder="Ask about this task, or answer the assistant…" aria-label="Discussion message"></textarea>
          <button class="agent-send" type="submit" aria-label="Send message" title="Send">
            <svg class="icon"><use href="#i-send"/></svg>
          </button>
        </div>
        <div class="agent-composer-foot">
          <span data-chat="status" role="status"></span>
          <span class="agent-hint">Enter to send · Shift+Enter for a new line</span>
        </div>
      </form>
    </div>
    <dialog class="modal session-viewer" data-chat="viewer" aria-labelledby="session-viewer-title">
      <div class="modal-body">
        <header class="session-viewer-head">
          <div>
            <p class="eyebrow" data-viewer="kind">Agent session · read-only</p>
            <h2 id="session-viewer-title" data-viewer="title"></h2>
            <p class="muted" data-viewer="meta"></p>
          </div>
          <button class="icon-button" type="button" data-close aria-label="Close session"><svg class="icon"><use href="#i-close"/></svg></button>
        </header>
        <div class="session-resume" data-resume>
          <code data-viewer="command"></code>
          <button class="btn" type="button" data-viewer="copy"><svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg> Copy resume command</button>
        </div>
        <div class="session-messages" data-viewer="body"></div>
      </div>
    </dialog>
  </section>`
}
