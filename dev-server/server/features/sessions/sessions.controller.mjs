import {API_ROUTES} from '../../../shared/routes.constant.mjs';
import {httpError, sendJson} from '../../http/http.util.mjs';

const sessionParams = {
  tool: /^(claude|codex)$/,
  sessionId: /^[A-Za-z0-9-]{8,80}$/,
};

/**
 * Registers the read-only session transcript route.
 * @param {ReturnType<import('../../http/router.mjs').createRouter>} router
 * @param {{sessionIndex: ReturnType<import('./sessions.repository.mjs').createSessionIndex>}} services
 */
export function registerSessionsRoutes(router, {sessionIndex}) {
  router.get(
    API_ROUTES.session,
    async ({response, params}) => {
      const session = await sessionIndex.read(params.tool, params.sessionId);
      if (!session) throw httpError(404, 'session not found in this workspace');
      sendJson(response, 200, session);
    },
    sessionParams,
  );
}
