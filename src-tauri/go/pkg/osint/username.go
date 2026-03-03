// Package osint implements username search across social media platforms.
// It uses the Sherlock Python tool when available, and falls back to a
// built-in list of common platforms otherwise.
package osint

import (
	"fmt"
	"regexp"
	"time"
	"unicode"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
	"github.com/bradleybond512/crystal-ball/osint/pkg/storage"
	"github.com/bradleybond512/crystal-ball/osint/internal/sherlock"
)

// UsernameEngine orchestrates username search operations.
type UsernameEngine struct {
	cfg     *storage.Config
	cacheDB *storage.CacheDB
	logger  *storage.Logger
}

// NewUsernameEngine creates a new username search engine.
func NewUsernameEngine(cfg *storage.Config, cacheDB *storage.CacheDB, logger *storage.Logger) *UsernameEngine {
	return &UsernameEngine{
		cfg:     cfg,
		cacheDB: cacheDB,
		logger:  logger,
	}
}

// Search searches for a username across platforms. Results are cached for
// 30 days.
func (e *UsernameEngine) Search(username string) (*api.UsernameSearchResult, error) {
	username = normalizeUsername(username)
	if err := validateUsername(username); err != nil {
		return nil, err
	}

	// Check cache first
	if cached := GetCachedUsername(e.cacheDB, username); cached != nil {
		e.logger.Info("username cache hit", "username", username)
		cached.Cached = true
		return cached, nil
	}

	e.logger.Info("searching username", "username", username)
	matches, totalChecked, err := sherlock.Search(username, e.logger)
	if err != nil {
		e.logger.Warn("sherlock search failed, using fallback", "error", err.Error())
		matches, totalChecked = builtinSearch(username)
	}

	result := &api.UsernameSearchResult{
		Username:     username,
		FoundOn:      matches,
		TotalChecked: totalChecked,
		LastUpdated:  time.Now().Unix(),
		Cached:       false,
	}

	if err := SetCachedUsername(e.cacheDB, username, result); err != nil {
		e.logger.Warn("failed to cache username result", "username", username, "error", err.Error())
	}

	return result, nil
}

// ValidateUsernameForTest exposes validateUsername for unit tests.
func ValidateUsernameForTest(username string) error {
	return validateUsername(username)
}

// normalizeUsername trims whitespace from a username.
func normalizeUsername(username string) string {
	runes := []rune(username)
	start, end := 0, len(runes)
	for start < end && unicode.IsSpace(runes[start]) {
		start++
	}
	for end > start && unicode.IsSpace(runes[end-1]) {
		end--
	}
	return string(runes[start:end])
}

var usernameRE = regexp.MustCompile(`^[a-zA-Z0-9_.\-]{1,64}$`)

// validateUsername ensures the username is safe to pass to external tools.
func validateUsername(username string) error {
	if username == "" {
		return fmt.Errorf("username must not be empty")
	}
	if !usernameRE.MatchString(username) {
		return fmt.Errorf("username contains invalid characters (only a-z, 0-9, _, ., - allowed)")
	}
	return nil
}

// builtinPlatforms is a small set of well-known platforms to check when
// Sherlock is unavailable.
var builtinPlatforms = []struct {
	name    string
	urlTmpl string
}{
	{"GitHub", "https://github.com/%s"},
	{"Twitter/X", "https://twitter.com/%s"},
	{"Instagram", "https://instagram.com/%s"},
	{"Reddit", "https://reddit.com/user/%s"},
	{"LinkedIn", "https://linkedin.com/in/%s"},
	{"YouTube", "https://youtube.com/@%s"},
	{"TikTok", "https://tiktok.com/@%s"},
	{"Twitch", "https://twitch.tv/%s"},
	{"Pinterest", "https://pinterest.com/%s"},
	{"Snapchat", "https://snapchat.com/add/%s"},
	{"Mastodon", "https://mastodon.social/@%s"},
	{"GitLab", "https://gitlab.com/%s"},
	{"HackerNews", "https://news.ycombinator.com/user?id=%s"},
	{"Keybase", "https://keybase.io/%s"},
	{"Steam", "https://steamcommunity.com/id/%s"},
	{"Telegram", "https://t.me/%s"},
}

// builtinSearch performs a simple HTTP-based check for the username on a
// limited set of platforms.
func builtinSearch(username string) ([]api.PlatformMatch, int) {
	var matches []api.PlatformMatch

	client := newHTTPClient()
	for _, p := range builtinPlatforms {
		profileURL := fmt.Sprintf(p.urlTmpl, username)
		found := checkProfileURL(client, profileURL)
		matches = append(matches, api.PlatformMatch{
			Platform: p.name,
			URL:      profileURL,
			Found:    found,
		})
	}
	return matches, len(builtinPlatforms)
}
