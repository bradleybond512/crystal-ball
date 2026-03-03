// Package osint provides shared HTTP utilities for OSINT lookups.
package osint

import (
	"net/http"
	"time"
)

const (
	osintHTTPTimeout = 8 * time.Second
	osintUserAgent   = "CrystalBall-OSINT/1.0 (+https://github.com/bradleybond512/crystal-ball)"
)

func newHTTPClient() *http.Client {
	return &http.Client{
		Timeout: osintHTTPTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return http.ErrUseLastResponse
			}
			return nil
		},
	}
}

// checkProfileURL returns true if the URL responds with HTTP 200.
func checkProfileURL(client *http.Client, url string) bool {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", osintUserAgent)

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
