package server

import (
	"context"
	"database/sql"
	"io/fs"
	"net/http"
	"time"
)

type Server struct {
	db  *sql.DB
	hub *Hub
	loc *time.Location
	now func() time.Time
	mux *http.ServeMux
}

func New(db *sql.DB, loc *time.Location, static fs.FS) *Server {
	s := &Server{db: db, hub: NewHub(), loc: loc, now: time.Now, mux: http.NewServeMux()}

	s.mux.HandleFunc("GET /api/session", s.handleMe)
	s.mux.HandleFunc("POST /api/session", s.handleSession)
	s.mux.HandleFunc("GET /api/sync", s.handleSync)
	s.mux.HandleFunc("POST /api/upload", s.handleUpload)
	s.mux.HandleFunc("GET /api/events", s.handleEvents)
	s.mux.Handle("GET /", http.FileServerFS(static))
	return s
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
