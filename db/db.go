package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

//go:embed views.sql
var Views string

func Open(path string) (*sql.DB, error) {
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)" +
		"&_pragma=foreign_keys(ON)" +
		"&_txlock=immediate"
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)
	return conn, nil
}

func Migrate(ctx context.Context, conn *sql.DB) error {
	var current int
	if err := conn.QueryRowContext(ctx, "PRAGMA user_version").Scan(&current); err != nil {
		return err
	}

	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	for i, name := range files {
		n := i + 1
		if n <= current {
			continue
		}
		body, err := migrations.ReadFile(name)
		if err != nil {
			return err
		}
		if err := runInTx(ctx, conn, string(body), fmt.Sprintf("PRAGMA user_version = %d", n)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}

	if _, err := conn.ExecContext(ctx, Views); err != nil {
		return fmt.Errorf("views.sql: %w", err)
	}
	return nil
}

func runInTx(ctx context.Context, conn *sql.DB, statements ...string) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, s := range statements {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			return err
		}
	}
	return tx.Commit()
}
