import {API_ROUTES} from '../../../shared/routes.constant.mjs';
import {httpError, readJson, sendJson} from '../../http/http.util.mjs';

/**
 * Registers the settings and initialization routes.
 * @param {ReturnType<import('../../http/router.mjs').createRouter>} router
 * @param {{root: string, workspaceService: ReturnType<import('./workspace.service.mjs').createWorkspaceService>}} services
 */
export function registerWorkspaceRoutes(router, {root, workspaceService}) {
  router.get(API_ROUTES.config, ({response}) => {
    sendJson(response, 200, {
      root,
      initialized: workspaceService.isInitialized(),
      workspace: workspaceService.current(),
    });
  });

  router.post(API_ROUTES.config, async ({request, response}) => {
    workspaceService.requireInitialized();
    const workspace = await workspaceService.saveConfig(
      await readJson(request),
    );
    sendJson(response, 200, {ok: true, workspace});
  });

  router.post(API_ROUTES.init, async ({request, response}) => {
    if (workspaceService.isInitialized())
      throw httpError(409, 'the queue is already initialized');
    const payload = await readJson(request);
    const workspace = await workspaceService.initialize(payload);
    sendJson(response, 201, {ok: true, workspace});
  });
}
