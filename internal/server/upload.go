package server

// =============================================================================
// STEP 8: PUSH — "here are the changes I made on my phone"
//
// A phone saves changes locally first and queues them in its outbox. When
// it's online it sends the whole queue in one request:
//
//	POST /api/upload
//	{"ops": [
//	  {"id": "1", "type": "put_order",
//	   "order": {"day": "2026-10-20", "menu_item_id": "flat-white",
//	             "size": "large", "milk": "oat", "extras": ["extra shot"]}}
//	]}
//
// and gets back one result per op, in the same order:
//
//	{"results": [{"id": "1", "ok": true}]}
//
// A rejected op is NOT an HTTP error. It still gets a 200, with a reason:
//
//	{"results": [{"id": "1", "ok": false, "error": "orders for 2026-10-19 have closed"}]}
//
// The phone drops it from its outbox and shows the reason. If it got a 400
// or 500 instead, it would retry the same op forever.
//
// What's already done:  the types and the SQL (this file), and cleanOrder,
//                       sizes and trimOrNil (validate.go).
// What you write:       Warm-up (OrderID + the route in server.go),
//                       Problem 1 (validateOrder, in validate.go),
//                       Problem 2 (apply), Problem 3 (handleUpload).
//
// Add imports as you need them: fmt, encoding/json and time in this file,
// encoding/json and slices in validate.go.
// =============================================================================

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// -----------------------------------------------------------------------------
// DONE FOR YOU: the shapes of the request and the response.
// -----------------------------------------------------------------------------

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
	Size       string   `json:"size"`   // may be missing: "" means "regular"
	Milk       *string  `json:"milk"`   // nil when the phone sends null or leaves it out
	Extras     []string `json:"extras"` // a real list here; stored as JSON text
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

// -----------------------------------------------------------------------------
// DONE FOR YOU: the two SQL statements apply needs.
// -----------------------------------------------------------------------------

// upsertOrder inserts the order, or, if this person already has an order
// today (same id), updates it instead. "excluded" is SQLite's name for the
// row we tried to insert. Sending the same op twice gives the same row, so a
// phone that retries after a dropped connection does no harm.
//
// deleted_at = NULL means ordering again after cancelling brings the row back.
//
// Ten ?s, in this order:
//
//	id, day, person_id, menu_item_id, size, milk, extras, note, updated_at, version
const upsertOrder = `
	INSERT INTO coffee_order
	  (id, day, person_id, menu_item_id, size, milk, extras, note, updated_at, version)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT (id) DO UPDATE SET
	  menu_item_id = excluded.menu_item_id,
	  size         = excluded.size,
	  milk         = excluded.milk,
	  extras       = excluded.extras,
	  note         = excluded.note,
	  status       = 'placed',
	  updated_at   = excluded.updated_at,
	  version      = excluded.version,
	  deleted_at   = NULL`

// deleteOrder doesn't remove the row. It sets deleted_at (a "tombstone") and
// stamps a new version, so the next pull tells every phone it's gone.
//
// Four ?s, in this order:  deleted_at, updated_at, version, id
// (deleted_at and updated_at are both "now".)
const deleteOrder = `
	UPDATE coffee_order
	SET deleted_at = ?, updated_at = ?, version = ?
	WHERE id = ? AND deleted_at IS NULL`

// deleteSeenOrder is deleteOrder with Rails' lock_version check: only delete
// the order if nobody changed it since the phone last saw it.
//
// Five ?s: deleted_at, updated_at, version, id, the version the phone saw
const deleteSeenOrder = deleteOrder + ` AND version = ?`

// -----------------------------------------------------------------------------
// WARM-UP: OrderID
//
// One order per person per day, so the id is just the two glued together:
//
//	OrderID("2026-10-20", "MBULNRKRF5U5ZVTITUQCXBH3MJ")
//	  → "2026-10-20:MBULNRKRF5U5ZVTITUQCXBH3MJ"
//
// The phone works out the same id offline, so both sides agree without asking.
// It's one line: join day, ":" and personID with +.
//
// Then, in server.go, uncomment the "POST /api/upload" route.
// -----------------------------------------------------------------------------

func OrderID(day, personID string) string {
	return day + ":" + personID
}

// -----------------------------------------------------------------------------
// PROBLEM 1 is in validate.go: validateOrder. Do it before Problem 2.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// PROBLEM 2: apply. Handles ONE op inside the write() transaction.
//
// It returns two things, and they mean different things:
//
//	("", nil)                 → the op worked
//	("a reason", nil)         → the op was rejected; the reason goes to the person
//	("", err)                 → something is actually broken (the database);
//	                            handleUpload rolls back the whole batch and sends a 500
//
// It's a plain function, not a method on *Server, because it doesn't need
// anything from s. Everything it uses is passed in.
//
// Steps:
//
//	a) input := op.Order
//
//	b) Only today's orders can change. If input.Day != today, reject:
//	     return fmt.Sprintf("orders for %s have closed", input.Day), nil
//
//	c) orderID := OrderID(input.Day, sender.ID)
//	   sender comes from the cookie, never from the request body.
//
//	d) switch op.Type {
//
//	   case "put_order":
//	     1. cleaned, reason := validateOrder(input)
//	        if reason != "", return it (with a nil error).
//	     2. Check the drink is on the menu:
//	          var onMenu bool
//	          err := tx.QueryRowContext(ctx,
//	              `SELECT EXISTS (SELECT 1 FROM menu_item WHERE id = ? AND deleted_at IS NULL)`,
//	              cleaned.MenuItemID).Scan(&onMenu)
//	        if err != nil → return "", err
//	        if !onMenu    → return "that drink isn't on the menu", nil
//	     3. Run upsertOrder with tx.ExecContext(ctx, upsertOrder, …ten values…).
//	        Use the cleaned values, not input's (except input.Day).
//	        ExecContext returns (result, err): you only want err, so write
//	        _, err = tx.ExecContext(...)
//	     4. return "", err
//
//	   case "delete_order":
//	     Run deleteOrder with its four values, then return "", err.
//
//	   default:
//	     return fmt.Sprintf("unknown op type %q", op.Type), nil
//	     (%q prints the value in quotes, so "" shows up as "".)
//	   }
// -----------------------------------------------------------------------------

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

func attemptUpsertOrder(ctx context.Context, tx *sql.Tx, orderID string, input OrderInput,
	sender person, now string, version int64) (string, error) {
	cleaned, reason := validateOrder(input)
	if reason != "" {
		return reason, nil
	}
	var onMenu bool
	err := tx.QueryRowContext(ctx,
		`SELECT EXISTS (SELECT 1 FROM menu_item WHERE id = ? AND deleted_at IS NULL)`,
		cleaned.MenuItemID).Scan(&onMenu)
	if err != nil {
		return "", err
	}
	if !onMenu {
		return "that drink isn't on the menu", nil
	}
	_, err = tx.ExecContext(ctx, upsertOrder,
		orderID, input.Day, sender.ID, cleaned.MenuItemID, cleaned.Size,
		cleaned.Milk, cleaned.ExtrasJSON, cleaned.Note, now, version)
	return "", err
}

// -----------------------------------------------------------------------------
// PROBLEM 3: handleUpload. The HTTP handler.
//
// It looks a lot like handleSession (step 6) and handleSync (step 7):
//
//	a) Sign-in guard, but keep the person this time:
//	     sender, err := s.currentPerson(request)
//	   If err != nil: 401 "sign in first", then return.
//
//	b) Read the body into an uploadRequest:
//	     var upload uploadRequest
//	     if err := json.NewDecoder(request.Body).Decode(&upload); err != nil {
//	   → 400 with `send JSON like {"ops": [...]}`, then return.
//
//	c) Work out the values every op in this batch shares:
//	     ctx     := request.Context()
//	     today   := s.today()
//	     now     := s.now().UTC().Format(time.RFC3339)   // e.g. "2026-10-20T06:49:23Z"
//	     results := []OpResult{}                          // [] in JSON, never null
//
//	d) The important part. Run every op inside ONE write():
//	     err = s.write(ctx, func(tx *sql.Tx, version int64) error {
//	         for _, op := range upload.Ops {
//	             // call apply; if it returns an err, return err (rolls back everything)
//	             // otherwise append an OpResult:
//	             //   ID: op.ID,  OK: reason == "",  Error: reason
//	         }
//	         return nil
//	     })
//	   The function you pass in can see and change `results` from out here. A
//	   function that does that is called a closure, like a Ruby block.
//	   write() gives you one version number for the whole batch, and pings
//	   phones once after it commits.
//
//	e) If write returned an err → serverError(responseWriter, err), then return.
//
//	f) writeJSON(responseWriter, http.StatusOK, uploadResponse{Results: results})
// -----------------------------------------------------------------------------

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

// =============================================================================
// HOW TO TEST IT (once it builds: go build ./...)
//
// 1. Restart the server:   go run ./cmd/server
//    In another terminal, save today's office date into a variable:
//      TODAY=$(TZ=Pacific/Auckland date +%F)
//
// 2. Not signed in → 401:
//      curl -i -X POST localhost:8080/api/upload -d '{}'
//
// 3. Place an order → {"results":[{"id":"1","ok":true}]}
//    (paste all four lines at once; '$TODAY' drops the date into the JSON)
//      curl -s -b jar -X POST localhost:8080/api/upload -d '{"ops": [
//        {"id": "1", "type": "put_order", "order": {"day": "'$TODAY'",
//         "menu_item_id": "flat-white", "size": "large", "milk": "oat",
//         "extras": ["Vanilla", "extra shot"]}}]}'
//
// 4. Pull it: only the new order, extras lowercased and sorted, cursor 3:
//      curl -s -b jar "localhost:8080/api/sync?since=2" | python3 -m json.tool
//
// 5. The docket view picks it up:
//      sqlite3 coffee-run.db "SELECT * FROM v_tally"
//    → 2026-10-20|large oat flat white + extra shot + vanilla|1
//
// 6. Rejections → still 200, one reason per op:
//      curl -s -b jar -X POST localhost:8080/api/upload -d '{"ops": [
//        {"id": "a", "type": "put_order", "order": {"day": "2020-01-01", "menu_item_id": "latte"}},
//        {"id": "b", "type": "put_order", "order": {"day": "'$TODAY'", "menu_item_id": "latte", "size": "venti"}},
//        {"id": "c", "type": "put_order", "order": {"day": "'$TODAY'", "menu_item_id": "frappe"}}]}'
//
// 7. Cancel it → ok. A pull shows "deleted_at" filled in, and v_tally is empty:
//      curl -s -b jar -X POST localhost:8080/api/upload -d '{"ops": [
//        {"id": "2", "type": "delete_order", "order": {"day": "'$TODAY'"}}]}'
//      curl -s -b jar "localhost:8080/api/sync?since=3" | python3 -m json.tool
//      sqlite3 coffee-run.db "SELECT * FROM v_tally"
// =============================================================================
