// The database schema is created and upgraded by the Worker itself, so there
// is no separate migration step when deploying. To change the schema, append a
// new entry to MIGRATIONS — never edit one that has already shipped.
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      page_title TEXT NOT NULL,
      nav_title TEXT NOT NULL,
      nav_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('heading', 'subheading', 'text', 'image')),
      data TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS modules_page_position ON modules (page_id, position)`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      failures INTEGER NOT NULL,
      locked_until INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
  ],
];

let ready: Promise<void> | undefined;

/** Runs pending migrations once per Worker isolate. */
export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= migrate(db).catch((err) => {
    ready = undefined;
    throw err;
  });
  return ready;
}

export async function migrate(db: D1Database): Promise<void> {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    )
    .run();
  const row = await db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .first<{ version: number }>();

  for (let version = (row?.version ?? 0) + 1; version <= MIGRATIONS.length; version++) {
    await db.batch([
      ...MIGRATIONS[version - 1].map((sql) => db.prepare(sql)),
      db
        .prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
        .bind(version, new Date().toISOString()),
    ]);
  }
}
