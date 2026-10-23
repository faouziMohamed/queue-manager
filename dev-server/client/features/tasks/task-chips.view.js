import {PAGES} from '../../../shared/routes.constant.mjs';
import {escapeHtml} from '../../core/html.util.js';

/** @typedef {import('../../../shared/types.mjs').Task} Task */
/** @typedef {import('../../../shared/types.mjs').AppState} AppState */

/**
 * Compact Definition of done progress chip, or empty without a checklist.
 * @param {Task} task
 * @returns {string}
 */
export function dodChip(task) {
  const dod = task.dod;
  if (!dod || !dod.present || dod.total === 0) return '';
  const complete = dod.done === dod.total;
  return `<span class="dod-chip${complete ? ' is-complete' : ''}" title="Definition of done: ${dod.done} of ${dod.total} checked">
    <svg class="icon" aria-hidden="true"><use href="#i-check"/></svg>DoD ${dod.done}/${dod.total}
  </span>`;
}

/**
 * Priority, status, repository and relation chips for a task header.
 * @param {AppState} state
 * @param {Task} task
 * @param {{relations?: boolean}} [options]
 * @returns {string}
 */
export function detailChips(state, task, {relations = true} = {}) {
  const chips = [
    `<span class="chip prio-${task.priority}">P${task.priority}</span>`,
    `<span class="chip">${escapeHtml(task.status)}</span>`,
    `<span class="chip">updated ${escapeHtml(task.updated)}</span>`,
  ];
  if (state.workspace.mode === 'workspace' && task.repo) {
    chips.push(`<span class="chip repo">${escapeHtml(task.repo)}</span>`);
  }
  if (relations) {
    for (const blocker of task.blockedBy)
      chips.push(relationLink('blocked', blocker));
    for (const dependent of state.tasks) {
      if (dependent.blockedBy.includes(task.id))
        chips.push(relationLink('blocks', dependent.id));
    }
  }
  if (task.awaitingProduction)
    chips.push('<span class="chip gate">awaiting production</span>');
  return chips.join('');
}

/**
 * Transition buttons allowed for the task's status.
 * @param {Task} task
 * @returns {string}
 */
export function detailActions(task) {
  if (task.status === 'done')
    return '<span class="muted">Completed records are immutable.</span>';
  const buttons = [];
  if (task.status === 'ready')
    buttons.push(
      '<button class="btn primary" type="button" data-detail-action="start">Start</button>',
    );
  if (task.status === 'in-progress')
    buttons.push(
      '<button class="btn primary" type="button" data-detail-action="done">Mark done</button>',
    );
  if (task.status === 'blocked')
    buttons.push(
      '<button class="btn" type="button" data-detail-action="unblock">Unblock</button>',
    );
  if (task.status === 'on-hold')
    buttons.push(
      '<button class="btn primary" type="button" data-detail-action="resume">Resume</button>',
    );
  if (
    task.status === 'ready' ||
    task.status === 'in-progress' ||
    task.status === 'blocked'
  ) {
    buttons.push(
      '<button class="btn" type="button" data-detail-action="hold">Hold</button>',
    );
  }
  if (task.status === 'ready' || task.status === 'in-progress') {
    buttons.push(
      '<button class="btn" type="button" data-detail-action="block">Block</button>',
    );
  }
  return buttons.join('');
}

/**
 * Link chip to a related task.
 * @param {'blocked' | 'blocks'} kind
 * @param {string} id
 * @returns {string}
 */
export function relationLink(kind, id) {
  return `<a class="chip ${kind === 'blocked' ? 'blocked' : ''}" href="${PAGES.task(id)}" data-task-link="${id}">${kind} ${escapeHtml(id)}</a>`;
}

/**
 * Escaped task title with backtick spans as inline code.
 * @param {string} value
 * @returns {string}
 */
export function inlineTitle(value) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');
}
