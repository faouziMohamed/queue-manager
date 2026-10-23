import {api} from './api.js'
import {$, showToast, state} from './app-state.js'
import {providerChoices} from './assistant.js'
import {escapeHtml} from './render.js'

export function initSettings({loadTasks}) {
  const dialog = $('#settings-dialog')
  const form = $('#settings-form')

  function open(mode) {
    state.settingsMode = mode
    const workspace = state.workspace
    form.elements.name.value = workspace.name || ''
    form.elements.view.value = workspace.view || 'list'
    form.elements.design.value = workspace.design || 'jira'
    form.elements.layout.value = workspace.layout || 'single-repo'
    form.elements.wipLimit.value = String(workspace.wipLimit || 1)
    form.elements.repos.value = (workspace.repos || []).join('\n')
    form.elements.repos.disabled = form.elements.layout.value === 'single-repo'
    loadAgentAvailability(workspace.agent?.provider || 'auto')
    $('#repos-field').hidden = form.elements.layout.value === 'single-repo'
    $('#settings-eyebrow').textContent = mode === 'init' ? 'Setup' : 'Configuration'
    $('#settings-title').textContent = mode === 'init' ? 'Initialize queue' : 'Queue settings'
    $('#settings-submit').textContent = mode === 'init' ? 'Initialize queue' : 'Save settings'
    $('#settings-note').hidden = mode !== 'init'
    if (!dialog.open) dialog.showModal()
    if (mode === 'init') form.elements.name.focus()
  }

  async function save(event) {
    event.preventDefault()
    const data = new FormData(form)
    const provider = data.get('agent_provider')
    const previousAgent = state.workspace.agent || {}
    const previousView = state.workspace.view || 'list'
    const payload = {
      name: data.get('name'),
      view: data.get('view') === 'board' ? 'board' : 'list',
      design: data.get('design') === 'classic' ? 'classic' : 'jira',
      layout: data.get('layout'),
      wipLimit: Number(data.get('wipLimit')) || 1,
      repos: String(data.get('repos') || '').split('\n').map(value => value.trim()).filter(Boolean),
      agent: {
        provider,
        model: provider === previousAgent.provider ? (previousAgent.model || '') : '',
      },
    }
    const endpoint = state.settingsMode === 'init' ? '/api/init' : '/api/config'
    try {
      await api(endpoint, {method: 'POST', body: JSON.stringify(payload)})
      dialog.close()
      showToast(state.settingsMode === 'init' ? 'Queue initialized.' : 'Queue settings saved.', 'success')
      window.dispatchEvent(new CustomEvent('queue-agent-config-changed'))
      await loadTasks()
      if (payload.view !== previousView) {
        window.dispatchEvent(new CustomEvent('queue-view-changed', {detail: {view: payload.view}}))
      }
    } catch (error) {
      showToast(error.message, 'error')
    }
  }

  form.addEventListener('submit', save)
  form.elements.layout.addEventListener('change', event => {
    const single = event.target.value === 'single-repo'
    form.elements.repos.disabled = single
    $('#repos-field').hidden = single
  })
  $('#settings').addEventListener('click', () => open('settings'))
  return {open}
}

async function loadAgentAvailability(selected) {
  const select = $('#settings-form').elements.agent_provider
  const target = $('#agent-availability')
  select.innerHTML = '<option value="auto">Auto — first available</option>'
  select.value = 'auto'
  try {
    const payload = await api('/api/agent')
    const available = payload.available || {}
    const choices = providerChoices(available)
    select.innerHTML = choices
      .map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`)
      .join('')
    select.value = choices.some(choice => choice.value === selected) ? selected : 'auto'
    const missing = [
      available.claudeApi ? '' : 'Claude key (ANTHROPIC_API_KEY)',
      available.codexApi ? '' : 'Codex key (OPENAI_API_KEY)',
      available.deepseek ? '' : 'DeepSeek key (DEEPSEEK_API_KEY)',
      available.claudeCli ? '' : 'Claude CLI',
      available.codexCli ? '' : 'Codex CLI',
      available.deepseekCli ? '' : 'DeepSeek cdk route',
    ].filter(Boolean)
    target.textContent = missing.length > 0
      ? `Only configured providers are listed. Not configured: ${missing.join(', ')}.`
      : 'Every provider is configured.'
  } catch {
    target.textContent = 'Provider status unavailable.'
  }
}
