// Package osint implements the cache layer for OSINT lookup results.
package osint

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
	"github.com/bradleybond512/crystal-ball/osint/pkg/storage"
)

const (
	domainCacheTTL   = 7 * 24 * time.Hour  // 7 days
	usernameCacheTTL = 30 * 24 * time.Hour // 30 days
)

// GetCachedDomain retrieves a cached domain intelligence result, or nil if
// not found or expired.
func GetCachedDomain(db *storage.CacheDB, domain string) *api.DomainIntelligence {
	if db == nil {
		return nil
	}
	raw, err := db.Get("domain:" + domain)
	if err != nil || raw == "" {
		return nil
	}
	var result api.DomainIntelligence
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil
	}
	age := time.Since(time.Unix(result.LastUpdated, 0))
	if age > domainCacheTTL {
		_ = db.Delete("domain:" + domain)
		return nil
	}
	return &result
}

// SetCachedDomain stores a domain intelligence result in the cache.
func SetCachedDomain(db *storage.CacheDB, domain string, result *api.DomainIntelligence) error {
	if db == nil {
		return nil
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal domain cache: %w", err)
	}
	return db.Set("domain:"+domain, string(raw), time.Now().Add(domainCacheTTL))
}

// GetCachedUsername retrieves a cached username search result, or nil if
// not found or expired.
func GetCachedUsername(db *storage.CacheDB, username string) *api.UsernameSearchResult {
	if db == nil {
		return nil
	}
	raw, err := db.Get("username:" + username)
	if err != nil || raw == "" {
		return nil
	}
	var result api.UsernameSearchResult
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil
	}
	age := time.Since(time.Unix(result.LastUpdated, 0))
	if age > usernameCacheTTL {
		_ = db.Delete("username:" + username)
		return nil
	}
	return &result
}

// SetCachedUsername stores a username search result in the cache.
func SetCachedUsername(db *storage.CacheDB, username string, result *api.UsernameSearchResult) error {
	if db == nil {
		return nil
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("marshal username cache: %w", err)
	}
	return db.Set("username:"+username, string(raw), time.Now().Add(usernameCacheTTL))
}
