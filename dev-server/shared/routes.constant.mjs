export const SECTION_IDS = [
  'board',
  'in-progress',
  'ready',
  'blocked',
  'on-hold',
  'awaiting',
  'done',
  'pitfalls',
  'insights',
  'graph',
];

export const TASK_ID_PATTERN = /^Q-\d{4,}$/;

export const PAGE_ROUTES = {
  home: '/',
  section: '/:section',
  task: '/tasks/:taskId',
};

export const API_ROUTES = {
  config: '/api/config',
  init: '/api/init',
  agent: '/api/agent',
  agentConfig: '/api/agent/config',
  agentChat: '/api/agent/chat',
  chats: '/api/chats',
  chatsImport: '/api/chats/import',
  chat: '/api/chats/:chatId',
  tasks: '/api/tasks',
  task: '/api/tasks/:taskId',
  taskAction: '/api/tasks/:taskId/action',
  taskBody: '/api/tasks/:taskId/body',
  taskDiscussions: '/api/tasks/:taskId/discussions',
  pitfalls: '/api/pitfalls',
  session: '/api/sessions/:tool/:sessionId',
};

export const ENDPOINTS = {
  config: API_ROUTES.config,
  init: API_ROUTES.init,
  agent: {
    root: API_ROUTES.agent,
    config: API_ROUTES.agentConfig,
    chat: API_ROUTES.agentChat,
  },
  chats: {
    list: query => withQuery(API_ROUTES.chats, query),
    import: API_ROUTES.chatsImport,
    byId: chatId => buildPath(API_ROUTES.chat, {chatId}),
  },
  tasks: {
    root: API_ROUTES.tasks,
    byId: taskId => buildPath(API_ROUTES.task, {taskId}),
    action: taskId => buildPath(API_ROUTES.taskAction, {taskId}),
    body: taskId => buildPath(API_ROUTES.taskBody, {taskId}),
    discussions: taskId => buildPath(API_ROUTES.taskDiscussions, {taskId}),
  },
  pitfalls: API_ROUTES.pitfalls,
  sessions: {
    byId: (tool, sessionId) => buildPath(API_ROUTES.session, {tool, sessionId}),
  },
};

export const PAGES = {
  section: section => buildPath(PAGE_ROUTES.section, {section}),
  task: taskId => buildPath(PAGE_ROUTES.task, {taskId}),
};

/**
 * Fills `:name` placeholders of a route template with URL-encoded values.
 * @param {string} template
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function buildPath(template, params = {}) {
  return template.replace(/:([A-Za-z]+)/g, (_, name) =>
    encodeURIComponent(String(params[name] ?? '')),
  );
}

function withQuery(path, query = {}) {
  const entries = Object.entries(query).filter(([, value]) => value);
  if (entries.length === 0) return path;
  return `${path}?${new URLSearchParams(entries).toString()}`;
}
