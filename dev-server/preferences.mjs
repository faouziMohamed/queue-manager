export function openPreferences(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS preferences
        (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `)
    const listAll = db.prepare('SELECT key, value FROM preferences')
    const upsert = db.prepare(`
        INSERT INTO preferences (key, value)
        VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
    `)

    return {
        preferences() {
            return Object.fromEntries(listAll.all().map(row => [row.key, row.value]))
        },
        savePreferences(values) {
            for (const [key, value] of Object.entries(values)) upsert.run(key, String(value))
        },
    }
}

export function unavailablePreferences(fail) {
    return {preferences: () => ({}), savePreferences: fail}
}
