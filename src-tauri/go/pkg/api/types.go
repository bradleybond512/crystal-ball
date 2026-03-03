// Package api defines the shared types used for Go/TypeScript IPC.
package api

// DomainIntelligence is the full OSINT result for a domain lookup.
type DomainIntelligence struct {
	Domain            string            `json:"domain"`
	Whois             *WhoisData        `json:"whois"`
	DNS               DNSRecords        `json:"dns"`
	SSL               *SSLCertificate   `json:"ssl"`
	WaybackSnapshots  []WaybackSnapshot `json:"wayback_snapshots"`
	VirusTotalScore   *float64          `json:"virustotal_score"`
	LastUpdated       int64             `json:"last_updated"`
	Cached            bool              `json:"cached"`
}

// WhoisData contains the WHOIS registration information for a domain.
type WhoisData struct {
	Registrar      string `json:"registrar"`
	CreatedDate    string `json:"created_date"`
	ExpiresDate    string `json:"expires_date"`
	UpdatedDate    string `json:"updated_date"`
	NameServers    []string `json:"name_servers"`
	Status         []string `json:"status"`
	Registrant     string `json:"registrant"`
	RawText        string `json:"raw_text"`
}

// DNSRecords contains resolved DNS records for a domain.
type DNSRecords struct {
	A     []string   `json:"a"`
	MX    []MXRecord `json:"mx"`
	NS    []string   `json:"ns"`
	TXT   []string   `json:"txt"`
}

// MXRecord represents a single mail exchange record.
type MXRecord struct {
	Host     string `json:"host"`
	Priority uint16 `json:"priority"`
}

// SSLCertificate contains information about a domain's TLS certificate.
type SSLCertificate struct {
	Subject    string   `json:"subject"`
	Issuer     string   `json:"issuer"`
	ValidFrom  string   `json:"valid_from"`
	ValidUntil string   `json:"valid_until"`
	SANs       []string `json:"sans"`
	IsExpired  bool     `json:"is_expired"`
}

// WaybackSnapshot represents a single archived snapshot from the Wayback Machine.
type WaybackSnapshot struct {
	Timestamp string `json:"timestamp"`
	URL       string `json:"url"`
	MIMEType  string `json:"mime_type"`
	StatusCode int   `json:"status_code"`
}

// UsernameSearchResult is the result of searching for a username across platforms.
type UsernameSearchResult struct {
	Username      string          `json:"username"`
	FoundOn       []PlatformMatch `json:"found_on"`
	TotalChecked  int             `json:"total_checked"`
	LastUpdated   int64           `json:"last_updated"`
	Cached        bool            `json:"cached"`
}

// PlatformMatch represents a result for a single platform check.
type PlatformMatch struct {
	Platform string `json:"platform"`
	URL      string `json:"url"`
	Found    bool   `json:"found"`
}

// ClearCacheResult is returned after a successful cache clear.
type ClearCacheResult struct {
	Success bool `json:"success"`
}

// ErrorResult wraps an error message as JSON for stderr output.
type ErrorResult struct {
	Error string `json:"error"`
}
