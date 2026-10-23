import path from 'node:path';
import {httpError} from '../../http/http.util.mjs';
import {pathExists} from '../../infrastructure/fs.util.mjs';
import {createPreferencesRepository} from '../preferences/preferences.repository.mjs';
import {
  normalizePreferences,
  normalizeWorkspaceConfig,
} from './workspace.model.mjs';
import {
  detectWorkspace,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from './workspace.repository.mjs';

/**
 * Holds the current settings and initialization state, and saves them to config and preferences.
 * @param {{root: string, queueDir: string, database: ReturnType<import('../../infrastructure/database.mjs').createDatabase>, queueCli: ReturnType<import('../../infrastructure/queue-cli.mjs').createQueueCli>}} dependencies
 */
export function createWorkspaceService({root, queueDir, database, queueCli}) {
  let workspace;
  let initialized = false;
  let preferences;

  async function load() {
    workspace = await readWorkspaceConfig(root, await detectWorkspace(root));
    initialized = await pathExists(queueDir);
    const store = await preferenceStore();
    if (!store) return;
    workspace = {
      ...workspace,
      ...normalizePreferences({...workspace, ...store.read()}),
    };
  }

  function requireInitialized() {
    if (!initialized) throw httpError(409, 'initialize the queue first');
  }

  async function preferenceStore() {
    if (!initialized) return null;
    try {
      const opened = await database.open();
      if (!opened.available) return null;
      preferences ??= createPreferencesRepository(opened.db);
      return preferences;
    } catch {
      return null;
    }
  }

  async function save(config) {
    const store = await preferenceStore();
    if (store) store.save(normalizePreferences(config));
    await writeWorkspaceConfig(root, config, {includePreferences: !store});
  }

  return {
    load,
    requireInitialized,
    current: () => workspace,
    isInitialized: () => initialized,

    async saveConfig(payload) {
      requireInitialized();
      const config = normalizeWorkspaceConfig(payload, workspace.name);
      await save(config);
      workspace = config;
      return workspace;
    },

    async initialize(payload) {
      if (initialized) throw httpError(409, 'the queue is already initialized');
      const config = normalizeWorkspaceConfig(payload, path.basename(root));
      await queueCli.run(['init']);
      initialized = true;
      await save(config);
      workspace = config;
      return workspace;
    },

    async saveAgent(payload) {
      requireInitialized();
      const config = normalizeWorkspaceConfig(
        {
          ...workspace,
          agent: {provider: payload.provider, model: payload.model},
        },
        workspace.name,
      );
      await save(config);
      workspace = config;
      return workspace;
    },
  };
}
