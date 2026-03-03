package tests

import (
	"testing"

	"github.com/bradleybond512/crystal-ball/osint/pkg/osint"
)

func TestNormalizeDomain(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"example.com", "example.com"},
		{"https://example.com", "example.com"},
		{"http://example.com/path", "example.com"},
		{"EXAMPLE.COM", "example.com"},
		{"example.com:443", "example.com"},
		{"  example.com  ", "example.com"},
	}

	for _, tc := range cases {
		t.Run(tc.input, func(t *testing.T) {
			got := osint.NormalizeDomainForTest(tc.input)
			if got != tc.expected {
				t.Errorf("NormalizeDomain(%q) = %q, want %q", tc.input, got, tc.expected)
			}
		})
	}
}

func TestValidateDomain(t *testing.T) {
	valid := []string{
		"example.com",
		"sub.example.com",
		"my-domain.org",
		"test123.io",
	}
	for _, d := range valid {
		t.Run("valid/"+d, func(t *testing.T) {
			if err := osint.ValidateDomainForTest(d); err != nil {
				t.Errorf("ValidateDomain(%q) unexpected error: %v", d, err)
			}
		})
	}

	invalid := []string{
		"",
		"nodot",
		"has space.com",
		"has@at.com",
	}
	for _, d := range invalid {
		t.Run("invalid/"+d, func(t *testing.T) {
			if err := osint.ValidateDomainForTest(d); err == nil {
				t.Errorf("ValidateDomain(%q) expected error, got nil", d)
			}
		})
	}
}
