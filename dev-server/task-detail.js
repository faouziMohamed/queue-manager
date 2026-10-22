import {detailActions, detailChips, escapeHtml} from './render.js'
import {renderMarkdown} from './markdown.js'
import {statusKey, statusOrder} from './insights.js'
import {taskPath} from './router.js'

export function mountTaskDetail(root, {variant, onAction, onSave, onOpenFull, onOpenTask, onCopy}) {
  root.innerHTML = template(variant)
  const element = name => root.querySelector(`[data-detail="${name}"]`)
  const view = {task: null, context: null, editing: false, saving: false}

  function show(task, context) {
    const switching = view.task?.id !== task.id
    view.task = task
    view.context = context
    element('state').hidden = true
    element('content').hidden = false
    element('eyebrow').textContent = `${task.status} · P${task.priority} · updated ${task.updated}`
    element('title').textContent = task.title
    element('actions').innerHTML = detailActions(task)
    element('edit-tab').disabled = task.status === 'done'
    if (switching || !view.editing) {
      element('textarea').value = task.body
      renderBody(task.body)
      setMode('view')
      element('save-status').textContent = ''
    }
    refresh(context)
  }

  function refresh(context) {
    if (!view.task) return
    view.context = context
    element('chips').innerHTML = detailChips(context, view.task, {relations: variant === 'drawer'})
    if (variant === 'page') {
      element('facts').innerHTML = facts(view.task, context)
      element('blockers').innerHTML = relationRows(view.task.blockedBy, context, 'Not blocked by any task.')
      const dependents = context.tasks.filter(task => task.blockedBy.includes(view.task.id)).map(task => task.id)
      element('dependents').innerHTML = relationRows(dependents, context, 'No task waits on this one.')
    }
  }

  function showState(kind, message) {
    view.task = null
    element('content').hidden = true
    const target = element('state')
    target.hidden = false
    target.innerHTML = statePanel(kind, message)
  }

  function renderBody(body) {
    element('rendered').innerHTML = renderMarkdown(body)
    if (variant !== 'page') return
    const headings = [...element('rendered').querySelectorAll('h1, h2, h3')]
    headings.forEach((heading, index) => { heading.id = `section-${index + 1}` })
    element('outline-card').hidden = headings.length < 3
    element('outline').innerHTML = headings
      .map(heading => `<button type="button" class="outline-item level-${heading.tagName.slice(1)}" data-outline="${heading.id}">${escapeHtml(heading.textContent)}</button>`)
      .join('')
  }

  function setMode(mode) {
    view.editing = mode === 'edit'
    element('rendered').hidden = view.editing
    element('edit').hidden = !view.editing
    element('save').hidden = !view.editing
    element('cancel').hidden = !view.editing
    element('edit-hint').hidden = !view.editing
    element('view-tab').setAttribute('aria-selected', String(!view.editing))
    element('edit-tab').setAttribute('aria-selected', String(view.editing))
    if (view.editing) element('textarea').focus()
  }

  function isDirty() {
    return Boolean(view.editing && view.task && element('textarea').value !== view.task.body)
  }

  function cancelEdit() {
    if (!view.task) return
    element('textarea').value = view.task.body
    element('save-status').textContent = ''
    setMode('view')
  }

  async function save() {
    if (!view.task || view.saving) return
    const body = element('textarea').value
    view.saving = true
    element('save').disabled = true
    element('save-status').textContent = 'Saving…'
    try {
      await onSave(view.task, body)
      view.task.body = body
      renderBody(body)
      setMode('view')
      element('save-status').textContent = 'Saved'
    } catch {
      element('save-status').textContent = ''
    } finally {
      view.saving = false
      element('save').disabled = false
    }
  }

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-detail-action]')
    if (action && view.task) { onAction(view.task, action.dataset.detailAction); return }
    if (event.target.closest('[data-detail="view-tab"]')) { if (!isDirty()) setMode('view'); return }
    if (event.target.closest('[data-detail="edit-tab"]')) { setMode('edit'); return }
    if (event.target.closest('[data-detail="save"]')) { save(); return }
    if (event.target.closest('[data-detail="cancel"]')) { cancelEdit(); return }
    if (event.target.closest('[data-detail="copy"]') && view.task) { onCopy(view.task); return }
    if (event.target.closest('[data-detail="open-full"]') && view.task) { onOpenFull(view.task); return }
    const outline = event.target.closest('[data-outline]')
    if (outline) {
      root.querySelector(`#${outline.dataset.outline}`)?.scrollIntoView({behavior: 'smooth', block: 'start'})
      return
    }
    const link = event.target.closest('a[data-task-link]')
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault()
      onOpenTask(link.dataset.taskLink)
    }
  })

  element('textarea').addEventListener('keydown', event => {
    const modifier = event.metaKey || event.ctrlKey
    if (modifier && (event.key === 's' || event.key === 'Enter')) {
      event.preventDefault()
      save()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!isDirty()) cancelEdit()
      else element('save-status').textContent = 'Unsaved changes — save or press Cancel.'
    }
  })

  return {
    show,
    refresh,
    showState,
    isDirty,
    cancelEdit,
    get task() { return view.task },
  }
}

function template(variant) {
  const prefix = `${variant}-detail`
  const drawerTools = variant === 'drawer'
    ? `<button class="btn" type="button" data-detail="open-full" title="Open the full task page">
        <svg class="icon" aria-hidden="true"><use href="#i-expand"/></svg> Open full page
      </button>`
    : ''
  const close = variant === 'drawer'
    ? `<button class="icon-button" type="button" data-close aria-label="Close task"><svg class="icon"><use href="#i-close"/></svg></button>`
    : ''
  const side = variant === 'page'
    ? `<aside class="detail-side" aria-label="Task details">
        <section class="side-card"><h3>Details</h3><dl class="facts" data-detail="facts"></dl></section>
        <section class="side-card"><h3>Blocked by</h3><div class="relation-list" data-detail="blockers"></div></section>
        <section class="side-card"><h3>Blocks</h3><div class="relation-list" data-detail="dependents"></div></section>
        <section class="side-card outline-card" data-detail="outline-card" hidden>
          <h3>On this page</h3><nav class="outline" data-detail="outline" aria-label="Task body outline"></nav>
        </section>
      </aside>`
    : ''
  return `<div class="detail detail-${variant}">
    <div data-detail="state" hidden></div>
    <div data-detail="content">
      <header class="detail-head">
        <div class="detail-heading">
          <p class="eyebrow" data-detail="eyebrow"></p>
          <h2 id="${prefix}-title" data-detail="title"></h2>
          <div class="chip-row" data-detail="chips"></div>
        </div>
        <div class="detail-tools">
          ${drawerTools}
          <button class="icon-button" type="button" data-detail="copy" aria-label="Copy link to the full task page" title="Copy link to the full task page">
            <svg class="icon"><use href="#i-link"/></svg>
          </button>
          ${close}
        </div>
      </header>
      <div class="detail-actions" data-detail="actions"></div>
      <div class="detail-layout">
        <section class="detail-main" aria-label="Task body">
          <div class="detail-body-head">
            <h3>Task body</h3>
            <div class="body-tabs" role="tablist" aria-label="Task body mode">
              <button class="body-tab" id="${prefix}-view-tab" data-detail="view-tab" type="button" role="tab" aria-selected="true" aria-controls="${prefix}-rendered">View</button>
              <button class="body-tab" id="${prefix}-edit-tab" data-detail="edit-tab" type="button" role="tab" aria-selected="false" aria-controls="${prefix}-edit">Edit</button>
            </div>
          </div>
          <div id="${prefix}-rendered" class="markdown" data-detail="rendered" role="tabpanel" aria-labelledby="${prefix}-view-tab" tabindex="0"></div>
          <label class="field detail-edit" id="${prefix}-edit" data-detail="edit" hidden>
            <span class="sr-only">Task body Markdown</span>
            <textarea data-detail="textarea" spellcheck="false"></textarea>
          </label>
          <div class="detail-foot">
            <button class="btn primary" type="button" data-detail="save" hidden>Save body</button>
            <button class="btn ghost" type="button" data-detail="cancel" hidden>Cancel</button>
            <span class="edit-hint" data-detail="edit-hint" hidden>Ctrl+S to save · Esc to leave</span>
            <span class="muted" data-detail="save-status" role="status"></span>
          </div>
          ${variant === 'page' ? '<div class="detail-chat-slot" data-detail="chat-slot"></div>' : ''}
        </section>
        ${side}
      </div>
    </div>
  </div>`
}

function facts(task, context) {
  const status = statusOrder.find(item => item.key === statusKey(task))
  const rows = [
    ['Status', `<span class="fact-status"><span class="legend-swatch" style="background:var(${status.token})"></span>${escapeHtml(status.label)}</span>`],
    ['Priority', `<span class="chip prio-${task.priority}">P${escapeHtml(task.priority)}</span>`],
    ['Updated', escapeHtml(task.updated || '—')],
  ]
  if (task.shipped) rows.push(['Shipped', escapeHtml(task.shipped)])
  if (context.workspace.mode === 'workspace') rows.push(['Repository', task.repo ? `<span class="chip repo">${escapeHtml(task.repo)}</span>` : 'Workspace-wide'])
  if (task.prodGate) rows.push(['Gate', '<span class="chip gate">production gate</span>'])
  if (task.file) rows.push(['File', `<code class="fact-file" title="${escapeHtml(task.file)}">${escapeHtml(task.file.split('/').slice(-3).join('/'))}</code>`])
  return rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')
}

function relationRows(ids, context, empty) {
  if (ids.length === 0) return `<p class="relation-empty">${escapeHtml(empty)}</p>`
  return ids.map(id => {
    const task = context.tasks.find(item => item.id === id)
    if (!task) {
      return `<a class="relation" href="${taskPath(id)}" data-task-link="${escapeHtml(id)}"><span class="relation-id">${escapeHtml(id)}</span><span class="relation-title muted">Not in the queue</span></a>`
    }
    const status = statusOrder.find(item => item.key === statusKey(task))
    return `<a class="relation" href="${taskPath(task.id)}" data-task-link="${escapeHtml(task.id)}">
      <span class="legend-swatch" style="background:var(${status.token})" title="${escapeHtml(status.label)}"></span>
      <span class="relation-id">${escapeHtml(task.id)}</span>
      <span class="relation-title">${escapeHtml(task.title)}</span>
      <span class="relation-status">${escapeHtml(status.label)}</span>
    </a>`
  }).join('')
}

function statePanel(kind, message) {
  if (kind === 'loading') {
    return '<div class="skeleton" aria-hidden="true">' + '<div class="skeleton-row"></div>'.repeat(4) + '</div><span class="sr-only" role="status">Loading task…</span>'
  }
  const panels = {
    'not-found': ['i-alert', 'Task not found', message || 'This task id does not exist in the queue.'],
    forbidden: ['i-lock', 'Localhost only', 'This queue is served on 127.0.0.1 and refuses non-local clients.'],
    error: ['i-alert', 'Could not load the task', message || 'The dev server did not answer.'],
  }
  const [icon, title, text] = panels[kind] || panels.error
  const retry = kind === 'error' ? '<button class="btn" type="button" data-detail-retry>Try again</button>' : ''
  return `<div class="state-panel ${kind}">
    <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(text)}</p>
    ${retry}
  </div>`
}
