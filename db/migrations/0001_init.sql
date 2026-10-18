CREATE TABLE sync_state (
                            id      INTEGER PRIMARY KEY CHECK (id = 1),
                            version INTEGER NOT NULL
);
INSERT INTO sync_state (id, version) VALUES (1, 0);

CREATE TABLE person (
                        id         TEXT PRIMARY KEY,
                        name       TEXT NOT NULL,
                        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                        version    INTEGER NOT NULL
);

CREATE TABLE session (
                         token_hash TEXT PRIMARY KEY,
                         person_id  TEXT NOT NULL REFERENCES person(id),
                         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE menu_item (
                           id         TEXT PRIMARY KEY,
                           name       TEXT NOT NULL UNIQUE,
                           version    INTEGER NOT NULL,
                           deleted_at TEXT
);

CREATE TABLE coffee_order (
                              id           TEXT PRIMARY KEY,          -- day || ':' || person_id
                              day          TEXT NOT NULL,             -- office-local date, YYYY-MM-DD
                              person_id    TEXT NOT NULL REFERENCES person(id),
                              menu_item_id TEXT NOT NULL REFERENCES menu_item(id),
                              size         TEXT NOT NULL DEFAULT 'regular'
                                  CHECK (size IN ('small', 'regular', 'large')),
                              milk         TEXT,
                              extras       TEXT NOT NULL DEFAULT '[]', -- sorted JSON array of strings
                              note         TEXT,
                              status       TEXT NOT NULL DEFAULT 'placed'
                                  CHECK (status IN ('placed', 'rejected')),
                              updated_at   TEXT NOT NULL,
                              version      INTEGER NOT NULL,
                              deleted_at   TEXT,
                              UNIQUE (day, person_id)
);

CREATE INDEX person_version       ON person(version);
CREATE INDEX menu_item_version    ON menu_item(version);
CREATE INDEX coffee_order_version ON coffee_order(version);