import {escapeHtml} from '../../core/html.util.js';
import {blockingPanel} from '../../core/state-panel.view.js';
import {dodChip, inlineTitle, relationLink} from './task-chips.view.js';

/** @typedef {import('../../../shared/types.mjs').AppState} AppState */

const priorityIcons = {1: 'i-prio-up', 3: 'i-prio-down'};

/**
 * Renders the task list of a section, with its empty and blocking states.
 * @param {AppState} state
 * @param {{id: string, icon: string, emptyTitle?: string, empty?: string}} section
 * @returns {void}
 */
export function renderList(state, section) {
  const list = document.querySelector('#task-list');
  list.setAttribute('aria-busy', state.loading ? 'true' : 'false');
  const panel = blockingPanel(state);
  if (panel) {
    list.innerHTML = panel;
    return;
  }
  const tasks = filteredTasks(state, section.id);
  if (tasks.length === 0) {
    const action =
      section.id === 'ready'
        ? '<button class="btn primary" type="button" data-new-task>New task</button>'
        : '';
    list.innerHTML = `<div class="empty-state">
      <svg class="icon" aria-hidden="true"><use href="#${section.icon}"/></svg>
      <h2>${state.query ? 'No matching tasks' : section.emptyTitle}</h2>
      <p>${state.query ? 'Try a different search.' : section.empty}</p>
      ${action}
    </div>`;
    return;
  }
  list.innerHTML = tasks.map(task => taskRow(state, task)).join('');
}

/**
 * Tasks shown in a section, after the search filter.
 * @param {AppState} state
 * @param {string} section
 * @returns {number}
 */
export function countTasks(state, section) {
  if (state.query) return filteredTasks(state, section).length;
  return sectionTasks(state, section).length;
}

function sectionTasks(state, section) {
  if (section === 'awaiting')
    return state.tasks.filter(task => task.awaitingProduction);
  if (section === 'blocked')
    return state.tasks.filter(
      task => task.status === 'blocked' && !task.awaitingProduction,
    );
  if (section === 'on-hold')
    return state.tasks.filter(
      task => task.status === 'on-hold' && !task.awaitingProduction,
    );
  return state.tasks.filter(task => task.status === section);
}

function filteredTasks(state, section) {
  const query = state.query.trim().toLowerCase();
  const tasks = sectionTasks(state, section);
  if (!query) return tasks;
  return tasks.filter(task =>
    [task.id, task.title, task.resume, task.repo]
      .join(' ')
      .toLowerCase()
      .includes(query),
  );
}

function taskRow(state, task) {
  const repo =
    state.workspace.mode === 'workspace' && task.repo
      ? `<span class="chip repo">${escapeHtml(task.repo)}</span>`
      : '';
  const priority = String(task.priority || '2');
  const priorityIcon = priorityIcons[priority] || 'i-prio-eq';
  const avatar =
    state.workspace.mode === 'workspace'
      ? `<span class="task-avatar" title="${escapeHtml(task.repo || 'queue')}">${escapeHtml(initials(task.repo || 'queue'))}</span>`
      : '';
  const meta = task.blockedBy.map(blocker => relationLink('blocked', blocker));
  if (task.awaitingProduction)
    meta.push('<span class="chip gate">production</span>');
  const dod = dodChip(task);
  if (dod) meta.push(dod);
  const metaHtml =
    meta.length > 0 ? `<span class="task-meta">${meta.join('')}</span>` : '';
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
  </article>`;
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
