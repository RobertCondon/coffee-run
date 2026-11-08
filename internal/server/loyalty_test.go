package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// addBearer stands in for auth0.Source.Client in these tests.
type addBearer struct{ next http.RoundTripper }

func (a addBearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer at-test")
	return a.next.RoundTrip(r)
}

func TestFetchLoyaltyCard(t *testing.T) {
	qr := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/qr/payload" {
			http.Error(w, "wrong endpoint", http.StatusNotFound)
			return
		}
		if r.Header.Get("Authorization") != "Bearer at-test" {
			http.Error(w, "no token", http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"token":"17d655bdb37d9c897f8f2209ad5b247d","code":"GM687N"}`))
	}))
	defer qr.Close()

	s := &Server{}
	s.UseQR(strings.TrimPrefix(qr.URL, "https://"), &http.Client{Transport: addBearer{qr.Client().Transport}})
	if want := qr.URL + "/api/qr/payload"; s.qrURL != want {
		t.Fatalf("qrURL = %q, want %q", s.qrURL, want)
	}

	card, err := s.fetchLoyaltyCard(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if card.Token != "17d655bdb37d9c897f8f2209ad5b247d" || card.Code != "GM687N" {
		t.Fatalf("got %+v", card)
	}
}

func TestFetchLoyaltyCardRejected(t *testing.T) {
	qr := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no token", http.StatusUnauthorized)
	}))
	defer qr.Close()

	s := &Server{}
	s.UseQR(strings.TrimPrefix(qr.URL, "https://"), qr.Client())
	if _, err := s.fetchLoyaltyCard(context.Background()); err == nil {
		t.Fatal("want an error for a 401 from the QR service")
	}
}

func TestUseQRBuildsURL(t *testing.T) {
	s := &Server{}
	s.UseQR("qr.example.com", http.DefaultClient)
	if s.qrURL != "https://qr.example.com/api/qr/payload" {
		t.Fatalf("got %q", s.qrURL)
	}
}
