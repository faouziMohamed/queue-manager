import {
  PAGES,
  SECTION_IDS,
  TASK_ID_PATTERN,
} from '../../shared/routes.constant.mjs';

/** @typedef {import('../../shared/types.mjs').Task} Task */
/**
 * Reads the page route from a URL: a section list (with an optional peeked task) or a task page.
 * @param {string} pathname
 * @param {string} [search]
 * @param {string} [hash] Legacy `#task/Q-NNNN` links.
 * @returns {{kind: 'section', section: string, peek: string, legacy?: boolean} | {kind: 'task', id: string}}
 */
export function parseRoute(pathname, search = '', hash = '') {
  const legacy = /^#task\/(Q-\d{4,})$/.exec(hash);
  if (legacy)
    return {kind: 'section', section: '', peek: legacy[1], legacy: true};
  const task = /^\/tasks\/(Q-\d{4,})\/?$/.exec(pathname);
  if (task) return {kind: 'task', id: task[1]};
  const section = pathname.replace(/^\/+|\/+$/g, '');
  const peek = new URLSearchParams(search).get('task') || '';
  return {
    kind: 'section',
    section: SECTION_IDS.includes(section) ? section : '',
    peek: TASK_ID_PATTERN.test(peek) ? peek : '',
  };
}

/**
 * URL of a section with a task open in the drawer.
 * @param {string} section
 * @param {string} id
 * @returns {string}
 */
export function peekPath(section, id) {
  return `${PAGES.section(section)}?task=${encodeURIComponent(id)}`;
}

/**
 * URL of a section page.
 * @param {string} section
 * @returns {string}
 */
export function sectionPath(section) {
  return PAGES.section(section);
}

/**
 * URL of a task's full page.
 * @param {string} id
 * @returns {string}
 */
export function taskPath(id) {
  return PAGES.task(id);
}

/**
 * Section that lists a task.
 * @param {Task} task
 * @returns {string}
 */
export function sectionForTask(task) {
  if (task.status === 'done') return 'done';
  if (task.awaitingProduction) return 'awaiting';
  return task.status;
}

/**
 * Path to handle in-app for a plain left click on an internal link, or empty to let the browser follow it.
 * @param {HTMLAnchorElement | null} anchor
 * @param {MouseEvent} event
 * @returns {string}
 */
export function internalPath(anchor, event) {
  if (!anchor || event.defaultPrevented || event.button !== 0) return '';
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return '';
  if (
    (anchor.target && anchor.target !== '_self') ||
    anchor.hasAttribute('download')
  )
    return '';
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin) return '';
  const route = parseRoute(url.pathname, url.search);
  const isPage = route.kind === 'task' || route.section || url.pathname === '/';
  return isPage ? `${url.pathname}${url.search}${url.hash}` : '';
}
