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
	"github.com/RobertCondon/coffee-run/internal/auth0"
	"github.com/RobertCondon/coffee-run/internal/server"
)

func main() {
	// Settings for `go run` (Auth0, QR_DOMAIN). Gitignored; see .env.example.
	if err := loadEnvFile(envOr("COFFEE_ENV_FILE", ".env.local")); err != nil {
		log.Fatal(err)
	}

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

	// Keep the Auth0 token alive, if this server has been given one.
	// AUTH0_DOMAIN is the bare host; refreshes go to https://<it>/oauth/token.
	var tokens *auth0.Source
	if domain := os.Getenv("AUTH0_DOMAIN"); domain != "" {
		store := auth0.NewStore(conn)
		if rt := os.Getenv("AUTH0_REFRESH_TOKEN"); rt != "" {
			if err := store.Seed(context.Background(), rt); err != nil {
				log.Fatal(err)
			}
		}
		tokens = auth0.NewSource(auth0.Config{
			Domain:       domain,
			ClientID:     os.Getenv("AUTH0_CLIENT_ID"),
			ClientSecret: os.Getenv("AUTH0_CLIENT_SECRET"),
		}, store)
		go tokens.Run(context.Background())
	}

	srv := server.New(conn, loc, os.DirFS(envOr("COFFEE_STATIC_DIR", "web/dist")))

	// The loyalty card: https://<QR_DOMAIN>/api/qr/payload, with the Auth0 token.
	if qrDomain := os.Getenv("QR_DOMAIN"); qrDomain != "" {
		if tokens == nil {
			log.Fatal("QR_DOMAIN is set but AUTH0_DOMAIN isn't: the QR service needs the Auth0 token")
		}
		srv.UseQR(qrDomain, tokens.Client())
	}

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
