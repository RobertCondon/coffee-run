package server

// Push: a phone saves changes locally, queues them in its outbox, and sends
// the whole queue in one request:
//
//	POST /api/upload
//	{"ops": [{"id": "1", "type": "put_order", "order": {...}}]}
//	{"results": [{"id": "1", "ok": true}]}
//
// A rejected op still gets a 200, with a reason for the person. A 400 or 500
// would make the phone retry the same op forever.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"
)

// Op is one row from the phone's outbox.
type Op struct {
	ID    string     `json:"id"`   // the outbox row's id; we echo it back so the phone knows which op a result is for
	Type  string     `json:"type"` // "put_order" or "delete_order"
	Order OrderInput `json:"order"`
}

// OrderInput is the order exactly as the phone sent it. Nothing in it is
// trusted yet: validateOrder checks and tidies it.
//
// put_order always uses the person from the session cookie, so nobody can
// order as someone else. delete_order may name another person: anyone can
// take an order off the docket.
type OrderInput struct {
	Day        string   `json:"day"`
	PersonID   string   `json:"person_id"` // delete_order only: whose order; "" means the sender
	Version    int64    `json:"version"`   // delete_order only: the version the phone saw; 0 skips the check
	MenuItemID string   `json:"menu_item_id"`
	Size       string   `json:"size"`    // may be missing: "" means "regular"
	Milk       *string  `json:"milk"`    // nil when the phone sends null or leaves it out
	Flavour    *string  `json:"flavour"` // nil when the drink has no flavour list
	Extras     []string `json:"extras"`  // a real list here; stored as JSON text
	Note       *string  `json:"note"`
}

// OpResult is what we send back for one op.
type OpResult struct {
	ID    string `json:"id"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"` // omitempty: left out of the JSON when it's ""
}

// uploadRequest is the whole request body: {"ops": [...]}
type uploadRequest struct {
	Ops []Op `json:"ops"`
}

// uploadResponse is the whole response body: {"results": [...]}
type uploadResponse struct {
	Results []OpResult `json:"results"`
}

// upsertOrder inserts the order, or, if this person already has an order
// today (same id), updates it instead. "excluded" is SQLite's name for the
// row we tried to insert. Sending the same op twice gives the same row, so a
// phone that retries after a dropped connection does no harm.
//
// deleted_at = NULL means ordering again after cancelling brings the row back.
const upsertOrder = `
	INSERT INTO coffee_order
	  (id, day, person_id, menu_item_id, size, milk, flavour, extras, note, updated_at, version)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (id) DO UPDATE SET
	  menu_item_id = excluded.menu_item_id,
	  size         = excluded.size,
	  milk         = excluded.milk,
	  flavour      = excluded.flavour,
	  extras       = excluded.extras,
	  note         = excluded.note,
	  status       = 'placed',
	  updated_at   = excluded.updated_at,
	  version      = excluded.version,
	  deleted_at   = NULL`

// deleteOrder doesn't remove the row. It sets deleted_at (a "tombstone") and
// stamps a new version, so the next pull tells every phone it's gone.
const deleteOrder = `
	UPDATE coffee_order
	SET deleted_at = ?, updated_at = ?, version = ?
	WHERE id = ? AND deleted_at IS NULL`

// deleteSeenOrder is deleteOrder with an optimistic lock: only delete
// the order if nobody changed it since the phone last saw it.
const deleteSeenOrder = deleteOrder + ` AND version = ?`

// OrderID is one order per person per day. Phones work out the same id
// offline, so both sides agree without asking.
func OrderID(day, personID string) string {
	return day + ":" + personID
}

// apply handles one op inside the write() transaction:
//
//	("", nil)        the op worked
//	("reason", nil)  rejected; the reason goes back to the person
//	("", err)        the database is broken; the whole batch rolls back
func apply(ctx context.Context, tx *sql.Tx, sender person, op Op, today, now string, version int64) (string, error) {
	input := op.Order
	if input.Day != today {
		return fmt.Sprintf("orders for %s have closed", input.Day), nil
	}

	orderID := OrderID(input.Day, sender.ID)

	switch op.Type {
	case "put_order":
		return attemptUpsertOrder(ctx, tx, orderID, input, sender, now, version)

	case "delete_order":
		return attemptDeleteOrder(ctx, tx, input, sender, now, version)

	default:
		return fmt.Sprintf("unknown op type %q", op.Type), nil
	}
}

// attemptDeleteOrder removes the sender's order, or someone else's. Already
// gone counts as done, so a retry or two people removing it at once is fine.
// Changed since the phone saw it means the phone is out of date: reject.
func attemptDeleteOrder(ctx context.Context, tx *sql.Tx, input OrderInput,
	sender person, now string, version int64) (string, error) {
	personID := input.PersonID
	if personID == "" {
		personID = sender.ID
	}
	orderID := OrderID(input.Day, personID)

	if input.Version == 0 {
		_, err := tx.ExecContext(ctx, deleteOrder, now, now, version, orderID)
		return "", err
	}
	result, err := tx.ExecContext(ctx, deleteSeenOrder, now, now, version, orderID, input.Version)
	if err != nil {
		return "", err
	}
	if removed, err := result.RowsAffected(); err != nil || removed == 1 {
		return "", err
	}

	var name string
	err = tx.QueryRowContext(ctx,
		`SELECT person.name FROM coffee_order JOIN person ON person.id = coffee_order.person_id
		 WHERE coffee_order.id = ? AND coffee_order.deleted_at IS NULL`,
		orderID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil // already gone
	}
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s changed their order, so it wasn't removed", name), nil
}

// drinkOptions rejects a size, milk, or flavour the café doesn't offer for this drink.
func drinkOptions(ctx context.Context, tx *sql.Tx, cleaned cleanOrder) (string, error) {
	var sizesJSON, flavoursJSON string
	var allowsMilk int
	err := tx.QueryRowContext(ctx,
		`SELECT sizes, allows_milk, flavours FROM menu_item WHERE id = ? AND deleted_at IS NULL`,
		cleaned.MenuItemID).Scan(&sizesJSON, &allowsMilk, &flavoursJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return "that drink isn't on the menu", nil
	}
	if err != nil {
		return "", err
	}

	var offered []string
	if err := json.Unmarshal([]byte(sizesJSON), &offered); err != nil {
		return "", err
	}
	if len(offered) == 0 {
		if cleaned.Size != "regular" {
			return "that drink doesn't come in a size", nil
		}
	} else if !slices.Contains(offered, cleaned.Size) {
		return "that drink doesn't come in that size", nil
	}
	if allowsMilk == 0 && cleaned.Milk != nil {
		return "that drink doesn't take milk", nil
	}

	var flavours []string
	if err := json.Unmarshal([]byte(flavoursJSON), &flavours); err != nil {
		return "", err
	}
	if len(flavours) == 0 {
		if cleaned.Flavour != nil {
			return "that drink doesn't come in a flavour", nil
		}
	} else if cleaned.Flavour == nil {
		return "pick a flavour", nil
	} else if !slices.Contains(flavours, *cleaned.Flavour) {
		return "that drink doesn't come in that flavour", nil
	}
	return "", nil
}

// attemptUpsertOrder places or changes the sender's order for the day.
func attemptUpsertOrder(ctx context.Context, tx *sql.Tx, orderID string, input OrderInput,
	sender person, now string, version int64) (string, error) {
	cleaned, reason := validateOrder(input)
	if reason != "" {
		return reason, nil
	}
	if reason, err := drinkOptions(ctx, tx, cleaned); reason != "" || err != nil {
		return reason, err
	}
	_, err := tx.ExecContext(ctx, upsertOrder,
		orderID, input.Day, sender.ID, cleaned.MenuItemID, cleaned.Size,
		cleaned.Milk, cleaned.Flavour, cleaned.ExtrasJSON, cleaned.Note, now, version)
	return "", err
}

// handleUpload applies every op in one write(), so the batch shares one
// version number and phones are pinged once after it commits.
func (s *Server) handleUpload(responseWriter http.ResponseWriter, request *http.Request) {
	sender, err := s.currentPerson(request)
	if err != nil {
		http.Error(responseWriter, "sign in first", http.StatusUnauthorized)
		return
	}

	var upload uploadRequest
	if err := json.NewDecoder(request.Body).Decode(&upload); err != nil {
		http.Error(responseWriter, `send JSON like {"ops": [...]}`, http.StatusBadRequest)
		return
	}

	ctx := request.Context()
	today := s.today()
	now := s.now().UTC().Format(time.RFC3339)
	results := []OpResult{}

	err = s.write(ctx, func(tx *sql.Tx, version int64) error {
		for _, op := range upload.Ops {
			reason, err := apply(ctx, tx, sender, op, today, now, version)
			if err != nil {
				return err
			}
			results = append(results, OpResult{
				ID:    op.ID,
				OK:    reason == "",
				Error: reason,
			})
		}
		return nil
	})

	if err != nil {
		serverError(responseWriter, err)
		return
	}

	writeJSON(responseWriter, http.StatusOK, uploadResponse{Results: results})
}
