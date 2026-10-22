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
  error: '',
  forbidden: false,
  blockTarget: null,
  doneTarget: null,
  theme: 'system',
  initialised: false,
  initialized: true,
  settingsMode: 'settings',
  workspace: {name: 'Queue', mode: 'repo', layout: 'single-repo', repos: []},
}

export const $ = selector => document.querySelector(selector)

export function showToast(message, tone = 'info') {
  const toast = document.createElement('div')
  toast.className = `toast ${tone}`
  toast.textContent = message
  $('#toasts').append(toast)
  window.setTimeout(() => toast.remove(), 4200)
}

export function isTyping(target) {
  return target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}
