import {api} from './api.js'
import {upsertSection} from './body-sections.js'
import {renderMarkdown} from './markdown.js'
import {escapeHtml} from './render.js'

export function createChatThread({
  messagesElement,
  emptyElement,
  form,
  input,
  status,
  showToast,
  request,
  agentLabel,
  failedAgent,
  chatMeta = () => ({}),
  onCreated = () => {},
  onSaved = () => {},
  onApplied = async () => {},
  canApply = () => true,
}) {
  const sendButton = form.querySelector('button[type="submit"]')
  const thread = {messages: [], chatId: undefined, busy: false, saveChain: Promise.resolve(), timer: undefined, generation: 0}

  function load(chat) {
    thread.generation += 1
    thread.chatId = chat?.id
    thread.messages = Array.isArray(chat?.messages) ? chat.messages : []
    render()
  }

  function reset() {
    thread.generation += 1
    thread.chatId = undefined
    thread.messages = []
    input.value = ''
    resizeInput()
    render()
  }

  function refuseWhileBusy() {
    if (!thread.busy) return false
    showToast('Wait for the current answer to finish.', 'error')
    return true
  }

  function persist() {
    if (thread.messages.length === 0) return thread.saveChain
    if (!thread.chatId) {
      thread.chatId = newChatId()
      onCreated(thread.chatId)
    }
    return persistConversation(thread.chatId, thread.messages, chatMeta())
  }

  function persistConversation(id, messages, meta) {
    const body = JSON.stringify({title: titleFor(messages), messages, ...meta})
    thread.saveChain = thread.saveChain
      .then(async () => onSaved(await api(`/api/chats/${encodeURIComponent(id)}`, {method: 'PUT', body})))
      .catch(error => showToast(`Chat not saved: ${error.message}`, 'error'))
    return thread.saveChain
  }

  function render() {
    if (emptyElement) emptyElement.hidden = thread.messages.length > 0
    messagesElement.innerHTML = thread.messages.map(messageHtml).join('')
    updateComposer()
    messagesElement.scrollTop = messagesElement.scrollHeight
  }

  function messageHtml(message, index) {
    if (message.role === 'user') {
      return `<div class="agent-message user"><div class="agent-bubble">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div></div>`
    }
    const usage = message.usage?.totalTokens
      ? `<span class="agent-usage" title="input ${message.usage.inputTokens || 0} · output ${message.usage.outputTokens || 0}">↓ ${formatTokens(message.usage.totalTokens)} tokens</span>`
      : ''
    const meta = `<div class="agent-message-meta">${escapeHtml(agentLabel(message.agent))}${usage}</div>`
    const proposals = message.proposals?.length
      ? `<div class="agent-proposals">${message.proposals.map((proposal, proposalIndex) => proposalCard(proposal, index, proposalIndex)).join('')}</div>`
      : ''
    return `<div class="agent-message assistant">${meta}<div class="agent-bubble markdown">${renderMarkdown(message.content)}</div>${proposals}</div>`
  }

  async function send(text) {
    const content = String(text || '').trim()
    if (!content || thread.busy) return
    thread.messages.push({role: 'user', content})
    persist()
    const conversation = {generation: thread.generation, id: thread.chatId, messages: thread.messages, meta: chatMeta()}
    thread.busy = true
    startThinking()
    input.value = ''
    resizeInput()
    render()
    try {
      const payload = await api('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: conversation.messages.map(message => ({role: message.role, content: message.content})),
          ...request(),
        }),
      })
      conversation.messages.push({
        role: 'assistant',
        content: payload.message,
        proposals: Array.isArray(payload.proposals) ? payload.proposals : [],
        usage: payload.usage,
        agent: {provider: payload.provider, model: payload.model || ''},
      })
    } catch (error) {
      conversation.messages.push({role: 'assistant', content: `**Could not answer.** ${error.message}`, proposals: [], agent: failedAgent()})
      showToast(error.message, 'error')
    } finally {
      persistConversation(conversation.id, conversation.messages, conversation.meta)
      thread.busy = false
      stopThinking()
      if (conversation.generation === thread.generation) render()
      else updateComposer()
    }
  }

  async function applyProposal(button) {
    const [messageIndex, proposalIndex] = button.dataset.apply.split(':').map(Number)
    const proposal = thread.messages[messageIndex]?.proposals?.[proposalIndex]
    if (!proposal || !canApply(proposal)) return
    button.disabled = true
    try {
      await applyToQueue(proposal)
      proposal.applied = true
      persist()
      render()
      showToast(proposal.type === 'upsert_section' ? `“${proposal.heading}” saved to ${proposal.task_id}.` : 'Queue updated.', 'success')
      await onApplied(proposal)
    } catch (error) {
      button.disabled = false
      showToast(error.message, 'error')
    }
  }

  function startThinking() {
    const started = Date.now()
    clearInterval(thread.timer)
    status.textContent = 'Thinking… 0s'
    thread.timer = setInterval(() => {
      if (thread.busy) status.textContent = `Thinking… ${Math.floor((Date.now() - started) / 1000)}s`
    }, 1000)
  }

  function stopThinking() {
    clearInterval(thread.timer)
    thread.timer = undefined
    status.textContent = ''
  }

  function updateComposer() {
    sendButton.disabled = thread.busy || input.value.trim().length === 0
  }

  function resizeInput() {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`
    updateComposer()
  }

  form.addEventListener('submit', event => {
    event.preventDefault()
    send(input.value)
  })
  input.addEventListener('input', resizeInput)
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      send(input.value)
    }
  })
  messagesElement.addEventListener('click', event => {
    const button = event.target.closest('[data-apply]')
    if (button && !button.disabled) applyProposal(button)
  })
  emptyElement?.addEventListener('click', event => {
    const suggestion = event.target.closest('[data-suggest]')
    if (suggestion) send(suggestion.dataset.suggest)
  })

  resizeInput()
  render()
  return {
    load,
    reset,
    send,
    render,
    refuseWhileBusy,
    get busy() { return thread.busy },
    get chatId() { return thread.chatId },
    get messages() { return thread.messages },
  }
}

export function formatTokens(value) {
  const tokens = Number(value) || 0
  if (tokens < 1000) return String(tokens)
  const thousands = tokens / 1000
  return `${thousands.toFixed(thousands < 100 ? 1 : 0)}k`
}

export function titleFor(messages) {
  const first = messages.find(message => message.role === 'user')
  return (first?.content || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat'
}

export function newChatId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function applyToQueue(proposal) {
  if (proposal.type === 'create_task') {
    await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({title: proposal.title, priority: proposal.priority, resume: proposal.resume}),
    })
    return
  }
  if (proposal.type === 'update_body') {
    await api(`/api/tasks/${proposal.task_id}/body`, {method: 'POST', body: JSON.stringify({body: proposal.body})})
    return
  }
  if (proposal.type === 'upsert_section') {
    const task = await api(`/api/tasks/${proposal.task_id}`)
    const body = upsertSection(String(task.body || ''), proposal.heading, proposal.content)
    await api(`/api/tasks/${proposal.task_id}/body`, {method: 'POST', body: JSON.stringify({body})})
    return
  }
  const payload = {action: proposal.action, summary: proposal.summary}
  if (proposal.action === 'block') payload.by = proposal.by
  await api(`/api/tasks/${proposal.task_id}/action`, {method: 'POST', body: JSON.stringify(payload)})
}

function proposalCard(proposal, messageIndex, proposalIndex) {
  const disabled = proposal.applied ? ' disabled' : ''
  const label = proposal.applied ? 'Applied' : 'Apply'
  if (proposal.type === 'upsert_section') {
    return `<div class="proposal proposal-section">
      <div class="proposal-head">
        <div><strong>${escapeHtml(`Update “${proposal.heading}” · ${proposal.task_id}`)}</strong><span>Replaces that section, or adds it if missing.</span></div>
        <button class="btn${proposal.applied ? '' : ' primary'}" type="button" data-apply="${messageIndex}:${proposalIndex}"${disabled}>${label}</button>
      </div>
      <div class="proposal-preview markdown">${renderMarkdown(proposal.content)}</div>
    </div>`
  }
  let title = ''
  let detail = ''
  if (proposal.type === 'create_task') {
    title = 'Create task'
    detail = proposal.title
  } else if (proposal.type === 'update_body') {
    title = `Replace body · ${proposal.task_id}`
    detail = proposal.body.replace(/\s+/g, ' ').slice(0, 100)
  } else {
    title = `${proposal.action} · ${proposal.task_id}`
    detail = proposal.summary || ''
  }
  return `<div class="proposal">
    <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>
    <button class="btn" type="button" data-apply="${messageIndex}:${proposalIndex}"${disabled}>${label}</button>
  </div>`
}
