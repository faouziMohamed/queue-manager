import {promises as fs} from 'node:fs';
import path from 'node:path';
import {withWorkspaceIdentity} from '../workspace/workspace.model.mjs';
import {parseTask, replaceBodyText} from './task-file.util.mjs';

/** @typedef {import('../../../shared/types.mjs').TaskRecord} TaskRecord */
/** @typedef {import('../../../shared/types.mjs').Workspace} Workspace */

const statuses = ['in-progress', 'ready', 'blocked', 'on-hold', 'done'];

/**
 * Reads task files and dependency edges from `.queue/`, and writes bodies atomically.
 * @param {{queueDir: string, currentWorkspace: () => Workspace}} options
 * @returns {{list: (options?: {keepBodies?: boolean}) => Promise<{tasks: TaskRecord[], gates: string[]}>, find: (id: string) => Promise<TaskRecord | undefined>, readBlockedBy: (id: string) => Promise<string[]>, writeBody: (task: TaskRecord, body: string) => Promise<boolean>}}
 */
export function createTasksRepository({queueDir, currentWorkspace}) {
  async function readBlockedBy(id) {
    try {
      const text = await fs.readFile(
        path.join(queueDir, 'deps', `${id}.blocked-by`),
        'utf8',
      );
      return text
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function list({keepBodies = false} = {}) {
    const tasks = [];
    for (const status of statuses) {
      let entries = [];
      try {
        entries = await fs.readdir(path.join(queueDir, status));
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const file = path.join(queueDir, status, entry);
        const parsed = parseTask(await fs.readFile(file, 'utf8'), status, file);
        if (!parsed) continue;
        const task = withWorkspaceIdentity(parsed, currentWorkspace());
        if (!keepBodies) task.body = '';
        task.blockedBy = await readBlockedBy(task.id);
        tasks.push(task);
      }
    }
    const gates = tasks.filter(task => task.prodGate).map(task => task.id);
    for (const task of tasks) {
      task.awaitingProduction = task.blockedBy.some(id => gates.includes(id));
    }
    tasks.sort((left, right) => left.id.localeCompare(right.id));
    return {tasks, gates};
  }

  async function find(id) {
    for (const status of statuses) {
      const file = path.join(queueDir, status, `${id}.md`);
      try {
        const parsed = parseTask(await fs.readFile(file, 'utf8'), status, file);
        if (parsed) return withWorkspaceIdentity(parsed, currentWorkspace());
      } catch {
        continue;
      }
    }
    return undefined;
  }

  async function writeBody(task, body) {
    const next = replaceBodyText(await fs.readFile(task.file, 'utf8'), body);
    if (next === undefined) return false;
    const temporary = `${task.file}.tmp.${process.pid}`;
    await fs.writeFile(temporary, next, 'utf8');
    await fs.rename(temporary, task.file);
    return true;
  }

  return {list, find, readBlockedBy, writeBody};
}
