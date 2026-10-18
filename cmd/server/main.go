package main

import (
    "context"
    "fmt"
    "log"
    "net/http"

    "github.com/RobertCondon/coffee-run/db"
  )

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/hello/{name}", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "kia ora, %s\n", r.PathValue("name"))
	})

	log.Println("listening on :8080")
	conn, err := db.Open("coffee.db")
    if err != nil {
      log.Fatal(err)
    }
    if err := db.Migrate(context.Background(), conn); err != nil {
      log.Fatal(err)
    }
    log.Println("migrated")

	log.Fatal(http.ListenAndServe(":8080", mux))
}