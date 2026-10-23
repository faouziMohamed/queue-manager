/** @typedef {import('../../../shared/types.mjs').TokenUsage} TokenUsage */

/**
 * Token usage in one shape whatever the provider reported.
 * @param {{input?: number, output?: number, cacheRead?: number, total?: number, costUsd?: number}} [values]
 * @returns {TokenUsage}
 */
export function normalizeUsage({
  input = 0,
  output = 0,
  cacheRead = 0,
  total,
  costUsd,
} = {}) {
  const inputTokens = Number(input) || 0;
  const outputTokens = Number(output) || 0;
  const cacheReadTokens = Number(cacheRead) || 0;
  const totalTokens = Number(total) || inputTokens + outputTokens;
  const usage = {inputTokens, outputTokens, cacheReadTokens, totalTokens};
  if (typeof costUsd === 'number') usage.costUsd = costUsd;
  return usage;
}

/**
 * Usage from Claude Code's JSON output.
 * @param {Record<string, any>} payload
 * @returns {TokenUsage}
 */
export function claudeUsage(payload) {
  const source =
    payload.usage ||
    (payload.modelUsage ? Object.values(payload.modelUsage)[0] : undefined) ||
    {};
  return normalizeUsage({
    input: source.input_tokens,
    output: source.output_tokens,
    cacheRead: source.cache_read_input_tokens,
    costUsd: payload.total_cost_usd,
  });
}

/**
 * Usage from the first JSON event of Codex output that reports tokens.
 * @param {string} stdout
 * @returns {TokenUsage | undefined}
 */
export function codexUsage(stdout) {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const usage = findUsage(JSON.parse(trimmed));
      if (usage) return usage;
    } catch {}
  }
  return undefined;
}

function findUsage(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  if (
    'input_tokens' in value ||
    'output_tokens' in value ||
    'total_tokens' in value
  ) {
    return normalizeUsage({
      input: value.input_tokens,
      output: value.output_tokens,
      cacheRead: value.cached_input_tokens,
      total: value.total_tokens,
    });
  }
  for (const child of Object.values(value)) {
    const found = findUsage(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}
