import {ENDPOINTS} from '../../../shared/routes.constant.mjs';
import {api, postJson} from '../../core/api-client.js';
import {toTask} from './task.model.js';

/** @typedef {import('../../../shared/types.mjs').Task} Task */
/** @typedef {import('../../../shared/types.mjs').Workspace} Workspace */

/**
 * Every task with the gates, workspace and initialization state.
 * @returns {Promise<{tasks: Task[], gates: string[], initialized: boolean, workspace: Workspace}>}
 */
export async function fetchQueue() {
  const payload = await api(ENDPOINTS.tasks.root);
  return {
    tasks: payload.tasks.map(toTask),
    gates: payload.gates.map(String),
    initialized: payload.initialized !== false,
    workspace: payload.workspace,
  };
}

/**
 * One task with its body.
 * @param {string} taskId
 * @returns {Promise<Task>}
 */
export async function fetchTask(taskId) {
  return toTask(await api(ENDPOINTS.tasks.byId(taskId)));
}

/**
 * Adds a task through the CLI.
 * @param {{title: string, priority?: string, resume?: string}} task
 * @returns {Promise<{ok: boolean, id: string, output: string}>}
 */
export function createTask({title, priority, resume}) {
  return postJson(ENDPOINTS.tasks.root, {title, priority, resume});
}

/**
 * Replaces a task body; done records are refused.
 * @param {string} taskId
 * @param {string} body
 * @returns {Promise<{ok: boolean}>}
 */
export function updateTaskBody(taskId, body) {
  return postJson(ENDPOINTS.tasks.body(taskId), {body});
}

/**
 * Runs a CLI transition on a task.
 * @param {string} taskId
 * @param {{action: 'start' | 'unblock' | 'hold' | 'resume' | 'done' | 'block', summary?: string, by?: string[]}} payload
 * @returns {Promise<{ok: boolean, output: string}>}
 */
export function applyTaskAction(taskId, payload) {
  return postJson(ENDPOINTS.tasks.action(taskId), payload);
}
