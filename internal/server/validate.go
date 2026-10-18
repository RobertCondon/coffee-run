package server

import (
	"errors"
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
