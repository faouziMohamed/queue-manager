import {httpError} from '../../http/http.util.mjs';
import {resolveAgent} from './agent-availability.mjs';
import {
  queueContext,
  singlePrompt,
  systemPrompt,
  transcript,
} from './agent-prompt.mjs';
import {parseProposals} from './agent-proposals.mjs';
import {
  runClaude,
  runCodex,
  runDeepseek,
  runDeepseekCli,
} from './agent-providers.mjs';

/** @typedef {import('../../../shared/types.mjs').TaskRecord} TaskRecord */
/** @typedef {import('../../../shared/types.mjs').Workspace} Workspace */
/** @typedef {import('../../../shared/types.mjs').TokenUsage} TokenUsage */
/** @typedef {import('../../../shared/types.mjs').Proposal} Proposal */

export {agentAvailability, agentModels} from './agent-availability.mjs';

/**
 * Asks the selected provider about the queue and returns its answer with parsed proposals.
 * @param {object} request
 * @param {Workspace} request.workspace
 * @param {TaskRecord[]} request.tasks
 * @param {TaskRecord | undefined} request.activeTask
 * @param {{role: string, content: string}[]} request.messages
 * @param {string} request.root
 * @param {'assistant' | 'clarify'} [request.mode]
 * @param {string} [request.provider]
 * @param {string} [request.model]
 * @returns {Promise<{provider: string, model: string, usage?: TokenUsage, message: string, proposals: Proposal[]}>}
 */
export async function runAgent({
  workspace,
  tasks,
  activeTask,
  messages,
  root,
  mode = 'assistant',
  provider: requestedProvider,
  model: requestedModel,
}) {
  const {provider, model} = await resolveAgent(workspace, {
    provider: requestedProvider,
    model: requestedModel,
  });
  const system = systemPrompt(mode, activeTask);
  const context = queueContext(workspace, tasks, activeTask);
  const conversation = transcript(messages);
  const answer = await askProvider(provider, model, root, {
    system,
    context,
    conversation,
  });

  const parsed = parseProposals(answer.text);
  if (!parsed.message && parsed.proposals.length === 0) {
    throw httpError(502, 'The assistant returned an empty answer.');
  }
  return {provider, model, usage: answer.usage, ...parsed};
}

function askProvider(provider, model, root, {system, context, conversation}) {
  if (provider === 'deepseek')
    return runDeepseek(system, context, conversation, model);
  const prompt = singlePrompt(system, context, conversation);
  if (provider === 'claude-cli') return runClaude(prompt, model, root);
  if (provider === 'claude-api')
    return runClaude(prompt, model, root, process.env.ANTHROPIC_API_KEY);
  if (provider === 'codex-cli') return runCodex(prompt, model, root);
  if (provider === 'codex-api')
    return runCodex(prompt, model, root, process.env.OPENAI_API_KEY);
  return runDeepseekCli(prompt, model, root);
}
