import {API_ROUTES, TASK_ID_PATTERN} from '../../../shared/routes.constant.mjs';
import {httpError, readJson, sendJson} from '../../http/http.util.mjs';
import {agentAvailability, agentModels, runAgent} from './agent.service.mjs';

/**
 * Registers the assistant routes: availability, default provider and chat.
 * @param {ReturnType<import('../../http/router.mjs').createRouter>} router
 * @param {{root: string, workspaceService: object, tasksService: object}} services
 */
export function registerAgentRoutes(
  router,
  {root, workspaceService, tasksService},
) {
  async function sendAgentState(response, config) {
    const available = await agentAvailability();
    sendJson(response, 200, {
      config,
      available,
      models: await agentModels(available),
    });
  }

  router.get(API_ROUTES.agent, async ({response}) => {
    const workspace = workspaceService.current();
    await sendAgentState(
      response,
      workspace.agent || {provider: 'auto', model: ''},
    );
  });

  router.post(API_ROUTES.agentConfig, async ({request, response}) => {
    workspaceService.requireInitialized();
    const workspace = await workspaceService.saveAgent(await readJson(request));
    await sendAgentState(response, workspace.agent);
  });

  router.post(API_ROUTES.agentChat, async ({request, response}) => {
    workspaceService.requireInitialized();
    const payload = await readJson(request);
    const messages = recentMessages(payload.messages);
    if (
      messages.length === 0 ||
      messages[messages.length - 1].role !== 'user'
    ) {
      throw httpError(400, 'a user message is required');
    }
    const activeTask = await taskFor(payload.taskId);
    if (payload.mode === 'clarify' && !activeTask)
      throw httpError(400, 'a task id is required to clarify a task');
    const answer = await runAgent({
      workspace: workspaceService.current(),
      tasks: await tasksService.listForAgent(),
      activeTask,
      messages,
      root,
      mode: payload.mode === 'clarify' ? 'clarify' : 'assistant',
      provider:
        payload.provider === undefined ? undefined : String(payload.provider),
      model:
        payload.model === undefined
          ? undefined
          : String(payload.model).slice(0, 200),
    });
    sendJson(response, 200, answer);
  });

  async function taskFor(taskId) {
    if (!taskId) return undefined;
    if (!TASK_ID_PATTERN.test(String(taskId)))
      throw httpError(400, 'invalid task id');
    return tasksService.findOrFail(String(taskId));
  }
}

function recentMessages(input) {
  return (Array.isArray(input) ? input : []).slice(-12).map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || '').slice(0, 4000),
  }));
}
