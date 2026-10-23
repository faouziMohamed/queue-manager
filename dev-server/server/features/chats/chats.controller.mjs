import {API_ROUTES} from '../../../shared/routes.constant.mjs';
import {httpError, readJson, sendJson} from '../../http/http.util.mjs';

/**
 * Registers the chat history routes.
 * @param {ReturnType<import('../../http/router.mjs').createRouter>} router
 * @param {{chatsService: ReturnType<import('./chats.service.mjs').createChatsService>}} services
 */
export function registerChatsRoutes(router, {chatsService}) {
  router.get(API_ROUTES.chats, async ({response, url}) => {
    const store = await chatsService.store();
    sendJson(response, 200, {
      chats: store.list(
        url.searchParams.get('q'),
        url.searchParams.get('task'),
      ),
    });
  });

  router.post(API_ROUTES.chatsImport, async ({request, response}) => {
    const store = await chatsService.store();
    const payload = await readJson(request, 16_000_000);
    sendJson(response, 200, {imported: store.importMany(payload.threads)});
  });

  router.get(API_ROUTES.chat, async ({response, params}) => {
    const chat = (await chatsService.store()).get(params.chatId);
    if (!chat) throw httpError(404, 'chat not found');
    sendJson(response, 200, chat);
  });

  router.put(API_ROUTES.chat, async ({request, response, params}) => {
    const store = await chatsService.store();
    const payload = await readJson(request, 8_000_000);
    sendJson(response, 200, store.save(params.chatId, payload));
  });

  router.delete(API_ROUTES.chat, async ({response, params}) => {
    if (!(await chatsService.store()).remove(params.chatId))
      throw httpError(404, 'chat not found');
    sendJson(response, 200, {ok: true});
  });
}
