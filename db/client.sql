-- The phone's database. It mirrors the synced columns of db/migrations, with
-- no CHECKs or foreign keys: the server is the one that validates. Safe to run
-- on every start. Keep it in step with the migrations and web/src/types.ts.

CREATE TABLE IF NOT EXISTS person (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS menu_item (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    version    INTEGER NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS coffee_order (
    id           TEXT PRIMARY KEY,           -- day || ':' || person_id
    day          TEXT NOT NULL,              -- office-local date, YYYY-MM-DD
    person_id    TEXT NOT NULL,
    menu_item_id TEXT NOT NULL,
    size         TEXT NOT NULL DEFAULT 'regular',
    milk         TEXT,
    extras       TEXT NOT NULL DEFAULT '[]', -- sorted JSON array of strings
    note         TEXT,
    status       TEXT NOT NULL DEFAULT 'placed',
    updated_at   TEXT NOT NULL,
    version      INTEGER NOT NULL,           -- 0 = changed here, not confirmed yet
    deleted_at   TEXT
);

-- Changes waiting for POST /api/upload, oldest first. op is one Op as JSON.
CREATE TABLE IF NOT EXISTS outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    op         TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Small values to remember: cursor, me, notice.
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
