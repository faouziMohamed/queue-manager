import {TASK_ID_PATTERN} from '../../../shared/routes.constant.mjs';
import {httpError} from '../../http/http.util.mjs';

/**
 * Task rules: validation, and transitions through `queue.sh` so its lock and WIP limit stay authoritative.
 * @param {{root: string, tasksRepository: ReturnType<import('./tasks.repository.mjs').createTasksRepository>, workspaceService: object, queueCli: ReturnType<import('../../infrastructure/queue-cli.mjs').createQueueCli>}} dependencies
 */
export function createTasksService({
  root,
  tasksRepository,
  workspaceService,
  queueCli,
}) {
  function requireQueue() {
    if (!workspaceService.isInitialized())
      throw httpError(404, 'queue not initialized');
  }

  async function findOrFail(id) {
    const task = await tasksRepository.find(id);
    if (!task) throw httpError(404, `unknown task: ${id}`);
    return task;
  }

  async function replaceBody(id, body) {
    if (typeof body !== 'string') throw httpError(400, 'body must be a string');
    const task = await findOrFail(id);
    if (task.status === 'done')
      throw httpError(409, 'done records are immutable');
    if (!(await tasksRepository.writeBody(task, body)))
      throw httpError(500, `cannot find frontmatter in ${task.file}`);
  }

  return {
    requireQueue,
    findOrFail,

    async overview() {
      const workspace = workspaceService.current();
      if (!workspaceService.isInitialized())
        return {root, initialized: false, workspace, tasks: [], gates: []};
      const {tasks, gates} = await tasksRepository.list();
      return {root, initialized: true, workspace, tasks, gates};
    },

    async listWithBodies() {
      if (!workspaceService.isInitialized()) return [];
      return (await tasksRepository.list({keepBodies: true})).tasks;
    },

    async listForAgent() {
      return (await tasksRepository.list()).tasks;
    },

    async get(id) {
      requireQueue();
      const task = await findOrFail(id);
      task.blockedBy = await tasksRepository.readBlockedBy(id);
      return task;
    },

    async create(payload) {
      const title = String(payload.title || '').trim();
      if (!title) throw httpError(400, 'title is required');
      if (title.startsWith('-'))
        throw httpError(400, 'title cannot start with -');
      const priority = ['1', '2', '3'].includes(String(payload.priority))
        ? String(payload.priority)
        : '2';
      const args = ['add', title, '--priority', priority];
      if (payload.resume) args.push('--resume', String(payload.resume));
      const output = await queueCli.run(args);
      const id = (output.match(/Q-\d{4,}/) || [])[0];
      return {id, output};
    },

    async updateBody(id, body) {
      requireQueue();
      await queueCli.serialize(() => replaceBody(id, body));
    },

    async applyAction(id, payload) {
      requireQueue();
      return queueCli.run(actionArgs(id, payload));
    },
  };
}

function actionArgs(id, payload) {
  const action = String(payload.action || '');
  if (['start', 'unblock', 'hold', 'resume'].includes(action))
    return [action, id];
  if (action === 'done') {
    const summary = String(payload.summary || '').trim();
    return summary ? ['done', id, '--summary', summary] : ['done', id];
  }
  if (action === 'block') {
    const blockers = (Array.isArray(payload.by) ? payload.by : [payload.by])
      .map(value => String(value || '').trim())
      .filter(Boolean);
    if (blockers.length === 0)
      throw httpError(400, 'block needs at least one blocker');
    for (const blocker of blockers) {
      if (!TASK_ID_PATTERN.test(blocker))
        throw httpError(400, `invalid blocker: ${blocker}`);
    }
    return ['block', id, '--by', blockers.join(',')];
  }
  throw httpError(400, `unknown action: ${action}`);
}
