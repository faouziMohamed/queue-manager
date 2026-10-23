import {escapeHtml} from '../../core/html.util.js';
import {taskPath} from '../../core/router.js';
import {statusKey, statusOrder} from '../../core/status.util.js';

/** @typedef {import('../../../shared/types.mjs').DefinitionOfDone} DefinitionOfDone */
/** @typedef {import('../../../shared/types.mjs').Task} Task */
/** @typedef {import('../../../shared/types.mjs').AppState} AppState */

/**
 * Static HTML of a task detail, for the drawer or the full page.
 * @param {'drawer' | 'page'} variant
 * @returns {string}
 */
export function detailTemplate(variant) {
  const prefix = `${variant}-detail`;
  const drawerTools =
    variant === 'drawer'
      ? `<button class="btn" type="button" data-detail="open-full" title="Open the full task page">
        <svg class="icon" aria-hidden="true"><use href="#i-expand"/></svg> Open full page
      </button>`
      : '';
  const close =
    variant === 'drawer'
      ? `<button class="icon-button" type="button" data-close aria-label="Close task"><svg class="icon"><use href="#i-close"/></svg></button>`
      : '';
  const side =
    variant === 'page'
      ? `<aside class="detail-side" aria-label="Task details">
        <section class="side-card"><h3>Details</h3><dl class="facts" data-detail="facts"></dl></section>
        <section class="side-card"><h3>Blocked by</h3><div class="relation-list" data-detail="blockers"></div></section>
        <section class="side-card"><h3>Blocks</h3><div class="relation-list" data-detail="dependents"></div></section>
        <section class="side-card" data-detail="dod-card" hidden>
          <h3>Definition of done</h3><div data-detail="dod"></div>
        </section>
        <section class="side-card" data-detail="pitfalls-card" hidden>
          <h3>Related pitfalls</h3><div class="relation-list" data-detail="pitfalls"></div>
        </section>
        <section class="side-card outline-card" data-detail="outline-card" hidden>
          <h3>On this page</h3><nav class="outline" data-detail="outline" aria-label="Task body outline"></nav>
        </section>
      </aside>`
      : '';
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
  </div>`;
}

/**
 * Definition of done progress bar and checklist.
 * @param {DefinitionOfDone} dod
 * @returns {string}
 */
export function dodPanel(dod) {
  if (!dod || !dod.present) return '';
  if (dod.total === 0)
    return '<p class="muted dod-empty">The section has no checklist items yet.</p>';
  const percent = Math.round((dod.done / dod.total) * 100);
  return `<div class="dod-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${dod.total}" aria-valuenow="${dod.done}" aria-label="Definition of done progress">
      <span class="dod-progress-bar" style="width:${percent}%"></span>
    </div>
    <p class="dod-summary">${dod.done} of ${dod.total} checked</p>
    <ul class="dod-list">
      ${dod.items
        .map(
          item => `<li class="${item.done ? 'is-done' : ''}">
        <span class="dod-box" aria-hidden="true">${item.done ? '<svg class="icon"><use href="#i-check"/></svg>' : ''}</span>
        <span>${escapeHtml(item.text).replace(/`([^`]+)`/g, '<code>$1</code>')}</span>
      </li>`,
        )
        .join('')}
    </ul>`;
}

/**
 * Rows of the Details card on the task page.
 * @param {Task} task
 * @param {AppState} context
 * @returns {string}
 */
export function facts(task, context) {
  const status = statusOrder.find(item => item.key === statusKey(task));
  const rows = [
    [
      'Status',
      `<span class="fact-status"><span class="legend-swatch" style="background:var(${status.token})"></span>${escapeHtml(status.label)}</span>`,
    ],
    [
      'Priority',
      `<span class="chip prio-${task.priority}">P${escapeHtml(task.priority)}</span>`,
    ],
    ['Updated', escapeHtml(task.updated || '—')],
  ];
  if (task.shipped) rows.push(['Shipped', escapeHtml(task.shipped)]);
  if (context.workspace.mode === 'workspace')
    rows.push([
      'Repository',
      task.repo
        ? `<span class="chip repo">${escapeHtml(task.repo)}</span>`
        : 'Workspace-wide',
    ]);
  if (task.prodGate)
    rows.push(['Gate', '<span class="chip gate">production gate</span>']);
  if (task.file)
    rows.push([
      'File',
      `<code class="fact-file" title="${escapeHtml(task.file)}">${escapeHtml(task.file.split('/').slice(-3).join('/'))}</code>`,
    ]);
  return rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join('');
}

/**
 * Rows linking to related tasks, or an empty message.
 * @param {string[]} ids
 * @param {AppState} context
 * @param {string} empty
 * @returns {string}
 */
export function relationRows(ids, context, empty) {
  if (ids.length === 0)
    return `<p class="relation-empty">${escapeHtml(empty)}</p>`;
  return ids
    .map(id => {
      const task = context.tasks.find(item => item.id === id);
      if (!task) {
        return `<a class="relation" href="${taskPath(id)}" data-task-link="${escapeHtml(id)}"><span class="relation-id">${escapeHtml(id)}</span><span class="relation-title muted">Not in the queue</span></a>`;
      }
      const status = statusOrder.find(item => item.key === statusKey(task));
      return `<a class="relation" href="${taskPath(task.id)}" data-task-link="${escapeHtml(task.id)}">
      <span class="legend-swatch" style="background:var(${status.token})" title="${escapeHtml(status.label)}"></span>
      <span class="relation-id">${escapeHtml(task.id)}</span>
      <span class="relation-title">${escapeHtml(task.title)}</span>
      <span class="relation-status">${escapeHtml(status.label)}</span>
    </a>`;
    })
    .join('');
}

/**
 * Loading, not-found, forbidden or error panel for the task detail.
 * @param {'loading' | 'not-found' | 'forbidden' | 'error'} kind
 * @param {string} [message]
 * @returns {string}
 */
export function statePanel(kind, message) {
  if (kind === 'loading') {
    return (
      '<div class="skeleton" aria-hidden="true">' +
      '<div class="skeleton-row"></div>'.repeat(4) +
      '</div><span class="sr-only" role="status">Loading task…</span>'
    );
  }
  const panels = {
    'not-found': [
      'i-alert',
      'Task not found',
      message || 'This task id does not exist in the queue.',
    ],
    forbidden: [
      'i-lock',
      'Localhost only',
      'This queue is served on 127.0.0.1 and refuses non-local clients.',
    ],
    error: [
      'i-alert',
      'Could not load the task',
      message || 'The dev server did not answer.',
    ],
  };
  const [icon, title, text] = panels[kind] || panels.error;
  const retry =
    kind === 'error'
      ? '<button class="btn" type="button" data-detail-retry>Try again</button>'
      : '';
  return `<div class="state-panel ${kind}">
    <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(text)}</p>
    ${retry}
  </div>`;
}
