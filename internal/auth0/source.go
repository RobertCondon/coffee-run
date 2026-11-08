package auth0

import (
	"cmp"
	"context"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"
)

// Refresh this long before the access token runs out.
const leeway = 5 * time.Minute

// Source hands out a valid access token, refreshing it when needed.
// One Source per process: its mutex is what stops two refreshes racing.
type Source struct {
	cfg   Config
	store Store
	http  *http.Client
	now   func() time.Time // tests swap this to fake "a day later"

	mu sync.Mutex
}

func NewSource(cfg Config, store Store) *Source {
	return &Source{cfg: cfg, store: store, http: &http.Client{Timeout: 30 * time.Second}, now: time.Now}
}

// AccessToken returns a token that is good for at least `leeway` more.
func (s *Source) AccessToken(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tok, err := s.store.Load(ctx)
	if err != nil {
		return "", err
	}
	if s.now().Before(tok.ExpiresAt.Add(-leeway)) {
		return tok.AccessToken, nil
	}

	tok, err = s.refreshLocked(ctx, tok)
	if err != nil {
		return "", err
	}
	return tok.AccessToken, nil
}

// refreshLocked swaps the refresh token for new tokens and saves them.
// The caller must hold s.mu.
func (s *Source) refreshLocked(ctx context.Context, old Token) (Token, error) {
	// Once we've sent the refresh token, Auth0 may already have used it up.
	// If the caller gives up halfway (closes the tab, times out), we must
	// still read the answer and save it, so cut the caller's cancel off.
	ctx = context.WithoutCancel(ctx)

	res, err := s.cfg.refresh(ctx, s.http, old.RefreshToken)
	if errors.Is(err, errRejected) {
		if markErr := s.store.MarkDead(ctx, err.Error()); markErr != nil {
			return Token{}, markErr
		}
		return Token{}, errors.Join(ErrDead, err)
	}
	if err != nil {
		return Token{}, err
	}

	now := s.now()
	fresh := Token{
		AccessToken:  res.AccessToken,
		RefreshToken: cmp.Or(res.RefreshToken, old.RefreshToken), // no rotation: keep the old one
		ExpiresAt:    now.Add(time.Duration(res.ExpiresIn) * time.Second),
	}
	if err := s.store.Save(ctx, fresh, now); err != nil {
		return Token{}, err
	}
	return fresh, nil
}

// Run refreshes ahead of time until ctx is cancelled, so the refresh token
// is used regularly even when nothing asks for an access token. That keeps
// Auth0's idle timer from running out.
func (s *Source) Run(ctx context.Context) {
	backoff := time.Minute
	for {
		tok, err := s.store.Load(ctx)
		if err != nil {
			log.Printf("auth0: stopping refresh loop: %v", err)
			return
		}
		if !sleep(ctx, max(tok.ExpiresAt.Add(-leeway).Sub(s.now()), 0)) {
			return
		}

		_, err = s.AccessToken(ctx)
		switch {
		case err == nil:
			backoff = time.Minute
		case errors.Is(err, ErrDead):
			log.Printf("auth0: stopping refresh loop: %v", err)
			return
		default: // Auth0 down, network blip: try again later, waiting longer each time
			log.Printf("auth0: refresh failed, retrying in %s: %v", backoff, err)
			if !sleep(ctx, backoff) {
				return
			}
			backoff = min(backoff*2, 30*time.Minute)
		}
	}
}

// sleep waits for d, or returns false early if ctx is cancelled.
func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// Client returns an *http.Client that adds "Authorization: Bearer …" to
// every request it sends.
func (s *Source) Client() *http.Client {
	return &http.Client{Transport: bearer{s}, Timeout: 30 * time.Second}
}

type bearer struct{ src *Source }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	tok, err := b.src.AccessToken(r.Context())
	if err != nil {
		return nil, err
	}
	r = r.Clone(r.Context()) // a RoundTripper must not change the caller's request
	r.Header.Set("Authorization", "Bearer "+tok)
	return http.DefaultTransport.RoundTrip(r)
}
