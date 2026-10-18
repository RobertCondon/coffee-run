package server

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
)

const cookieName = "coffee_session"

var errNoSession = errors.New("no session")

type person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// currentPerson works out who sent the request from their session cookie.
func (s *Server) currentPerson(r *http.Request) (person, error) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return person{}, errNoSession
	}

	var p person
	err = s.db.QueryRowContext(r.Context(), `
		SELECT p.id, p.name
		FROM session AS s JOIN person AS p ON p.id = s.person_id
		WHERE s.token_hash = ?`, hashToken(c.Value)).Scan(&p.ID, &p.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return person{}, errNoSession
	}
	return p, err
}

// We store a hash of the token, so a leaked database can't sign anyone in.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// handleMe answers "who is this device signed in as?"
//
// YOUR TURN: replace the line below. Three steps:
//  1. p, err := s.currentPerson(r)
//  2. if err != nil, send a 401:  http.Error(w, "not signed in", http.StatusUnauthorized)  then return
//  3. otherwise send the person:   writeJSON(w, http.StatusOK, p)
func (s *Server) handleMe(responseWriter http.ResponseWriter, request *http.Request) {
	person, err := s.currentPerson(request)
	if err != nil {
		http.Error(responseWriter, "not signed in", http.StatusUnauthorized)
		return
	}
	writeJSON(responseWriter, http.StatusOK, person)
}

// handleSession signs a device in: the one time someone types their name.
func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	if p, err := s.currentPerson(r); err == nil {
		writeJSON(w, http.StatusOK, p) // already signed in on this device
		return
	}

	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `send JSON like {"name": "Aaron"}`, http.StatusBadRequest)
		return
	}
	name, err := cleanName(req.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	p := person{ID: rand.Text(), Name: name}
	token := rand.Text()
	err = s.write(r.Context(), func(tx *sql.Tx, v int64) error {
		if _, err := tx.Exec(`INSERT INTO person (id, name, version) VALUES (?, ?, ?)`, p.ID, p.Name, v); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO session (token_hash, person_id) VALUES (?, ?)`, hashToken(token), p.ID)
		return err
	})
	if err != nil {
		serverError(w, err)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   400 * 24 * 60 * 60, // the longest browsers allow
		HttpOnly: true,               // page scripts can't read it
		Secure:   r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusCreated, p)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func serverError(w http.ResponseWriter, err error) {
	log.Printf("error: %v", err)
	http.Error(w, "something went wrong on the server", http.StatusInternalServerError)
}
