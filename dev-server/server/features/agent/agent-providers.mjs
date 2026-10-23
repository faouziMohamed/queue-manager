import {randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {httpError} from '../../http/http.util.mjs';
import {runCommand} from './agent-command.util.mjs';
import {claudeUsage, codexUsage, normalizeUsage} from './agent-usage.util.mjs';

/** @typedef {import('../../../shared/types.mjs').TokenUsage} TokenUsage */

const claudePrintArgs = [
  '--output-format',
  'json',
  '--permission-mode',
  'plan',
  '--permission-prompts',
  'none',
];
const inheritedModelKeys = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_EFFORT_LEVEL',
];

/**
 * Asks Claude Code in plan mode, through the subscription login or an API key.
 * @param {string} prompt
 * @param {string} model
 * @param {string} root
 * @param {string} [apiKey]
 * @returns {Promise<{text: string, usage?: TokenUsage}>}
 */
export async function runClaude(prompt, model, root, apiKey) {
  const args = ['-p', prompt, ...claudePrintArgs];
  if (model) args.push('--model', model);
  const {stdout} = await runCommand('claude', args, {
    cwd: root,
    env: claudeEnvironment(apiKey),
  });
  return claudeAnswer(stdout);
}

/**
 * Asks Claude Code routed to DeepSeek through the user's `cdk` shell function.
 * @param {string} prompt
 * @param {string} model
 * @param {string} root
 * @returns {Promise<{text: string, usage?: TokenUsage}>}
 */
export async function runDeepseekCli(prompt, model, root) {
  const args = ['-p', prompt, ...claudePrintArgs];
  if (model) args.push('--model', model);
  const {stdout} = await runCommand(
    'bash',
    ['-ic', 'cdk "$@"', 'queue-agent', ...args],
    {cwd: root},
  );
  return claudeAnswer(stdout);
}

/**
 * Asks Codex in a read-only sandbox.
 * @param {string} prompt
 * @param {string} model
 * @param {string} root
 * @param {string} [apiKey]
 * @returns {Promise<{text: string, usage?: TokenUsage}>}
 */
export async function runCodex(prompt, model, root, apiKey) {
  const output = path.join(os.tmpdir(), `qds-agent-${randomUUID()}.md`);
  const args = [
    'exec',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--color',
    'never',
    '--json',
    '-C',
    root,
    '-o',
    output,
  ];
  if (model) args.push('--model', model);
  args.push(prompt);
  const env = {...process.env};
  if (apiKey) env.OPENAI_API_KEY = apiKey;
  else delete env.OPENAI_API_KEY;
  try {
    const {stdout} = await runCommand('codex', args, {cwd: root, env});
    return {
      text: (await fs.readFile(output, 'utf8')).trim(),
      usage: codexUsage(stdout),
    };
  } finally {
    await fs.rm(output, {force: true}).catch(() => {});
  }
}

/**
 * Asks the DeepSeek chat completions API.
 * @param {string} system
 * @param {string} context
 * @param {{role: string, content: string}[]} messages
 * @param {string} model
 * @returns {Promise<{text: string, usage: TokenUsage}>}
 */
export async function runDeepseek(system, context, messages, model) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw httpError(409, 'DEEPSEEK_API_KEY is not set.');
  const base = (
    process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
  ).replace(/\/$/, '');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'deepseek-chat',
      temperature: 0.2,
      max_tokens: 8192,
      messages: [
        {role: 'system', content: `${system}\n\nQueue context:\n${context}`},
        ...messages,
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok)
    throw httpError(502, `DeepSeek request failed (${response.status}).`);
  const payload = await response.json();
  const source = payload.usage || {};
  return {
    text: String(payload.choices?.[0]?.message?.content || ''),
    usage: normalizeUsage({
      input: source.prompt_tokens,
      output: source.completion_tokens,
      total: source.total_tokens,
    }),
  };
}

function claudeAnswer(stdout) {
  try {
    const payload = JSON.parse(stdout);
    if (typeof payload.result === 'string') {
      return {text: payload.result, usage: claudeUsage(payload)};
    }
  } catch {}
  return {text: stdout.trim(), usage: undefined};
}

function claudeEnvironment(apiKey) {
  const env = {...process.env};
  for (const key of inheritedModelKeys) delete env[key];
  if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
  else delete env.ANTHROPIC_API_KEY;
  return env;
}
