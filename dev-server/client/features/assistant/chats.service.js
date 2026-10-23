import {ENDPOINTS} from '../../../shared/routes.constant.mjs';
import {api, postJson} from '../../core/api-client.js';

/** @typedef {import('../../../shared/types.mjs').ChatMessage} ChatMessage */
/** @typedef {import('../../../shared/types.mjs').ChatSummary} ChatSummary */
/** @typedef {import('../../../shared/types.mjs').Chat} Chat */
/** @typedef {import('../../../shared/types.mjs').SessionMessage} SessionMessage */
/** @typedef {import('../../../shared/types.mjs').SessionSummary} SessionSummary */

/**
 * Saved chats, newest first, optionally filtered by a search term.
 * @param {string} [query]
 * @returns {Promise<{chats: ChatSummary[]}>}
 */
export function listChats(query) {
  return api(ENDPOINTS.chats.list({q: query}));
}

/**
 * One saved chat with its messages.
 * @param {string} chatId
 * @returns {Promise<Chat>}
 */
export function fetchChat(chatId) {
  return api(ENDPOINTS.chats.byId(chatId));
}

/**
 * Creates or replaces a saved chat.
 * @param {string} chatId
 * @param {{title: string, messages: ChatMessage[], taskId?: string}} payload
 * @returns {Promise<ChatSummary>}
 */
export function saveChat(chatId, payload) {
  return api(ENDPOINTS.chats.byId(chatId), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes a saved chat.
 * @param {string} chatId
 * @returns {Promise<{ok: boolean}>}
 */
export function deleteChat(chatId) {
  return api(ENDPOINTS.chats.byId(chatId), {method: 'DELETE'});
}

/**
 * Imports chats that older versions kept in browser storage.
 * @param {object[]} threads
 * @returns {Promise<{imported: number}>}
 */
export function importChats(threads) {
  return postJson(ENDPOINTS.chats.import, {threads});
}

/**
 * Chats and agent sessions that mention a task.
 * @param {string} taskId
 * @returns {Promise<{chats: ChatSummary[], sessions: SessionSummary[], sessionsEnabled: boolean}>}
 */
export function fetchTaskDiscussions(taskId) {
  return api(ENDPOINTS.tasks.discussions(taskId));
}

/**
 * A Claude Code or Codex session transcript, read-only.
 * @param {'claude' | 'codex'} tool
 * @param {string} sessionId
 * @returns {Promise<SessionSummary & {messages: SessionMessage[]}>}
 */
export function fetchSession(tool, sessionId) {
  return api(ENDPOINTS.sessions.byId(tool, sessionId));
}
