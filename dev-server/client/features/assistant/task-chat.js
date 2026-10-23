import {escapeHtml} from '../../core/html.util.js';
import {relativeTime} from '../../core/time.util.js';
import {fetchAgent} from './agent.service.js';
import {
  agentLabel,
  firstAvailable,
  providerShort,
} from './agent-providers.util.js';
import {createChatThread} from './chat-thread.js';
import {fetchChat, fetchTaskDiscussions} from './chats.service.js';
import {SOURCE_LABELS} from './session-messages.view.js';
import {createSessionViewer} from './session-viewer.js';
import {taskChatTemplate} from './task-chat.template.js';

/** @typedef {import('../../../shared/types.mjs').Task} Task */

const COLLAPSED_ROWS = 5;

/**
 * Wires the Discussions panel on the task page: clarify chat, linked chats and agent sessions.
 * @param {{showToast: (message: string, tone?: string) => void, reloadTask: (id: string) => Promise<void>, hasUnsavedEdits: () => boolean, openSettings: () => void}} options
 * @returns {{setTask: (task: Task | null) => Promise<void>, refresh: () => Promise<void>}}
 */
export function initTaskChat({
  showToast,
  reloadTask,
  hasUnsavedEdits,
  openSettings,
}) {
  const root = document.querySelector(
    '#task-page-detail [data-detail="chat-slot"]',
  );
  root.innerHTML = taskChatTemplate();
  const element = name => root.querySelector(`[data-chat="${name}"]`);
  const view = {
    task: null,
    chats: [],
    sessions: [],
    sessionsEnabled: true,
    status: 'idle',
    error: '',
    expanded: false,
    agent: {config: undefined, available: undefined},
    request: 0,
  };
  const viewer = createSessionViewer({
    viewer: element('viewer'),
    showToast,
    currentTaskId: () => view.task?.id || '',
  });

  const chat = createChatThread({
    messagesElement: element('messages'),
    emptyElement: element('empty'),
    form: element('form'),
    input: element('input'),
    status: element('status'),
    showToast,
    request: () => ({taskId: view.task?.id, mode: 'clarify'}),
    agentLabel: agent =>
      agentLabel(agent, view.agent.config, view.agent.available),
    failedAgent: () => {
      const config = view.agent.config || {provider: 'auto', model: ''};
      const provider =
        config.provider === 'auto'
          ? firstAvailable(view.agent.available)
          : config.provider;
      return {provider, model: config.model || ''};
    },
    chatMeta: () => ({taskId: view.task?.id}),
    onSaved: summary => {
      if (!summary?.id || summary.taskId !== view.task?.id) return;
      view.chats = [
        {...summary, linked: true},
        ...view.chats.filter(item => item.id !== summary.id),
      ];
      renderList();
    },
    onApplied: proposal => reloadTask(proposal.task_id),
    canApply: () => {
      if (!hasUnsavedEdits()) return true;
      showToast(
        'Save or cancel your body edits before applying a chat update.',
        'error',
      );
      return false;
    },
  });

  async function setTask(task) {
    if (!task) {
      view.task = null;
      return;
    }
    const switching = view.task?.id !== task.id;
    view.task = task;
    element('task-id').textContent = task.id;
    if (!switching) return;
    chat.reset();
    view.expanded = false;
    refreshAgent();
    await loadDiscussions({openLatest: true});
  }

  async function loadDiscussions({openLatest = false} = {}) {
    if (!view.task) return;
    const request = ++view.request;
    const taskId = view.task.id;
    view.status = 'loading';
    renderList();
    try {
      const payload = await fetchTaskDiscussions(taskId);
      if (request !== view.request) return;
      view.chats = Array.isArray(payload.chats) ? payload.chats : [];
      view.sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      view.sessionsEnabled = payload.sessionsEnabled !== false;
      view.status = 'ready';
      renderList();
      const latest = view.chats.find(item => item.linked);
      if (openLatest && latest && !chat.chatId && chat.messages.length === 0)
        await openChat(latest.id);
    } catch (error) {
      if (request !== view.request) return;
      view.status = 'error';
      view.error = error.message;
      renderList();
    }
  }

  async function openChat(id) {
    if (chat.refuseWhileBusy()) return;
    try {
      chat.load(await fetchChat(id));
      renderList();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function newDiscussion() {
    if (chat.refuseWhileBusy()) return;
    chat.reset();
    renderList();
    element('input').focus();
  }

  async function refreshAgent() {
    try {
      const payload = await fetchAgent();
      view.agent = {config: payload.config, available: payload.available};
      const config = payload.config || {provider: 'auto', model: ''};
      const resolved =
        config.provider === 'auto'
          ? firstAvailable(payload.available)
          : config.provider;
      element('provider').textContent = resolved
        ? providerShort(resolved)
        : 'No assistant configured';
      element('model').textContent = config.model || 'default model';
      element('dot').classList.toggle('warn', !resolved);
    } catch {
      element('provider').textContent = 'Assistant unavailable';
      element('dot').classList.add('warn');
    }
  }

  function rows() {
    const chatRows = view.chats.map(item => ({
      kind: 'chat',
      source: item.linked ? 'clarify' : 'assistant',
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      detail: `${item.messageCount} message${item.messageCount === 1 ? '' : 's'}`,
    }));
    const sessionRows = view.sessions.map(item => ({
      kind: 'session',
      source: item.tool,
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      detail: `mentions ${view.task?.id} ×${item.mentionCount}`,
    }));
    return [...chatRows, ...sessionRows].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  }

  function renderList() {
    const list = element('list');
    const count = element('count');
    if (
      view.status === 'loading' &&
      view.chats.length + view.sessions.length === 0
    ) {
      count.textContent = '';
      list.innerHTML =
        '<p class="discussion-state" role="status">Loading discussions…</p>';
      return;
    }
    if (view.status === 'error') {
      count.textContent = '';
      list.innerHTML = `<div class="discussion-state" role="alert">Discussions could not load: ${escapeHtml(view.error)}
        <button class="btn" type="button" data-chat-retry>Retry</button></div>`;
      return;
    }
    const all = rows();
    count.textContent = all.length ? String(all.length) : '';
    if (all.length === 0) {
      const note = view.sessionsEnabled
        ? ''
        : ' Agent session lookup is off (QUEUE_AGENT_SESSIONS=off).';
      list.innerHTML = `<p class="discussion-state">No discussion mentions ${escapeHtml(view.task?.id || 'this task')} yet. Start one below.${note}</p>`;
      return;
    }
    const visible = view.expanded ? all : all.slice(0, COLLAPSED_ROWS);
    const more =
      all.length > COLLAPSED_ROWS
        ? `<button class="link-button discussion-more" type="button" data-chat-expand>${view.expanded ? 'Show fewer' : `Show all ${all.length}`}</button>`
        : '';
    list.innerHTML = `<ul class="discussion-list">${visible.map(rowHtml).join('')}</ul>${more}`;
  }

  function rowHtml(row) {
    const current = row.kind === 'chat' && row.id === chat.chatId;
    const action =
      row.kind === 'chat'
        ? `data-open-discussion="${escapeHtml(row.id)}"`
        : `data-open-session="${escapeHtml(row.source)}:${escapeHtml(row.id)}"`;
    const hint = hintFor(row, current);
    return `<li><button class="discussion-row${current ? ' current' : ''}" type="button" ${action}${current ? ' aria-current="true"' : ''}>
      <span class="discussion-source source-${row.source}">${SOURCE_LABELS[row.source]}</span>
      <span class="discussion-title">${escapeHtml(row.title)}</span>
      <span class="discussion-meta">${escapeHtml(`${row.detail} · ${relativeTime(row.updatedAt)}`)}</span>
      <span class="discussion-hint">${hint}</span>
    </button></li>`;
  }

  root.addEventListener('click', event => {
    if (event.target.closest('[data-chat="new"]')) {
      newDiscussion();
      return;
    }
    if (event.target.closest('[data-chat-retry]')) {
      loadDiscussions();
      return;
    }
    if (event.target.closest('[data-chat-expand]')) {
      view.expanded = !view.expanded;
      renderList();
      return;
    }
    if (event.target.closest('[data-chat="settings"]')) {
      openSettings();
      return;
    }
    const discussion = event.target.closest('[data-open-discussion]');
    if (discussion) {
      if (aiEnabled()) openChat(discussion.dataset.openDiscussion);
      else viewer.openChat(discussion.dataset.openDiscussion);
      return;
    }
    const session = event.target.closest('[data-open-session]');
    if (session) {
      const [tool, id] = session.dataset.openSession.split(':');
      viewer.openSession(tool, id);
    }
  });

  window.addEventListener('queue-agent-config-changed', refreshAgent);
  return {setTask, refresh: () => loadDiscussions()};
}

function aiEnabled() {
  return document.documentElement.dataset.ai === 'on';
}

function hintFor(row, current) {
  if (row.kind !== 'chat') return 'Read-only · resume in terminal';
  if (!aiEnabled()) return 'Read-only';
  return current ? 'Open below' : 'Continue here';
}
