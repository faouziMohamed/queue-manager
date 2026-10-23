import {ENDPOINTS} from '../../../shared/routes.constant.mjs';
import {api} from '../../core/api-client.js';

/**
 * Lessons from the project's PITFALLS.md with the tasks that link to them.
 * @returns {Promise<{exists: boolean, file: string, intro: string, pitfalls: object[]}>}
 */
export function fetchPitfalls() {
  return api(ENDPOINTS.pitfalls);
}
