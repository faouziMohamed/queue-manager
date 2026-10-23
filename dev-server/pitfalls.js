import {api} from './api.js'
import {renderMarkdown} from './markdown.js'
import {escapeHtml} from './render.js'

let data = null
let dataKey = ''
let requestToken = 0
let filter = 'all'
let query = ''
let focused = ''

export function disposePitfalls() {
  requestToken += 1
  data = null
  dataKey = ''
  focused = ''
}

export function renderPitfalls(state, container) {
  const key = `${state.queueVersion}|${state.tasks.map(task => `${task.id}:${task.status}:${task.updated}`).join('|')}`
  if (data && dataKey === key) {
    draw(container)
    return
  }
  const token = ++requestToken
  container.setAttribute('aria-busy', 'true')
  if (!data) container.innerHTML = skeleton()
  api('/api/pitfalls')
    .then(payload => {
      if (token !== requestToken) return
      data = payload
      dataKey = key
      container.setAttribute('aria-busy', 'false')
      focused = ''
      draw(container)
    })
    .catch(error => {
      if (token !== requestToken) return
      console.error('pitfalls view:', error)
      container.setAttribute('aria-busy', 'false')
      container.innerHTML = `<div class="state-panel error">
        <svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>
        <h2>Could not load pitfalls</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>`
    })
}

function skeleton() {
  return `<div class="pitfalls" aria-hidden="true">
    <div class="pitfalls-hero skeleton-row"></div>
    <div class="skeleton"><div class="skeleton-row"></div>${'<div class="skeleton-row"></div>'.repeat(3)}</div>
  </div>`
}

function draw(container) {
  if (!data) return
  if (!container.querySelector('[data-pitfalls-ready]')) {
    container.innerHTML = shell()
    bind(container)
  }
  const lessons = filtered()
  const list = container.querySelector('[data-pitfall-list]')
  if (!data.exists) {
    list.innerHTML = fileMissing()
    updateCount(container, 0)
    return
  }
  if (data.pitfalls.length === 0) {
    list.innerHTML = noLessons()
    updateCount(container, 0)
    return
  }
  list.innerHTML = lessons.length
    ? lessons.map(card).join('')
    : `<div class="empty-state pitfall-empty">
        <svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>
        <h2>No matching pitfalls</h2>
        <p>Try a different filter or search term.</p>
      </div>`
  updateCount(container, lessons.length)
  focusHash(container)
}

function shell() {
  const counts = data.counts || {total: 0, linked: 0, verified: 0, unverified: 0}
  return `<div class="pitfalls" data-pitfalls-ready>
    <section class="pitfalls-hero" aria-labelledby="pitfalls-title">
      <div class="pitfalls-hero-copy">
        <p class="eyebrow">Institutional memory</p>
        <h2 id="pitfalls-title">Known traps</h2>
        <p>Verified lessons from this workspace, linked to the tasks that ran into them.</p>
        <span class="pitfall-file"><code>${escapeHtml(data.file)}</code></span>
      </div>
      <div class="pitfall-stats" aria-label="Pitfalls summary">
        <div class="pitfall-stat"><span class="pitfall-stat-value">${counts.total}</span><span class="pitfall-stat-label">lessons</span></div>
        <div class="pitfall-stat"><span class="pitfall-stat-value">${counts.linked}</span><span class="pitfall-stat-label">linked</span></div>
        <div class="pitfall-stat"><span class="pitfall-stat-value">${counts.verified}</span><span class="pitfall-stat-label">dated</span></div>
      </div>
    </section>
    ${data.intro ? `<details class="pitfall-intro"><summary>How this file works</summary><div class="markdown">${renderMarkdown(data.intro)}</div></details>` : ''}
    <div class="pitfall-toolbar">
      <label class="pitfall-search">
        <svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>
        <input type="search" data-pitfall-search placeholder="Filter by ID, symptom, cause or task…" aria-label="Filter pitfalls">
      </label>
      <div class="pitfall-filters" role="group" aria-label="Filter pitfalls">
        <button class="pitfall-filter" type="button" data-pitfall-filter="all" aria-pressed="true">All</button>
        <button class="pitfall-filter" type="button" data-pitfall-filter="linked" aria-pressed="false">Linked to tasks</button>
        <button class="pitfall-filter" type="button" data-pitfall-filter="unverified" aria-pressed="false">Undated</button>
      </div>
      <span class="pitfall-count" data-pitfall-count></span>
    </div>
    <div class="pitfall-list" data-pitfall-list></div>
  </div>`
}

function bind(container) {
  const search = container.querySelector('[data-pitfall-search]')
  search.value = query
  search.addEventListener('input', () => {
    query = search.value
    draw(container)
  })
  for (const button of container.querySelectorAll('[data-pitfall-filter]')) {
    button.setAttribute('aria-pressed', String(button.dataset.pitfallFilter === filter))
    button.addEventListener('click', () => {
      filter = button.dataset.pitfallFilter
      for (const other of container.querySelectorAll('[data-pitfall-filter]')) {
        other.setAttribute('aria-pressed', String(other.dataset.pitfallFilter === filter))
      }
      draw(container)
    })
  }
}

function filtered() {
  if (!data?.pitfalls) return []
  const needle = query.trim().toLowerCase()
  return data.pitfalls
    .filter(pitfall => {
      if (filter === 'linked' && pitfall.linkedTasks.length === 0) return false
      if (filter === 'unverified' && pitfall.verified) return false
      return true
    })
    .filter(pitfall => {
      if (!needle) return true
      const haystack = [
        pitfall.id, pitfall.title, pitfall.group, pitfall.symptom, pitfall.cause,
        pitfall.remedy, pitfall.appliesTo, pitfall.cost, pitfall.body,
        ...(pitfall.cases || []),
        ...pitfall.linkedTasks.flatMap(task => [task.id, task.title, task.repo]),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
}

function updateCount(container, shown) {
  const label = container.querySelector('[data-pitfall-count]')
  if (label) label.textContent = `${shown} of ${data.counts?.total || 0} shown`
}

function inline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function card(pitfall) {
  const identified = Boolean(pitfall.id)
  const fields = [
    ['Symptom', pitfall.symptom],
    ['Cause', pitfall.cause],
    ['Remedy', pitfall.remedy],
    ['Applies to', pitfall.appliesTo],
    ...pitfall.extras.map(field => [field.label, field.value]),
  ].filter(([, value]) => value)
  const linked = pitfall.linkedTasks.length
    ? `<div class="pitfall-links"><span class="pitfall-links-label">Linked tasks</span>${pitfall.linkedTasks.map(taskChip).join('')}</div>`
    : '<div class="pitfall-links"><span class="pitfall-links-label">Linked tasks</span><span class="muted">No task references this lesson yet.</span></div>'
  const cases = pitfall.cases.length
    ? `<div class="pitfall-links"><span class="pitfall-links-label">Verified in</span>${pitfall.cases.map(name => `<span class="chip case">${escapeHtml(name)}</span>`).join('')}</div>`
    : ''
  const verified = pitfall.verified
    ? `<span class="pitfall-verified is-verified">verified${pitfall.verifiedDate ? ` ${escapeHtml(pitfall.verifiedDate)}` : ''}</span>`
    : '<span class="pitfall-verified" title="No Verified date recorded">undated</span>'
  return `<article class="pitfall-card" id="${escapeHtml(pitfall.anchor)}" data-pitfall="${escapeHtml(pitfall.id || pitfall.anchor)}">
    <header class="pitfall-head">
      <span class="pitfall-id${identified ? '' : ' is-unnumbered'}">${escapeHtml(pitfall.id || 'Lesson')}</span>
      ${pitfall.group ? `<span class="pitfall-group">${escapeHtml(pitfall.group)}</span>` : ''}
      <h3 class="pitfall-title">${inline(pitfall.title)}</h3>
      ${verified}
    </header>
    ${pitfall.cost ? `<p class="pitfall-cost"><span>Cost</span>${inline(pitfall.cost)}</p>` : ''}
    ${fields.length ? `<div class="pitfall-fields">${fields.map(([label, value]) => field(label, value)).join('')}</div>` : ''}
    ${pitfall.body ? `<div class="pitfall-prose markdown">${renderMarkdown(pitfall.body)}</div>` : ''}
    ${identified ? '' : '<p class="pitfall-note">No <code>PIT-</code> ID yet. Add one so tasks can link to this lesson.</p>'}
    <footer class="pitfall-foot">${linked}${cases}</footer>
  </article>`
}

function field(label, value) {
  return `<div class="pitfall-field">
    <span class="pitfall-label">${escapeHtml(label)}</span>
    <div class="pitfall-value">${renderMarkdown(value)}</div>
  </div>`
}

function taskChip(task) {
  const status = ['in-progress', 'ready', 'blocked', 'on-hold', 'done'].includes(task.status) ? task.status : ''
  return `<a class="chip task-chip${status ? ` status-${status}` : ''}" href="/tasks/${escapeHtml(task.id)}" data-task-link="${escapeHtml(task.id)}" title="${escapeHtml(task.title)}">${escapeHtml(task.id)} · ${escapeHtml(task.title)}</a>`
}

function fileMissing() {
  return `<div class="empty-state pitfall-empty">
    <svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>
    <h2>No pitfalls file yet</h2>
    <p>Record verified, recurring traps in <code>PITFALLS.md</code> at the workspace root (or <code>docs/PITFALLS.md</code>). Tasks that mention a <code>PIT-</code> ID are linked here automatically.</p>
    <pre class="pitfall-sample">### PIT-001 — A short, specific title

**Symptom:** what someone sees.
**Cause:** why it happens.
**Remedy:** what to do instead.
**Applies to:** the area it affects. **Verified:** 2026-01-31, \`repo-name\`.</pre>
  </div>`
}

function noLessons() {
  return `<div class="empty-state pitfall-empty">
    <svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>
    <h2>No lessons found</h2>
    <p><code>${escapeHtml(data.file)}</code> exists, but no headings were found. Start each lesson with <code>### PIT-001 — Title</code>, or an unnumbered <code>## Title</code>.</p>
  </div>`
}

function focusHash(container) {
  const hash = location.hash
  if (!hash || hash === focused) return
  const id = hash.slice(1)
  let card = [...container.querySelectorAll('.pitfall-card')].find(element => element.id === id)
  if (!card && (query || filter !== 'all')) {
    query = ''
    filter = 'all'
    const search = container.querySelector('[data-pitfall-search]')
    if (search) search.value = ''
    for (const button of container.querySelectorAll('[data-pitfall-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.pitfallFilter === 'all'))
    }
    draw(container)
    return
  }
  if (!card) return
  focused = hash
  card.classList.add('is-focused')
  requestAnimationFrame(() => card.scrollIntoView({behavior: 'auto', block: 'start'}))
}
