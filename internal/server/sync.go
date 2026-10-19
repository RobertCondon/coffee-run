package server

// =============================================================================
// STEP 7: PULL — "what changed since version N?"
//
// A phone remembers the highest version number it has seen (its "cursor").
// It calls:
//
//	GET /api/sync?since=41
//
// and gets back every person, menu item and order whose version is above 41,
// plus the new cursor to remember for next time:
//
//	{"cursor": 44, "people": [...], "menu_items": [...], "orders": [...]}
//
// What's already done in this file:  queryAll (bottom of the file).
// What you write:                     Problem 1 (the types) and Problem 2
//                                     (handleSync). Also uncomment the
//                                     "GET /api/sync" route in server.go.
//
// When you add code that uses strconv and time, add them to the imports
// (or let the IDE's Optimize imports do it).
// =============================================================================

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"time"
)

// -----------------------------------------------------------------------------
// PROBLEM 1: four struct types. Write them here.
//
// Each one mirrors a table's columns, plus `json:"…"` tags so the JSON keys
// match the column names. Look at db/migrations/0001_init.sql while you write.
//
// Type rules:
//   - TEXT NOT NULL      → string
//   - TEXT that can be NULL (milk, note, deleted_at) → *string
//     (a pointer can be nil, which becomes null in JSON)
//   - INTEGER            → int64
//
// 1. syncPerson:   ID, Name, Version
//      e.g.  ID string `json:"id"`
//
// 2. syncMenuItem: ID, Name, Version, DeletedAt (*string, `json:"deleted_at"`)
//
// 3. syncOrder:    ID, Day, PersonID, MenuItemID, Size, Milk (*string),
//                  Extras (string — the JSON text as stored, e.g. "[]"),
//                  Note (*string), Status, UpdatedAt, Version, DeletedAt (*string)
//      JSON keys use the column names: "person_id", "menu_item_id", "updated_at"…
//
// 4. syncResponse: what handleSync sends back.
//      Cursor    int64          `json:"cursor"`
//      People    []syncPerson   `json:"people"`
//      MenuItems []syncMenuItem `json:"menu_items"`
//      Orders    []syncOrder    `json:"orders"`
//
// Why not reuse the person type from session.go? That one has no Version,
// and it's the shape for "who am I", not for syncing.
// -----------------------------------------------------------------------------

type syncPerson struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version int64  `json:"version"`
}

type syncMenuItem struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Version   int64   `json:"version"`
	DeletedAt *string `json:"deleted_at"`
}

type syncOrder struct {
	ID         string  `json:"id"`
	Day        string  `json:"day"`
	PersonID   string  `json:"person_id"`
	MenuItemID string  `json:"menu_item_id"`
	Size       string  `json:"size"`
	Milk       *string `json:"milk"`
	Extras     string  `json:"extras"`
	Note       *string `json:"note"`
	Status     string  `json:"status"`
	UpdatedAt  string  `json:"updated_at"`
	Version    int64   `json:"version"`
	DeletedAt  *string `json:"deleted_at"`
}

type syncResponse struct {
	Cursor    int64          `json:"cursor"`
	People    []syncPerson   `json:"people"`
	MenuItems []syncMenuItem `json:"menu_items"`
	Orders    []syncOrder    `json:"orders"`
}

// Phones only keep the last two weeks of orders. Older days come later from a
// separate history endpoint. You'll use this in handleSync.
const keepDays = 14

// -----------------------------------------------------------------------------
// PROBLEM 2: handleSync. Replace the http.Error line inside it.
//
// Do these in order. Each one is a few lines.
//
//	a) Signed in? Call s.currentPerson(r). If err != nil, reply 401
//	   ("sign in first") and return. You don't need the person itself,
//	   so use _ for it:  if _, err := s.currentPerson(r); err != nil { … }
//
//	b) Read ?since= from the URL as a number:
//	     r.URL.Query().Get("since")         → the text, "" if missing
//	     strconv.ParseInt(text, 10, 64)     → (int64, error)
//	   A missing or bad value should just mean 0, so you can ignore the
//	   error with _ here.
//
//	c) Work out the oldest day to send:
//	     today in Auckland, minus (keepDays - 1) days, as "YYYY-MM-DD".
//	   Hint: s.now().In(s.loc).AddDate(0, 0, -(keepDays - 1)).Format(time.DateOnly)
//
//	d) Start a transaction so all three queries see the same snapshot:
//	     ctx := r.Context()
//	     tx, err := s.db.BeginTx(ctx, nil)    → serverError on error
//	     defer tx.Rollback()                  (we only read, so never Commit)
//
//	e) Make the response and fill in the cursor:
//	     var response syncResponse
//	     SELECT version FROM sync_state  → Scan(&response.Cursor)
//	   Use tx.QueryRowContext, not s.db. On error: serverError and return.
//
//	f) Fill response.People with queryAll (see the example at the bottom):
//	     SQL:  SELECT id, name, version FROM person WHERE version > ?
//	     args: since
//
//	g) Fill response.MenuItems the same way:
//	     SQL:  SELECT id, name, version, deleted_at FROM menu_item WHERE version > ?
//
//	h) Fill response.Orders the same way, all 12 columns, in table order:
//	     SQL:  SELECT id, day, person_id, …, deleted_at FROM coffee_order
//	           WHERE version > ? AND day >= ?
//	     args: since, oldest     (two ?, two values, same order)
//	   Scan into all 12 fields in the SAME order as the SELECT.
//
//	i) writeJSON(w, http.StatusOK, response)
//
// After each queryAll: if err != nil { serverError(w, err); return }
// -----------------------------------------------------------------------------
func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	_, signin_error := s.currentPerson(r)
	if signin_error != nil {
		http.Error(w, "sign in first", http.StatusUnauthorized)
		return
	}

	since_string := r.URL.Query().Get("since")
	since_int, _ := strconv.ParseInt(since_string, 10, 64)
	oldest_ever_day := s.now().In(s.loc).AddDate(0, 0, -(keepDays - 1)).Format(time.DateOnly)

	ctx := r.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		serverError(w, err)
		return
	}
	defer tx.Rollback()

	var response syncResponse

	err = tx.QueryRowContext(ctx, `SELECT version FROM sync_state`).Scan(&response.Cursor)
	if err != nil {
		serverError(w, err)
		return
	}

	response.People, err = queryPeople(ctx, tx, since_int)
	if err != nil {
		serverError(w, err)
		return
	}

	response.MenuItems, err = queryMenuItems(ctx, tx, since_int)
	if err != nil {
		serverError(w, err)
		return
	}

	response.Orders, err = queryOrders(ctx, tx, since_int, oldest_ever_day)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, response)
}

// queryOrders returns every order changed since the given version, from the
// last keepDays days only.
func queryOrders(ctx context.Context, tx *sql.Tx, since int64, oldest string) ([]syncOrder, error) {
	query := `SELECT id, day, person_id, menu_item_id, size, milk, extras, note,
	                 status, updated_at, version, deleted_at
	          FROM coffee_order
	          WHERE version > ? AND day >= ?`
	return queryAll(ctx, tx, query,
		func(rows *sql.Rows, order *syncOrder) error {
			return rows.Scan(&order.ID, &order.Day, &order.PersonID, &order.MenuItemID,
				&order.Size, &order.Milk, &order.Extras, &order.Note,
				&order.Status, &order.UpdatedAt, &order.Version, &order.DeletedAt)
		},
		since, oldest)
}

// queryMenuItems returns every menu item changed since the given version,
// including removed ones (deleted_at set), so phones learn they're gone.
func queryMenuItems(ctx context.Context, tx *sql.Tx, since int64) ([]syncMenuItem, error) {
	query := `SELECT id, name, version, deleted_at FROM menu_item WHERE version > ?`
	return queryAll(ctx, tx, query,
		func(rows *sql.Rows, menuItem *syncMenuItem) error {
			return rows.Scan(&menuItem.ID, &menuItem.Name, &menuItem.Version, &menuItem.DeletedAt)
		},
		since)
}

// queryPeople returns every person changed since the given version, so phones
// pick up new people and changed names.
func queryPeople(ctx context.Context, tx *sql.Tx, since int64) ([]syncPerson, error) {
	query := `SELECT id, name, version FROM person WHERE version > ?`
	return queryAll(ctx, tx, query,
		func(rows *sql.Rows, person *syncPerson) error {
			return rows.Scan(&person.ID, &person.Name, &person.Version)
		},
		since)
}

// -----------------------------------------------------------------------------
// queryAll — DONE FOR YOU. Read it, don't change it.
//
// It runs a query and turns every row into a T, using a small function you
// pass in that says which columns go into which fields. [T any] makes it
// generic: the same helper works for syncPerson, syncMenuItem and syncOrder.
//
// Example call (this is the shape of steps f, g and h above):
//
//	response.People, err = queryAll(ctx, tx,
//		`SELECT id, name, version FROM person WHERE version > ?`,
//		func(rows *sql.Rows, person *syncPerson) error {
//			return rows.Scan(&person.ID, &person.Name, &person.Version)
//		},
//		since)
//
// Go works out T = syncPerson from the function you pass in.
// -----------------------------------------------------------------------------
func queryAll[T any](ctx context.Context, tx *sql.Tx, query string,
	scan func(*sql.Rows, *T) error, args ...any) ([]T, error) {

	// Run the query. args... spreads the extra values into the ? placeholders.
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	// Always close rows, or the connection stays busy. defer does it on return.
	defer rows.Close()

	// Start with an empty list, not nil, so the JSON says [] instead of null.
	results := []T{}

	// rows.Next() moves to the next row and returns false when there are none.
	for rows.Next() {
		var item T // a fresh, zero-valued T for this row
		if err := scan(rows, &item); err != nil {
			return nil, err
		}
		results = append(results, item) // add it to the end of the list
	}

	// rows.Err() reports any error that stopped the loop early.
	return results, rows.Err()
}

// =============================================================================
// HOW TO TEST IT (once it builds: go build ./...)
//
// 1. Start the server:          go run ./cmd/server
//
// 2. Not signed in → 401:
//      curl -i "localhost:8080/api/sync?since=0"
//
// 3. Everything (you signed in as Aaron in step 6, so the cookie is in jar):
//      curl -s -b jar "localhost:8080/api/sync?since=0" | python3 -m json.tool
//    Expect: "cursor": 2, Aaron in "people", 9 "menu_items", "orders": []
//    (your cursor may be higher if you signed in more than once)
//
// 4. Nothing new since the cursor → three empty lists:
//      curl -s -b jar "localhost:8080/api/sync?since=2"
//
// 5. Add an order by hand. There's no upload endpoint until step 8, so bump
//    the counter yourself and stamp the order with it, like write() does:
//      sqlite3 coffee-run.db "UPDATE sync_state SET version = version + 1;
//        INSERT INTO coffee_order (id, day, person_id, menu_item_id, updated_at, version)
//        SELECT date('now','localtime') || ':' || id, date('now','localtime'), id,
//               'matcha', strftime('%Y-%m-%dT%H:%M:%SZ','now'),
//               (SELECT version FROM sync_state)
//        FROM person WHERE name = 'Aaron';"
//
// 6. Ask again from the old cursor → ONLY the new order, cursor goes up by 1:
//      curl -s -b jar "localhost:8080/api/sync?since=2" | python3 -m json.tool
//
// 7. Ask from the new cursor → empty lists again. That's sync working.
// =============================================================================
