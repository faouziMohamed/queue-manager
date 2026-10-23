import {statusOrder} from '../../core/status.util.js';

/**
 * Mounts the dependency graph with a left-to-right dagre layout, hover highlighting and click-to-open.
 * @param {any} cytoscape The Cytoscape factory.
 * @param {HTMLElement} viewport
 * @param {{nodes: object[], edges: [string, string][]}} data
 * @param {Record<string, string>} colors From `themeColors()`.
 * @returns {any} The Cytoscape instance.
 */
export function createGraph(cytoscape, viewport, data, colors) {
  const cy = cytoscape({
    container: viewport.querySelector('.graph-canvas'),
    minZoom: 0.15,
    maxZoom: 3,
    boxSelectionEnabled: false,
    autoungrabify: true,
    elements: [
      ...data.nodes.map(node => ({
        data: {
          id: node.id,
          label: `${node.id}  ·  ${node.subtitle}\n${truncate(node.title, 34)}`,
          search: `${node.id} ${node.title} ${node.repo}`.toLowerCase(),
          status: node.status,
        },
      })),
      ...data.edges.map(([from, to]) => ({
        data: {id: `${from}->${to}`, source: from, target: to},
      })),
    ],
    style: graphStyle(colors),
    layout: {
      name: 'dagre',
      rankDir: 'LR',
      nodeSep: 18,
      rankSep: 90,
      edgeSep: 10,
      padding: 40,
      fit: true,
    },
  });

  const scaleLabel = viewport.closest('.graph').querySelector('.graph-scale');
  function updateScale() {
    scaleLabel.textContent = `${Math.round(cy.zoom() * 100)}%`;
  }
  cy.on('zoom', updateScale);
  updateScale();

  cy.on('tap', 'node', event => {
    viewport.dispatchEvent(
      new CustomEvent('queue-open-task', {
        bubbles: true,
        detail: event.target.id(),
      }),
    );
  });
  cy.on('mouseover', 'node', event => {
    const node = event.target;
    const related = node.predecessors().union(node.successors()).union(node);
    cy.elements().addClass('dimmed');
    related.removeClass('dimmed').addClass('related');
    viewport.classList.add('pointing');
  });
  cy.on('mouseout', 'node', () => {
    cy.elements().removeClass('dimmed related');
    viewport.classList.remove('pointing');
  });
  return cy;
}

function graphStyle(colors) {
  const statusStyles = statusOrder.map(status => ({
    selector: `node[status = "${status.key}"]`,
    style: {'border-color': colors[status.key]},
  }));
  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        width: 240,
        height: 52,
        'background-color': colors.surface,
        'border-width': 2,
        'border-color': colors.line,
        label: 'data(label)',
        color: colors.ink,
        'font-size': 12,
        'font-family': getComputedStyle(document.body).fontFamily,
        'text-wrap': 'wrap',
        'text-max-width': 220,
        'text-valign': 'center',
        'text-halign': 'center',
        'line-height': 1.45,
      },
    },
    ...statusStyles,
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'curve-style': 'taxi',
        'taxi-direction': 'rightward',
        'taxi-turn': 40,
        'line-color': colors.faint,
        'target-arrow-color': colors.faint,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
      },
    },
    {selector: '.dimmed', style: {opacity: 0.18}},
    {
      selector: 'edge.related',
      style: {
        'line-color': colors.brand,
        'target-arrow-color': colors.brand,
        width: 2.5,
      },
    },
    {selector: 'node.related', style: {'border-width': 3}},
    {selector: '.faded', style: {opacity: 0.25}},
    {
      selector: 'node.match',
      style: {'border-width': 4, 'border-color': colors.brand},
    },
  ];
}

/**
 * Fades nodes that do not match the search and outlines the ones that do.
 * @param {any} cy
 * @param {string} query
 */
export function applySearch(cy, query) {
  if (!cy) return;
  const term = String(query || '')
    .trim()
    .toLowerCase();
  cy.elements().removeClass('faded match');
  if (!term) return;
  const matches = cy.nodes().filter(node => node.data('search').includes(term));
  cy.elements().not(matches).addClass('faded');
  matches.addClass('match');
}

/**
 * Animates the zoom to a level, kept within the graph limits, around the viewport center.
 * @param {any} cy
 * @param {number} level
 */
export function zoomAroundCenter(cy, level) {
  cy.animate({
    zoom: {
      level: Math.min(cy.maxZoom(), Math.max(cy.minZoom(), level)),
      renderedPosition: {x: cy.width() / 2, y: cy.height() / 2},
    },
    duration: 150,
  });
}

function truncate(value, length) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
