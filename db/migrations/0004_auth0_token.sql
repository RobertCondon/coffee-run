-- The one Auth0 credential the server keeps alive. Exactly one row (id = 1).
CREATE TABLE auth0_token (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  access_token  TEXT    NOT NULL DEFAULT '',
  refresh_token TEXT    NOT NULL,
  expires_at    INTEGER NOT NULL DEFAULT 0,   -- unix seconds; 0 = refresh now
  refreshed_at  INTEGER,                      -- unix seconds of the last good refresh
  dead_reason   TEXT                          -- set once Auth0 rejects the refresh token
);
