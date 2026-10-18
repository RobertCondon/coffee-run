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

	conn, err := db.Open("coffee-run.db")
	if err != nil {
		log.Fatal(err)
	}

	if err := db.Migrate(context.Background(), conn); err != nil {
		log.Fatal(err)
	}

	srv := server.New(conn, loc, os.DirFS("web/dist"))

	fmt.Println("Server is running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", srv))
}
