package server

// Pull: a phone remembers the highest version it has seen (its cursor) and
// asks for everything newer:
//
//	GET /api/sync?since=41
//	{"cursor": 44, "people": [...], "menu_items": [...], "orders": [...]}

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"time"
)

// The sync types mirror their tables' columns. Nullable columns are pointers,
// so they come out as null in the JSON.

type syncPerson struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version int64  `json:"version"`
}

type syncMenuItem struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Section    string  `json:"section"`
	SortOrder  int64   `json:"sort_order"`
	Sizes      string  `json:"sizes"`
	AllowsMilk bool    `json:"allows_milk"`
	Flavours   string  `json:"flavours"`
	Version    int64   `json:"version"`
	DeletedAt  *string `json:"deleted_at"`
}

type syncOrder struct {
	ID         string  `json:"id"`
	Day        string  `json:"day"`
	PersonID   string  `json:"person_id"`
	MenuItemID string  `json:"menu_item_id"`
	Size       string  `json:"size"`
	Milk       *string `json:"milk"`
	Flavour    *string `json:"flavour"`
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

// Phones only keep the last two weeks of orders.
const keepDays = 14

// handleSync sends every person, menu item and order changed since ?since=,
// read in one transaction so all three see the same snapshot.
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
	query := `SELECT id, day, person_id, menu_item_id, size, milk, flavour, extras, note,
	                 status, updated_at, version, deleted_at
	          FROM coffee_order
	          WHERE version > ? AND day >= ?`
	return queryAll(ctx, tx, query,
		func(rows *sql.Rows, order *syncOrder) error {
			return rows.Scan(&order.ID, &order.Day, &order.PersonID, &order.MenuItemID,
				&order.Size, &order.Milk, &order.Flavour, &order.Extras, &order.Note,
				&order.Status, &order.UpdatedAt, &order.Version, &order.DeletedAt)
		},
		since, oldest)
}

// queryMenuItems returns every menu item changed since the given version,
// including removed ones (deleted_at set), so phones learn they're gone.
func queryMenuItems(ctx context.Context, tx *sql.Tx, since int64) ([]syncMenuItem, error) {
	query := `SELECT id, name, section, sort_order, sizes, allows_milk, flavours, version, deleted_at
	          FROM menu_item WHERE version > ?`
	return queryAll(ctx, tx, query,
		func(rows *sql.Rows, menuItem *syncMenuItem) error {
			var allowsMilk int
			err := rows.Scan(&menuItem.ID, &menuItem.Name, &menuItem.Section, &menuItem.SortOrder,
				&menuItem.Sizes, &allowsMilk, &menuItem.Flavours, &menuItem.Version, &menuItem.DeletedAt)
			menuItem.AllowsMilk = allowsMilk != 0
			return err
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

// queryAll runs a query and scans every row into a T. It returns an empty
// slice rather than nil, so the JSON says [] instead of null.
func queryAll[T any](ctx context.Context, tx *sql.Tx, query string,
	scan func(*sql.Rows, *T) error, args ...any) ([]T, error) {

	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := []T{}

	for rows.Next() {
		var item T
		if err := scan(rows, &item); err != nil {
			return nil, err
		}
		results = append(results, item)
	}

	return results, rows.Err()
}
