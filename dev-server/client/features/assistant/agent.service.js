import {ENDPOINTS} from '../../../shared/routes.constant.mjs';
import {api, postJson} from '../../core/api-client.js';

/** @typedef {import('../../../shared/types.mjs').AgentConfig} AgentConfig */
/** @typedef {import('../../../shared/types.mjs').AgentAvailability} AgentAvailability */
/** @typedef {import('../../../shared/types.mjs').ModelChoice} ModelChoice */
/** @typedef {import('../../../shared/types.mjs').TokenUsage} TokenUsage */
/** @typedef {import('../../../shared/types.mjs').Proposal} Proposal */

/**
 * Assistant configuration, provider availability and model lists.
 * @returns {Promise<{config: AgentConfig, available: AgentAvailability, models: Record<string, ModelChoice[]>}>}
 */
export function fetchAgent() {
  return api(ENDPOINTS.agent.root);
}

/**
 * Saves the default provider and model to the queue config.
 * @param {AgentConfig} config
 * @returns {Promise<{config: AgentConfig, available: AgentAvailability, models: Record<string, ModelChoice[]>}>}
 */
export function saveAgentConfig({provider, model}) {
  return postJson(ENDPOINTS.agent.config, {provider, model});
}

/**
 * Asks the assistant. It is read-only: changes come back as proposals.
 * @param {{messages: {role: string, content: string}[], taskId?: string, mode?: 'assistant' | 'clarify', provider?: string, model?: string}} payload
 * @returns {Promise<{message: string, proposals: Proposal[], usage?: TokenUsage, provider: string, model: string}>}
 */
export function sendAgentChat(payload) {
  return postJson(ENDPOINTS.agent.chat, payload);
}
