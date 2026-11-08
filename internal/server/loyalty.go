package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"
)

// loyaltyCard is what the QR service hands back for the café's scanner.
type loyaltyCard struct {
	Token string `json:"token"` // what the QR code encodes
	Code  string `json:"code"`  // printed under it, for typing in by hand
}

// UseQR turns on GET /api/loyalty. Cards come from
// https://<domain>/api/qr/payload, fetched with client, which must add the
// Auth0 bearer token itself (auth0.Source.Client does).
func (s *Server) UseQR(domain string, client *http.Client) {
	s.qrURL = "https://" + domain + "/api/qr/payload"
	s.qrClient = client
}

// handleLoyalty fetches a fresh card each time a phone opens the docket.
// The phone never sees the Auth0 token: this server adds it on the way out.
func (s *Server) handleLoyalty(w http.ResponseWriter, r *http.Request) {
	if _, err := s.currentPerson(r); err != nil {
		http.Error(w, "not signed in", http.StatusUnauthorized)
		return
	}
	if s.qrClient == nil {
		http.Error(w, "loyalty card is not set up on this server", http.StatusServiceUnavailable)
		return
	}

	card, err := s.fetchLoyaltyCard(r.Context())
	if err != nil {
		log.Printf("loyalty: %v", err)
		http.Error(w, "could not load the loyalty card", http.StatusBadGateway)
		return
	}
	w.Header().Set("Cache-Control", "no-store") // always a fresh card, never a cached one
	writeJSON(w, http.StatusOK, card)
}

func (s *Server) fetchLoyaltyCard(ctx context.Context) (loyaltyCard, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.qrURL, nil)
	if err != nil {
		return loyaltyCard{}, err
	}
	req.Header.Set("Accept", "application/json")

	res, err := s.qrClient.Do(req)
	if err != nil {
		return loyaltyCard{}, err
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		return loyaltyCard{}, fmt.Errorf("GET %s: status %d", s.qrURL, res.StatusCode)
	}
	var card loyaltyCard
	if err := json.NewDecoder(res.Body).Decode(&card); err != nil {
		return loyaltyCard{}, fmt.Errorf("GET %s: %w", s.qrURL, err)
	}
	if card.Token == "" || card.Code == "" {
		return loyaltyCard{}, errors.New("QR service sent a card without a token or code")
	}
	return card, nil
}
