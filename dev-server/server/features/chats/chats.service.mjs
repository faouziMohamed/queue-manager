import {
  createChatsRepository,
  unavailableChatsRepository,
} from './chats.repository.mjs';

/**
 * Opens the chat repository on first use, once the queue is initialized.
 * @param {{database: ReturnType<import('../../infrastructure/database.mjs').createDatabase>, workspaceService: ReturnType<import('../workspace/workspace.service.mjs').createWorkspaceService>}} dependencies
 */
export function createChatsService({database, workspaceService}) {
  let repository;

  return {
    async store() {
      workspaceService.requireInitialized();
      const opened = await database.open();
      repository ??= opened.available
        ? createChatsRepository(opened.db)
        : unavailableChatsRepository(opened.message);
      return repository;
    },
  };
}
