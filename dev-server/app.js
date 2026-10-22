import {api, toTask} from './api.js'
import {$, isTyping, showToast, state} from './app-state.js'
import {initAssistant} from './assistant.js'
import {installGraph} from './graph.js'
import {initNavigation} from './navigation.js'
import {applyWorkspaceHeader, render} from './render.js'
import {initSettings} from './settings.js'
import {initTaskActions} from './task-actions.js'
import {initTaskChat} from './task-chat.js'
import {initTheme} from './theme.js'

async function loadTasks() {
  state.loading = true
  state.error = ''
  state.forbidden = false
  render(state)
  try {
    const payload = await api('/api/tasks')
    state.tasks = payload.tasks.map(toTask)
    state.gates = payload.gates.map(String)
    state.initialized = payload.initialized !== false
    state.workspace = payload.workspace || state.workspace
    applyWorkspaceHeader(state)
  } catch (error) {
    if (error.status === 403) state.forbidden = true
    else state.error = error.message
  } finally {
    state.loading = false
    if (!state.initialised && state.initialized) {
      state.initialised = true
      const hasInProgress = state.tasks.some(task => task.status === 'in-progress')
      const hasReady = state.tasks.some(task => task.status === 'ready')
      if (!state.sectionExplicit && state.section === 'in-progress' && !hasInProgress && hasReady) state.section = 'ready'
    }
    render(state)
    navigation.refreshOpenDetails()
  }
}

const settings = initSettings({loadTasks})

const actions = initTaskActions({
  loadTasks,
  reloadActiveTask: id => navigation.reloadActiveTask(id),
  openPeek: id => navigation.openPeek(id),
  openSettings: mode => settings.open(mode),
})

const navigation = initNavigation({
  loadTasks,
  onAction: actions.handleDetailAction,
  onSave: actions.saveTaskBody,
  onCopy: actions.copyTaskLink,
  onPageTask: task => taskChat.setTask(task),
})

const taskChat = initTaskChat({
  showToast,
  reloadTask: id => navigation.reloadActiveTask(id),
  hasUnsavedEdits: () => navigation.hasUnsavedEdits(),
  openSettings: () => settings.open('settings'),
})

const assistant = initAssistant({
  showToast,
  reloadTasks: loadTasks,
  getActiveTaskId: () => navigation.activeTask()?.id,
  openSettings: () => settings.open('settings'),
})

async function detectAssistant() {
  let enabled = false
  try {
    const payload = await api('/api/agent')
    enabled = Object.values(payload.available || {}).some(Boolean)
  } catch {}
  const previous = document.documentElement.dataset.ai
  document.documentElement.dataset.ai = enabled ? 'on' : 'off'
  if (!enabled && document.querySelector('#agent-dialog').open) assistant.close()
  if (previous !== document.documentElement.dataset.ai) taskChat.refresh()
  return enabled
}

function handleListClick(event) {
  if (event.target.closest('[data-retry]')) { loadTasks(); return }
  if (event.target.closest('[data-retry-charts]')) { render(state); return }
  if (event.target.closest('[data-init]')) { settings.open('init'); return }
  const section = event.target.closest('[data-section]')
  if (section) { navigation.setSection(section.dataset.section); return }
  const open = event.target.closest('[data-open]')
  if (open) { navigation.openPeek(open.dataset.open); return }
  if (event.target.closest('[data-new-task]')) actions.openAddDialog()
}

function handleShortcut(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (isTyping(event.target)) return
  const dialogOpen = Boolean(document.querySelector('dialog[open]'))
  if (event.key === '/') {
    event.preventDefault()
    $('#search').focus()
  }
  if (event.key === 'r') loadTasks()
  if (dialogOpen) return
  if (event.key === 'n') {
    event.preventDefault()
    actions.openAddDialog()
  }
  if (event.key === 'i') navigation.setSection('insights')
  if (event.key === 'g') navigation.setSection('graph')
  if (event.key === 'Escape' && state.view === 'task') navigation.goBack()
}

$('#sections').addEventListener('click', handleListClick)
$('#gate-card').addEventListener('click', handleListClick)
$('#task-list').addEventListener('click', handleListClick)

const viewRoot = $('#view-root')
installGraph(viewRoot)
viewRoot.addEventListener('click', handleListClick)
viewRoot.addEventListener('queue-open-task', event => navigation.openPeek(event.detail))
viewRoot.addEventListener('queue-set-section', event => navigation.setSection(event.detail))
viewRoot.addEventListener('queue-rerender', () => render(state))

$('#search').addEventListener('input', event => {
  state.query = event.target.value
  render(state)
})
$('#refresh').addEventListener('click', loadTasks)
$('#new-task').addEventListener('click', actions.openAddDialog)
$('#assistant').addEventListener('click', () => {
  if (document.documentElement.dataset.ai === 'on') assistant.open()
})
window.addEventListener('queue-agent-config-changed', detectAssistant)

document.addEventListener('click', event => {
  const close = event.target.closest('[data-close]')
  const dialog = close?.closest('dialog')
  if (dialog) dialog.close()
})
document.addEventListener('keydown', handleShortcut)

initTheme({onChange: () => render(state)})
navigation.applyRoute()
loadTasks()
detectAssistant().then(enabled => {
  if (enabled && location.hash === '#assistant') assistant.open()
})
