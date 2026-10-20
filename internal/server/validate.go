package server

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"
)

func cleanName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || utf8.RuneCountInString(name) > 40 {
		return "", errors.New("name must be between 1 and 40 characters")
	}
	return name, nil
}

// =============================================================================
// STEP 8 · PROBLEM 1: validateOrder
// =============================================================================

// DONE FOR YOU: the sizes the coffee_order table allows (see its CHECK).
var sizes = []string{"small", "regular", "large"}

// DONE FOR YOU: an order after validateOrder has checked and tidied it.
// apply saves these values, never the raw OrderInput.
type cleanOrder struct {
	MenuItemID string
	Size       string
	Milk       *string
	Note       *string
	ExtrasJSON string // ready for the extras column, e.g. ["extra shot","vanilla"]
}

// DONE FOR YOU: trimOrNil trims spaces, and turns "nothing left" into nil,
// so " oat " is saved as "oat" and "   " is saved as NULL.
func trimOrNil(text *string) *string {
	if text == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*text)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// -----------------------------------------------------------------------------
// YOUR TURN: validateOrder checks an order and tidies it up.
//
// Returns (cleaned order, "") when it's fine, or (whatever, "a reason") when
// it isn't. The reason is shown to the person, so write it for them.
//
// Steps:
//
//	a) Start the result from the input:
//	     cleaned := cleanOrder{
//	         MenuItemID: input.MenuItemID,
//	         Size:       input.Size,
//	         Milk:       trimOrNil(input.Milk),
//	         Note:       trimOrNil(input.Note),
//	     }
//
//	b) No drink?                  → return cleaned, "pick a drink"
//
//	c) Size is "" → set it to "regular".
//	   Not in sizes? (slices.Contains(sizes, cleaned.Size))
//	                              → return cleaned, "size must be one of " + strings.Join(sizes, ", ")
//
//	d) Note longer than 80 characters? (count with utf8.RuneCountInString,
//	   like cleanName; remember Note is a *string, so check != nil and use *cleaned.Note)
//	                              → return cleaned, "keep the note to 80 characters"
//
//	e) Extras: build a new list. For each one in input.Extras, lowercase and
//	   trim it (strings.ToLower, strings.TrimSpace), and skip it if it's "".
//	   Start with extras := []string{} so an empty list becomes [] not null.
//
//	f) slices.Sort(extras), then extras = slices.Compact(extras)
//	   Compact removes neighbours that are the same, which after sorting is
//	   every duplicate. Sorting also means "vanilla + shot" and "shot + vanilla"
//	   become the same label, so they tally on the same docket line.
//
//	g) More than 5?               → return cleaned, "five extras at most"
//
//	h) Turn the list into JSON text for the column:
//	     extrasJSON, err := json.Marshal(extras)     // gives []byte
//	   if err != nil → return cleaned, "those extras don't make sense"
//	   cleaned.ExtrasJSON = string(extrasJSON)
//
//	i) return cleaned, ""
//
// Imports to add at the top: "encoding/json" and "slices".
// -----------------------------------------------------------------------------

func validateOrder(input OrderInput) (cleanOrder, string) {
	cleaned := cleanOrder{
	    MenuItemID: input.MenuItemID,
        Size:       input.Size,
        Milk:       trimOrNil(input.Milk),
        Note:       trimOrNil(input.Note),
    }

    if cleaned.MenuItemID == "" {
        return cleaned, "pick a drink"
    }

    if cleaned.Size == "" {
        cleaned.Size = "regular"
    }
    if !slices.Contains(sizes, cleaned.Size) {
        return cleaned, "size must be one of " + strings.Join(sizes, ", ")
    }

    if cleaned.Note != nil && utf8.RuneCountInString(*cleaned.Note) > 80 {
        return cleaned, "keep the note to 80 characters"
    }

    extras := []string{}
    for _, extra := range input.Extras {
        extra = strings.ToLower(strings.TrimSpace(extra))
        if extra != "" {
            extras = append(extras, extra)
        }
    }

    slices.Sort(extras)
    extras = slices.Compact(extras)

    if len(extras) > 5 {
        return cleaned, "five extras at most"
    }

    extrasJSON, err := json.Marshal(extras)
    if err != nil {
        return cleaned, "those extras don't make sense"
    }

    cleaned.ExtrasJSON = string(extrasJSON)

    return cleaned, ""

}
