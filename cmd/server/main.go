package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"
	_ "time/tzdata"

	"github.com/RobertCondon/coffee-run/db"
	"github.com/RobertCondon/coffee-run/internal/server"
)

func main() {
	loc, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		log.Fatal(err)
	}

	conn, err := db.Open(envOr("COFFEE_DB_PATH", "coffee-run.db"))
	if err != nil {
		log.Fatal(err)
	}

	if err := db.Migrate(context.Background(), conn); err != nil {
		log.Fatal(err)
	}

	srv := server.New(conn, loc, os.DirFS(envOr("COFFEE_STATIC_DIR", "web/dist")))

	addr := envOr("COFFEE_ADDR", ":8080")
	fmt.Printf("Server is running on http://localhost%s\n", addr)
	log.Fatal(http.ListenAndServe(addr, srv))
}

// envOr reads an environment variable, falling back to the value used in
// development. Docker sets all three (see Dockerfile); `go run` sets none.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
