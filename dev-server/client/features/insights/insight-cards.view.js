import {daysAgo} from '../../core/date.util.js';
import {escapeHtml} from '../../core/html.util.js';
import {openStatuses, statusKey, statusOrder} from '../../core/status.util.js';

/** @typedef {import('../../../shared/types.mjs').StatusKey} StatusKey */
/** @typedef {import('../../../shared/types.mjs').Task} Task */

/**
 * Number of tasks per display status.
 * @param {Task[]} tasks
 * @returns {Record<StatusKey, number>}
 */
export function countByStatus(tasks) {
  const counts = Object.fromEntries(statusOrder.map(status => [status.key, 0]));
  for (const task of tasks) counts[statusKey(task)] += 1;
  return counts;
}

/**
 * HTML card with an empty chart canvas.
 * @param {string} name Matches `data-chart`.
 * @param {string} title
 * @param {string} subtitle
 * @returns {string}
 */
export function chartCard(name, title, subtitle) {
  return `<section class="chart-card">
    <header><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></header>
    <div class="chart-canvas" data-chart="${name}" role="img" aria-label="${escapeHtml(title)}"></div>
  </section>`;
}

/**
 * HTML card around a ranked list.
 * @param {string} title
 * @param {string} subtitle
 * @param {string} body HTML.
 * @returns {string}
 */
export function listCard(title, subtitle, body) {
  return `<section class="chart-card">
    <header><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></header>
    ${body}
  </section>`;
}

/**
 * HTML for the KPI tiles: open work per status and shipped in the last 7 days.
 * @param {Record<StatusKey, number>} counts
 * @param {number} openCount
 * @param {Task[]} done
 * @returns {string}
 */
export function kpiTiles(counts, openCount, done) {
  const lastWeek = done.filter(task => daysAgo(task.shipped) <= 6).length;
  const weekBefore = done.filter(task => {
    const age = daysAgo(task.shipped);
    return age >= 7 && age <= 13;
  }).length;
  const delta = lastWeek - weekBefore;
  let trend = 'same as the 7 days before';
  if (delta > 0) trend = `+${delta} vs the 7 days before`;
  else if (delta < 0) trend = `${delta} vs the 7 days before`;
  const tiles = [
    tile('Open', openCount, 'tasks not done', 'ready', ''),
    ...openStatuses.map(status =>
      tile(
        status.label,
        counts[status.key],
        shareOfOpen(counts[status.key], openCount),
        status.key,
        status.token,
      ),
    ),
    tile('Shipped · 7 days', lastWeek, trend, 'done', '--faint'),
  ];
  return `<div class="kpi-grid">${tiles.join('')}</div>`;
}

/**
 * Top five open tasks by how many open tasks they block.
 * @param {Task[]} tasks
 * @returns {string} HTML.
 */
export function blockingList(tasks) {
  const open = new Map(
    tasks.filter(task => task.status !== 'done').map(task => [task.id, task]),
  );
  const blocking = new Map();
  for (const task of open.values()) {
    for (const blocker of task.blockedBy) {
      if (open.has(blocker))
        blocking.set(blocker, (blocking.get(blocker) || 0) + 1);
    }
  }
  const rows = [...blocking.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 5);
  if (rows.length === 0)
    return '<p class="chart-empty">No open task is blocking another.</p>';
  return `<ol class="rank-list">${rows.map(([id, count]) => rankRow(open.get(id), `blocks ${count}`)).join('')}</ol>`;
}

/**
 * Five open tasks with the oldest update date.
 * @param {Task[]} open
 * @returns {string} HTML.
 */
export function staleList(open) {
  const rows = open
    .map(task => ({task, age: daysAgo(task.updated)}))
    .filter(row => Number.isFinite(row.age))
    .sort(
      (left, right) =>
        right.age - left.age || left.task.id.localeCompare(right.task.id),
    )
    .slice(0, 5);
  if (rows.length === 0)
    return '<p class="chart-empty">No open task has an update date.</p>';
  return `<ol class="rank-list">${rows.map(row => rankRow(row.task, row.age === 0 ? 'today' : `${row.age} d`)).join('')}</ol>`;
}

function tile(label, value, hint, section, token) {
  const swatch = token
    ? `<span class="kpi-swatch" style="background:var(${token})"></span>`
    : '';
  return `<button class="kpi" type="button" data-section="${section}">
    <span class="kpi-label">${swatch}${escapeHtml(label)}</span>
    <strong class="kpi-value">${value}</strong>
    <span class="kpi-hint">${escapeHtml(hint)}</span>
  </button>`;
}

function shareOfOpen(value, total) {
  if (total === 0) return '0% of open work';
  return `${Math.round((value / total) * 100)}% of open work`;
}

function rankRow(task, metric) {
  const status = statusOrder.find(item => item.key === statusKey(task));
  return `<li><button class="rank-row" type="button" data-open="${escapeHtml(task.id)}">
    <span class="legend-swatch" style="background:var(${status.token})" title="${escapeHtml(status.label)}"></span>
    <span class="rank-id">${escapeHtml(task.id)}</span>
    <span class="rank-title">${escapeHtml(task.title)}</span>
    <span class="rank-metric">${escapeHtml(metric)}</span>
  </button></li>`;
}
