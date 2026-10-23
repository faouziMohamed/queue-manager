/** @typedef {import('../../shared/types.mjs').StatusKey} StatusKey */
/** @typedef {import('../../shared/types.mjs').Task} Task */

export const statusOrder = [
  {key: 'in-progress', label: 'In progress', token: '--status-in-progress'},
  {key: 'ready', label: 'Ready', token: '--status-ready'},
  {key: 'blocked', label: 'Blocked', token: '--status-blocked'},
  {key: 'on-hold', label: 'On hold', token: '--status-on-hold'},
  {key: 'awaiting', label: 'Awaiting production', token: '--status-awaiting'},
  {key: 'done', label: 'Done', token: '--status-done'},
];

export const openStatuses = statusOrder.filter(status => status.key !== 'done');

/**
 * Display status of a task: `awaiting` for open tasks behind a production gate.
 * @param {Task} task
 * @returns {StatusKey}
 */
export function statusKey(task) {
  if (task.status === 'done') return 'done';
  return task.awaitingProduction ? 'awaiting' : task.status;
}

/**
 * Current theme colors read from the CSS tokens, including one per status key.
 * @returns {Record<string, string>}
 */
export function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = name => style.getPropertyValue(name).trim();
  const colors = {
    ink: read('--ink'),
    muted: read('--muted'),
    faint: read('--faint'),
    line: read('--line'),
    surface: read('--surface'),
    canvas: read('--canvas'),
    brand: read('--brand'),
  };
  for (const status of statusOrder) colors[status.key] = read(status.token);
  return colors;
}
