// Package osint implements the domain intelligence orchestrator.
package osint

import (
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
	"github.com/bradleybond512/crystal-ball/osint/pkg/storage"
)

// DomainEngine orchestrates domain OSINT lookups.
type DomainEngine struct {
	cfg      *storage.Config
	cacheDB  *storage.CacheDB
	vtAPIKey string
	logger   *storage.Logger
}

// NewDomainEngine creates a new domain intelligence engine.
func NewDomainEngine(cfg *storage.Config, cacheDB *storage.CacheDB, vtAPIKey string, logger *storage.Logger) *DomainEngine {
	return &DomainEngine{
		cfg:      cfg,
		cacheDB:  cacheDB,
		vtAPIKey: vtAPIKey,
		logger:   logger,
	}
}

// Lookup performs a full domain intelligence lookup. Results are cached for
// 7 days.
func (e *DomainEngine) Lookup(domain string) (*api.DomainIntelligence, error) {
	domain = normalizeDomain(domain)
	if err := validateDomain(domain); err != nil {
		return nil, err
	}

	// Check cache first
	if cached := GetCachedDomain(e.cacheDB, domain); cached != nil {
		e.logger.Info("domain cache hit", "domain", domain)
		cached.Cached = true
		return cached, nil
	}

	result := &api.DomainIntelligence{
		Domain:      domain,
		LastUpdated: time.Now().Unix(),
		Cached:      false,
	}

	// WHOIS lookup
	whoisData, err := LookupWhois(domain)
	if err != nil {
		e.logger.Warn("whois lookup failed", "domain", domain, "error", err.Error())
	} else {
		result.Whois = whoisData
	}

	// DNS lookup
	result.DNS = LookupDNS(domain)

	// SSL certificate
	sslData, err := LookupSSL(domain)
	if err != nil {
		e.logger.Warn("ssl lookup failed", "domain", domain, "error", err.Error())
	} else {
		result.SSL = sslData
	}

	// Wayback Machine snapshots
	snapshots, err := LookupWayback(domain)
	if err != nil {
		e.logger.Warn("wayback lookup failed", "domain", domain, "error", err.Error())
		result.WaybackSnapshots = []api.WaybackSnapshot{}
	} else {
		result.WaybackSnapshots = snapshots
	}

	// VirusTotal (optional)
	if e.vtAPIKey != "" {
		vtScore, err := LookupVirusTotal(domain, e.vtAPIKey)
		if err != nil {
			e.logger.Warn("virustotal lookup failed", "domain", domain, "error", err.Error())
		} else {
			result.VirusTotalScore = vtScore
		}
	}

	// Cache the result
	if err := SetCachedDomain(e.cacheDB, domain, result); err != nil {
		e.logger.Warn("failed to cache domain result", "domain", domain, "error", err.Error())
	}

	return result, nil
}

// NormalizeDomainForTest exposes normalizeDomain for unit tests.
func NormalizeDomainForTest(domain string) string {
	return normalizeDomain(domain)
}

// ValidateDomainForTest exposes validateDomain for unit tests.
func ValidateDomainForTest(domain string) error {
	return validateDomain(domain)
}
func normalizeDomain(domain string) string {
	domain = strings.TrimSpace(domain)
	domain = strings.ToLower(domain)
	// Strip protocol prefix
	for _, prefix := range []string{"https://", "http://"} {
		domain = strings.TrimPrefix(domain, prefix)
	}
	// Strip path and query
	if i := strings.IndexByte(domain, '/'); i >= 0 {
		domain = domain[:i]
	}
	// Strip port
	if i := strings.LastIndexByte(domain, ':'); i >= 0 {
		domain = domain[:i]
	}
	return domain
}

// validateDomain ensures the domain is a valid hostname.
func validateDomain(domain string) error {
	if domain == "" {
		return fmt.Errorf("domain must not be empty")
	}
	if len(domain) > 253 {
		return fmt.Errorf("domain exceeds maximum length")
	}
	for _, ch := range domain {
		if !unicode.IsLetter(ch) && !unicode.IsDigit(ch) && ch != '.' && ch != '-' {
			return fmt.Errorf("domain contains invalid character: %q", ch)
		}
	}
	if !strings.Contains(domain, ".") {
		return fmt.Errorf("domain must contain at least one dot")
	}
	return nil
}
