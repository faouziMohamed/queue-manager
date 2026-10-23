import {escapeHtml} from '../../core/html.util.js';
import {relativeTime} from '../../core/time.util.js';
import {providerShort} from './agent-providers.util.js';
import {deleteChat, listChats} from './chats.service.js';

/** @typedef {import('../../../shared/types.mjs').ChatSummary} ChatSummary */

const DAY_MS = 86_400_000;

/**
 * Drives the chat history panel: search, grouping by date, open and two-step delete.
 * @param {{toggle: HTMLElement, panel: HTMLElement, search: HTMLInputElement, list: HTMLElement, count: HTMLElement, showToast: (message: string, tone?: string) => void, currentChatId: () => string | undefined, onOpen: (id: string) => void, onDeleted: (id: string) => void}} options
 * @returns {{load: () => Promise<void>, upsert: (summary: ChatSummary) => void, forget: (id: string) => void, open: () => void, close: () => void, isOpen: () => boolean}}
 */
export function createChatHistory({
  toggle,
  panel,
  search,
  list,
  count,
  showToast,
  currentChatId,
  onOpen,
  onDeleted,
}) {
  const state = {
    chats: [],
    status: 'idle',
    error: '',
    request: 0,
    searchTimer: undefined,
    pendingDelete: undefined,
    pendingDeleteTimer: undefined,
  };

  async function load() {
    const request = ++state.request;
    const query = search.value.trim();
    state.status = 'loading';
    render();
    try {
      const payload = await listChats(query);
      if (request !== state.request) return;
      state.chats = Array.isArray(payload.chats) ? payload.chats : [];
      state.status = 'ready';
    } catch (error) {
      if (request !== state.request) return;
      state.status = 'error';
      state.error = error.message;
    }
    render();
  }

  async function remove(id) {
    try {
      await deleteChat(id);
    } catch (error) {
      if (error.status !== 404) {
        showToast(error.message, 'error');
        return;
      }
    }
    forget(id);
    onDeleted(id);
    showToast('Chat deleted.', 'success');
  }

  function forget(id) {
    state.chats = state.chats.filter(item => item.id !== id);
    render();
  }

  function upsert(summary) {
    if (!summary?.id) return;
    state.chats = [
      summary,
      ...state.chats.filter(chat => chat.id !== summary.id),
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    render();
  }

  function open() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    load();
    search.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    clearPendingDelete();
  }

  function clearPendingDelete() {
    clearTimeout(state.pendingDeleteTimer);
    state.pendingDelete = undefined;
  }

  function render() {
    const query = search.value.trim();
    count.textContent =
      !query && state.status === 'ready' && state.chats.length > 0
        ? String(state.chats.length)
        : '';
    if (panel.hidden) return;
    if (state.status === 'loading' && state.chats.length === 0) {
      list.innerHTML =
        '<div class="history-state" role="status">Loading chats…</div>';
      return;
    }
    if (state.status === 'error') {
      list.innerHTML = `<div class="history-state" role="alert">
        <span>Chat history could not load: ${escapeHtml(state.error)}</span>
        <button class="btn" type="button" data-history-retry>Retry</button>
      </div>`;
      return;
    }
    if (state.chats.length === 0) {
      const message = query
        ? `No chats match “${escapeHtml(query)}”.`
        : 'No chats yet. Your conversations will appear here.';
      list.innerHTML = `<div class="history-state">${message}</div>`;
      return;
    }
    let group = '';
    const rows = [];
    for (const summary of state.chats) {
      const label = historyGroup(summary.updatedAt);
      if (label !== group) {
        group = label;
        rows.push(`<h4 class="history-group">${label}</h4>`);
      }
      rows.push(historyRow(summary));
    }
    list.innerHTML = rows.join('');
  }

  function historyRow(summary) {
    const current = summary.id === currentChatId() ? ' current' : '';
    const confirming = state.pendingDelete === summary.id;
    const provider = summary.provider
      ? `${providerShort(summary.provider)} · `
      : '';
    const plural = summary.messageCount === 1 ? '' : 's';
    const task = summary.taskId ? `${summary.taskId} · ` : '';
    const meta = `${task}${provider}${summary.messageCount} message${plural} · ${relativeTime(summary.updatedAt)}`;
    const deleteLabel = confirming
      ? 'Delete?'
      : '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>';
    return `<div class="history-item${current}">
      <button class="history-open" type="button" data-open-chat="${escapeHtml(summary.id)}"${current ? ' aria-current="true"' : ''}>
        <span class="history-title">${escapeHtml(summary.title)}</span>
        <span class="history-meta">${escapeHtml(meta)}</span>
      </button>
      <button class="history-delete${confirming ? ' confirming' : ''}" type="button" data-delete-chat="${escapeHtml(summary.id)}" aria-label="${confirming ? 'Confirm delete' : 'Delete'} chat ${escapeHtml(summary.title)}">${deleteLabel}</button>
    </div>`;
  }

  toggle.addEventListener('click', () => {
    if (panel.hidden) open();
    else close();
  });

  search.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(load, 200);
  });

  list.addEventListener('click', event => {
    if (event.target.closest('[data-history-retry]')) {
      load();
      return;
    }
    const removeButton = event.target.closest('[data-delete-chat]');
    if (removeButton) {
      const id = removeButton.dataset.deleteChat;
      if (state.pendingDelete === id) {
        clearPendingDelete();
        remove(id);
        return;
      }
      clearPendingDelete();
      state.pendingDelete = id;
      state.pendingDeleteTimer = setTimeout(() => {
        state.pendingDelete = undefined;
        render();
      }, 3000);
      render();
      return;
    }
    const openButton = event.target.closest('[data-open-chat]');
    if (openButton) onOpen(openButton.dataset.openChat);
  });

  return {
    load,
    upsert,
    forget,
    open,
    close,
    isOpen: () => !panel.hidden,
  };
}

function historyGroup(timestamp) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  if (timestamp >= today) return 'Today';
  if (timestamp >= today - DAY_MS) return 'Yesterday';
  if (timestamp >= today - 6 * DAY_MS) return 'Previous 7 days';
  if (timestamp >= today - 29 * DAY_MS) return 'Previous 30 days';
  return 'Older';
}
