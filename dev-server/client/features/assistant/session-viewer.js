import {escapeHtml} from '../../core/html.util.js';
import {fetchChat, fetchSession} from './chats.service.js';
import {renderSessionMessages, SOURCE_LABELS} from './session-messages.view.js';

/**
 * Read-only viewer dialog for agent sessions and saved chats.
 * @param {{viewer: HTMLDialogElement, showToast: (message: string, tone?: string) => void, currentTaskId: () => string}} options
 * @returns {{openSession: (tool: string, id: string) => Promise<void>, openChat: (id: string) => Promise<void>}}
 */
export function createSessionViewer({viewer, showToast, currentTaskId}) {
  const part = name => viewer.querySelector(`[data-viewer="${name}"]`);
  let viewerSession = null;

  function reset() {
    part('body').innerHTML = '<p class="muted" role="status">Loading…</p>';
    part('title').textContent = 'Discussion';
    part('meta').textContent = '';
    part('kind').textContent = 'Agent session · read-only';
    viewer.querySelector('[data-resume]').hidden = false;
    if (!viewer.open) viewer.showModal();
  }

  function showError(title, error) {
    part('body').innerHTML = `<div class="state-panel error" role="alert">
        <h2>${title}</h2><p>${escapeHtml(error.message)}</p></div>`;
  }

  function render(session) {
    part('title').textContent = session.title;
    part('meta').textContent =
      `${SOURCE_LABELS[session.tool] || 'Queue chat'} · ${session.messageCount} messages · updated ${new Date(session.updatedAt).toLocaleString()}`;
    part('command').textContent = session.resumeCommand || '';
    const body = part('body');
    body.innerHTML =
      renderSessionMessages(session, currentTaskId()) ||
      '<p class="muted">No readable messages in this session.</p>';
    const firstMention = body.querySelector('.session-message.mentions');
    if (firstMention) firstMention.scrollIntoView({block: 'start'});
  }

  async function openSession(tool, id) {
    reset();
    try {
      viewerSession = await fetchSession(tool, id);
      render(viewerSession);
    } catch (error) {
      showError('Session unavailable', error);
    }
  }

  async function openChat(id) {
    reset();
    try {
      const saved = await fetchChat(id);
      viewerSession = null;
      part('kind').textContent = 'Queue chat · read-only';
      viewer.querySelector('[data-resume]').hidden = true;
      render({
        tool: 'chat',
        title: saved.title,
        messageCount: saved.messages.length,
        updatedAt: saved.updatedAt,
        messages: saved.messages.map(message => ({
          role: message.role,
          text: message.content,
          timestamp: 0,
        })),
      });
    } catch (error) {
      showError('Chat unavailable', error);
    }
  }

  viewer.addEventListener('click', async event => {
    if (event.target.closest('[data-close]')) {
      viewer.close();
      return;
    }
    if (event.target.closest('[data-viewer="copy"]') && viewerSession) {
      try {
        await navigator.clipboard.writeText(viewerSession.resumeCommand);
        showToast('Resume command copied. Paste it in a terminal.', 'success');
      } catch {
        showToast('Could not copy the command.', 'error');
      }
    }
  });

  return {openSession, openChat};
}
