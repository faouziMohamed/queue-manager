/** @typedef {import('../../../shared/types.mjs').SessionMessage} SessionMessage */

const MAX_TOOL_TEXT = 8_000;
const toolDetailFields = {
  Read: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  Glob: 'pattern',
  Grep: 'pattern',
  Task: 'description',
  Agent: 'description',
  WebFetch: 'url',
  WebSearch: 'query',
  Skill: 'skill',
};

/**
 * Kind and one-line summary of a transcript message, so the viewer can collapse
 * tool steps and thinking the way the CLI does.
 * @param {string} role
 * @param {string} text
 * @returns {{kind: SessionMessage['kind'], summary: string}}
 */
export function describe(role, text) {
  if (role === 'tool') {
    const result = text.startsWith('**Tool result');
    const firstLine = result
      ? ''
      : text.split('\n').find(line => line.trim()) || '';
    const command =
      !result && text.startsWith('**Bash**')
        ? // Matches the first line inside the Bash code fence.
          (text.match(/```[a-z]*\n([^\n]*)/) || [])[1] || ''
        : '';
    const summary = toolSummary(text, result, command, firstLine);
    return {kind: result ? 'result' : 'call', summary: summary.slice(0, 160)};
  }
  if (text.startsWith('**Thinking**'))
    return {kind: 'thinking', summary: 'Thinking'};
  return {kind: 'text', summary: ''};
}

/**
 * Markdown for a Claude tool call: the tool name and its main argument.
 * @param {string} name
 * @param {unknown} input
 * @returns {string}
 */
export function toolUseText(name, input) {
  const label = String(name || 'Tool');
  const values = input && typeof input === 'object' ? input : {};
  const field = toolDetailFields[label];
  const detail = field
    ? values[field]
    : (values.command ?? values.description ?? values.path ?? values.query);
  if (detail == null || detail === '') return `**${label}**`;
  if (label === 'Bash')
    return `**Bash**\n\n${codeFence(Array.isArray(detail) ? detail.join(' ') : detail, 'sh')}`;
  const text = String(Array.isArray(detail) ? detail.join(' ') : detail)
    .replace(/\s+/g, ' ')
    .trim();
  return text
    ? `**${label}** · \`${inlineCode(clip(text, 200))}\``
    : `**${label}**`;
}

/**
 * Markdown for a Claude tool result, or empty when it has no text.
 * @param {Record<string, any>} part
 * @returns {string}
 */
export function toolResultText(part) {
  const text = contentText(part?.content);
  if (!text.trim()) return '';
  return `**Tool result${part.is_error ? ' · error' : ''}**\n\n${codeFence(text)}`;
}

/**
 * Fenced code block, clipped and safe against nested fences.
 * @param {string} value
 * @param {string} [language]
 * @returns {string}
 */
export function codeFence(value, language = '') {
  const body = clip(value, MAX_TOOL_TEXT).replace(/```/g, '``​`');
  return `\`\`\`${language}\n${body}\n\`\`\``;
}

/**
 * Text safe inside a single-backtick code span.
 * @param {unknown} value
 * @returns {string}
 */
export function inlineCode(value) {
  return String(value).replace(/`/g, "'");
}

/**
 * Clipped Markdown blockquote.
 * @param {string} value
 * @returns {string}
 */
export function quoteBlock(value) {
  return clip(value, MAX_TOOL_TEXT)
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

/**
 * Text cut at a limit, noting how many characters were dropped.
 * @param {unknown} value
 * @param {number} limit
 * @returns {string}
 */
export function clip(value, limit) {
  const text = String(value ?? '');
  return text.length > limit
    ? `${text.slice(0, limit)}\n… +${text.length - limit} more characters`
    : text;
}

function toolSummary(text, result, command, firstLine) {
  if (result) return text.includes('· error') ? 'Result · error' : 'Result';
  if (command) return `Bash · ${command}`;
  return firstLine.replace(/\*\*/g, '').replace(/`/g, '');
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(item => typeof item?.text === 'string')
    .map(item => item.text)
    .join('\n\n');
}
