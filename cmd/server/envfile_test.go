package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	os.WriteFile(path, []byte(`# Auth0
export ENVTEST_DOMAIN=auth.example.com
ENVTEST_QUOTED="has spaces"
ENVTEST_SINGLE='x'
ENVTEST_EMPTY=

ENVTEST_KEEP=from-file
`), 0o600)
	t.Setenv("ENVTEST_KEEP", "from-shell")
	for _, k := range []string{"ENVTEST_DOMAIN", "ENVTEST_QUOTED", "ENVTEST_SINGLE", "ENVTEST_EMPTY"} {
		t.Setenv(k, "") // registers cleanup
		os.Unsetenv(k)
	}

	if err := loadEnvFile(path); err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"ENVTEST_DOMAIN": "auth.example.com",
		"ENVTEST_QUOTED": "has spaces",
		"ENVTEST_SINGLE": "x",
		"ENVTEST_EMPTY":  "",
		"ENVTEST_KEEP":   "from-shell", // the real environment wins
	}
	for k, v := range want {
		if got := os.Getenv(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func TestLoadEnvFileMissingIsFine(t *testing.T) {
	if err := loadEnvFile(filepath.Join(t.TempDir(), "nope")); err != nil {
		t.Fatal(err)
	}
}

func TestLoadEnvFileBadLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env.local")
	os.WriteFile(path, []byte("NOT A SETTING\n"), 0o600)
	if err := loadEnvFile(path); err == nil {
		t.Fatal("want an error for a line without =")
	}
}
