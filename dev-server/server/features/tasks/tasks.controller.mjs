import {API_ROUTES, TASK_ID_PATTERN} from '../../../shared/routes.constant.mjs';
import {readJson, sendJson} from '../../http/http.util.mjs';

const taskParams = {taskId: TASK_ID_PATTERN};

/**
 * Registers the task routes: list, create, read, body and transitions.
 * @param {ReturnType<import('../../http/router.mjs').createRouter>} router
 * @param {{tasksService: ReturnType<import('./tasks.service.mjs').createTasksService>, workspaceService: object}} services
 */
export function registerTasksRoutes(router, {tasksService, workspaceService}) {
  router.get(API_ROUTES.tasks, async ({response}) => {
    sendJson(response, 200, await tasksService.overview());
  });

  router.post(API_ROUTES.tasks, async ({request, response}) => {
    workspaceService.requireInitialized();
    const {id, output} = await tasksService.create(await readJson(request));
    sendJson(response, 201, {ok: true, id, output});
  });

  router.get(
    API_ROUTES.task,
    async ({response, params}) => {
      sendJson(response, 200, await tasksService.get(params.taskId));
    },
    taskParams,
  );

  router.post(
    API_ROUTES.taskBody,
    async ({request, response, params}) => {
      tasksService.requireQueue();
      const payload = await readJson(request);
      await tasksService.updateBody(params.taskId, payload.body);
      sendJson(response, 200, {ok: true});
    },
    taskParams,
  );

  router.post(
    API_ROUTES.taskAction,
    async ({request, response, params}) => {
      tasksService.requireQueue();
      const payload = await readJson(request);
      const output = await tasksService.applyAction(params.taskId, payload);
      sendJson(response, 200, {ok: true, output});
    },
    taskParams,
  );
}
