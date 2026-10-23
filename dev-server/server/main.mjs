import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {registerAgentRoutes} from './features/agent/agent.controller.mjs';
import {registerChatsRoutes} from './features/chats/chats.controller.mjs';
import {createChatsService} from './features/chats/chats.service.mjs';
import {registerDiscussionsRoutes} from './features/discussions/discussions.controller.mjs';
import {registerPitfallsRoutes} from './features/pitfalls/pitfalls.controller.mjs';
import {registerSessionsRoutes} from './features/sessions/sessions.controller.mjs';
import {createSessionIndex} from './features/sessions/sessions.repository.mjs';
import {registerTasksRoutes} from './features/tasks/tasks.controller.mjs';
import {createTasksRepository} from './features/tasks/tasks.repository.mjs';
import {createTasksService} from './features/tasks/tasks.service.mjs';
import {registerWorkspaceRoutes} from './features/workspace/workspace.controller.mjs';
import {createWorkspaceService} from './features/workspace/workspace.service.mjs';
import {httpError, isLoopback, sendJson} from './http/http.util.mjs';
import {createRouter} from './http/router.mjs';
import {createStaticFiles} from './http/static-files.mjs';
import {loadAgentEnv} from './infrastructure/agent-env.mjs';
import {createDatabase} from './infrastructure/database.mjs';
import {createQueueCli} from './infrastructure/queue-cli.mjs';

const uiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillDir = path.resolve(uiDir, '..');
const root = path.resolve(
  process.argv[2] || process.env.WORKSPACE_ROOT || process.cwd(),
);
const port = Number(process.argv[3] || process.env.PORT || 4317);
const queueDir = path.join(root, '.queue');

await loadAgentEnv(path.join(queueDir, 'agent.env'));

const queueCli = createQueueCli({
  root,
  queueScript: path.join(skillDir, 'scripts', 'queue.sh'),
});
const database = createDatabase(queueDir);
const workspaceService = createWorkspaceService({
  root,
  queueDir,
  database,
  queueCli,
});
await workspaceService.load();

const tasksRepository = createTasksRepository({
  queueDir,
  currentWorkspace: workspaceService.current,
});
const tasksService = createTasksService({
  root,
  tasksRepository,
  workspaceService,
  queueCli,
});
const chatsService = createChatsService({database, workspaceService});
const sessionIndex = createSessionIndex(root);
const services = {
  root,
  workspaceService,
  tasksService,
  chatsService,
  sessionIndex,
};

const router = createRouter();
registerWorkspaceRoutes(router, services);
registerAgentRoutes(router, services);
registerChatsRoutes(router, services);
registerTasksRoutes(router, services);
registerDiscussionsRoutes(router, services);
registerPitfallsRoutes(router, services);
registerSessionsRoutes(router, services);
const serveStatic = createStaticFiles(uiDir);

const server = createServer(async (request, response) => {
  try {
    if (!isLoopback(request)) {
      sendJson(response, 403, {
        error: 'the queue dev server is localhost-only',
      });
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (await serveStatic(request, response, url)) return;
    if (await router.handle(request, response, url)) return;
    throw httpError(404, 'not found');
  } catch (error) {
    sendJson(response, error.statusCode || 500, {error: error.message});
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`queue dev server: http://127.0.0.1:${port} (${root})`);
});
