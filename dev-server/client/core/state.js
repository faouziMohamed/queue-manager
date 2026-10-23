export const state = {
  tasks: [],
  gates: [],
  section: 'in-progress',
  sectionExplicit: false,
  view: 'list',
  pageTaskId: '',
  returnSection: '',
  query: '',
  loading: true,
  queueVersion: 0,
  error: '',
  forbidden: false,
  blockTarget: null,
  doneTarget: null,
  theme: 'system',
  initialised: false,
  initialized: true,
  settingsMode: 'settings',
  boardRepo: '',
  boardShowDone: false,
  workspace: {
    name: 'Queue',
    mode: 'repo',
    layout: 'single-repo',
    view: 'list',
    design: 'jira',
    repos: [],
  },
};

export const $ = selector => document.querySelector(selector);

/**
 * Shows a short notification.
 * @param {string} message
 * @param {'info' | 'success' | 'error'} [tone]
 */
export function showToast(message, tone = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  $('#toasts').append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

/**
 * True when the event target is a text field, so keyboard shortcuts stay out of the way.
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
export function isTyping(target) {
  return (
    target instanceof HTMLElement &&
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}
