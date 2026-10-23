import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {httpError} from '../../http/http.util.mjs';
import {commandExists, runCommand} from './agent-command.util.mjs';

/** @typedef {import('../../../shared/types.mjs').AgentProvider} AgentProvider */
/** @typedef {import('../../../shared/types.mjs').AgentAvailability} AgentAvailability */
/** @typedef {import('../../../shared/types.mjs').ModelChoice} ModelChoice */
/** @typedef {import('../../../shared/types.mjs').Workspace} Workspace */

const PROVIDERS = [
  'auto',
  'claude-cli',
  'claude-api',
  'codex-cli',
  'codex-api',
  'deepseek-cli',
  'deepseek',
];
const autoOrder = [
  ['claudeCli', 'claude-cli'],
  ['codexCli', 'codex-cli'],
  ['deepseekCli', 'deepseek-cli'],
  ['deepseek', 'deepseek'],
  ['claudeApi', 'claude-api'],
  ['codexApi', 'codex-api'],
];
const missingProvider = {
  'claude-cli': ['claudeCli', 'Claude CLI is not installed.'],
  'claude-api': [
    'claudeApi',
    'ANTHROPIC_API_KEY is not set or Claude CLI is missing.',
  ],
  'codex-cli': ['codexCli', 'Codex CLI is not installed.'],
  'codex-api': [
    'codexApi',
    'OPENAI_API_KEY is not set or Codex CLI is missing.',
  ],
  'deepseek-cli': [
    'deepseekCli',
    'The cdk DeepSeek route is not configured in ~/.bashrc.',
  ],
  deepseek: ['deepseek', 'DEEPSEEK_API_KEY is not set.'],
};
const claudeModels = [
  {value: 'opus', label: 'Opus'},
  {value: 'sonnet', label: 'Sonnet'},
  {value: 'haiku', label: 'Haiku'},
  {value: 'fable', label: 'Fable'},
];
const deepseekModels = [
  {value: 'deepseek-chat', label: 'DeepSeek Chat'},
  {value: 'deepseek-reasoner', label: 'DeepSeek Reasoner'},
];

let codexModelsCache = {at: 0, models: []};

/**
 * Which assistant providers this machine can use.
 * @returns {Promise<AgentAvailability>}
 */
export async function agentAvailability() {
  const [claudeCli, codexCli, deepseekCli] = await Promise.all([
    commandExists('claude'),
    commandExists('codex'),
    hasCdkRoute(),
  ]);
  return {
    claudeCli,
    claudeApi: Boolean(process.env.ANTHROPIC_API_KEY) && claudeCli,
    codexCli,
    codexApi: Boolean(process.env.OPENAI_API_KEY) && codexCli,
    deepseekCli,
    deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
  };
}

/**
 * Model choices per provider family; Codex models come from its CLI and are cached for 10 minutes.
 * @param {AgentAvailability} available
 * @returns {Promise<Record<'claude' | 'codex' | 'deepseek', ModelChoice[]>>}
 */
export async function agentModels(available) {
  const codex = available.codexCli ? await codexModels() : [];
  return {claude: claudeModels, codex, deepseek: deepseekModels};
}

/**
 * Concrete provider and model for a request, resolving Auto; throws 409 when it is not configured.
 * @param {Workspace} workspace
 * @param {{provider?: string, model?: string}} [selection]
 * @returns {Promise<{provider: Exclude<AgentProvider, 'auto'>, model: string}>}
 */
export async function resolveAgent(workspace, selection) {
  const config = selection?.provider
    ? {provider: selection.provider, model: selection.model || ''}
    : workspace.agent || {provider: 'auto', model: ''};
  if (!PROVIDERS.includes(config.provider))
    throw httpError(400, 'invalid agent provider');
  const available = await agentAvailability();
  let provider = config.provider;
  if (provider === 'auto') {
    provider = autoOrder.find(([flag]) => available[flag])?.[1];
  }
  if (!provider) {
    throw httpError(
      409,
      'No assistant is available. Install claude or codex, or set DEEPSEEK_API_KEY.',
    );
  }
  const [flag, message] = missingProvider[provider];
  if (!available[flag]) throw httpError(409, message);
  return {
    provider,
    model: config.model === 'default' ? '' : config.model || '',
  };
}

async function hasCdkRoute() {
  if (!(await commandExists('bash'))) return false;
  try {
    const bashrc = await fs.readFile(
      path.join(os.homedir(), '.bashrc'),
      'utf8',
    );
    // Matches a shell function definition named cdk, such as "cdk() {".
    return /\bcdk\s*\(\s*\)/.test(bashrc);
  } catch {
    return false;
  }
}

async function codexModels() {
  if (Date.now() - codexModelsCache.at < 10 * 60_000)
    return codexModelsCache.models;
  try {
    const {stdout} = await runCommand('codex', ['debug', 'models'], {
      cwd: os.tmpdir(),
      timeout: 20_000,
    });
    const catalog = JSON.parse(stdout);
    const models = (catalog.models || [])
      .filter(model => model.visibility === 'list' && model.slug)
      .sort((left, right) => (left.priority || 999) - (right.priority || 999))
      .slice(0, 24)
      .map(model => ({
        value: model.slug,
        label: model.display_name || model.slug,
      }));
    codexModelsCache = {at: Date.now(), models};
    return models;
  } catch {
    return [];
  }
}
