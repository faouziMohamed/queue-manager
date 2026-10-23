import {promises as fs} from 'node:fs';
import path from 'node:path';
import {
  clip,
  codeFence,
  describe,
  inlineCode,
  quoteBlock,
  toolResultText,
  toolUseText,
} from './session-format.util.mjs';

/** @typedef {import('../../../shared/types.mjs').SessionMessage} SessionMessage */

// Matches injected harness blocks that are not part of what the person or agent said.
const injectedPattern =
  /<(system-reminder|command-[a-z-]+|local-command-caveat|task-notification)>[\s\S]*?<\/\1[^>]*>/gi;
// Matches harness wrappers whose inner text is real content; only the tags are dropped.
const wrapperPattern =
  /<\/?(pasted_content|cross-session-message|local-command-stdout|local-command-stderr)[^>]*>/gi;
const MAX_TEXT = 20_000;

/**
 * Parses a Claude Code or Codex JSONL transcript into readable messages.
 * @param {'claude' | 'codex'} tool
 * @param {string} file
 * @returns {Promise<{tool: string, id: string, title: string, cwd: string, startedAt: number, automated: boolean, messages: SessionMessage[]}>}
 */
export async function parseSession(tool, file) {
  const text = await fs.readFile(file, 'utf8');
  return tool === 'claude' ? parseClaude(text, file) : parseCodex(text, file);
}

function emptySession(tool) {
  return {
    tool,
    id: '',
    title: '',
    cwd: '',
    startedAt: 0,
    automated: false,
    messages: [],
  };
}

function pushSegments(session, segments, timestamp, firstPrompt) {
  let first = firstPrompt;
  for (const segment of segments) {
    const cleaned = clean(segment.text);
    if (!cleaned) continue;
    if (segment.role === 'user' && !first) first = cleaned;
    session.messages.push({
      role: segment.role,
      ...describe(segment.role, cleaned),
      text: cleaned.slice(0, MAX_TEXT),
      timestamp,
    });
  }
  return first;
}

function parseClaude(text, file) {
  const session = emptySession('claude');
  session.id = path.basename(file, '.jsonl');
  let firstPrompt = '';
  for (const line of text.split('\n')) {
    const record = parseLine(line);
    if (!record) continue;
    if (record.entrypoint && record.entrypoint !== 'cli')
      session.automated = true;
    if (record.cwd && !session.cwd) session.cwd = record.cwd;
    if (record.type === 'ai-title' && record.aiTitle)
      session.title = String(record.aiTitle);
    if (record.type === 'summary' && record.summary && !session.title)
      session.title = String(record.summary);
    if (
      (record.type !== 'user' && record.type !== 'assistant') ||
      record.isMeta ||
      record.isSidechain
    )
      continue;
    const timestamp = Date.parse(record.timestamp) || 0;
    if (!session.startedAt && timestamp) session.startedAt = timestamp;
    firstPrompt = pushSegments(
      session,
      claudeSegments(record.type, record.message?.content),
      timestamp,
      firstPrompt,
    );
  }
  session.title = titleFrom(session.title || firstPrompt);
  return session;
}

function claudeSegments(role, content) {
  const segments = [];
  for (const part of contentParts(content)) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      segments.push({role, text: part.text});
    } else if (part?.type === 'thinking' && typeof part.thinking === 'string') {
      segments.push({
        role,
        text: `**Thinking**\n\n${quoteBlock(part.thinking)}`,
      });
    } else if (part?.type === 'tool_use') {
      segments.push({role: 'tool', text: toolUseText(part.name, part.input)});
    } else if (part?.type === 'tool_result') {
      segments.push({role: 'tool', text: toolResultText(part)});
    }
  }
  return segments;
}

function parseCodex(text, file) {
  const session = emptySession('codex');
  let firstPrompt = '';
  for (const line of text.split('\n')) {
    const record = parseLine(line);
    if (!record) continue;
    const payload = record.payload || {};
    if (record.type === 'session_meta') {
      session.id = String(payload.id || '');
      session.cwd = String(payload.cwd || '');
      session.startedAt = Date.parse(payload.timestamp) || 0;
      if (/sdk|exec/i.test(String(payload.originator || '')))
        session.automated = true;
      continue;
    }
    if (record.type !== 'response_item') continue;
    const timestamp = Date.parse(record.timestamp) || 0;
    firstPrompt = pushSegments(
      session,
      codexSegments(payload),
      timestamp,
      firstPrompt,
    );
  }
  if (!session.id) session.id = path.basename(file, '.jsonl').slice(-36);
  session.title = titleFrom(firstPrompt);
  return session;
}

function codexSegments(payload) {
  if (payload.type === 'message') {
    if (payload.role !== 'user' && payload.role !== 'assistant') return [];
    const raw = (Array.isArray(payload.content) ? payload.content : [])
      .filter(part => typeof part?.text === 'string')
      .map(part => part.text)
      .join('\n\n');
    if (!raw.trim()) return [];
    // Matches user messages that start with a harness tag, such as <environment_context>.
    if (payload.role === 'user' && /^\s*<[a-z_ -]+>/i.test(raw)) return [];
    return [{role: payload.role, text: raw}];
  }
  if (payload.type === 'function_call' || payload.type === 'local_shell_call') {
    return [{role: 'tool', text: codexCallText(payload)}];
  }
  if (payload.type === 'function_call_output') {
    const output =
      typeof payload.output === 'string'
        ? payload.output
        : JSON.stringify(payload.output ?? '');
    return output.trim()
      ? [{role: 'tool', text: `**Tool result**\n\n${codeFence(output)}`}]
      : [];
  }
  if (payload.type === 'reasoning') {
    const summary = Array.isArray(payload.summary)
      ? payload.summary
          .map(item => item?.text)
          .filter(Boolean)
          .join('\n')
      : '';
    const raw =
      summary || (typeof payload.content === 'string' ? payload.content : '');
    return raw.trim()
      ? [{role: 'assistant', text: `**Thinking**\n\n${quoteBlock(raw)}`}]
      : [];
  }
  return [];
}

function codexCallText(payload) {
  const name = String(payload.name || payload.action?.type || 'Tool');
  let args = {};
  try {
    args = JSON.parse(String(payload.arguments || '')) || {};
  } catch {}
  const command = args.command ?? args.cmd ?? payload.action?.command;
  if (typeof command === 'string' || Array.isArray(command)) {
    return `**${name}**\n\n${codeFence(Array.isArray(command) ? command.join(' ') : command, 'sh')}`;
  }
  const detail = command ?? args.description ?? '';
  if (detail)
    return `**${name}** · \`${inlineCode(clip(String(detail), 200))}\``;
  const raw = String(payload.arguments || '').trim();
  return raw
    ? `**${name}** · \`${inlineCode(clip(raw, 200))}\``
    : `**${name}**`;
}

function contentParts(content) {
  if (typeof content === 'string') return [{type: 'text', text: content}];
  return Array.isArray(content) ? content : [];
}

function parseLine(line) {
  if (!line) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function clean(value) {
  return String(value || '')
    .replace(injectedPattern, '')
    .replace(wrapperPattern, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFrom(value) {
  const line = String(value || '')
    .replace(/<\/?pasted_content[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return line.slice(0, 90) || 'Untitled session';
}
