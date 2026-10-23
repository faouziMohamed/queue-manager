import {ENDPOINTS} from '../../../shared/routes.constant.mjs';
import {postJson} from '../../core/api-client.js';

/** @typedef {import('../../../shared/types.mjs').Workspace} Workspace */

/**
 * Saves queue settings.
 * @param {Partial<Workspace>} payload
 * @returns {Promise<{ok: boolean, workspace: Workspace}>}
 */
export function saveWorkspaceConfig(payload) {
  return postJson(ENDPOINTS.config, payload);
}

/**
 * Creates `.queue/` in this folder with the given settings.
 * @param {Partial<Workspace>} payload
 * @returns {Promise<{ok: boolean, workspace: Workspace}>}
 */
export function initializeQueue(payload) {
  return postJson(ENDPOINTS.init, payload);
}
