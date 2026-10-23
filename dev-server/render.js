import {renderBoard} from './board.js'
import {disposeGraph, renderGraph} from './graph.js'
import {disposeInsights, renderInsights} from './insights.js'
import {disposePitfalls, renderPitfalls} from './pitfalls.js'

const sections = [
  {id: 'board', label: 'Board', icon: 'i-board', view: true},
  {id: 'in-progress', label: 'In progress', icon: 'i-play', emptyTitle: 'No task is running', empty: 'Nothing is being processed right now.'},
  {id: 'ready', label: 'Ready', icon: 'i-inbox', emptyTitle: 'The ready queue is empty', empty: 'Create a task, or unblock a dependency.'},
  {id: 'blocked', label: 'Blocked', icon: 'i-block', emptyTitle: 'Nothing is blocked', empty: 'No task is waiting on another.'},
  {id: 'on-hold', label: 'On hold', icon: 'i-pause', emptyTitle: 'Nothing is on hold', empty: 'No task is paused right now.'},
  {id: 'awaiting', label: 'Awaiting production', icon: 'i-gate', emptyTitle: 'No production waits', empty: 'No task is parked behind the production gate.'},
  {id: 'done', label: 'Done', icon: 'i-check', emptyTitle: 'No completed records', empty: 'Closed tasks are kept here, out of the main queue.'},
  {id: 'pitfalls', label: 'Pitfalls', icon: 'i-alert', view: true},
  {id: 'insights', label: 'Insights', icon: 'i-chart', view: true},
  {id: 'graph', label: 'Dependency graph', icon: 'i-graph', view: true},
]

const $ = selector => document.querySelector(selector)
const listSectionIds = ['in-progress', 'ready', 'blocked', 'on-hold', 'awaiting', 'done']
const statusTokens = {
  'in-progress': '--status-in-progress',
  ready: '--status-ready',
  blocked: '--status-blocked',
  'on-hold': '--status-on-hold',
  awaiting: '--status-awaiting',
  done: '--status-done',
}

function projectLabel(name) {
  return String(name || 'Queue').replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase())
}

function initials(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'Q'
}

function displayDate(value) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})
}

function inlineTitle(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>')
}

export function dodChip(task) {
  const dod = task.dod
  if (!dod || !dod.present || dod.total === 0) return ''
  const complete = dod.done === dod.total
  return `<span class="dod-chip${complete ? ' is-complete' : ''}" title="Definition of done: ${dod.done} of ${dod.total} checked">
    <svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>DoD ${dod.done}/${dod.total}
  </span>`
}

function renderAppHeader(state, section, onTaskPage) {
  const project = state.workspace.name || 'Queue'
  const activeSection = onTaskPage && state.returnSection ? state.returnSection : state.section
  const active = activeSection === 'board'
    ? 'board'
    : listSectionIds.includes(activeSection) ? 'list' : activeSection
  const gate = state.tasks.find(task => task.prodGate)
  const open = state.tasks.filter(task => task.status !== 'done').length
  const done = state.tasks.filter(task => task.status === 'done').length
  const tabs = [
    ['board', 'Board', 'i-board', '/board'],
    ['list', 'List', 'i-inbox', '/ready'],
    ['insights', 'Insights', 'i-chart', '/insights'],
    ['pitfalls', 'Pitfalls', 'i-alert', '/pitfalls'],
    ['graph', 'Graph', 'i-graph', '/graph'],
  ]
  $('#app-header').innerHTML = `<div class="app-project">
      <span class="app-project-mark" aria-hidden="true">${escapeHtml(project.trim()[0]?.toUpperCase() || 'Q')}</span>
      <div class="app-project-copy">
        <span class="app-project-space">Spaces / Workspace queue</span>
        <h2 class="app-project-name">${escapeHtml(projectLabel(project))}</h2>
      </div>
      <div class="app-project-side">
        ${gate ? `<a class="app-gate" href="/awaiting" title="${escapeHtml(`${gate.id} · ${gate.title}`)}">Gate ${escapeHtml(gate.id)}</a>` : ''}
        <span class="app-counts">${open} open · ${done} done</span>
      </div>
    </div>
    <nav class="app-tabs" aria-label="Queue views">
      ${tabs.map(([id, label, icon, href]) => `<a class="app-tab${active === id ? ' is-active' : ''}" href="${href}"${active === id ? ' aria-current="page"' : ''}>
        <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>${label}
      </a>`).join('')}
    </nav>`
}

function renderListNav(state, section, isView, onTaskPage) {
  const nav = $('#list-nav')
  if (isView || onTaskPage) {
    nav.hidden = true
    nav.innerHTML = ''
    return
  }
  nav.hidden = false
  nav.innerHTML = listSectionIds.map(id => {
    const entry = sections.find(item => item.id === id)
    const active = state.section === id
    return `<a class="list-tab${active ? ' is-active' : ''}" href="/${id}"${active ? ' aria-current="page"' : ''}>
      <span class="list-tab-dot" style="--list-dot:var(${statusTokens[id]})"></span>
      <span>${entry.label}</span>
      <span class="list-tab-count">${countTasks(state, id)}</span>
    </a>`
  }).join('')
}

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
  if (task.status === 'on-hold') buttons.push('<button class="btn primary" type="button" data-detail-action="resume">Resume</button>')
  if (task.status === 'ready' || task.status === 'in-progress' || task.status === 'blocked') {
    buttons.push('<button class="btn" type="button" data-detail-action="hold">Hold</button>')
  }
  if (task.status === 'ready' || task.status === 'in-progress') {
    buttons.push('<button class="btn" type="button" data-detail-action="block">Block</button>')
  }
  return buttons.join('')
}

export function render(state) {
  const section = sections.find(item => item.id === state.section) || sections[0]
  const onTaskPage = state.view === 'task'
  const isView = Boolean(section.view) && !onTaskPage
  const design = state.workspace.design === 'classic' ? 'classic' : 'jira'
  document.body.classList.toggle('design-jira', design === 'jira')
  document.body.classList.toggle('design-classic', design === 'classic')
  document.body.classList.toggle('board-view', section.id === 'board' && !onTaskPage)
  renderAppHeader(state, section, onTaskPage)
  renderListNav(state, section, isView, onTaskPage)
  $('#section-title').textContent = onTaskPage ? (state.pageTaskId || 'Task') : section.label
  renderSidebar(state)
  $('#task-list').hidden = isView || onTaskPage
  $('#view-root').hidden = !isView
  $('#task-page').hidden = !onTaskPage
  $('#status-strip').hidden = !(state.loading || state.error || state.forbidden || !state.initialized)
  if (onTaskPage) {
    disposeInsights()
    disposeGraph()
    disposePitfalls()
  } else if (isView) {
    renderView(state, section)
  } else {
    disposeInsights()
    disposeGraph()
    disposePitfalls()
    renderList(state, section)
  }
  const strip = $('#status-strip')
  if (!state.initialized && !state.loading) strip.textContent = 'Queue not initialized'
  else if (state.loading && state.tasks.length > 0) strip.textContent = 'Refreshing queue…'
  else strip.textContent = ''
}

function isAwaiting(task) {
  return task.awaitingProduction
}

function sectionTasks(state, section) {
  if (section === 'awaiting') return state.tasks.filter(task => isAwaiting(task))
  if (section === 'blocked') return state.tasks.filter(task => task.status === 'blocked' && !isAwaiting(task))
  if (section === 'on-hold') return state.tasks.filter(task => task.status === 'on-hold' && !isAwaiting(task))
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
    if (section.id === 'in-progress' || section.id === 'done' || section.id === 'pitfalls') {
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
    disposePitfalls()
    root.innerHTML = panel
    return
  }
  if (section.id === 'board') {
    disposeInsights()
    disposeGraph()
    disposePitfalls()
    renderBoard(state, root)
  } else if (section.id === 'pitfalls') {
    disposeInsights()
    disposeGraph()
    renderPitfalls(state, root)
  } else if (section.id === 'insights') {
    disposeGraph()
    disposePitfalls()
    renderInsights(state, root)
  } else {
    disposeInsights()
    disposePitfalls()
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
  const priority = String(task.priority || '2')
  const priorityIcon = priority === '1' ? 'i-prio-up' : priority === '3' ? 'i-prio-down' : 'i-prio-eq'
  const avatar = state.workspace.mode === 'workspace'
    ? `<span class="task-avatar" title="${escapeHtml(task.repo || 'queue')}">${escapeHtml(initials(task.repo || 'queue'))}</span>`
    : ''
  const meta = task.blockedBy.map(blocker => relationLink('blocked', blocker))
  if (task.awaitingProduction) meta.push('<span class="chip gate">production</span>')
  const dod = dodChip(task)
  if (dod) meta.push(dod)
  const metaHtml = meta.length > 0 ? `<span class="task-meta">${meta.join('')}</span>` : ''
  return `<article class="task" data-status="${escapeHtml(task.status)}" data-awaiting="${task.awaitingProduction}">
    <span class="task-rail" aria-hidden="true"></span>
    <div class="task-body">
      <button class="task-open" type="button" data-open="${task.id}">
        <span class="task-top">
          <span class="task-type" aria-hidden="true"><svg class="icon"><use href="#i-check"/></svg></span>
          <span class="task-id">${task.id}</span>
          ${repo}
          <span class="task-title">${inlineTitle(task.title)}</span>
          <span class="task-prio prio-${escapeHtml(priority)}" title="Priority P${escapeHtml(priority)}"><svg class="icon" aria-hidden="true"><use href="#${priorityIcon}"/></svg></span>
          <span class="task-updated">${escapeHtml(displayDate(task.updated))}</span>
          ${avatar}
          <span class="chip task-priority prio-${escapeHtml(priority)}">P${escapeHtml(priority)}</span>
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
