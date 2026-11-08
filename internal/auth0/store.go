package auth0

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Token is one row of auth0_token.
type Token struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

var (
	ErrNoToken = errors.New("auth0: no token stored (set AUTH0_REFRESH_TOKEN once)")
	ErrDead    = errors.New("auth0: refresh token rejected, paste a new one")
)

type Store struct{ db *sql.DB }

func NewStore(db *sql.DB) Store { return Store{db: db} }

// Seed stores the very first refresh token. It does nothing if a row is
// already there, so a stale value left in the environment never overwrites
// a newer, rotated one.
func (s Store) Seed(ctx context.Context, refreshToken string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO auth0_token (id, refresh_token) VALUES (1, ?)`, refreshToken)
	return err
}

// Load reads row 1.
func (s Store) Load(ctx context.Context) (Token, error) {
	var t Token
	var expires int64
	var dead sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT access_token, refresh_token, expires_at, dead_reason FROM auth0_token WHERE id = 1`,
	).Scan(&t.AccessToken, &t.RefreshToken, &expires, &dead)
	if errors.Is(err, sql.ErrNoRows) {
		return Token{}, ErrNoToken
	}
	if err != nil {
		return Token{}, err
	}
	if dead.Valid {
		return Token{}, fmt.Errorf("%w: %s", ErrDead, dead.String)
	}
	t.ExpiresAt = time.Unix(expires, 0)
	return t, nil
}

// Save writes freshly refreshed tokens back to row 1.
func (s Store) Save(ctx context.Context, t Token, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE auth0_token
		SET access_token = ?, refresh_token = ?, expires_at = ?, refreshed_at = ?
		WHERE id = 1`,
		t.AccessToken, t.RefreshToken, t.ExpiresAt.Unix(), now.Unix())
	return err
}

// MarkDead records that Auth0 will never take this refresh token again.
func (s Store) MarkDead(ctx context.Context, reason string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE auth0_token SET dead_reason = ? WHERE id = 1`, reason)
	return err
}
