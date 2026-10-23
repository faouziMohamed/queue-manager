import {escapeHtml} from './html.util.js';

/** @typedef {import('../../shared/types.mjs').AppState} AppState */

/**
 * HTML for the state that replaces a view (forbidden, error, loading, uninitialized), or empty when the view can render.
 * @param {AppState} state
 * @returns {string}
 */
export function blockingPanel(state) {
  if (state.forbidden) {
    return statePanel(
      'i-lock',
      'Localhost only',
      'This queue is served on 127.0.0.1 and refuses non-local clients.',
      'forbidden',
    );
  }
  if (state.error) {
    return `${statePanel('i-alert', 'Could not load the queue', state.error, 'error')}
      <button class="btn" type="button" data-retry>Try again</button>`;
  }
  if (state.loading && state.tasks.length === 0) {
    return (
      '<div class="skeleton" aria-hidden="true">' +
      '<div class="skeleton-row"></div>'.repeat(5) +
      '</div>'
    );
  }
  if (!state.initialized) {
    return `<div class="state-panel">
      <svg class="icon" aria-hidden="true"><use href="#i-settings"/></svg>
      <h2>Initialize this folder</h2>
      <p>Create the queue files and record the project layout. This writes to .queue/ only.</p>
      <button class="btn primary" type="button" data-init>Initialize queue</button>
    </div>`;
  }
  return '';
}

function statePanel(icon, title, message, tone) {
  return `<div class="state-panel ${tone}">
    <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
  </div>`;
}
