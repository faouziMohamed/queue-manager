import {TASK_ID_PATTERN} from '../../../shared/routes.constant.mjs';

/** @typedef {import('../../../shared/types.mjs').ChatMessage} ChatMessage */
/** @typedef {import('../../../shared/types.mjs').ChatSummary} ChatSummary */
/** @typedef {import('../../../shared/types.mjs').Chat} Chat */

const MAX_MESSAGES = 500;
const MAX_CONTENT = 200_000;

export const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Validates and caps a chat before it is stored.
 * @param {Record<string, any>} input
 * @returns {Omit<Chat, 'messageCount'>}
 */
export function normalizeChat(input) {
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .slice(-MAX_MESSAGES)
    .map(normalizeMessage)
    .filter(Boolean);
  const lastAgent = [...messages]
    .reverse()
    .find(message => message.agent)?.agent;
  const updatedAt = toTimestamp(
    input.updatedAt,
    toTimestamp(input.createdAt, Date.now()),
  );
  const createdAt = Math.min(
    toTimestamp(input.createdAt, updatedAt),
    updatedAt,
  );
  return {
    id: String(input.id),
    title: chatTitle(input.title, messages),
    createdAt,
    updatedAt,
    provider: lastAgent?.provider || '',
    model: lastAgent?.model || '',
    taskId: TASK_ID_PATTERN.test(String(input.taskId || ''))
      ? String(input.taskId)
      : '',
    messages,
  };
}

/**
 * Lower-cased text the history search matches against.
 * @param {{title: string, messages: ChatMessage[]}} chat
 * @returns {string}
 */
export function searchText(chat) {
  return [chat.title, ...chat.messages.map(message => message.content)]
    .join('\n')
    .toLowerCase()
    .slice(0, 2_000_000);
}

/**
 * Chat summary from a database row.
 * @param {Record<string, any>} row
 * @returns {ChatSummary}
 */
export function summaryFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    provider: row.provider,
    model: row.model,
    messageCount: Number(row.message_count),
    taskId: row.task_id || '',
  };
}

/**
 * Full chat from a database row.
 * @param {Record<string, any>} row
 * @returns {Chat}
 */
export function chatFromRow(row) {
  let messages = [];
  try {
    messages = JSON.parse(row.messages);
  } catch {}
  return {
    ...summaryFromRow(row),
    messages: Array.isArray(messages) ? messages : [],
  };
}

function normalizeMessage(message) {
  if (!message || typeof message.content !== 'string') return undefined;
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  const normalized = {role, content: message.content.slice(0, MAX_CONTENT)};
  if (role === 'assistant') {
    normalized.proposals = Array.isArray(message.proposals)
      ? message.proposals.slice(0, 3)
      : [];
    if (message.usage && typeof message.usage === 'object') {
      normalized.usage = {
        inputTokens: Number(message.usage.inputTokens) || 0,
        outputTokens: Number(message.usage.outputTokens) || 0,
        cacheReadTokens: Number(message.usage.cacheReadTokens) || 0,
        totalTokens: Number(message.usage.totalTokens) || 0,
      };
      if (typeof message.usage.costUsd === 'number')
        normalized.usage.costUsd = message.usage.costUsd;
    }
    if (message.agent && typeof message.agent === 'object') {
      normalized.agent = {
        provider: String(message.agent.provider || '').slice(0, 40),
        model: String(message.agent.model || '').slice(0, 200),
      };
    }
  }
  return normalized;
}

function chatTitle(title, messages) {
  const explicit = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (explicit && explicit !== 'New chat') return explicit.slice(0, 120);
  const first = messages.find(message => message.role === 'user');
  return (
    (first?.content || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 120) ||
    'New chat'
  );
}

function toTimestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
