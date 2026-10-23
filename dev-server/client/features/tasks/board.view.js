import {escapeHtml} from '../../core/html.util.js';
import {statusKey, statusOrder} from '../../core/status.util.js';
import {dodChip} from './task-chips.view.js';

/** @typedef {import('../../../shared/types.mjs').AppState} AppState */

let root = null;
let callbacks = {};
let currentState = null;
let currentContainer = null;
let draggedId = '';
let draggedStatus = '';

/**
 * Wires drag and drop on the board once; drops become CLI transitions through the callbacks.
 * @param {{root: HTMLElement} & Record<string, Function>} options
 */
export function initBoard(options) {
  root = options.root;
  callbacks = options;
  if (!root || root.dataset.kanbanReady) return;
  root.dataset.kanbanReady = 'true';

  root.addEventListener('dragstart', event => {
    const card = event.target.closest('[data-kanban-card]');
    if (!card || card.getAttribute('draggable') === 'false') return;
    draggedId = card.dataset.kanbanCard;
    draggedStatus = card.dataset.kanbanStatus || '';
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedId);
  });

  root.addEventListener('dragend', () => clearDrag());

  root.addEventListener('dragover', event => {
    if (!draggedId) return;
    const column = event.target.closest('[data-kanban-column]');
    if (!column || column.dataset.kanbanColumn === draggedStatus) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    for (const other of root.querySelectorAll(
      '.kanban-column.is-drop-target',
    )) {
      if (other !== column) other.classList.remove('is-drop-target');
    }
    column.classList.add('is-drop-target');
  });

  root.addEventListener('dragleave', event => {
    const column = event.target.closest('[data-kanban-column]');
    if (column && !column.contains(event.relatedTarget))
      column.classList.remove('is-drop-target');
  });

  root.addEventListener('drop', event => {
    const column = event.target.closest('[data-kanban-column]');
    if (!column || !draggedId) return;
    event.preventDefault();
    const id = draggedId;
    const target = column.dataset.kanbanColumn;
    clearDrag();
    const task = currentState?.tasks.find(item => item.id === id);
    if (task) callbacks.onMove?.(task, target);
  });

  root.addEventListener('input', event => {
    if (!event.target.matches('[data-kanban-search]') || !currentState) return;
    currentState.query = event.target.value;
    const topbarSearch = document.querySelector('#search');
    if (topbarSearch && topbarSearch !== event.target)
      topbarSearch.value = event.target.value;
    draw();
    const next = currentContainer?.querySelector('[data-kanban-search]');
    if (next) {
      next.focus();
      next.setSelectionRange(next.value.length, next.value.length);
    }
  });

  root.addEventListener('change', event => {
    if (!currentState) return;
    if (event.target.matches('[data-kanban-show-done]')) {
      currentState.boardShowDone = event.target.checked;
      draw();
    }
    if (event.target.matches('[data-kanban-repo]')) {
      currentState.boardRepo = event.target.value;
      draw();
    }
  });

  root.addEventListener('click', event => {
    if (event.target.closest('[data-kanban-clear]')) {
      event.preventDefault();
      if (!currentState) return;
      currentState.boardRepo = '';
      currentState.boardShowDone = false;
      draw();
    }
  });
}

/**
 * Renders the board: one column per status.
 * @param {AppState} state
 * @param {HTMLElement} container
 */
export function renderBoard(state, container) {
  currentState = state;
  currentContainer = container;
  draw();
}

function draw() {
  if (!currentState || !currentContainer) return;
  const state = currentState;
  if (
    state.workspace.mode !== 'workspace' ||
    (state.boardRepo &&
      !(state.workspace.repos || []).includes(state.boardRepo))
  ) {
    state.boardRepo = '';
  }
  const tasks = filteredTasks(state);
  const canDrag = !(
    window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  );
  const counts = Object.fromEntries(
    statusOrder.map(status => [
      status.key,
      tasks.filter(task => statusKey(task) === status.key).length,
    ]),
  );
  const open = tasks.filter(task => task.status !== 'done').length;
  const done = counts.done || 0;
  const repoFilter =
    state.workspace.mode === 'workspace'
      ? `<select class="kanban-select" data-kanban-repo aria-label="Filter by repository">
        <option value="">All repositories</option>
        ${(state.workspace.repos || []).map(repo => `<option value="${escapeHtml(repo)}"${state.boardRepo === repo ? ' selected' : ''}>${escapeHtml(repo)}</option>`).join('')}
      </select>`
      : '';
  const filtered = Boolean(state.boardRepo || state.boardShowDone);
  currentContainer.innerHTML = `<div class="kanban-view">
    <div class="kanban-filterbar">
      <label class="kanban-search">
        <svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>
        <input type="search" data-kanban-search placeholder="Search board" value="${escapeHtml(state.query)}" aria-label="Search board">
      </label>
      ${repoFilter}
      <label class="kanban-switch">
        <input type="checkbox" data-kanban-show-done${state.boardShowDone ? ' checked' : ''}>
        <span class="kanban-switch-track" aria-hidden="true"><span class="kanban-switch-thumb"></span></span>
        <span>Show done</span>
      </label>
      ${filtered ? '<button class="kanban-clear" type="button" data-kanban-clear>Clear</button>' : ''}
      <span class="kanban-hint kanban-hint-desktop">Drag a card to transition it through the CLI.</span>
      <span class="kanban-hint kanban-hint-mobile">Swipe between columns; tap a card to change status.</span>
      <span class="kanban-result-count">${open} open · ${done} done</span>
    </div>
    <div class="kanban-board">
      ${statusOrder.map(status => column(status, tasks, counts[status.key], state, canDrag)).join('')}
    </div>
  </div>`;
}

function filteredTasks(state) {
  const needle = String(state.query || '')
    .trim()
    .toLowerCase();
  return state.tasks.filter(task => {
    if (state.boardRepo && task.repo !== state.boardRepo) return false;
    if (!needle) return true;
    return [task.id, task.title, task.resume, task.repo]
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

function column(status, tasks, count, state, canDrag) {
  const columnTasks = tasks.filter(task => statusKey(task) === status.key);
  if (status.key === 'done' && !state.boardShowDone) {
    return `<section class="kanban-column is-collapsed" data-kanban-column="done" aria-label="Done, ${count} tasks">
      <div class="kanban-collapsed-count">${count}</div>
      <div class="kanban-collapsed-label">Done</div>
    </section>`;
  }
  const cards = columnTasks.length
    ? columnTasks.map(task => card(task, state, canDrag)).join('')
    : status.key === 'ready'
      ? ''
      : '<p class="kanban-empty">No tasks</p>';
  const canAdd = status.key === 'ready';
  return `<section class="kanban-column" data-kanban-column="${status.key}" aria-label="${escapeHtml(status.label)}">
    <header class="kanban-column-head">
      <span class="kanban-dot" style="background:var(${status.token})"></span>
      <span class="kanban-column-title">${escapeHtml(status.label)}</span>
      <span class="kanban-column-count">${count}</span>
    </header>
    <div class="kanban-column-cards">${cards}</div>
    ${
      canAdd
        ? `<div class="kanban-column-foot">
      <button class="kanban-add${columnTasks.length ? '' : ' is-empty'}" type="button" data-new-task>
        <svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg> Add task
      </button>
    </div>`
        : ''
    }
  </section>`;
}

function card(task, state, canDrag) {
  const status = statusKey(task);
  const priority = String(task.priority || '2');
  const priorityIcon =
    priority === '1'
      ? 'i-prio-up'
      : priority === '3'
        ? 'i-prio-down'
        : 'i-prio-eq';
  const hue = repoHue(task.repo);
  const repo =
    state.workspace.mode === 'workspace' && task.repo
      ? `<span class="kanban-label repo" title="${escapeHtml(task.repo)}" style="--label-hue:${hue}">
        <span class="kanban-label-dot" aria-hidden="true"></span>
        <span class="kanban-label-text">${escapeHtml(task.repo)}</span>
      </span>`
      : '';
  const blocked = task.blockedBy.length
    ? `<span class="kanban-label blocked">blocked by ${task.blockedBy.map(escapeHtml).join(', ')}</span>`
    : '';
  const gate = task.awaitingProduction
    ? '<span class="kanban-label gate">awaiting production</span>'
    : '';
  const dod = dodChip(task);
  const labels =
    repo || blocked || gate || dod
      ? `<div class="kanban-card-labels">${repo}${blocked}${gate}${dod}</div>`
      : '';
  const avatar =
    state.workspace.mode === 'workspace'
      ? `<span class="kanban-avatar" title="${escapeHtml(task.repo || 'queue')}" style="--avatar-hue:${hue}">${escapeHtml(initials(task.repo || 'queue'))}</span>`
      : '';
  return `<a class="kanban-card" href="/tasks/${escapeHtml(task.id)}" data-task-link="${escapeHtml(task.id)}" data-kanban-card="${escapeHtml(task.id)}" data-kanban-status="${status}" draggable="${canDrag && task.status !== 'done' ? 'true' : 'false'}">
    <div class="kanban-card-head">
      <span class="kanban-card-title">${inlineTitle(task.title)}</span>
      <span class="kanban-prio prio-${escapeHtml(priority)}" title="Priority P${escapeHtml(priority)}">
        <svg class="icon" aria-hidden="true"><use href="#${priorityIcon}"/></svg>
      </span>
    </div>
    ${labels}
    <div class="kanban-card-foot">
      <span class="kanban-key"><span class="kanban-type" aria-hidden="true"><svg class="icon"><use href="#i-check"/></svg></span>${escapeHtml(task.id)}</span>
      <span class="kanban-updated"><svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg>${escapeHtml(displayDate(task.updated))}</span>
      ${avatar}
    </div>
  </a>`;
}

function inlineTitle(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function displayDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function repoHue(value) {
  if (!value) return 216;
  let hash = 0;
  for (const character of value)
    hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

function initials(value) {
  return (
    String(value)
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase() || 'Q'
  );
}

function clearDrag() {
  draggedId = '';
  draggedStatus = '';
  if (!root) return;
  for (const element of root.querySelectorAll(
    '.is-dragging, .is-drop-target',
  )) {
    element.classList.remove('is-dragging', 'is-drop-target');
  }
}
