// Package osint implements Wayback Machine snapshot lookups.
package osint

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
)

const (
	waybackAPIURL  = "https://archive.org/wayback/available"
	waybackCDXURL  = "https://web.archive.org/cdx/search/cdx"
	waybackTimeout = 15 * time.Second
	maxSnapshots   = 10
)

// LookupWayback fetches recent snapshots for the given domain from the
// Wayback Machine CDX API.
func LookupWayback(domain string) ([]api.WaybackSnapshot, error) {
	client := &http.Client{Timeout: waybackTimeout}

	params := url.Values{}
	params.Set("url", domain)
	params.Set("output", "json")
	params.Set("limit", fmt.Sprintf("%d", maxSnapshots))
	params.Set("fl", "timestamp,original,mimetype,statuscode")
	params.Set("filter", "statuscode:200")
	params.Set("collapse", "timestamp:8") // one per day

	reqURL := waybackCDXURL + "?" + params.Encode()
	resp, err := client.Get(reqURL)
	if err != nil {
		return nil, fmt.Errorf("wayback CDX fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wayback CDX returned HTTP %d", resp.StatusCode)
	}

	var rows [][]string
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, fmt.Errorf("wayback CDX parse: %w", err)
	}

	var snapshots []api.WaybackSnapshot
	for i, row := range rows {
		if i == 0 && len(row) > 0 && row[0] == "timestamp" {
			// skip header row
			continue
		}
		if len(row) < 4 {
			continue
		}
		ts := row[0]
		origURL := row[1]
		mime := row[2]
		status := 0
		fmt.Sscanf(row[3], "%d", &status)

		archiveURL := fmt.Sprintf("https://web.archive.org/web/%s/%s", ts, origURL)
		snapshots = append(snapshots, api.WaybackSnapshot{
			Timestamp:  ts,
			URL:        archiveURL,
			MIMEType:   mime,
			StatusCode: status,
		})
	}

	if snapshots == nil {
		snapshots = []api.WaybackSnapshot{}
	}
	return snapshots, nil
}
