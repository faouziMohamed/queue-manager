import {API_ROUTES, TASK_ID_PATTERN} from '../../../shared/routes.constant.mjs';
import {sendJson} from '../../http/http.util.mjs';

/**
 * Registers the task discussions route: related chats and agent sessions.
 * @param {ReturnType<import('../../http/router.mjs').createRouter>} router
 * @param {{tasksService: object, chatsService: object, sessionIndex: ReturnType<import('../sessions/sessions.repository.mjs').createSessionIndex>}} services
 */
export function registerDiscussionsRoutes(
  router,
  {tasksService, chatsService, sessionIndex},
) {
  router.get(
    API_ROUTES.taskDiscussions,
    async ({response, params}) => {
      tasksService.requireQueue();
      const store = await chatsService.store();
      const [chats, sessions] = await Promise.all([
        store.available ? store.related(params.taskId) : [],
        sessionIndex.forTask(params.taskId),
      ]);
      sendJson(response, 200, {
        chats,
        sessions,
        sessionsEnabled: sessionIndex.enabled,
      });
    },
    {taskId: TASK_ID_PATTERN},
  );
}
