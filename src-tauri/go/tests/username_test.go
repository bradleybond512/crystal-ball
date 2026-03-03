package tests

import (
	"testing"

	"github.com/bradleybond512/crystal-ball/osint/pkg/osint"
)

func TestValidateUsername(t *testing.T) {
	valid := []string{
		"johndoe",
		"john_doe",
		"john.doe",
		"john-doe",
		"user123",
		"a",
	}
	for _, u := range valid {
		t.Run("valid/"+u, func(t *testing.T) {
			if err := osint.ValidateUsernameForTest(u); err != nil {
				t.Errorf("ValidateUsername(%q) unexpected error: %v", u, err)
			}
		})
	}

	invalid := []string{
		"",
		"has space",
		"has@symbol",
		"has/slash",
		"has!exclaim",
		"this-username-is-way-too-long-for-the-64-character-maximum-limit!",
	}
	for _, u := range invalid {
		t.Run("invalid/"+u, func(t *testing.T) {
			if err := osint.ValidateUsernameForTest(u); err == nil {
				t.Errorf("ValidateUsername(%q) expected error, got nil", u)
			}
		})
	}
}
