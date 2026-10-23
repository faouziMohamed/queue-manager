import {TASK_ID_PATTERN} from '../../../shared/routes.constant.mjs';

/** @typedef {import('../../../shared/types.mjs').Proposal} Proposal */

const ACTIONS = ['start', 'unblock', 'hold', 'resume', 'done', 'block'];
const normalizers = {
  create_task: createTaskProposal,
  upsert_section: upsertSectionProposal,
  update_body: updateBodyProposal,
  action: actionProposal,
};

/**
 * Splits an answer into its message and the validated proposals of its last ```json block.
 * @param {string} text
 * @returns {{message: string, proposals: Proposal[]}}
 */
export function parseProposals(text) {
  // Matches fenced ```json blocks; the last valid one wins.
  const fences = [...String(text).matchAll(/```json\s*([\s\S]*?)```/gi)];
  for (const fence of fences.reverse()) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (!Array.isArray(parsed.proposals)) continue;
      const proposals = parsed.proposals
        .map(normalizeProposal)
        .filter(Boolean)
        .slice(0, 3);
      const message = String(text).replace(fence[0], '').trim();
      return {message: message || 'I prepared the proposals below.', proposals};
    } catch {}
  }
  return {message: String(text).trim(), proposals: []};
}

function normalizeProposal(proposal) {
  if (!proposal || typeof proposal !== 'object') return undefined;
  return normalizers[proposal.type]?.(proposal);
}

function hasTaskId(proposal) {
  return TASK_ID_PATTERN.test(String(proposal.task_id || ''));
}

function createTaskProposal(proposal) {
  const title = String(proposal.title || '').trim();
  if (!title || title.startsWith('-')) return undefined;
  return {
    type: 'create_task',
    title,
    priority: ['1', '2', '3'].includes(String(proposal.priority))
      ? String(proposal.priority)
      : '2',
    resume: String(proposal.resume || '')
      .trim()
      .slice(0, 4000),
  };
}

function upsertSectionProposal(proposal) {
  const heading = String(proposal.heading || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^#+\s*/, '');
  const content = String(proposal.content || '').trim();
  if (!hasTaskId(proposal) || !heading || heading.length > 80 || !content)
    return undefined;
  return {
    type: 'upsert_section',
    task_id: String(proposal.task_id),
    heading,
    content: content.slice(0, 20_000),
  };
}

function updateBodyProposal(proposal) {
  if (!hasTaskId(proposal) || typeof proposal.body !== 'string')
    return undefined;
  return {
    type: 'update_body',
    task_id: String(proposal.task_id),
    body: proposal.body.slice(0, 120_000),
  };
}

function actionProposal(proposal) {
  if (!hasTaskId(proposal) || !ACTIONS.includes(proposal.action))
    return undefined;
  const action = {
    type: 'action',
    task_id: String(proposal.task_id),
    action: proposal.action,
    summary: String(proposal.summary || '')
      .trim()
      .slice(0, 4000),
  };
  if (proposal.action === 'block') {
    action.by = (Array.isArray(proposal.by) ? proposal.by : [])
      .map(value => String(value))
      .filter(value => TASK_ID_PATTERN.test(value));
    if (action.by.length === 0) return undefined;
  }
  return action;
}
