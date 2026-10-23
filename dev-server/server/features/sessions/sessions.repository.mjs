import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseSession} from './session-transcript.parser.mjs';

/** @typedef {import('../../../shared/types.mjs').SessionMessage} SessionMessage */
/** @typedef {import('../../../shared/types.mjs').SessionSummary} SessionSummary */

// Matches queue task ids such as Q-0147.
const taskIdPattern = /\bQ-\d{4,}\b/g;
const sessionIdPattern = /^[A-Za-z0-9-]{8,80}$/;
const REFRESH_MS = 30_000;
const MAX_MESSAGES = 1000;

/**
 * Index of local Claude Code and Codex sessions run inside this project, refreshed at most every 30 s.
 * @param {string} root Project root; sessions elsewhere are ignored.
 * @returns {{enabled: boolean, readonly ready: boolean, forTask: (taskId: string) => Promise<SessionSummary[]>, read: (tool: string, id: string) => Promise<(SessionSummary & {messages: SessionMessage[]}) | undefined>}}
 */
export function createSessionIndex(root) {
  const enabled = process.env.QUEUE_AGENT_SESSIONS !== 'off';
  const claudeHome =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const files = new Map();
  let refreshedAt = 0;
  let refreshing;

  async function refresh() {
    if (!enabled) return;
    if (Date.now() - refreshedAt < REFRESH_MS) return;
    refreshing ??= (async () => {
      const candidates = [
        ...(await claudeFiles(claudeHome, root)),
        ...(await codexFiles(codexHome)),
      ];
      const seen = new Set();
      for (const candidate of candidates) {
        seen.add(candidate.file);
        const stat = await fs.stat(candidate.file).catch(() => undefined);
        if (!stat) continue;
        const cached = files.get(candidate.file);
        if (
          cached &&
          cached.mtimeMs === stat.mtimeMs &&
          cached.size === stat.size
        )
          continue;
        const parsed = await parseSession(candidate.tool, candidate.file).catch(
          () => undefined,
        );
        files.set(candidate.file, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          session: accept(parsed, root, stat),
        });
      }
      for (const file of files.keys()) if (!seen.has(file)) files.delete(file);
      refreshedAt = Date.now();
    })().finally(() => {
      refreshing = undefined;
    });
    await refreshing;
  }

  async function current() {
    if (files.size === 0) await refresh();
    else refresh().catch(() => {});
  }

  if (enabled) refresh().catch(() => {});

  return {
    enabled,
    get ready() {
      return refreshedAt > 0;
    },
    async forTask(taskId) {
      await current();
      return [...files.values()]
        .map(entry => entry.session)
        .filter(session => session?.mentions.has(taskId))
        .map(session => summary(session, taskId))
        .sort((left, right) => right.updatedAt - left.updatedAt);
    },
    async read(tool, id) {
      if (
        !['claude', 'codex'].includes(tool) ||
        !sessionIdPattern.test(String(id))
      )
        return undefined;
      await current();
      const entry = [...files.entries()].find(
        ([, value]) => value.session?.tool === tool && value.session.id === id,
      );
      if (!entry) return undefined;
      const parsed = await parseSession(tool, entry[0]);
      return {
        ...summary(entry[1].session),
        messages: parsed.messages.slice(-MAX_MESSAGES),
      };
    },
  };
}

function accept(parsed, root, stat) {
  if (!parsed || parsed.automated || parsed.messages.length === 0)
    return undefined;
  if (parsed.cwd !== root && !parsed.cwd.startsWith(`${root}/`))
    return undefined;
  const mentions = new Map();
  for (const message of parsed.messages) {
    for (const match of message.text.matchAll(taskIdPattern))
      mentions.set(match[0], (mentions.get(match[0]) || 0) + 1);
  }
  return {
    tool: parsed.tool,
    id: parsed.id,
    title: parsed.title,
    cwd: parsed.cwd,
    startedAt: parsed.startedAt || stat.birthtimeMs || stat.mtimeMs,
    updatedAt: stat.mtimeMs,
    messageCount: parsed.messages.length,
    mentions,
  };
}

function summary(session, taskId) {
  const resume =
    session.tool === 'claude'
      ? `claude --resume ${session.id}`
      : `codex resume ${session.id}`;
  return {
    tool: session.tool,
    id: session.id,
    title: session.title,
    cwd: session.cwd,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    mentionCount: taskId ? session.mentions.get(taskId) || 0 : undefined,
    resumeCommand: `cd ${shellQuote(session.cwd)} && ${resume}`,
  };
}

async function claudeFiles(home, root) {
  const projects = path.join(home, 'projects');
  const prefix = root.replace(/[^A-Za-z0-9]/g, '-');
  const directories = (await fs.readdir(projects).catch(() => [])).filter(
    name => name.startsWith(prefix),
  );
  const found = [];
  for (const directory of directories) {
    for (const name of await fs
      .readdir(path.join(projects, directory))
      .catch(() => [])) {
      if (name.endsWith('.jsonl'))
        found.push({
          tool: 'claude',
          file: path.join(projects, directory, name),
        });
    }
  }
  return found;
}

async function codexFiles(home) {
  const found = [];
  async function walk(directory, depth) {
    for (const entry of await fs
      .readdir(directory, {withFileTypes: true})
      .catch(() => [])) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < 4) await walk(target, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl'))
        found.push({tool: 'codex', file: target});
    }
  }
  await walk(path.join(home, 'sessions'), 0);
  return found;
}

function shellQuote(value) {
  // Matches values that are safe to pass to a shell unquoted.
  return /^[A-Za-z0-9_./-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, `'\\''`)}'`;
}
