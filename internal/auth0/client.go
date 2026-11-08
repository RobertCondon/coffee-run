package auth0

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type Config struct {
	Domain       string // bare host from AUTH0_DOMAIN, e.g. "dev-abc123.us.auth0.com"
	ClientID     string
	ClientSecret string // empty for a public client (SPA / native app)
}

// tokenURL is where refresh requests go: https:// + AUTH0_DOMAIN + /oauth/token.
func (c Config) tokenURL() string {
	return "https://" + c.Domain + "/oauth/token"
}

// What Auth0's /oauth/token sends back. Success and failure share this shape.
type tokenResponse struct {
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"` // only sent when rotation is on
	ExpiresIn        int    `json:"expires_in"`    // seconds
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// errRejected means Auth0 will never accept this refresh token again.
var errRejected = errors.New("auth0 rejected the refresh token")

// refresh swaps a refresh token for new tokens.
func (c Config) refresh(ctx context.Context, hc *http.Client, refreshToken string) (tokenResponse, error) {
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {c.ClientID},
		"refresh_token": {refreshToken},
	}
	if c.ClientSecret != "" {
		form.Set("client_secret", c.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := hc.Do(req)
	if err != nil {
		return tokenResponse{}, err // network trouble: worth retrying
	}
	defer res.Body.Close()

	var body tokenResponse
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return tokenResponse{}, fmt.Errorf("auth0: status %d, unreadable body: %w", res.StatusCode, err)
	}
	if body.Error == "invalid_grant" {
		return tokenResponse{}, fmt.Errorf("%w: %s", errRejected, body.ErrorDescription)
	}
	if res.StatusCode != http.StatusOK || body.AccessToken == "" {
		return tokenResponse{}, fmt.Errorf("auth0: status %d: %s %s", res.StatusCode, body.Error, body.ErrorDescription)
	}
	return body, nil
}
