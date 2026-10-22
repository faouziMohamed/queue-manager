import {api} from './api.js'
import {createChatThread} from './chat-thread.js'

const LEGACY_CHATS_KEY = 'queue-agent-chats'
const LAST_CHAT_KEY = 'queue-agent-last-chat'

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]))
}

function readLegacyChats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_CHATS_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter(thread => thread && typeof thread.id === 'string')
  } catch {
    return []
  }
}

function clearLegacyChats() {
  try {
    localStorage.removeItem(LEGACY_CHATS_KEY)
  } catch {}
}

function readPreference(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function writePreference(key, value) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {}
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

function historyGroup(timestamp) {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()
  const day = 86_400_000
  if (timestamp >= today) return 'Today'
  if (timestamp >= today - day) return 'Yesterday'
  if (timestamp >= today - 6 * day) return 'Previous 7 days'
  if (timestamp >= today - 29 * day) return 'Previous 30 days'
  return 'Older'
}

export function providerLabel(provider) {
  if (provider === 'claude-cli') return 'Claude CLI · subscription'
  if (provider === 'claude-api') return 'Claude · API key'
  if (provider === 'codex-cli') return 'Codex CLI · subscription'
  if (provider === 'codex-api') return 'Codex · API key'
  if (provider === 'deepseek-cli') return 'DeepSeek · CLI route'
  if (provider === 'deepseek') return 'DeepSeek · API key'
  return 'Assistant'
}

export function providerShort(provider) {
  if (provider === 'claude-cli') return 'Claude CLI'
  if (provider === 'claude-api') return 'Claude · API key'
  if (provider === 'codex-cli') return 'Codex CLI'
  if (provider === 'codex-api') return 'Codex · API key'
  if (provider === 'deepseek-cli') return 'DeepSeek · CLI route'
  if (provider === 'deepseek') return 'DeepSeek · API key'
  return 'Assistant'
}

function providerReady(provider, available) {
  if (provider === 'claude-cli') return Boolean(available?.claudeCli)
  if (provider === 'claude-api') return Boolean(available?.claudeApi)
  if (provider === 'codex-cli') return Boolean(available?.codexCli)
  if (provider === 'codex-api') return Boolean(available?.codexApi)
  if (provider === 'deepseek-cli') return Boolean(available?.deepseekCli)
  if (provider === 'deepseek') return Boolean(available?.deepseek)
  return false
}

export function providerChoices(available) {
  const choices = [{value: 'auto', label: 'Auto — first available'}]
  const candidates = [
    'claude-cli', 'codex-cli', 'deepseek-cli', 'deepseek', 'claude-api', 'codex-api',
  ]
  for (const provider of candidates) {
    if (providerReady(provider, available)) {
      choices.push({value: provider, label: providerLabel(provider)})
    }
  }
  return choices
}

export function firstAvailable(available) {
  if (available?.claudeCli) return 'claude-cli'
  if (available?.codexCli) return 'codex-cli'
  if (available?.deepseekCli) return 'deepseek-cli'
  if (available?.deepseek) return 'deepseek'
  if (available?.claudeApi) return 'claude-api'
  if (available?.codexApi) return 'codex-api'
  return ''
}

function providerGroup(provider, available) {
  const resolved = provider === 'auto' ? firstAvailable(available) : provider
  if (resolved.startsWith('claude')) return 'claude'
  if (resolved.startsWith('codex')) return 'codex'
  if (resolved.startsWith('deepseek')) return 'deepseek'
  return ''
}

export function agentLabel(agent, config, available) {
  if (agent?.provider) {
    return `${providerLabel(agent.provider)}${agent.model ? ` · ${agent.model}` : ''}`
  }
  const resolved = config?.provider === 'auto' ? firstAvailable(available) : config?.provider
  return resolved ? `${providerLabel(resolved)}${config?.model ? ` · ${config.model}` : ''}` : 'Assistant'
}

export function initAssistant({showToast, reloadTasks, getActiveTaskId, openSettings}) {
  const dialog = document.querySelector('#agent-dialog')
  const messagesElement = document.querySelector('#agent-messages')
  const emptyElement = document.querySelector('#agent-empty')
  const form = document.querySelector('#agent-form')
  const input = document.querySelector('#agent-input')
  const status = document.querySelector('#agent-status')
  const providerLabelElement = document.querySelector('#agent-provider')
  const modelLabelElement = document.querySelector('#agent-model-label')
  const connectionElement = document.querySelector('#agent-connection')
  const dotElement = document.querySelector('#agent-dot')
  const providerSelect = document.querySelector('#agent-provider-select')
  const modelSelect = document.querySelector('#agent-model-select')
  const historyToggle = document.querySelector('#agent-history-toggle')
  const historyPanel = document.querySelector('#agent-history-panel')
  const historySearch = document.querySelector('#agent-history-search')
  const historyList = document.querySelector('#agent-history-list')
  const historyCount = document.querySelector('#agent-history-count')
  const state = {
    config: undefined,
    available: undefined,
    models: {},
    chats: [],
    historyStatus: 'idle',
    historyError: '',
    historyRequest: 0,
    historySearchTimer: undefined,
    pendingDelete: undefined,
    pendingDeleteTimer: undefined,
    resetting: false,
  }

  const chat = createChatThread({
    messagesElement,
    emptyElement,
    form,
    input,
    status,
    showToast,
    request: () => ({taskId: getActiveTaskId(), provider: providerSelect.value || 'auto', model: modelSelect.value}),
    agentLabel: agent => agentLabel(agent, state.config, state.available),
    failedAgent: () => ({
      provider: providerSelect.value === 'auto' ? firstAvailable(state.available) : providerSelect.value,
      model: modelSelect.value,
    }),
    onCreated: id => writePreference(LAST_CHAT_KEY, id),
    onSaved: upsertSummary,
    onApplied: () => reloadTasks(),
  })

  function upsertSummary(summary) {
    if (!summary?.id) return
    state.chats = [summary, ...state.chats.filter(chat => chat.id !== summary.id)]
      .sort((left, right) => right.updatedAt - left.updatedAt)
    renderHistory()
  }

  function newChat() {
    if (chat.refuseWhileBusy()) return
    writePreference(LAST_CHAT_KEY, '')
    chat.reset()
    closeHistory()
    input.focus()
  }

  async function openChat(id) {
    if (chat.refuseWhileBusy()) return
    try {
      const saved = await api(`/api/chats/${encodeURIComponent(id)}`)
      chat.load(saved)
      writePreference(LAST_CHAT_KEY, saved.id)
      closeHistory()
      input.focus()
    } catch (error) {
      if (error.status === 404) {
        state.chats = state.chats.filter(item => item.id !== id)
        renderHistory()
      }
      showToast(error.message, 'error')
    }
  }

  async function deleteChat(id) {
    try {
      await api(`/api/chats/${encodeURIComponent(id)}`, {method: 'DELETE'})
    } catch (error) {
      if (error.status !== 404) {
        showToast(error.message, 'error')
        return
      }
    }
    state.chats = state.chats.filter(item => item.id !== id)
    if (chat.chatId === id) {
      writePreference(LAST_CHAT_KEY, '')
      chat.reset()
    }
    renderHistory()
    showToast('Chat deleted.', 'success')
  }

  async function loadChats() {
    const request = ++state.historyRequest
    const query = historySearch.value.trim()
    state.historyStatus = 'loading'
    renderHistory()
    try {
      const suffix = query ? `?q=${encodeURIComponent(query)}` : ''
      const payload = await api(`/api/chats${suffix}`)
      if (request !== state.historyRequest) return
      state.chats = Array.isArray(payload.chats) ? payload.chats : []
      state.historyStatus = 'ready'
    } catch (error) {
      if (request !== state.historyRequest) return
      state.historyStatus = 'error'
      state.historyError = error.message
    }
    renderHistory()
  }

  async function migrateLegacyChats() {
    const legacy = readLegacyChats()
    if (legacy.length === 0) return
    try {
      const payload = await api('/api/chats/import', {
        method: 'POST',
        body: JSON.stringify({threads: legacy}),
      })
      clearLegacyChats()
      if (!readPreference(LAST_CHAT_KEY)) writePreference(LAST_CHAT_KEY, legacy[0].id)
      if (payload.imported > 0) {
        const plural = payload.imported === 1 ? '' : 's'
        showToast(`Moved ${payload.imported} chat${plural} from this browser into chat history.`, 'success')
      }
    } catch (error) {
      if (error.status !== 409) showToast(`Browser chats not imported yet: ${error.message}`, 'error')
    }
  }

  async function restoreLastChat() {
    const id = readPreference(LAST_CHAT_KEY)
    if (!id || chat.chatId || chat.messages.length > 0) return
    try {
      const saved = await api(`/api/chats/${encodeURIComponent(id)}`)
      if (chat.chatId || chat.messages.length > 0) return
      chat.load(saved)
    } catch (error) {
      if (error.status === 404) writePreference(LAST_CHAT_KEY, '')
    }
  }

  function openHistory() {
    historyPanel.hidden = false
    historyToggle.setAttribute('aria-expanded', 'true')
    loadChats()
    historySearch.focus()
  }

  function closeHistory() {
    if (historyPanel.hidden) return
    historyPanel.hidden = true
    historyToggle.setAttribute('aria-expanded', 'false')
    clearPendingDelete()
  }

  function clearPendingDelete() {
    clearTimeout(state.pendingDeleteTimer)
    state.pendingDelete = undefined
  }

  async function refreshProvider() {
    try {
      const payload = await api('/api/agent')
      state.config = payload.config
      state.available = payload.available
      state.models = payload.models || {}
      applyAgentControls()
    } catch {
      providerLabelElement.textContent = 'Assistant unavailable'
      dotElement.classList.add('warn')
      connectionElement.textContent = ''
    }
  }

  function applyAgentControls() {
    const config = state.config || {provider: 'auto', model: ''}
    const provider = config.provider || 'auto'
    const choices = providerChoices(state.available)
    const selected = choices.some(choice => choice.value === provider) ? provider : 'auto'
    const model = selected === provider ? (config.model || '') : ''
    populateProviderOptions(selected)
    const resolved = selected === 'auto' ? firstAvailable(state.available) : selected
    providerLabelElement.textContent = selected === 'auto'
      ? (resolved ? `Auto · ${providerShort(resolved)}` : 'Auto')
      : providerShort(selected)
    modelLabelElement.textContent = model || 'default model'
    const ready = selected === 'auto' ? Boolean(resolved) : providerReady(selected, state.available)
    dotElement.classList.toggle('warn', !ready)
    connectionElement.textContent = ready ? '' : 'not configured'
    populateModels(model)
    if (provider !== 'auto' && selected !== provider && state.available !== undefined && !state.resetting) {
      resetUnavailableProvider()
    }
  }

  function populateProviderOptions(selected) {
    const choices = providerChoices(state.available)
    providerSelect.innerHTML = choices
      .map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`)
      .join('')
    providerSelect.value = choices.some(choice => choice.value === selected) ? selected : 'auto'
  }

  async function resetUnavailableProvider() {
    state.resetting = true
    try {
      const payload = await api('/api/agent/config', {
        method: 'POST',
        body: JSON.stringify({provider: 'auto', model: ''}),
      })
      state.config = payload.config
      state.available = payload.available
      state.models = payload.models || state.models
    } catch {
    } finally {
      state.resetting = false
    }
  }

  function populateModels(current) {
    const group = providerGroup(providerSelect.value, state.available)
    const list = state.models[group] || []
    const options = ['<option value="">Default model</option>']
    for (const model of list) {
      options.push(`<option value="${escapeHtml(model.value)}">${escapeHtml(model.label)}</option>`)
    }
    if (current && !list.some(model => model.value === current)) {
      options.push(`<option value="${escapeHtml(current)}">${escapeHtml(current)}</option>`)
    }
    modelSelect.innerHTML = options.join('')
    modelSelect.value = current
  }

  async function saveAgent(provider, model) {
    try {
      const payload = await api('/api/agent/config', {
        method: 'POST',
        body: JSON.stringify({provider, model}),
      })
      state.config = payload.config
      state.available = payload.available
      state.models = payload.models || state.models
      applyAgentControls()
      showToast('Assistant settings saved.', 'success')
    } catch (error) {
      applyAgentControls()
      showToast(error.message, 'error')
    }
  }

  function renderHistory() {
    const query = historySearch.value.trim()
    historyCount.textContent = !query && state.historyStatus === 'ready' && state.chats.length > 0
      ? String(state.chats.length)
      : ''
    if (historyPanel.hidden) return
    if (state.historyStatus === 'loading' && state.chats.length === 0) {
      historyList.innerHTML = '<div class="history-state" role="status">Loading chats…</div>'
      return
    }
    if (state.historyStatus === 'error') {
      historyList.innerHTML = `<div class="history-state" role="alert">
        <span>Chat history could not load: ${escapeHtml(state.historyError)}</span>
        <button class="btn" type="button" data-history-retry>Retry</button>
      </div>`
      return
    }
    if (state.chats.length === 0) {
      const message = query ? `No chats match “${escapeHtml(query)}”.` : 'No chats yet. Your conversations will appear here.'
      historyList.innerHTML = `<div class="history-state">${message}</div>`
      return
    }
    let group = ''
    const rows = []
    for (const summary of state.chats) {
      const label = historyGroup(summary.updatedAt)
      if (label !== group) {
        group = label
        rows.push(`<h4 class="history-group">${label}</h4>`)
      }
      rows.push(historyRow(summary))
    }
    historyList.innerHTML = rows.join('')
  }

  function historyRow(summary) {
    const current = summary.id === chat.chatId ? ' current' : ''
    const confirming = state.pendingDelete === summary.id
    const provider = summary.provider ? `${providerShort(summary.provider)} · ` : ''
    const plural = summary.messageCount === 1 ? '' : 's'
    const task = summary.taskId ? `${summary.taskId} · ` : ''
    const meta = `${task}${provider}${summary.messageCount} message${plural} · ${relativeTime(summary.updatedAt)}`
    const deleteLabel = confirming
      ? 'Delete?'
      : '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>'
    return `<div class="history-item${current}">
      <button class="history-open" type="button" data-open-chat="${escapeHtml(summary.id)}"${current ? ' aria-current="true"' : ''}>
        <span class="history-title">${escapeHtml(summary.title)}</span>
        <span class="history-meta">${escapeHtml(meta)}</span>
      </button>
      <button class="history-delete${confirming ? ' confirming' : ''}" type="button" data-delete-chat="${escapeHtml(summary.id)}" aria-label="${confirming ? 'Confirm delete' : 'Delete'} chat ${escapeHtml(summary.title)}">${deleteLabel}</button>
    </div>`
  }

  function open() {
    refreshProvider()
    chat.render()
    if (!dialog.open) dialog.showModal()
    input.focus()
  }

  function close() {
    if (dialog.open) dialog.close()
  }

  providerSelect.addEventListener('change', () => {
    populateModels('')
    saveAgent(providerSelect.value, '')
  })

  modelSelect.addEventListener('change', () => {
    saveAgent(providerSelect.value, modelSelect.value)
  })

  historyToggle.addEventListener('click', () => {
    if (historyPanel.hidden) openHistory()
    else closeHistory()
  })

  historySearch.addEventListener('input', () => {
    clearTimeout(state.historySearchTimer)
    state.historySearchTimer = setTimeout(loadChats, 200)
  })

  historyList.addEventListener('click', event => {
    if (event.target.closest('[data-history-retry]')) {
      loadChats()
      return
    }
    const remove = event.target.closest('[data-delete-chat]')
    if (remove) {
      const id = remove.dataset.deleteChat
      if (state.pendingDelete === id) {
        clearPendingDelete()
        deleteChat(id)
        return
      }
      clearPendingDelete()
      state.pendingDelete = id
      state.pendingDeleteTimer = setTimeout(() => {
        state.pendingDelete = undefined
        renderHistory()
      }, 3000)
      renderHistory()
      return
    }
    const openButton = event.target.closest('[data-open-chat]')
    if (openButton) openChat(openButton.dataset.openChat)
  })

  dialog.addEventListener('cancel', event => {
    if (historyPanel.hidden) return
    event.preventDefault()
    closeHistory()
    historyToggle.focus()
  })

  document.querySelector('#agent-new-chat').addEventListener('click', newChat)

  document.querySelector('#agent-settings').addEventListener('click', () => {
    close()
    openSettings()
  })

  window.addEventListener('queue-agent-config-changed', refreshProvider)

  migrateLegacyChats()
    .then(restoreLastChat)
    .then(loadChats)
  return {open, close}
}
