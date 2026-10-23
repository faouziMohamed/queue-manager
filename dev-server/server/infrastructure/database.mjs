import {promises as fs} from 'node:fs';
import path from 'node:path';

const ignoredFiles = [
  'agent.env',
  'chats.sqlite',
  'chats.sqlite-wal',
  'chats.sqlite-shm',
  'dev-server.pid',
  'dev-server.log',
];

/**
 * Opens `.queue/chats.sqlite` once, owner-only and git-ignored, shared by chats and preferences.
 * @param {string} queueDir
 * @returns {{open: () => Promise<{available: true, db: import('node:sqlite').DatabaseSync} | {available: false, message: string}>}}
 */
export function createDatabase(queueDir) {
  let opening;

  return {
    open() {
      opening ??= openDatabase(queueDir).catch(error => {
        opening = undefined;
        throw error;
      });
      return opening;
    },
  };
}

async function openDatabase(queueDir) {
  let DatabaseSync;
  try {
    ({DatabaseSync} = await import('node:sqlite'));
  } catch {
    return {
      available: false,
      message: 'Chat history needs Node.js 22.13 or newer (node:sqlite).',
    };
  }
  await ensureIgnored(queueDir);
  const file = path.join(queueDir, 'chats.sqlite');
  const handle = await fs.open(file, 'a', 0o600);
  await handle.close();
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
  `);
  for (const suffix of ['', '-wal', '-shm']) {
    await fs.chmod(`${file}${suffix}`, 0o600).catch(() => {});
  }
  return {available: true, db};
}

async function ensureIgnored(queueDir) {
  const file = path.join(queueDir, '.gitignore');
  let current = '';
  try {
    current = await fs.readFile(file, 'utf8');
  } catch {}
  const lines = new Set(current.split('\n').map(line => line.trim()));
  const missing = ignoredFiles.filter(name => !lines.has(name));
  if (missing.length === 0) return;
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  await fs.appendFile(file, `${prefix}${missing.join('\n')}\n`);
}
