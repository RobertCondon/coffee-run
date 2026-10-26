package server

import (
	"fmt"
	"net/http"
	"time"
)

// Proxies close connections that stay silent too long, so say something
// at least this often.
const keepAliveEvery = 25 * time.Second

// handleEvents holds a Server-Sent Events stream open and writes
// "event: changed" every time write() commits. Phones then pull.
func (s *Server) handleEvents(responseWriter http.ResponseWriter, request *http.Request) {
	if _, err := s.currentPerson(request); err != nil {
		http.Error(responseWriter, "sign in first", http.StatusUnauthorized)
		return
	}

	responseWriter.Header().Set("Content-Type", "text/event-stream")
	responseWriter.Header().Set("Cache-Control", "no-cache")
	responseWriter.Header().Set("X-Accel-Buffering", "no") // tell nginx (the reverse proxy) not to buffer the stream
	controller := http.NewResponseController(responseWriter)
	controller.SetWriteDeadline(time.Time{})

	pings := s.hub.Subscribe()
	defer s.hub.Unsubscribe(pings)

	fmt.Fprint(responseWriter, ": connected\n\n")
	controller.Flush()

	keepAlive := time.NewTicker(keepAliveEvery)
	defer keepAlive.Stop()

	for {
		select {
		case <-request.Context().Done():
			return
		case version := <-pings:
			fmt.Fprintf(responseWriter, "event: changed\ndata: %d\n\n", version)
			controller.Flush()
		case <-keepAlive.C:
			fmt.Fprint(responseWriter, ": still here\n\n")
			controller.Flush()
		}
	}
}
