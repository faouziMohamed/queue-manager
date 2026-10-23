import {API_ROUTES} from '../../../shared/routes.constant.mjs';
import {sendJson} from '../../http/http.util.mjs';
import {attachLinkedTasks, readPitfalls} from './pitfalls.repository.mjs';

/**
 * Registers the pitfalls route.
 * @param {ReturnType<import('../../http/router.mjs').createRouter>} router
 * @param {{root: string, tasksService: object}} services
 */
export function registerPitfallsRoutes(router, {root, tasksService}) {
  router.get(API_ROUTES.pitfalls, async ({response}) => {
    const pitfalls = await readPitfalls(root);
    const tasks = await tasksService.listWithBodies();
    sendJson(response, 200, attachLinkedTasks(pitfalls, tasks));
  });
}
