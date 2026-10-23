/** @typedef {import('../../../shared/types.mjs').TaskRecord} TaskRecord */
/** @typedef {import('../../../shared/types.mjs').Workspace} Workspace */

const layouts = ['workspace', 'monorepo', 'single-repo'];
const providers = [
  'auto',
  'claude-cli',
  'claude-api',
  'codex-cli',
  'codex-api',
  'deepseek-cli',
  'deepseek',
];

/**
 * Validated settings with defaults; unknown values fall back safely.
 * @param {Record<string, any>} input
 * @param {string} [fallbackName]
 * @returns {Workspace}
 */
export function normalizeWorkspaceConfig(input, fallbackName) {
  const name =
    String(input.name || fallbackName || 'Queue')
      .trim()
      .slice(0, 80) || 'Queue';
  const layout = layouts.includes(input.layout) ? input.layout : 'single-repo';
  const {view, design} = normalizePreferences(input);
  const repos =
    layout === 'single-repo'
      ? []
      : [
          ...new Set(
            (Array.isArray(input.repos) ? input.repos : [])
              .map(value => String(value).trim())
              .filter(Boolean),
          ),
        ].slice(0, 100);
  const wipLimit = Math.min(
    Math.max(Number.parseInt(input.wipLimit, 10) || 1, 1),
    20,
  );
  const agentInput =
    input.agent && typeof input.agent === 'object' ? input.agent : {};
  const agent = {
    provider: providers.includes(agentInput.provider)
      ? agentInput.provider
      : 'auto',
    model: String(agentInput.model || '')
      .trim()
      .slice(0, 80),
  };
  return {
    version: 1,
    name,
    layout,
    mode: modeFor(layout),
    view,
    design,
    wipLimit,
    repos,
    agent,
  };
}

/**
 * Validated display preferences.
 * @param {Record<string, any>} input
 * @returns {Pick<Workspace, 'view' | 'design'>}
 */
export function normalizePreferences(input) {
  return {
    view: ['list', 'board'].includes(input.view) ? input.view : 'list',
    design: ['jira', 'classic'].includes(input.design) ? input.design : 'jira',
  };
}

/**
 * Whether repository chips apply to a layout.
 * @param {Workspace['layout']} layout
 * @returns {Workspace['mode']}
 */
export function modeFor(layout) {
  return layout === 'single-repo' ? 'repo' : 'workspace';
}

/**
 * Task with its repository resolved from frontmatter or a `[repo]` title prefix.
 * @param {TaskRecord} task
 * @param {Workspace} workspace
 * @returns {TaskRecord}
 */
export function withWorkspaceIdentity(task, workspace) {
  const match = task.title.match(/^\[([^\]]+)\]\s*(.+)$/);
  let repo = task.sourceRepository;
  let title = task.title;
  if (match && !repo && workspace.repos.includes(match[1])) repo = match[1];
  if (match && repo && match[1] === repo) title = match[2];
  return {
    ...task,
    title,
    repo: workspace.mode === 'workspace' ? repo : '',
  };
}
