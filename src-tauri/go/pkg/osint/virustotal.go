// Package osint implements optional VirusTotal domain threat scoring.
package osint

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const vtAPIURL = "https://www.virustotal.com/api/v3/domains/"
const vtTimeout = 15 * time.Second

// LookupVirusTotal queries the VirusTotal API for a domain's threat score.
// Returns nil if the API key is empty. Returns a score in range [0.0, 1.0]
// representing the fraction of engines that flagged the domain as malicious.
func LookupVirusTotal(domain, apiKey string) (*float64, error) {
	if apiKey == "" {
		return nil, nil
	}

	client := &http.Client{Timeout: vtTimeout}
	req, err := http.NewRequest(http.MethodGet, vtAPIURL+domain, nil)
	if err != nil {
		return nil, fmt.Errorf("create VT request: %w", err)
	}
	req.Header.Set("x-apikey", apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("VT request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		score := 0.0
		return &score, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("VT returned HTTP %d", resp.StatusCode)
	}

	var body struct {
		Data struct {
			Attributes struct {
				LastAnalysisStats struct {
					Malicious  int `json:"malicious"`
					Suspicious int `json:"suspicious"`
					Harmless   int `json:"harmless"`
					Undetected int `json:"undetected"`
				} `json:"last_analysis_stats"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("VT parse: %w", err)
	}

	stats := body.Data.Attributes.LastAnalysisStats
	total := stats.Malicious + stats.Suspicious + stats.Harmless + stats.Undetected
	if total == 0 {
		score := 0.0
		return &score, nil
	}
	score := float64(stats.Malicious+stats.Suspicious) / float64(total)
	return &score, nil
}
