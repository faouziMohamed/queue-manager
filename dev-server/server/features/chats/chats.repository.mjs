import {TASK_ID_PATTERN} from '../../../shared/routes.constant.mjs';
import {httpError} from '../../http/http.util.mjs';
import {
  CHAT_ID_PATTERN,
  chatFromRow,
  normalizeChat,
  searchText,
  summaryFromRow,
} from './chat.model.mjs';

const LIST_LIMIT = 200;
const upsertColumns = `
    INSERT INTO chats (id, title, created_at, updated_at, provider, model, message_count, search_text, messages, task_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      title = excluded.title,
      updated_at = excluded.updated_at,
      provider = excluded.provider,
      model = excluded.model,
      message_count = excluded.message_count,
      search_text = excluded.search_text,
      messages = excluded.messages,
      task_id = excluded.task_id`;
const summaryColumns =
  'id, title, created_at, updated_at, provider, model, message_count, task_id';

/**
 * Chat history stored in SQLite; creates or migrates the table on first use.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function createChatsRepository(db) {
  migrate(db);
  const upsert = db.prepare(
    `${upsertColumns} WHERE excluded.updated_at >= chats.updated_at`,
  );
  const insertNewer = db.prepare(
    `${upsertColumns} WHERE excluded.updated_at > chats.updated_at`,
  );
  const listAll = db.prepare(
    `SELECT ${summaryColumns} FROM chats ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}`,
  );
  const listMatching = db.prepare(`
    SELECT ${summaryColumns} FROM chats
    WHERE search_text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}
  `);
  const listForTask = db.prepare(`
    SELECT ${summaryColumns} FROM chats WHERE task_id = ? ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}
  `);
  const listRelated = db.prepare(`
    SELECT ${summaryColumns} FROM chats
    WHERE task_id = ? OR search_text LIKE ? ESCAPE '\\'
    ORDER BY updated_at DESC LIMIT ${LIST_LIMIT}
  `);
  const getOne = db.prepare('SELECT * FROM chats WHERE id = ?');
  const removeOne = db.prepare('DELETE FROM chats WHERE id = ?');

  function write(chat, statement = upsert) {
    return statement.run(
      chat.id,
      chat.title,
      chat.createdAt,
      chat.updatedAt,
      chat.provider,
      chat.model,
      chat.messages.length,
      searchText(chat),
      JSON.stringify(chat.messages),
      chat.taskId,
    );
  }

  return {
    available: true,
    list(query, taskId) {
      if (taskId)
        return listForTask.all(requireTaskId(taskId)).map(summaryFromRow);
      const term = String(query || '')
        .trim()
        .toLowerCase()
        .slice(0, 200);
      const rows = term
        ? listMatching.all(`%${escapeLike(term)}%`)
        : listAll.all();
      return rows.map(summaryFromRow);
    },
    related(taskId) {
      const id = requireTaskId(taskId);
      return listRelated
        .all(id, `%${escapeLike(id.toLowerCase())}%`)
        .map(row => ({...summaryFromRow(row), linked: row.task_id === id}));
    },
    get(id) {
      const row = getOne.get(requireChatId(id));
      return row ? chatFromRow(row) : undefined;
    },
    save(id, payload) {
      const existing = getOne.get(requireChatId(id));
      const now = Date.now();
      const chat = normalizeChat({
        title: payload.title,
        messages: payload.messages,
        taskId:
          payload.taskId === undefined && existing
            ? existing.task_id
            : payload.taskId,
        id,
        createdAt: existing ? existing.created_at : now,
        updatedAt: Math.max(now, existing ? existing.updated_at : 0),
      });
      write(chat);
      return summaryFromRow(getOne.get(chat.id));
    },
    remove(id) {
      return removeOne.run(requireChatId(id)).changes > 0;
    },
    importMany(threads) {
      if (!Array.isArray(threads))
        throw httpError(400, 'threads must be an array');
      let imported = 0;
      db.exec('BEGIN');
      try {
        for (const thread of threads.slice(0, 1000)) {
          if (!thread || !CHAT_ID_PATTERN.test(String(thread.id || '')))
            continue;
          const chat = normalizeChat(thread);
          if (chat.messages.length === 0) continue;
          if (write(chat, insertNewer).changes > 0) imported += 1;
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return imported;
    },
  };
}

/**
 * Stand-in used when `node:sqlite` is missing: every call answers 501.
 * @param {string} message
 */
export function unavailableChatsRepository(message) {
  function fail() {
    throw httpError(501, message);
  }
  return {
    available: false,
    list: fail,
    related: fail,
    get: fail,
    save: fail,
    remove: fail,
    importMany: fail,
  };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      message_count INTEGER NOT NULL,
      search_text TEXT NOT NULL,
      messages TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chats_updated_at ON chats (updated_at DESC);
  `);
  const columns = db
    .prepare('PRAGMA table_info(chats)')
    .all()
    .map(column => column.name);
  if (!columns.includes('task_id'))
    db.exec("ALTER TABLE chats ADD COLUMN task_id TEXT NOT NULL DEFAULT ''");
  db.exec(
    'CREATE INDEX IF NOT EXISTS chats_task_id ON chats (task_id, updated_at DESC)',
  );
}

function requireChatId(id) {
  const value = String(id || '');
  if (!CHAT_ID_PATTERN.test(value)) throw httpError(400, 'invalid chat id');
  return value;
}

function requireTaskId(value) {
  const id = String(value || '');
  if (!TASK_ID_PATTERN.test(id)) throw httpError(400, 'invalid task id');
  return id;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}
