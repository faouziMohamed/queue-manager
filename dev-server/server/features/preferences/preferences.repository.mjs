/**
 * Per-machine display preferences (Design, Queue view) stored in SQLite.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {{read: () => Record<string, string>, save: (values: Record<string, unknown>) => void}}
 */
export function createPreferencesRepository(db) {
  db.exec(`
        CREATE TABLE IF NOT EXISTS preferences
        (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);
  const listAll = db.prepare('SELECT key, value FROM preferences');
  const upsert = db.prepare(`
        INSERT INTO preferences (key, value)
        VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `);

  return {
    read() {
      return Object.fromEntries(listAll.all().map(row => [row.key, row.value]));
    },
    save(values) {
      for (const [key, value] of Object.entries(values))
        upsert.run(key, String(value));
    },
  };
}
