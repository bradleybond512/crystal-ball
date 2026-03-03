package tests

import (
	"testing"
	"time"

	"github.com/bradleybond512/crystal-ball/osint/pkg/storage"
)

func TestCacheDBSetAndGet(t *testing.T) {
	// Use in-memory SQLite for tests
	db, err := storage.OpenCacheDBInMemory()
	if err != nil {
		t.Fatalf("OpenCacheDBInMemory() error: %v", err)
	}
	defer db.Close()

	key := "test:example"
	value := `{"domain":"example.com"}`

	// Should not exist initially
	got, err := db.Get(key)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if got != "" {
		t.Errorf("expected empty for missing key, got %q", got)
	}

	// Set a value
	if err := db.Set(key, value, time.Now().Add(24*time.Hour)); err != nil {
		t.Fatalf("Set() error: %v", err)
	}

	// Get the value back
	got, err = db.Get(key)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if got != value {
		t.Errorf("Get() = %q, want %q", got, value)
	}

	// Delete the value
	if err := db.Delete(key); err != nil {
		t.Fatalf("Delete() error: %v", err)
	}

	got, err = db.Get(key)
	if err != nil {
		t.Fatalf("Get() after Delete() error: %v", err)
	}
	if got != "" {
		t.Errorf("expected empty after delete, got %q", got)
	}
}

func TestCacheDBExpiry(t *testing.T) {
	db, err := storage.OpenCacheDBInMemory()
	if err != nil {
		t.Fatalf("OpenCacheDBInMemory() error: %v", err)
	}
	defer db.Close()

	key := "test:expired"
	value := `{"test":true}`

	// Set with past expiry
	if err := db.Set(key, value, time.Now().Add(-1*time.Second)); err != nil {
		t.Fatalf("Set() error: %v", err)
	}

	got, err := db.Get(key)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if got != "" {
		t.Errorf("expected empty for expired entry, got %q", got)
	}
}

func TestCacheDBClearAll(t *testing.T) {
	db, err := storage.OpenCacheDBInMemory()
	if err != nil {
		t.Fatalf("OpenCacheDBInMemory() error: %v", err)
	}
	defer db.Close()

	// Insert several entries
	future := time.Now().Add(24 * time.Hour)
	for _, key := range []string{"a", "b", "c"} {
		if err := db.Set(key, "val", future); err != nil {
			t.Fatalf("Set(%q) error: %v", key, err)
		}
	}

	if err := db.ClearAll(); err != nil {
		t.Fatalf("ClearAll() error: %v", err)
	}

	for _, key := range []string{"a", "b", "c"} {
		got, _ := db.Get(key)
		if got != "" {
			t.Errorf("expected empty after ClearAll for key %q, got %q", key, got)
		}
	}
}
