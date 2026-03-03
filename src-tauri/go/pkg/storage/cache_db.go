// Package storage implements the SQLite cache database for OSINT results.
package storage

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // pure-Go SQLite driver
)

const cacheDBPath = "~/.cache/crystal-ball/osint.db"

// CacheDB wraps a SQLite database for storing OSINT results.
type CacheDB struct {
	db *sql.DB
}

// OpenCacheDB opens (or creates) the SQLite cache database.
func OpenCacheDB() (*CacheDB, error) {
	dbPath, err := expandPath(cacheDBPath)
	if err != nil {
		return nil, fmt.Errorf("resolve cache path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o700); err != nil {
		return nil, fmt.Errorf("create cache dir: %w", err)
	}
	return openSQLite(dbPath)
}

// OpenCacheDBInMemory opens an in-memory SQLite database for testing.
func OpenCacheDBInMemory() (*CacheDB, error) {
	return openSQLite(":memory:")
}

func openSQLite(path string) (*CacheDB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &CacheDB{db: db}, nil
}

// Close closes the database connection.
func (c *CacheDB) Close() {
	if c != nil && c.db != nil {
		_ = c.db.Close()
	}
}

// Get retrieves a cached value by key. Returns ("", nil) if not found.
func (c *CacheDB) Get(key string) (string, error) {
	if c == nil || c.db == nil {
		return "", nil
	}
	var value string
	var expiresAt int64
	err := c.db.QueryRow(
		`SELECT value, expires_at FROM osint_cache WHERE key = ?`, key,
	).Scan(&value, &expiresAt)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("cache get: %w", err)
	}
	if expiresAt > 0 && time.Now().Unix() > expiresAt {
		_ = c.Delete(key)
		return "", nil
	}
	return value, nil
}

// Set stores a key/value pair with an optional expiry time.
func (c *CacheDB) Set(key, value string, expiresAt time.Time) error {
	if c == nil || c.db == nil {
		return nil
	}
	_, err := c.db.Exec(
		`INSERT OR REPLACE INTO osint_cache (key, value, created_at, expires_at)
		 VALUES (?, ?, ?, ?)`,
		key, value, time.Now().Unix(), expiresAt.Unix(),
	)
	if err != nil {
		return fmt.Errorf("cache set: %w", err)
	}
	return nil
}

// Delete removes a key from the cache.
func (c *CacheDB) Delete(key string) error {
	if c == nil || c.db == nil {
		return nil
	}
	_, err := c.db.Exec(`DELETE FROM osint_cache WHERE key = ?`, key)
	return err
}

// ClearAll removes all entries from the cache.
func (c *CacheDB) ClearAll() error {
	if c == nil || c.db == nil {
		return nil
	}
	_, err := c.db.Exec(`DELETE FROM osint_cache`)
	return err
}

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS osint_cache (
			key        TEXT PRIMARY KEY,
			value      TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL
		)
	`)
	return err
}

func expandPath(path string) (string, error) {
	if len(path) >= 2 && path[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, path[2:]), nil
	}
	return path, nil
}
