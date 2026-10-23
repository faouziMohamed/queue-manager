import {escapeHtml} from '../../core/html.util.js';
import {fetchAgent, saveAgentConfig} from './agent.service.js';
import {
  firstAvailable,
  providerChoices,
  providerGroup,
  providerReady,
  providerShort,
} from './agent-providers.util.js';

/** @typedef {import('../../../shared/types.mjs').AgentConfig} AgentConfig */
/** @typedef {import('../../../shared/types.mjs').AgentAvailability} AgentAvailability */

/**
 * Drives the assistant's provider and model selectors and the status line above them.
 * @param {{providerSelect: HTMLSelectElement, modelSelect: HTMLSelectElement, providerLabelElement: HTMLElement, modelLabelElement: HTMLElement, connectionElement: HTMLElement, dotElement: HTMLElement, showToast: (message: string, tone?: string) => void}} elements
 * @returns {{refresh: () => Promise<void>, config: () => AgentConfig | undefined, available: () => AgentAvailability | undefined, selection: () => AgentConfig}}
 */
export function createAgentControls({
  providerSelect,
  modelSelect,
  providerLabelElement,
  modelLabelElement,
  connectionElement,
  dotElement,
  showToast,
}) {
  const state = {
    config: undefined,
    available: undefined,
    models: {},
    resetting: false,
  };

  async function refresh() {
    try {
      applyPayload(await fetchAgent());
      apply();
    } catch {
      providerLabelElement.textContent = 'Assistant unavailable';
      dotElement.classList.add('warn');
      connectionElement.textContent = '';
    }
  }

  function applyPayload(payload) {
    state.config = payload.config;
    state.available = payload.available;
    state.models = payload.models || state.models;
  }

  function apply() {
    const config = state.config || {provider: 'auto', model: ''};
    const provider = config.provider || 'auto';
    const choices = providerChoices(state.available);
    const selected = choices.some(choice => choice.value === provider)
      ? provider
      : 'auto';
    const model = selected === provider ? config.model || '' : '';
    populateProviders(choices, selected);
    const resolved =
      selected === 'auto' ? firstAvailable(state.available) : selected;
    providerLabelElement.textContent = providerText(selected, resolved);
    modelLabelElement.textContent = model || 'default model';
    const ready =
      selected === 'auto'
        ? Boolean(resolved)
        : providerReady(selected, state.available);
    dotElement.classList.toggle('warn', !ready);
    connectionElement.textContent = ready ? '' : 'not configured';
    populateModels(model);
    if (
      provider !== 'auto' &&
      selected !== provider &&
      state.available !== undefined &&
      !state.resetting
    ) {
      resetUnavailableProvider();
    }
  }

  function populateProviders(choices, selected) {
    providerSelect.innerHTML = choices
      .map(
        choice =>
          `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`,
      )
      .join('');
    providerSelect.value = choices.some(choice => choice.value === selected)
      ? selected
      : 'auto';
  }

  function populateModels(current) {
    const group = providerGroup(providerSelect.value, state.available);
    const list = state.models[group] || [];
    const options = ['<option value="">Default model</option>'];
    for (const model of list) {
      options.push(
        `<option value="${escapeHtml(model.value)}">${escapeHtml(model.label)}</option>`,
      );
    }
    if (current && !list.some(model => model.value === current)) {
      options.push(
        `<option value="${escapeHtml(current)}">${escapeHtml(current)}</option>`,
      );
    }
    modelSelect.innerHTML = options.join('');
    modelSelect.value = current;
  }

  async function resetUnavailableProvider() {
    state.resetting = true;
    try {
      applyPayload(await saveAgentConfig({provider: 'auto', model: ''}));
    } catch {
    } finally {
      state.resetting = false;
    }
  }

  async function save(provider, model) {
    try {
      applyPayload(await saveAgentConfig({provider, model}));
      apply();
      showToast('Assistant settings saved.', 'success');
    } catch (error) {
      apply();
      showToast(error.message, 'error');
    }
  }

  providerSelect.addEventListener('change', () => {
    populateModels('');
    save(providerSelect.value, '');
  });

  modelSelect.addEventListener('change', () => {
    save(providerSelect.value, modelSelect.value);
  });

  return {
    refresh,
    config: () => state.config,
    available: () => state.available,
    selection: () => ({
      provider: providerSelect.value || 'auto',
      model: modelSelect.value,
    }),
  };
}

function providerText(selected, resolved) {
  if (selected !== 'auto') return providerShort(selected);
  return resolved ? `Auto · ${providerShort(resolved)}` : 'Auto';
}
