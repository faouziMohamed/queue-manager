import {escapeHtml} from '../../core/html.util.js';
import {renderMarkdown} from '../../core/markdown.util.js';

/** @typedef {import('../../../shared/types.mjs').SessionMessage} SessionMessage */

const stepIcons = {thinking: 'i-message', result: 'i-check'};

export const SOURCE_LABELS = {
  clarify: 'Clarify',
  assistant: 'Assistant',
  claude: 'Claude Code',
  codex: 'Codex',
};

/**
 * HTML for a transcript: messages as bubbles, consecutive tool steps and thinking collapsed into groups.
 * @param {{tool: string, messages: SessionMessage[]}} session
 * @param {string} taskId Highlights messages that mention it.
 * @returns {string}
 */
export function renderSessionMessages(session, taskId) {
  const assistantLabel = SOURCE_LABELS[session.tool] || 'Assistant';
  return groupMessages(session.messages)
    .map(group =>
      group.message
        ? bubble(group.message, taskId, assistantLabel)
        : stepGroup(group.steps),
    )
    .join('');
}

function groupMessages(messages) {
  const groups = [];
  for (const message of messages) {
    const isStep = message.role === 'tool' || message.kind === 'thinking';
    const last = groups[groups.length - 1];
    if (isStep && last?.steps) last.steps.push(message);
    else if (isStep) groups.push({steps: [message]});
    else groups.push({message});
  }
  return groups;
}

function bubble(message, taskId, assistantLabel) {
  const mentions = taskId && message.text.includes(taskId) ? ' mentions' : '';
  const time = message.timestamp
    ? `<time>${escapeHtml(new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}))}</time>`
    : '';
  const mine = message.role === 'user';
  const content = mine
    ? escapeHtml(message.text).replace(/\n/g, '<br>')
    : renderMarkdown(message.text);
  return `<article class="session-message ${mine ? 'user' : 'assistant'}${mentions}">
        <header><strong>${mine ? 'You' : escapeHtml(assistantLabel)}</strong>${time}</header>
        <div class="markdown">${content}</div>
      </article>`;
}

function step(message) {
  const icon = stepIcons[message.kind] || 'i-chevron';
  const summary =
    message.summary || (message.kind === 'thinking' ? 'Thinking' : 'Tool');
  return `<details class="session-step ${message.kind || 'call'}${message.summary?.includes('error') ? ' is-error' : ''}">
        <summary><svg class="icon" aria-hidden="true"><use href="#${icon}"/></svg><span>${escapeHtml(summary)}</span></summary>
        <div class="markdown">${renderMarkdown(message.text)}</div>
      </details>`;
}

function stepGroup(steps) {
  const tools = steps.filter(
    item =>
      item.kind === 'call' || (item.role === 'tool' && item.kind !== 'result'),
  ).length;
  const label = [
    tools ? `${tools} tool call${tools === 1 ? '' : 's'}` : '',
    steps.some(item => item.kind === 'thinking') ? 'thinking' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const errors = steps.some(item => item.summary?.includes('error'));
  return `<details class="session-steps${errors ? ' has-error' : ''}">
        <summary><span class="session-steps-dot" aria-hidden="true"></span>Worked · ${escapeHtml(label || `${steps.length} steps`)}</summary>
        <div class="session-steps-list">${steps.map(step).join('')}</div>
      </details>`;
}
