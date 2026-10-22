import {disposeGraph, renderGraph} from './graph.js'
import {disposeInsights, renderInsights} from './insights.js'

const sections = [
  {id: 'in-progress', label: 'In progress', icon: 'i-play', emptyTitle: 'No task is running', empty: 'Nothing is being processed right now.'},
  {id: 'ready', label: 'Ready', icon: 'i-inbox', emptyTitle: 'The ready queue is empty', empty: 'Create a task, or unblock a dependency.'},
  {id: 'blocked', label: 'Blocked', icon: 'i-block', emptyTitle: 'Nothing is blocked', empty: 'No task is waiting on another.'},
  {id: 'awaiting', label: 'Awaiting production', icon: 'i-gate', emptyTitle: 'No production waits', empty: 'No task is parked behind the production gate.'},
  {id: 'done', label: 'Done', icon: 'i-check', emptyTitle: 'No completed records', empty: 'Closed tasks are kept here, out of the main queue.'},
  {id: 'insights', label: 'Insights', icon: 'i-chart', view: true},
  {id: 'graph', label: 'Dependency graph', icon: 'i-graph', view: true},
]

const $ = selector => document.querySelector(selector)

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]))
}

export function applyWorkspaceHeader(state) {
  const workspace = state.workspace
  const name = workspace.name || 'Queue'
  let modeLabel = 'Repository queue'
  if (workspace.layout === 'monorepo') modeLabel = 'Monorepo queue'
  else if (workspace.layout === 'workspace') modeLabel = 'Workspace queue'
  if (state.view !== 'task') document.title = `Queue · ${name}`
  $('#brand-mark').textContent = name.slice(0, 1).toUpperCase()
  $('#brand-name').textContent = name
  $('#brand-subtitle').textContent = modeLabel
  $('#queue-mode').textContent = modeLabel
}

export function sectionLabel(id) {
  return (sections.find(section => section.id === id) || sections[1]).label
}

export function detailChips(state, task, {relations = true} = {}) {
  const chips = [
    `<span class="chip prio-${task.priority}">P${task.priority}</span>`,
    `<span class="chip">${escapeHtml(task.status)}</span>`,
    `<span class="chip">updated ${escapeHtml(task.updated)}</span>`,
  ]
  if (state.workspace.mode === 'workspace' && task.repo) {
    chips.push(`<span class="chip repo">${escapeHtml(task.repo)}</span>`)
  }
  if (relations) {
    for (const blocker of task.blockedBy) chips.push(relationLink('blocked', blocker))
    for (const dependent of state.tasks) {
      if (dependent.blockedBy.includes(task.id)) chips.push(relationLink('blocks', dependent.id))
    }
  }
  if (task.awaitingProduction) chips.push('<span class="chip gate">awaiting production</span>')
  return chips.join('')
}

export function detailActions(task) {
  if (task.status === 'done') return '<span class="muted">Completed records are immutable.</span>'
  const buttons = []
  if (task.status === 'ready') buttons.push('<button class="btn primary" type="button" data-detail-action="start">Start</button>')
  if (task.status === 'in-progress') buttons.push('<button class="btn primary" type="button" data-detail-action="done">Mark done</button>')
  if (task.status === 'blocked') buttons.push('<button class="btn" type="button" data-detail-action="unblock">Unblock</button>')
  if (task.status === 'ready' || task.status === 'in-progress') {
    buttons.push('<button class="btn" type="button" data-detail-action="block">Block</button>')
  }
  return buttons.join('')
}

export function render(state) {
  const section = sections.find(item => item.id === state.section) || sections[0]
  const onTaskPage = state.view === 'task'
  $('#section-title').textContent = onTaskPage ? (state.pageTaskId || 'Task') : section.label
  renderSidebar(state)
  const isView = Boolean(section.view) && !onTaskPage
  $('#task-list').hidden = isView || onTaskPage
  $('#view-root').hidden = !isView
  $('#task-page').hidden = !onTaskPage
  $('#status-strip').hidden = onTaskPage
  $('.content').classList.toggle('wide', isView || onTaskPage)
  if (onTaskPage) {
    disposeInsights()
    disposeGraph()
  } else if (isView) {
    renderView(state, section)
  } else {
    disposeInsights()
    disposeGraph()
    renderList(state, section)
  }
  const strip = $('#status-strip')
  if (!state.initialized && !state.loading) strip.textContent = 'Queue not initialized'
  else if (state.loading && state.tasks.length > 0) strip.textContent = 'Refreshing queue…'
  else if (!state.loading && !state.error && !state.forbidden) {
    strip.textContent = state.tasks.length > 0
      ? `${state.tasks.filter(task => task.status !== 'done').length} open · ${state.tasks.filter(task => task.status === 'done').length} done`
      : ''
  } else {
    strip.textContent = ''
  }
}

function isAwaiting(task) {
  return task.awaitingProduction
}

function sectionTasks(state, section) {
  if (section === 'awaiting') return state.tasks.filter(task => isAwaiting(task))
  if (section === 'blocked') return state.tasks.filter(task => task.status === 'blocked' && !isAwaiting(task))
  return state.tasks.filter(task => task.status === section)
}

function countTasks(state, section) {
  if (state.query) return filteredTasks(state, section).length
  return sectionTasks(state, section).length
}

function filteredTasks(state, section) {
  const query = state.query.trim().toLowerCase()
  const tasks = sectionTasks(state, section)
  if (!query) return tasks
  return tasks.filter(task => [task.id, task.title, task.resume, task.repo].join(' ').toLowerCase().includes(query))
}

function renderSidebar(state) {
  const counts = Object.fromEntries(sections.map(section => [section.id, section.view ? '' : countTasks(state, section.id)]))
  const items = sections.map(section => {
    if (section.id === 'done' || section.id === 'insights') {
      return `<div class="section-separator"></div>${sectionButton(state, section, counts[section.id])}`
    }
    return sectionButton(state, section, counts[section.id])
  })
  $('#sections').innerHTML = items.join('')

  const gateTasks = state.tasks.filter(task => task.prodGate)
  const gateCard = $('#gate-card')
  if (gateTasks.length === 0) {
    gateCard.hidden = true
    return
  }
  const gate = gateTasks[0]
  gateCard.hidden = false
  gateCard.innerHTML = `
    <p class="eyebrow">Production gate</p>
    <strong>${escapeHtml(gate.id)} · ${escapeHtml(gate.title)}</strong>
    <p>Production work stays parked until this gate clears.</p>
    <button class="gate-link" type="button" data-section="awaiting">View waiting tasks</button>`
}

function sectionButton(state, section, count) {
  const current = section.id === state.section ? ' aria-current="page"' : ''
  return `<button class="section-button" type="button" data-section="${section.id}"${current}>
    <svg class="icon" aria-hidden="true"><use href="#${section.icon}"/></svg>
    <span class="label">${section.label}</span>
    ${section.view ? '' : `<span class="section-count">${count}</span>`}
  </button>`
}

function renderView(state, section) {
  const root = $('#view-root')
  root.setAttribute('aria-busy', state.loading ? 'true' : 'false')
  const panel = blockingPanel(state)
  if (panel) {
    disposeInsights()
    disposeGraph()
    root.innerHTML = panel
    return
  }
  if (section.id === 'insights') {
    disposeGraph()
    renderInsights(state, root)
  } else {
    disposeInsights()
    renderGraph(state, root)
  }
}

function blockingPanel(state) {
  if (state.forbidden) {
    return statePanel('i-lock', 'Localhost only', 'This queue is served on 127.0.0.1 and refuses non-local clients.', 'forbidden')
  }
  if (state.error) {
    return `${statePanel('i-alert', 'Could not load the queue', state.error, 'error')}
      <button class="btn" type="button" data-retry>Try again</button>`
  }
  if (state.loading && state.tasks.length === 0) {
    return '<div class="skeleton" aria-hidden="true">' + '<div class="skeleton-row"></div>'.repeat(5) + '</div>'
  }
  if (!state.initialized) {
    return `<div class="state-panel">
      <svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg>
      <h2>Initialize this folder</h2>
      <p>Create the queue files and record the project layout. This writes to .queue/ only.</p>
      <button class="btn primary" type="button" data-init>Initialize queue</button>
    </div>`
  }
  return ''
}

function renderList(state, section) {
  const list = $('#task-list')
  list.setAttribute('aria-busy', state.loading ? 'true' : 'false')
  const panel = blockingPanel(state)
  if (panel) {
    list.innerHTML = panel
    return
  }
  const tasks = filteredTasks(state, section.id)
  if (tasks.length === 0) {
    const action = section.id === 'ready'
      ? '<button class="btn primary" type="button" data-new-task>New task</button>' : ''
    list.innerHTML = `<div class="empty-state">
      <svg class="icon" aria-hidden="true"><use href="#${section.icon}"/></svg>
      <h2>${state.query ? 'No matching tasks' : section.emptyTitle}</h2>
      <p>${state.query ? 'Try a different search.' : section.empty}</p>
      ${action}
    </div>`
    return
  }
  list.innerHTML = tasks.map(task => taskRow(state, task)).join('')
}

function statePanel(icon, title, message, tone) {
  return `<div class="state-panel ${tone}">
    <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
  </div>`
}

function taskRow(state, task) {
  const repo = state.workspace.mode === 'workspace' && task.repo
    ? `<span class="chip repo">${escapeHtml(task.repo)}</span>` : ''
  const meta = task.blockedBy.map(blocker => relationLink('blocked', blocker))
  if (task.awaitingProduction) meta.push('<span class="chip gate">production</span>')
  const metaHtml = meta.length > 0 ? `<span class="task-meta">${meta.join('')}</span>` : ''
  return `<article class="task" data-status="${escapeHtml(task.status)}" data-awaiting="${task.awaitingProduction}">
    <span class="task-rail" aria-hidden="true"></span>
    <div class="task-body">
      <button class="task-open" type="button" data-open="${task.id}">
        <span class="task-top">
          <span class="task-id">${task.id}</span>
          ${repo}
          <span class="task-title">${escapeHtml(task.title)}</span>
          <span class="chip task-priority prio-${task.priority}">P${task.priority}</span>
        </span>
        <span class="task-resume">${escapeHtml(task.resume || 'No next action recorded.')}</span>
      </button>
      ${metaHtml}
    </div>
    <button class="task-chevron-button" type="button" data-open="${task.id}" aria-label="Open ${task.id}">
      <svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg>
    </button>
  </article>`
}

function relationLink(kind, id) {
  return `<a class="chip ${kind === 'blocked' ? 'blocked' : ''}" href="/tasks/${id}" data-task-link="${id}">${kind} ${escapeHtml(id)}</a>`
}
