import {escapeHtml} from '../../core/html.util.js';
import {createAgentControls} from './agent-controls.js';
import {agentLabel, firstAvailable} from './agent-providers.util.js';
import {
  clearLegacyChats,
  LAST_CHAT_KEY,
  readLegacyChats,
  readPreference,
  writePreference,
} from './assistant-storage.js';
import {createChatHistory} from './chat-history.js';
import {createChatThread} from './chat-thread.js';
import {fetchChat, importChats} from './chats.service.js';

/** @typedef {import('../../../shared/types.mjs').Task} Task */

/**
 * Starter prompts for the assistant, naming real tasks from the queue.
 * @param {Task[]} tasks
 * @returns {[label: string, prompt: string][]}
 */
export function suggestionsFor(tasks) {
  const suggestions = [
    [
      'Summarize ready work',
      'Summarize the ready tasks and the main blockers.',
    ],
  ];
  const blocked = tasks.find(task => task.status === 'blocked');
  if (blocked) {
    suggestions.push([
      `Explain ${blocked.id}`,
      `What is blocking ${blocked.id}, and what should happen next?`,
    ]);
  }
  const next =
    tasks.find(task => task.status === 'in-progress') ||
    tasks.find(task => task.status === 'ready');
  if (next) {
    suggestions.push([
      `Draft ${next.id} next action`,
      `Draft the next action for ${next.id}.`,
    ]);
  }
  return suggestions;
}

/**
 * Wires the assistant drawer: chat thread, history, provider controls and suggestions.
 * @param {{showToast: (message: string, tone?: string) => void, reloadTasks: () => Promise<void>, getActiveTaskId: () => string | undefined, getTasks: () => Task[], openSettings: () => void}} options
 * @returns {{open: () => void, close: () => void}}
 */
export function initAssistant({
  showToast,
  reloadTasks,
  getActiveTaskId,
  getTasks,
  openSettings,
}) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#agent-dialog');
  const suggestionsElement = $('#agent-suggestions');
  const input = $('#agent-input');
  const controls = createAgentControls({
    providerSelect: $('#agent-provider-select'),
    modelSelect: $('#agent-model-select'),
    providerLabelElement: $('#agent-provider'),
    modelLabelElement: $('#agent-model-label'),
    connectionElement: $('#agent-connection'),
    dotElement: $('#agent-dot'),
    showToast,
  });

  const chat = createChatThread({
    messagesElement: $('#agent-messages'),
    emptyElement: $('#agent-empty'),
    form: $('#agent-form'),
    input,
    status: $('#agent-status'),
    showToast,
    request: () => ({taskId: getActiveTaskId(), ...controls.selection()}),
    agentLabel: agent =>
      agentLabel(agent, controls.config(), controls.available()),
    failedAgent: () => {
      const {provider, model} = controls.selection();
      return {
        provider:
          provider === 'auto' ? firstAvailable(controls.available()) : provider,
        model,
      };
    },
    onCreated: id => writePreference(LAST_CHAT_KEY, id),
    onSaved: summary => chatHistory.upsert(summary),
    onApplied: () => reloadTasks(),
  });

  const chatHistory = createChatHistory({
    toggle: $('#agent-history-toggle'),
    panel: $('#agent-history-panel'),
    search: $('#agent-history-search'),
    list: $('#agent-history-list'),
    count: $('#agent-history-count'),
    showToast,
    currentChatId: () => chat.chatId,
    onOpen: openChat,
    onDeleted: id => {
      if (chat.chatId !== id) return;
      writePreference(LAST_CHAT_KEY, '');
      chat.reset();
    },
  });

  function newChat() {
    if (chat.refuseWhileBusy()) return;
    writePreference(LAST_CHAT_KEY, '');
    chat.reset();
    chatHistory.close();
    input.focus();
  }

  async function openChat(id) {
    if (chat.refuseWhileBusy()) return;
    try {
      const saved = await fetchChat(id);
      chat.load(saved);
      writePreference(LAST_CHAT_KEY, saved.id);
      chatHistory.close();
      input.focus();
    } catch (error) {
      if (error.status === 404) chatHistory.forget(id);
      showToast(error.message, 'error');
    }
  }

  async function migrateLegacyChats() {
    const legacy = readLegacyChats();
    if (legacy.length === 0) return;
    try {
      const payload = await importChats(legacy);
      clearLegacyChats();
      if (!readPreference(LAST_CHAT_KEY))
        writePreference(LAST_CHAT_KEY, legacy[0].id);
      if (payload.imported > 0) {
        const plural = payload.imported === 1 ? '' : 's';
        showToast(
          `Moved ${payload.imported} chat${plural} from this browser into chat history.`,
          'success',
        );
      }
    } catch (error) {
      if (error.status !== 409)
        showToast(`Browser chats not imported yet: ${error.message}`, 'error');
    }
  }

  async function restoreLastChat() {
    const id = readPreference(LAST_CHAT_KEY);
    if (!id || chat.chatId || chat.messages.length > 0) return;
    try {
      const saved = await fetchChat(id);
      if (chat.chatId || chat.messages.length > 0) return;
      chat.load(saved);
    } catch (error) {
      if (error.status === 404) writePreference(LAST_CHAT_KEY, '');
    }
  }

  function renderSuggestions() {
    suggestionsElement.innerHTML = suggestionsFor(getTasks())
      .map(
        ([label, prompt]) =>
          `<button class="suggestion" type="button" data-suggest="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`,
      )
      .join('');
  }

  function open() {
    controls.refresh();
    renderSuggestions();
    chat.render();
    if (!dialog.open) dialog.showModal();
    input.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('cancel', event => {
    if (!chatHistory.isOpen()) return;
    event.preventDefault();
    chatHistory.close();
    $('#agent-history-toggle').focus();
  });

  $('#agent-new-chat').addEventListener('click', newChat);

  $('#agent-settings').addEventListener('click', () => {
    close();
    openSettings();
  });

  window.addEventListener('queue-agent-config-changed', controls.refresh);

  migrateLegacyChats().then(restoreLastChat).then(chatHistory.load);
  return {open, close};
}
