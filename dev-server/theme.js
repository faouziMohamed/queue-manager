import {$, state} from './app-state.js'

export function initTheme({onChange}) {
  function apply(theme) {
    state.theme = theme
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
    try { localStorage.setItem('queue-theme', theme) } catch {}
    updateButton()
    onChange()
  }

  function updateButton() {
    const button = $('#theme-toggle')
    const dark = resolvedDark()
    button.innerHTML = `<svg class="icon"><use href="#${dark ? 'i-sun' : 'i-moon'}"/></svg>`
    const appearance = dark ? 'Dark' : 'Light'
    const source = state.theme === 'system' ? ' (follows system)' : ''
    button.setAttribute('aria-label', `Theme: ${appearance}${source}. Switch to ${dark ? 'light' : 'dark'}`)
    button.title = `Theme: ${appearance}${source}`
  }

  function toggle() {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const wantDark = !resolvedDark()
    if (wantDark === systemDark) apply('system')
    else apply(wantDark ? 'dark' : 'light')
  }

  $('#theme-toggle').addEventListener('click', toggle)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    updateButton()
    onChange()
  })
  apply(savedTheme())
}

function resolvedDark() {
  if (state.theme === 'dark') return true
  if (state.theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function savedTheme() {
  let saved = 'system'
  try { saved = localStorage.getItem('queue-theme') || 'system' } catch {}
  return ['system', 'light', 'dark'].includes(saved) ? saved : 'system'
}
