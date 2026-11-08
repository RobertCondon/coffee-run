package auth0

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/RobertCondon/coffee-run/db"
)

// fakeAuth0 behaves like Auth0 with refresh token rotation and reuse detection.
type fakeAuth0 struct {
	mu      sync.Mutex
	valid   map[string]bool // refresh tokens that still work
	used    map[string]bool
	n       int
	calls   atomic.Int32
	rotate  bool
	delay   time.Duration
	revoked bool
}

func newFake(first string, rotate bool) *fakeAuth0 {
	return &fakeAuth0{valid: map[string]bool{first: true}, used: map[string]bool{}, rotate: rotate}
}

func (f *fakeAuth0) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	time.Sleep(f.delay)
	if r.Method != http.MethodPost || r.URL.Path != "/oauth/token" || r.TLS == nil {
		http.Error(w, "wrong endpoint: "+r.Method+" "+r.URL.String(), http.StatusNotFound)
		return
	}
	r.ParseForm()
	rt := r.PostForm.Get("refresh_token")
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if f.used[rt] { // reuse detected: Auth0 kills the whole family
		f.valid, f.revoked = map[string]bool{}, true
	}
	if r.PostForm.Get("grant_type") != "refresh_token" || !f.valid[rt] {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant", "error_description": "Unknown or invalid refresh token."})
		return
	}
	f.n++
	res := map[string]any{"access_token": fmt.Sprintf("at-%d", f.n), "expires_in": 86400, "token_type": "Bearer"}
	if f.rotate {
		delete(f.valid, rt)
		f.used[rt] = true
		next := fmt.Sprintf("rt-%d", f.n)
		f.valid[next] = true
		res["refresh_token"] = next
	}
	json.NewEncoder(w).Encode(res)
}

func setup(t *testing.T, f *fakeAuth0) (*Source, Store) {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(context.Background(), conn); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewTLSServer(f) // real https, like Auth0
	t.Cleanup(srv.Close)
	store := NewStore(conn)
	if err := store.Seed(context.Background(), "rt-0"); err != nil {
		t.Fatal(err)
	}
	// Domain is a bare host, as AUTH0_DOMAIN will be; the code adds https://.
	src := NewSource(Config{Domain: strings.TrimPrefix(srv.URL, "https://"), ClientID: "cid"}, store)
	src.http = srv.Client() // trusts the test server's certificate
	return src, store
}

func TestRefreshAndRotate(t *testing.T) {
	f := newFake("rt-0", true)
	src, store := setup(t, f)
	ctx := context.Background()

	at, err := src.AccessToken(ctx)
	if err != nil || at != "at-1" {
		t.Fatalf("got %q %v", at, err)
	}
	tok, _ := store.Load(ctx)
	if tok.RefreshToken != "rt-1" {
		t.Fatalf("rotated refresh token not saved: %q", tok.RefreshToken)
	}
	// Still fresh: no second call.
	if at, _ := src.AccessToken(ctx); at != "at-1" || f.calls.Load() != 1 {
		t.Fatalf("expected cached token, calls=%d", f.calls.Load())
	}
	// Time passes: refreshes with rt-1.
	src.now = func() time.Time { return time.Now().Add(24 * time.Hour) }
	if at, err := src.AccessToken(ctx); at != "at-2" || err != nil {
		t.Fatalf("got %q %v", at, err)
	}
}

func TestNoRotationKeepsOldRefreshToken(t *testing.T) {
	src, store := setup(t, newFake("rt-0", false))
	if _, err := src.AccessToken(context.Background()); err != nil {
		t.Fatal(err)
	}
	tok, _ := store.Load(context.Background())
	if tok.RefreshToken != "rt-0" {
		t.Fatalf("lost refresh token: %q", tok.RefreshToken)
	}
}

func TestConcurrentCallersRefreshOnce(t *testing.T) {
	f := newFake("rt-0", true)
	f.delay = 50 * time.Millisecond
	src, _ := setup(t, f)
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			if _, err := src.AccessToken(context.Background()); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if c := f.calls.Load(); c != 1 || f.revoked {
		t.Fatalf("calls=%d revoked=%v", c, f.revoked)
	}
}

func TestCallerCancelStillSaves(t *testing.T) {
	f := newFake("rt-0", true)
	f.delay = 100 * time.Millisecond
	src, store := setup(t, f)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	src.AccessToken(ctx)
	tok, err := store.Load(context.Background())
	if err != nil || tok.RefreshToken != "rt-1" {
		t.Fatalf("rotated token lost after cancel: %q %v", tok.RefreshToken, err)
	}
}

func TestRejectedMarksDead(t *testing.T) {
	f := newFake("something-else", true)
	src, _ := setup(t, f)
	_, err := src.AccessToken(context.Background())
	if !errors.Is(err, ErrDead) {
		t.Fatalf("want ErrDead, got %v", err)
	}
	_, err = src.AccessToken(context.Background())
	if !errors.Is(err, ErrDead) || f.calls.Load() != 1 {
		t.Fatalf("should not call Auth0 again: calls=%d err=%v", f.calls.Load(), err)
	}
}

func TestSeedDoesNotOverwrite(t *testing.T) {
	src, store := setup(t, newFake("rt-0", true))
	src.AccessToken(context.Background())
	store.Seed(context.Background(), "rt-0") // stale env var on restart
	tok, _ := store.Load(context.Background())
	if tok.RefreshToken != "rt-1" {
		t.Fatalf("seed clobbered rotated token: %q", tok.RefreshToken)
	}
}

func TestClientAddsBearer(t *testing.T) {
	src, _ := setup(t, newFake("rt-0", true))
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(r.Header.Get("Authorization")))
	}))
	defer api.Close()
	res, err := src.Client().Get(api.URL)
	if err != nil {
		t.Fatal(err)
	}
	var b [64]byte
	n, _ := res.Body.Read(b[:])
	if string(b[:n]) != "Bearer at-1" {
		t.Fatalf("got %q", b[:n])
	}
}

func TestRunRefreshesAhead(t *testing.T) {
	f := newFake("rt-0", true)
	src, store := setup(t, f)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { src.Run(ctx); close(done) }()
	deadline := time.Now().Add(2 * time.Second)
	for f.calls.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	tok, _ := store.Load(context.Background())
	if tok.RefreshToken != "rt-1" {
		t.Fatalf("Run did not refresh: %q", tok.RefreshToken)
	}
}

func TestTokenURL(t *testing.T) {
	got := Config{Domain: "dev-abc123.us.auth0.com"}.tokenURL()
	if got != "https://dev-abc123.us.auth0.com/oauth/token" {
		t.Fatalf("got %q", got)
	}
}
