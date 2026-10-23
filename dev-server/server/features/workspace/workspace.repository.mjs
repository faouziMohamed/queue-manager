import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathExists} from '../../infrastructure/fs.util.mjs';
import {modeFor, normalizeWorkspaceConfig} from './workspace.model.mjs';

/** @typedef {import('../../../shared/types.mjs').Workspace} Workspace */

const workspaceMarkers = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'turbo.json',
  'nx.json',
  'rush.json',
];

/**
 * Default settings guessed from the folder: monorepo markers or nested Git repositories.
 * @param {string} rootPath
 * @returns {Promise<Workspace>}
 */
export async function detectWorkspace(rootPath) {
  const repos = [];
  const entries = await fs.readdir(rootPath, {withFileTypes: true});
  for (const entry of entries) {
    if (!isProjectFolder(entry)) continue;
    const directory = path.join(rootPath, entry.name);
    if (await pathExists(path.join(directory, '.git'))) {
      repos.push(entry.name);
      continue;
    }
    let children = [];
    try {
      children = await fs.readdir(directory, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const child of children) {
      if (!isProjectFolder(child)) continue;
      if (await pathExists(path.join(directory, child.name, '.git'))) {
        repos.push(`${entry.name}/${child.name}`);
      }
    }
  }

  const layout = layoutFor(await hasWorkspaceMarker(rootPath), repos);
  return {
    name: path.basename(rootPath),
    layout,
    mode: modeFor(layout),
    view: 'list',
    design: 'jira',
    wipLimit: 1,
    repos: repos.sort(),
    agent: {provider: 'auto', model: ''},
  };
}

/**
 * Settings from `.queue/config.json`, or the detected defaults.
 * @param {string} rootPath
 * @param {Workspace} detected
 * @returns {Promise<Workspace>}
 */
export async function readWorkspaceConfig(rootPath, detected) {
  try {
    const text = await fs.readFile(
      path.join(rootPath, '.queue', 'config.json'),
      'utf8',
    );
    return normalizeWorkspaceConfig(JSON.parse(text), detected.name);
  } catch {
    return detected;
  }
}

/**
 * Writes `.queue/config.json`; display preferences go there only when SQLite is unavailable.
 * @param {string} rootPath
 * @param {Workspace} config
 * @param {{includePreferences?: boolean}} [options]
 * @returns {Promise<void>}
 */
export async function writeWorkspaceConfig(
  rootPath,
  config,
  {includePreferences = false} = {},
) {
  const directory = path.join(rootPath, '.queue');
  await fs.mkdir(directory, {recursive: true});
  const preferences = includePreferences
    ? {view: config.view, design: config.design}
    : {};
  await fs.writeFile(
    path.join(directory, 'config.json'),
    `${JSON.stringify(
      {
        version: 1,
        name: config.name,
        layout: config.layout,
        ...preferences,
        wipLimit: config.wipLimit,
        repos: config.repos,
        agent: config.agent,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function isProjectFolder(entry) {
  return (
    entry.isDirectory() &&
    !entry.name.startsWith('.') &&
    entry.name !== 'node_modules'
  );
}

function layoutFor(monorepo, repos) {
  if (monorepo) return 'monorepo';
  return repos.length > 0 ? 'workspace' : 'single-repo';
}

async function hasWorkspaceMarker(rootPath) {
  for (const marker of workspaceMarkers) {
    if (await pathExists(path.join(rootPath, marker))) return true;
  }
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(rootPath, 'package.json'), 'utf8'),
    );
    return Boolean(manifest.workspaces);
  } catch {
    return false;
  }
}
