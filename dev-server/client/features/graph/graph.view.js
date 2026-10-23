import {escapeHtml} from '../../core/html.util.js';
import {loadCytoscape} from '../../core/vendor-loader.js';
import {applySearch, createGraph, zoomAroundCenter} from './graph-cytoscape.js';
import {statusKey, statusOrder, themeColors} from '../../core/status.util.js';

/** @typedef {import('../../../shared/types.mjs').AppState} AppState */

const options = {showDone: false, showIsolated: false, repo: ''};
const mounted = {cy: undefined, signature: '', container: undefined, token: 0};

/**
 * Destroys the mounted graph, if any.
 */
export function disposeGraph() {
  mounted.cy?.destroy();
  mounted.cy = undefined;
  mounted.signature = '';
  mounted.container = undefined;
}

/**
 * Renders the dependency graph view; reuses the mounted graph when nothing changed.
 * @param {AppState} state
 * @param {HTMLElement} container
 */
export function renderGraph(state, container) {
  const data = buildGraph(state.tasks);
  const colors = themeColors();
  const signature = JSON.stringify([
    data.nodes,
    data.edges,
    options,
    colors,
    state.workspace.mode,
  ]);
  if (
    signature === mounted.signature &&
    mounted.container === container &&
    container.querySelector('.graph')
  ) {
    applySearch(mounted.cy, state.query);
    return;
  }
  disposeGraph();
  mounted.signature = signature;
  mounted.container = container;
  const repos = [
    ...new Set(state.tasks.map(task => task.repo).filter(Boolean)),
  ].sort();
  container.innerHTML = `<div class="graph">
    <div class="graph-toolbar">
      <div class="graph-filters">
        ${state.workspace.mode === 'workspace' && repos.length > 0 ? repoSelect(repos) : ''}
        <label class="graph-check"><input type="checkbox" data-graph-option="showDone"${options.showDone ? ' checked' : ''}> Show done</label>
        <label class="graph-check"><input type="checkbox" data-graph-option="showIsolated"${options.showIsolated ? ' checked' : ''}> Tasks without dependencies</label>
      </div>
      <div class="graph-zoom" role="group" aria-label="Zoom">
        <button class="icon-button" type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out (−)"><svg class="icon"><use href="#i-minus"/></svg></button>
        <span class="graph-scale" aria-live="polite">100%</span>
        <button class="icon-button" type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)"><svg class="icon"><use href="#i-plus"/></svg></button>
        <button class="btn" type="button" data-zoom="fit" title="Fit to screen (0)">Fit</button>
        <button class="btn" type="button" data-zoom="reset" title="Actual size (1)">100%</button>
      </div>
    </div>
    <div class="graph-legend">${legend()}<span class="graph-hint">Scroll or pinch to zoom · drag to pan · click a task to open it</span></div>
    ${data.nodes.length === 0 ? emptyState(data.hiddenIsolated) : graphShell(data)}
  </div>`;
  if (data.nodes.length === 0) return;

  const token = ++mounted.token;
  const viewport = container.querySelector('.graph-viewport');
  loadCytoscape()
    .then(cytoscape => {
      if (token !== mounted.token || !viewport.isConnected) return;
      mounted.cy = createGraph(cytoscape, viewport, data, colors);
      applySearch(mounted.cy, state.query);
    })
    .catch(error => {
      viewport.innerHTML = `<div class="empty-state" role="alert">
        <h2>The graph could not load</h2><p>${escapeHtml(error.message)}</p>
        <button class="btn" type="button" data-zoom="retry">Retry</button>
      </div>`;
      mounted.signature = '';
    });
}

/**
 * Wires the graph toolbar, zoom buttons and keyboard shortcuts once.
 * @param {HTMLElement} container
 */
export function installGraph(container) {
  function rerender() {
    mounted.signature = '';
    container.dispatchEvent(new CustomEvent('queue-rerender', {bubbles: true}));
  }

  container.addEventListener('change', event => {
    const option = event.target.closest('[data-graph-option]');
    if (option) {
      options[option.dataset.graphOption] = option.checked;
      rerender();
      return;
    }
    const repo = event.target.closest('[data-graph-repo]');
    if (repo) {
      options.repo = repo.value;
      rerender();
    }
  });

  container.addEventListener('click', event => {
    const zoom = event.target.closest('[data-zoom]');
    if (!zoom) return;
    const action = zoom.dataset.zoom;
    if (action === 'show-isolated') {
      options.showIsolated = true;
      rerender();
      return;
    }
    if (action === 'retry') {
      rerender();
      return;
    }
    const cy = mounted.cy;
    if (!cy) return;
    if (action === 'in') zoomAroundCenter(cy, cy.zoom() * 1.25);
    if (action === 'out') zoomAroundCenter(cy, cy.zoom() * 0.8);
    if (action === 'fit') cy.animate({fit: {padding: 40}, duration: 200});
    if (action === 'reset') zoomAroundCenter(cy, 1);
  });

  container.addEventListener('keydown', event => {
    const cy = mounted.cy;
    if (!cy || !event.target.closest('.graph-viewport')) return;
    const actions = {
      '+': () => zoomAroundCenter(cy, cy.zoom() * 1.25),
      '=': () => zoomAroundCenter(cy, cy.zoom() * 1.25),
      '-': () => zoomAroundCenter(cy, cy.zoom() * 0.8),
      0: () => cy.fit(undefined, 40),
      1: () => zoomAroundCenter(cy, 1),
      ArrowLeft: () => cy.panBy({x: 60, y: 0}),
      ArrowRight: () => cy.panBy({x: -60, y: 0}),
      ArrowUp: () => cy.panBy({x: 0, y: 60}),
      ArrowDown: () => cy.panBy({x: 0, y: -60}),
    };
    if (!actions[event.key]) return;
    event.preventDefault();
    actions[event.key]();
  });
}

function buildGraph(tasks) {
  const candidates = tasks.filter(task => {
    if (!options.showDone && task.status === 'done') return false;
    if (options.repo && task.repo !== options.repo) return false;
    return true;
  });
  const included = new Set(candidates.map(task => task.id));
  const edges = [];
  for (const task of candidates) {
    for (const blocker of task.blockedBy) {
      if (included.has(blocker) && blocker !== task.id)
        edges.push([blocker, task.id]);
    }
  }
  const linked = new Set(edges.flat());
  const visible = candidates.filter(
    task => options.showIsolated || linked.has(task.id),
  );
  const nodes = visible.map(task => {
    const status = statusKey(task);
    const label = statusOrder.find(item => item.key === status).label;
    return {
      id: task.id,
      title: task.title,
      status,
      repo: task.repo,
      subtitle: [label, `P${task.priority}`].join(' · '),
    };
  });
  return {
    nodes,
    edges,
    hiddenIsolated: options.showIsolated
      ? 0
      : candidates.length - visible.length,
  };
}

function graphShell(data) {
  const items = data.nodes
    .map(
      node =>
        `<li><button type="button" data-open="${escapeHtml(node.id)}">${escapeHtml(`${node.id} ${node.title} (${[node.subtitle, node.repo].filter(Boolean).join(' · ')})`)}</button></li>`,
    )
    .join('');
  return `<div class="graph-viewport" tabindex="0" aria-label="Dependency graph of ${data.nodes.length} tasks. Plus and minus zoom, arrow keys pan, 0 fits.">
    <div class="graph-canvas"></div>
  </div>
  <ul class="sr-only" aria-label="Tasks in the graph">${items}</ul>`;
}

function emptyState(hidden) {
  const action =
    hidden > 0
      ? `<button class="btn primary" type="button" data-zoom="show-isolated">Show ${hidden} task${hidden === 1 ? '' : 's'} without dependencies</button>`
      : '';
  return `<div class="empty-state graph-empty">
    <svg class="icon" aria-hidden="true"><use href="#i-graph"/></svg>
    <h2>No dependencies to draw</h2>
    <p>No task in this filter is blocked by another. Arrows run from a blocker to the task it holds back.</p>
    ${action}
  </div>`;
}

function repoSelect(repos) {
  const choices = [
    '<option value="">All repositories</option>',
    ...repos.map(repo => {
      const selected = repo === options.repo ? ' selected' : '';
      return `<option value="${escapeHtml(repo)}"${selected}>${escapeHtml(repo)}</option>`;
    }),
  ];
  return `<label class="graph-select"><span class="sr-only">Repository</span><select data-graph-repo>${choices.join('')}</select></label>`;
}

function legend() {
  return statusOrder
    .map(
      status =>
        `<span class="legend-chip"><span class="legend-swatch" style="background:var(${status.token})"></span>${escapeHtml(status.label)}</span>`,
    )
    .join('');
}
