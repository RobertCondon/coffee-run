package server

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"
)

// cleanName trims a name and keeps it to 1–40 characters.
func cleanName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || utf8.RuneCountInString(name) > 40 {
		return "", errors.New("name must be between 1 and 40 characters")
	}
	return name, nil
}

// sizes are the ones the coffee_order table allows (see its CHECK).
var sizes = []string{"small", "regular", "large"}

// cleanOrder is an order after validateOrder has checked and tidied it.
// apply saves these values, never the raw OrderInput.
type cleanOrder struct {
	MenuItemID string
	Size       string
	Milk       *string
	Flavour    *string
	Note       *string
	ExtrasJSON string // ready for the extras column, e.g. ["extra shot","vanilla"]
}

func lowerOrNil(text *string) *string {
	if text == nil {
		return nil
	}
	lower := strings.ToLower(*text)
	return &lower
}

// trimOrNil trims spaces, and turns "nothing left" into nil,
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

// validateOrder checks an order and tidies it up. It returns a reason for the
// person when the order isn't valid. Extras are lowercased, sorted and
// de-duplicated, so the same drink tallies on one docket line.
func validateOrder(input OrderInput) (cleanOrder, string) {
	cleaned := cleanOrder{
		MenuItemID: input.MenuItemID,
		Size:       input.Size,
		Milk:       trimOrNil(input.Milk),
		Flavour:    lowerOrNil(trimOrNil(input.Flavour)),
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
