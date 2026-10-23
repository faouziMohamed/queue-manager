import {escapeHtml} from '../../core/html.util.js';
import {renderMarkdown} from '../../core/markdown.util.js';
import {upsertSection} from '../tasks/body-sections.util.js';
import {
  applyTaskAction,
  createTask,
  fetchTask,
  updateTaskBody,
} from '../tasks/tasks.service.js';

/** @typedef {import('../../../shared/types.mjs').Proposal} Proposal */

/**
 * Applies one assistant proposal through the tasks API.
 * @param {Proposal} proposal
 * @returns {Promise<void>}
 */
export async function applyToQueue(proposal) {
  if (proposal.type === 'create_task') {
    await createTask({
      title: proposal.title,
      priority: proposal.priority,
      resume: proposal.resume,
    });
    return;
  }
  if (proposal.type === 'update_body') {
    await updateTaskBody(proposal.task_id, proposal.body);
    return;
  }
  if (proposal.type === 'upsert_section') {
    const task = await fetchTask(proposal.task_id);
    const body = upsertSection(
      String(task.body || ''),
      proposal.heading,
      proposal.content,
    );
    await updateTaskBody(proposal.task_id, body);
    return;
  }
  const payload = {action: proposal.action, summary: proposal.summary};
  if (proposal.action === 'block') payload.by = proposal.by;
  await applyTaskAction(proposal.task_id, payload);
}

/**
 * HTML card for a proposal with its Apply button.
 * @param {Proposal} proposal
 * @param {number} messageIndex
 * @param {number} proposalIndex
 * @returns {string}
 */
export function proposalCard(proposal, messageIndex, proposalIndex) {
  const disabled = proposal.applied ? ' disabled' : '';
  const label = proposal.applied ? 'Applied' : 'Apply';
  if (proposal.type === 'upsert_section') {
    return `<div class="proposal proposal-section">
      <div class="proposal-head">
        <div><strong>${escapeHtml(`Update “${proposal.heading}” · ${proposal.task_id}`)}</strong><span>Replaces that section, or adds it if missing.</span></div>
        <button class="btn${proposal.applied ? '' : ' primary'}" type="button" data-apply="${messageIndex}:${proposalIndex}"${disabled}>${label}</button>
      </div>
      <div class="proposal-preview markdown">${renderMarkdown(proposal.content)}</div>
    </div>`;
  }
  let title = '';
  let detail = '';
  if (proposal.type === 'create_task') {
    title = 'Create task';
    detail = proposal.title;
  } else if (proposal.type === 'update_body') {
    title = `Replace body · ${proposal.task_id}`;
    detail = proposal.body.replace(/\s+/g, ' ').slice(0, 100);
  } else {
    title = `${proposal.action} · ${proposal.task_id}`;
    detail = proposal.summary || '';
  }
  return `<div class="proposal">
    <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>
    <button class="btn" type="button" data-apply="${messageIndex}:${proposalIndex}"${disabled}>${label}</button>
  </div>`;
}
