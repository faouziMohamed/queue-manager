import {escapeHtml} from '../../core/html.util.js';
import {themeColors} from '../../core/status.util.js';
import {loadECharts} from '../../core/vendor-loader.js';
import {
  blockingList,
  chartCard,
  countByStatus,
  kpiTiles,
  listCard,
  staleList,
} from './insight-cards.view.js';
import {
  priorityRows,
  repositoryRows,
  shippedOption,
  stackedOption,
  statusOption,
  WEEKS,
} from './insight-charts.js';

/** @typedef {import('../../../shared/types.mjs').AppState} AppState */

const charts = [];
let renderedSignature = '';
let renderToken = 0;

/**
 * Disposes the mounted charts and their resize observers.
 */
export function disposeInsights() {
  while (charts.length > 0) {
    const {chart, observer} = charts.pop();
    observer.disconnect();
    chart.dispose();
  }
  renderedSignature = '';
}

/**
 * Renders the Insights view; skips the work when tasks and theme are unchanged.
 * @param {AppState} state
 * @param {HTMLElement} container
 */
export function renderInsights(state, container) {
  const colors = themeColors();
  const signature = JSON.stringify([
    state.tasks.map(task => [
      task.id,
      task.status,
      task.priority,
      task.repo,
      task.updated,
      task.shipped,
      task.awaitingProduction,
      task.blockedBy,
    ]),
    state.workspace.mode,
    colors,
  ]);
  if (signature === renderedSignature && container.querySelector('.insights'))
    return;
  disposeInsights();
  renderedSignature = signature;

  if (state.tasks.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg class="icon" aria-hidden="true"><use href="#i-chart"/></svg>
      <h2>No tasks to chart yet</h2>
      <p>Insights appear once the queue has tasks.</p>
      <button class="btn primary" type="button" data-new-task>New task</button>
    </div>`;
    return;
  }

  const open = state.tasks.filter(task => task.status !== 'done');
  const done = state.tasks.filter(task => task.status === 'done');
  const counts = countByStatus(state.tasks);
  const showRepos = state.workspace.mode === 'workspace';
  container.innerHTML = `<div class="insights">
    ${kpiTiles(counts, open.length, done)}
    <div class="chart-grid">
      ${chartCard('status', 'Open work by status', 'Click a slice to open that list.')}
      ${chartCard('shipped', 'Shipped per week', `Last ${WEEKS} weeks, by shipped date.`)}
      ${chartCard('priority', 'Open work by priority', 'Each bar splits a priority by status.')}
      ${showRepos ? chartCard('repos', 'Open work by repository', 'Top repositories by open tasks.') : ''}
      ${listCard('Most blocking', 'Open tasks that hold back the most other open tasks.', blockingList(state.tasks))}
      ${listCard('Longest untouched', 'Open tasks with the oldest update date.', staleList(open))}
    </div>
  </div>`;

  const token = ++renderToken;
  loadECharts()
    .then(echarts => {
      if (token !== renderToken || !container.isConnected) return;
      const options = {
        status: statusOption(counts, open.length, colors),
        shipped: shippedOption(done, colors),
        priority: stackedOption(priorityRows(open), colors),
      };
      if (showRepos)
        options.repos = stackedOption(repositoryRows(open), colors);
      for (const [name, option] of Object.entries(options))
        mount(echarts, container, name, option);
    })
    .catch(error => {
      for (const element of container.querySelectorAll('.chart-canvas')) {
        element.innerHTML = `<div class="chart-empty" role="alert">Charts could not load: ${escapeHtml(error.message)}
          <button class="btn" type="button" data-retry-charts>Retry</button></div>`;
      }
      renderedSignature = '';
    });
}

function mount(echarts, container, name, option) {
  const element = container.querySelector(`[data-chart="${name}"]`);
  if (!element) return;
  if (!option) {
    element.innerHTML = '<p class="chart-empty">Nothing to show yet.</p>';
    return;
  }
  const chart = echarts.init(element, null, {renderer: 'svg'});
  chart.setOption({
    aria: {enabled: true},
    animationDuration: 400,
    textStyle: {fontFamily: getComputedStyle(document.body).fontFamily},
    ...option,
  });
  chart.on('click', params => {
    const section = params.data?.section || params.seriesId;
    if (section)
      element.dispatchEvent(
        new CustomEvent('queue-set-section', {bubbles: true, detail: section}),
      );
  });
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(element);
  charts.push({chart, observer});
}
