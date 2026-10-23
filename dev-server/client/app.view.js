import {PAGES} from '../shared/routes.constant.mjs';
import {escapeHtml} from './core/html.util.js';
import {blockingPanel} from './core/state-panel.view.js';
import {disposeGraph, renderGraph} from './features/graph/graph.view.js';
import {
  disposeInsights,
  renderInsights,
} from './features/insights/insights.view.js';
import {
  disposePitfalls,
  renderPitfalls,
} from './features/pitfalls/pitfalls.view.js';
import {renderBoard} from './features/tasks/board.view.js';
import {countTasks, renderList} from './features/tasks/task-list.view.js';

/** @typedef {import('../shared/types.mjs').AppState} AppState */

const sections = [
  {id: 'board', label: 'Board', icon: 'i-board', view: true},
  {
    id: 'in-progress',
    label: 'In progress',
    icon: 'i-play',
    emptyTitle: 'No task is running',
    empty: 'Nothing is being processed right now.',
  },
  {
    id: 'ready',
    label: 'Ready',
    icon: 'i-inbox',
    emptyTitle: 'The ready queue is empty',
    empty: 'Create a task, or unblock a dependency.',
  },
  {
    id: 'blocked',
    label: 'Blocked',
    icon: 'i-block',
    emptyTitle: 'Nothing is blocked',
    empty: 'No task is waiting on another.',
  },
  {
    id: 'on-hold',
    label: 'On hold',
    icon: 'i-pause',
    emptyTitle: 'Nothing is on hold',
    empty: 'No task is paused right now.',
  },
  {
    id: 'awaiting',
    label: 'Awaiting production',
    icon: 'i-gate',
    emptyTitle: 'No production waits',
    empty: 'No task is parked behind the production gate.',
  },
  {
    id: 'done',
    label: 'Done',
    icon: 'i-check',
    emptyTitle: 'No completed records',
    empty: 'Closed tasks are kept here, out of the main queue.',
  },
  {id: 'pitfalls', label: 'Pitfalls', icon: 'i-alert', view: true},
  {id: 'insights', label: 'Insights', icon: 'i-chart', view: true},
  {id: 'graph', label: 'Dependency graph', icon: 'i-graph', view: true},
];

const $ = selector => document.querySelector(selector);
const listSectionIds = [
  'in-progress',
  'ready',
  'blocked',
  'on-hold',
  'awaiting',
  'done',
];
const statusTokens = {
  'in-progress': '--status-in-progress',
  ready: '--status-ready',
  blocked: '--status-blocked',
  'on-hold': '--status-on-hold',
  awaiting: '--status-awaiting',
  done: '--status-done',
};
const tabs = [
  ['board', 'Board', 'i-board', 'board'],
  ['list', 'List', 'i-inbox', 'ready'],
  ['insights', 'Insights', 'i-chart', 'insights'],
  ['pitfalls', 'Pitfalls', 'i-alert', 'pitfalls'],
  ['graph', 'Graph', 'i-graph', 'graph'],
];

/**
 * Renders the app shell for the current section: header, tabs, sidebar and the list or view.
 * @param {AppState} state
 */
export function render(state) {
  const section =
    sections.find(item => item.id === state.section) || sections[0];
  const onTaskPage = state.view === 'task';
  const isView = Boolean(section.view) && !onTaskPage;
  const design = state.workspace.design === 'classic' ? 'classic' : 'jira';
  document.body.classList.toggle('design-jira', design === 'jira');
  document.body.classList.toggle('design-classic', design === 'classic');
  document.body.classList.toggle(
    'board-view',
    section.id === 'board' && !onTaskPage,
  );
  renderAppHeader(state, onTaskPage);
  renderListNav(state, isView, onTaskPage);
  $('#section-title').textContent = onTaskPage
    ? state.pageTaskId || 'Task'
    : section.label;
  renderSidebar(state);
  $('#task-list').hidden = isView || onTaskPage;
  $('#view-root').hidden = !isView;
  $('#task-page').hidden = !onTaskPage;
  $('#status-strip').hidden = !(
    state.loading ||
    state.error ||
    state.forbidden ||
    !state.initialized
  );
  if (onTaskPage) {
    disposeViews();
  } else if (isView) {
    renderView(state, section);
  } else {
    disposeViews();
    renderList(state, section);
  }
  const strip = $('#status-strip');
  if (!state.initialized && !state.loading)
    strip.textContent = 'Queue not initialized';
  else if (state.loading && state.tasks.length > 0)
    strip.textContent = 'Refreshing queue…';
  else strip.textContent = '';
}

/**
 * Writes the project name and layout label into the page header and title.
 * @param {AppState} state
 */
export function applyWorkspaceHeader(state) {
  const workspace = state.workspace;
  const name = workspace.name || 'Queue';
  let modeLabel = 'Repository queue';
  if (workspace.layout === 'monorepo') modeLabel = 'Monorepo queue';
  else if (workspace.layout === 'workspace') modeLabel = 'Workspace queue';
  if (state.view !== 'task') document.title = `Queue · ${name}`;
  $('#brand-mark').textContent = name.slice(0, 1).toUpperCase();
  $('#brand-name').textContent = name;
  $('#brand-subtitle').textContent = modeLabel;
  $('#queue-mode').textContent = modeLabel;
}

/**
 * Human label of a section id, defaulting to "In progress".
 * @param {string} id
 * @returns {string}
 */
export function sectionLabel(id) {
  return (sections.find(section => section.id === id) || sections[1]).label;
}

function activeTab(state, onTaskPage) {
  const activeSection =
    onTaskPage && state.returnSection ? state.returnSection : state.section;
  if (activeSection === 'board') return 'board';
  return listSectionIds.includes(activeSection) ? 'list' : activeSection;
}

function renderAppHeader(state, onTaskPage) {
  const project = state.workspace.name || 'Queue';
  const active = activeTab(state, onTaskPage);
  const gate = state.tasks.find(task => task.prodGate);
  const open = state.tasks.filter(task => task.status !== 'done').length;
  const done = state.tasks.filter(task => task.status === 'done').length;
  $('#app-header').innerHTML = `<div class="app-project">
      <span class="app-project-mark" aria-hidden="true">${escapeHtml(project.trim()[0]?.toUpperCase() || 'Q')}</span>
      <div class="app-project-copy">
        <span class="app-project-space">Spaces / Workspace queue</span>
        <h2 class="app-project-name">${escapeHtml(projectLabel(project))}</h2>
      </div>
      <div class="app-project-side">
        ${gate ? `<a class="app-gate" href="${PAGES.section('awaiting')}" title="${escapeHtml(`${gate.id} · ${gate.title}`)}">Gate ${escapeHtml(gate.id)}</a>` : ''}
        <span class="app-counts">${open} open · ${done} done</span>
      </div>
    </div>
    <nav class="app-tabs" aria-label="Queue views">
      ${tabs
        .map(
          ([
            id,
            label,
            icon,
            section,
          ]) => `<a class="app-tab${active === id ? ' is-active' : ''}" href="${PAGES.section(section)}"${active === id ? ' aria-current="page"' : ''}>
        <svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg>${label}
      </a>`,
        )
        .join('')}
    </nav>`;
}

function renderListNav(state, isView, onTaskPage) {
  const nav = $('#list-nav');
  if (isView || onTaskPage) {
    nav.hidden = true;
    nav.innerHTML = '';
    return;
  }
  nav.hidden = false;
  nav.innerHTML = listSectionIds
    .map(id => {
      const entry = sections.find(item => item.id === id);
      const active = state.section === id;
      return `<a class="list-tab${active ? ' is-active' : ''}" href="${PAGES.section(id)}"${active ? ' aria-current="page"' : ''}>
      <span class="list-tab-dot" style="--list-dot:var(${statusTokens[id]})"></span>
      <span>${entry.label}</span>
      <span class="list-tab-count">${countTasks(state, id)}</span>
    </a>`;
    })
    .join('');
}

function renderSidebar(state) {
  const counts = Object.fromEntries(
    sections.map(section => [
      section.id,
      section.view ? '' : countTasks(state, section.id),
    ]),
  );
  const items = sections.map(section => {
    if (
      section.id === 'in-progress' ||
      section.id === 'done' ||
      section.id === 'pitfalls'
    ) {
      return `<div class="section-separator"></div>${sectionButton(state, section, counts[section.id])}`;
    }
    return sectionButton(state, section, counts[section.id]);
  });
  $('#sections').innerHTML = items.join('');

  const gateTasks = state.tasks.filter(task => task.prodGate);
  const gateCard = $('#gate-card');
  if (gateTasks.length === 0) {
    gateCard.hidden = true;
    return;
  }
  const gate = gateTasks[0];
  gateCard.hidden = false;
  gateCard.innerHTML = `
    <p class="eyebrow">Production gate</p>
    <strong>${escapeHtml(gate.id)} · ${escapeHtml(gate.title)}</strong>
    <p>Production work stays parked until this gate clears.</p>
    <button class="gate-link" type="button" data-section="awaiting">View waiting tasks</button>`;
}

function sectionButton(state, section, count) {
  const current = section.id === state.section ? ' aria-current="page"' : '';
  return `<button class="section-button" type="button" data-section="${section.id}"${current}>
    <svg class="icon" aria-hidden="true"><use href="#${section.icon}"/></svg>
    <span class="label">${section.label}</span>
    ${section.view ? '' : `<span class="section-count">${count}</span>`}
  </button>`;
}

function renderView(state, section) {
  const root = $('#view-root');
  root.setAttribute('aria-busy', state.loading ? 'true' : 'false');
  const panel = blockingPanel(state);
  if (panel) {
    disposeViews();
    root.innerHTML = panel;
    return;
  }
  if (section.id === 'board') {
    disposeViews();
    renderBoard(state, root);
  } else if (section.id === 'pitfalls') {
    disposeInsights();
    disposeGraph();
    renderPitfalls(state, root);
  } else if (section.id === 'insights') {
    disposeGraph();
    disposePitfalls();
    renderInsights(state, root);
  } else {
    disposeInsights();
    disposePitfalls();
    renderGraph(state, root);
  }
}

function disposeViews() {
  disposeInsights();
  disposeGraph();
  disposePitfalls();
}

function projectLabel(name) {
  return String(name || 'Queue')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}
