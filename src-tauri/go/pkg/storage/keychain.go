// Package storage implements macOS Keychain integration for API key storage.
// On non-macOS platforms, falls back to the YAML config or environment variables.
package storage

import (
	"os/exec"
	"strings"
)

// keychainService must match the Rust KEYRING_SERVICE constant in src-tauri/src/main.rs
// so that the Go engine and Tauri backend share the same keychain entries.
const keychainService = "world-monitor"

// GetKeychainSecret retrieves a secret from the macOS Keychain.
// Returns ("", nil) on non-macOS platforms or if the key is not found.
func GetKeychainSecret(key string) (string, error) {
	// Use security command-line tool (available on macOS)
	cmd := exec.Command("security", "find-generic-password",
		"-s", keychainService,
		"-a", key,
		"-w", // print password only
	)
	out, err := cmd.Output()
	if err != nil {
		return "", nil // not found or not macOS
	}
	return strings.TrimSpace(string(out)), nil
}

// SetKeychainSecret stores a secret in the macOS Keychain.
func SetKeychainSecret(key, value string) error {
	// Delete existing entry first (ignore error if not found)
	_ = exec.Command("security", "delete-generic-password",
		"-s", keychainService,
		"-a", key,
	).Run()

	return exec.Command("security", "add-generic-password",
		"-s", keychainService,
		"-a", key,
		"-w", value,
	).Run()
}
