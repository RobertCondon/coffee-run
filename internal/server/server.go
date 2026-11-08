package server

import (
	"context"
	"database/sql"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

type Server struct {
	db  *sql.DB
	hub *Hub
	loc *time.Location
	now func() time.Time
	mux *http.ServeMux

	qrURL    string       // set by UseQR
	qrClient *http.Client // adds the Auth0 bearer token
}

func New(db *sql.DB, loc *time.Location, static fs.FS) *Server {
	s := &Server{db: db, hub: NewHub(), loc: loc, now: time.Now, mux: http.NewServeMux()}

	s.mux.HandleFunc("GET /api/session", s.handleMe)
	s.mux.HandleFunc("POST /api/session", s.handleSession)
	s.mux.HandleFunc("GET /api/sync", s.handleSync)
	s.mux.HandleFunc("POST /api/upload", s.handleUpload)
	s.mux.HandleFunc("GET /api/events", s.handleEvents)
	s.mux.HandleFunc("GET /api/loyalty", s.handleLoyalty)
	s.mux.Handle("GET /", cacheRules(http.FileServerFS(static)))
	return s
}

// cacheRules tells browsers how long to keep each file. Vite puts a hash in
// every name under /assets/, so a new build means new names: those can be
// kept for a year. Everything else (the page, version.json) must be checked
// with the server each time, or phones keep running the old build.
func cacheRules(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) today() string {
	return s.now().In(s.loc).Format(time.DateOnly)
}

// ---- C: every write goes through here ----

// write runs fn in a transaction with the next sync version, then pings
// every phone once it has committed.
func (s *Server) write(ctx context.Context, fn func(tx *sql.Tx, version int64) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() // does nothing once Commit has succeeded

	var version int64
	err = tx.QueryRowContext(ctx,
		`UPDATE sync_state SET version = version + 1 RETURNING version`).Scan(&version)
	if err != nil {
		return err
	}

	if err := fn(tx, version); err != nil {
		return err // the deferred Rollback undoes everything fn did
	}
	if err := tx.Commit(); err != nil {
		return err
	}

	s.hub.Publish(version)
	return nil
}
