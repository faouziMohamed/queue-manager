import {escapeHtml} from '../../core/html.util.js';

const suggestions = [
  [
    'What is unclear?',
    'What is unclear or ambiguous in this task? Ask me the questions you need answered.',
  ],
  [
    'What is needed before continuing?',
    'List what is still needed before this task can continue, as a checklist.',
  ],
  [
    'Summarize agreed decisions',
    'Summarize what we have agreed so far and propose a Clarifications section.',
  ],
];

/**
 * Static HTML of the Discussions panel and its session viewer dialog.
 * @returns {string}
 */
export function taskChatTemplate() {
  const chips = suggestions
    .map(
      ([label, prompt]) =>
        `<button class="suggestion" type="button" data-suggest="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`,
    )
    .join('');
  return `<section class="task-chat" aria-labelledby="task-chat-title">
    <header class="task-chat-head">
      <div>
        <h3 id="task-chat-title">Discussions <span data-chat="task-id"></span> <span class="discussion-count" data-chat="count"></span></h3>
        <p data-requires-ai>Clarify this task with the assistant, and find the agent sessions that worked on it.</p>
        <p data-without-ai>Agent sessions and earlier chats about this task. Configure an assistant to start a new discussion.</p>
      </div>
      <button class="btn" type="button" data-chat="new" data-requires-ai><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg> New discussion</button>
    </header>
    <div data-chat="list"></div>
    <div class="task-chat-thread" data-requires-ai>
      <div class="agent-identity task-chat-identity">
        <span class="agent-dot" data-chat="dot" aria-hidden="true"></span>
        <span class="task-chat-provider" data-chat="provider">Checking assistant…</span>
        <span class="task-chat-model" data-chat="model"></span>
        <button class="link-button" type="button" data-chat="settings">Change</button>
      </div>
      <div class="agent-messages task-chat-messages" data-chat="messages" aria-live="polite"></div>
      <div class="task-chat-empty" data-chat="empty">${chips}</div>
      <form class="agent-composer" data-chat="form">
        <div class="agent-input-wrap">
          <textarea data-chat="input" rows="2" placeholder="Ask about this task, or answer the assistant…" aria-label="Discussion message"></textarea>
          <button class="agent-send" type="submit" aria-label="Send message" title="Send">
            <svg class="icon"><use href="#i-send"/></svg>
          </button>
        </div>
        <div class="agent-composer-foot">
          <span data-chat="status" role="status"></span>
          <span class="agent-hint">Enter to send · Shift+Enter for a new line</span>
        </div>
      </form>
    </div>
    <dialog class="modal session-viewer" data-chat="viewer" aria-labelledby="session-viewer-title">
      <div class="modal-body">
        <header class="session-viewer-head">
          <div>
            <p class="eyebrow" data-viewer="kind">Agent session · read-only</p>
            <h2 id="session-viewer-title" data-viewer="title"></h2>
            <p class="muted" data-viewer="meta"></p>
          </div>
          <button class="icon-button" type="button" data-close aria-label="Close session"><svg class="icon"><use href="#i-close"/></svg></button>
        </header>
        <div class="session-resume" data-resume>
          <code data-viewer="command"></code>
          <button class="btn" type="button" data-viewer="copy"><svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg> Copy resume command</button>
        </div>
        <div class="session-messages" data-viewer="body"></div>
      </div>
    </dialog>
  </section>`;
}
