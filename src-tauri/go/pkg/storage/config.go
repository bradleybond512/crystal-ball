// Package storage implements YAML configuration loading for the OSINT engine.
package storage

import (
	"fmt"
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

const configFilePath = "~/.config/crystal-ball/config.yaml"

// Config holds OSINT engine preferences loaded from the YAML config file.
type Config struct {
	// CacheTTLDays overrides the default cache TTL in days (0 = use defaults).
	CacheTTLDays struct {
		Domain   int `yaml:"domain"`
		Username int `yaml:"username"`
	} `yaml:"cache_ttl_days"`

	// HTTPTimeoutSeconds overrides the HTTP request timeout (0 = use default).
	HTTPTimeoutSeconds int `yaml:"http_timeout_seconds"`

	// UserAgent overrides the HTTP user-agent string.
	UserAgent string `yaml:"user_agent"`

	// DisableVirusTotal disables VirusTotal lookups even if an API key is set.
	DisableVirusTotal bool `yaml:"disable_virustotal"`

	// DisableWayback disables Wayback Machine lookups.
	DisableWayback bool `yaml:"disable_wayback"`
}

// DefaultConfig returns the default OSINT engine configuration.
func DefaultConfig() *Config {
	return &Config{
		HTTPTimeoutSeconds: 10,
	}
}

// LoadConfig reads the YAML config file. Returns DefaultConfig if the file
// does not exist.
func LoadConfig() (*Config, error) {
	cfgPath, err := expandConfigPath()
	if err != nil {
		return DefaultConfig(), nil
	}

	data, err := os.ReadFile(cfgPath)
	if os.IsNotExist(err) {
		return DefaultConfig(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return cfg, nil
}

// EnsureConfigDir creates the config directory if it doesn't exist.
func EnsureConfigDir() error {
	cfgPath, err := expandConfigPath()
	if err != nil {
		return err
	}
	return os.MkdirAll(filepath.Dir(cfgPath), 0o700)
}

func expandConfigPath() (string, error) {
	cfgPath := configFilePath
	if len(cfgPath) >= 2 && cfgPath[:2] == "~/" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, cfgPath[2:]), nil
	}
	return cfgPath, nil
}
