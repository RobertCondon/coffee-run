package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/hello/{name}", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "kia ora, %s\n", r.PathValue("name"))
	})

	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}