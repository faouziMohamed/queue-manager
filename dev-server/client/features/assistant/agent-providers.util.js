/** @typedef {import('../../../shared/types.mjs').AgentConfig} AgentConfig */
/** @typedef {import('../../../shared/types.mjs').AgentAvailability} AgentAvailability */

const providerNames = {
  'claude-cli': ['Claude CLI · subscription', 'Claude CLI', 'claudeCli'],
  'claude-api': ['Claude · API key', 'Claude · API key', 'claudeApi'],
  'codex-cli': ['Codex CLI · subscription', 'Codex CLI', 'codexCli'],
  'codex-api': ['Codex · API key', 'Codex · API key', 'codexApi'],
  'deepseek-cli': [
    'DeepSeek · CLI route',
    'DeepSeek · CLI route',
    'deepseekCli',
  ],
  deepseek: ['DeepSeek · API key', 'DeepSeek · API key', 'deepseek'],
};
const autoOrder = [
  'claude-cli',
  'codex-cli',
  'deepseek-cli',
  'deepseek',
  'claude-api',
  'codex-api',
];

/**
 * Long provider name, such as "Claude CLI · subscription".
 * @param {string} provider
 * @returns {string}
 */
export function providerLabel(provider) {
  return providerNames[provider]?.[0] || 'Assistant';
}

/**
 * Short provider name for compact labels.
 * @param {string} provider
 * @returns {string}
 */
export function providerShort(provider) {
  return providerNames[provider]?.[1] || 'Assistant';
}

/**
 * Whether a provider is configured on this machine.
 * @param {string} provider
 * @param {AgentAvailability | undefined} available
 * @returns {boolean}
 */
export function providerReady(provider, available) {
  const flag = providerNames[provider]?.[2];
  return Boolean(flag && available?.[flag]);
}

/**
 * Options for a provider selector: Auto plus every configured provider.
 * @param {AgentAvailability | undefined} available
 * @returns {{value: string, label: string}[]}
 */
export function providerChoices(available) {
  const choices = [{value: 'auto', label: 'Auto — first available'}];
  for (const provider of autoOrder) {
    if (providerReady(provider, available)) {
      choices.push({value: provider, label: providerLabel(provider)});
    }
  }
  return choices;
}

/**
 * Provider that Auto resolves to, or empty when none is configured.
 * @param {AgentAvailability | undefined} available
 * @returns {string}
 */
export function firstAvailable(available) {
  return autoOrder.find(provider => providerReady(provider, available)) || '';
}

/**
 * Model family of a provider selection: `claude`, `codex`, `deepseek` or empty.
 * @param {string} provider
 * @param {AgentAvailability | undefined} available
 * @returns {string}
 */
export function providerGroup(provider, available) {
  const resolved = provider === 'auto' ? firstAvailable(available) : provider;
  if (resolved.startsWith('claude')) return 'claude';
  if (resolved.startsWith('codex')) return 'codex';
  if (resolved.startsWith('deepseek')) return 'deepseek';
  return '';
}

/**
 * Label for who answered a message: the recorded agent, else the current selection.
 * @param {{provider: string, model: string} | undefined} agent
 * @param {AgentConfig | undefined} config
 * @param {AgentAvailability | undefined} available
 * @returns {string}
 */
export function agentLabel(agent, config, available) {
  if (agent?.provider) {
    return `${providerLabel(agent.provider)}${agent.model ? ` · ${agent.model}` : ''}`;
  }
  const resolved =
    config?.provider === 'auto' ? firstAvailable(available) : config?.provider;
  return resolved
    ? `${providerLabel(resolved)}${config?.model ? ` · ${config.model}` : ''}`
    : 'Assistant';
}
