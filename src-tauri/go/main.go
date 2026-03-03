// Package main is the entry point for the Crystal Ball OSINT engine binary.
// It accepts a subcommand and arguments, executes the appropriate intelligence
// operation, and writes the JSON result to stdout.
//
// Usage:
//
//	osint-engine lookup-domain <domain>
//	osint-engine search-username <username>
//	osint-engine clear-cache
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
	"github.com/bradleybond512/crystal-ball/osint/pkg/osint"
	"github.com/bradleybond512/crystal-ball/osint/pkg/storage"
)

func main() {
	if len(os.Args) < 2 {
		writeError("usage: osint-engine <command> [args...]")
		os.Exit(1)
	}

	logger, err := storage.NewLogger()
	if err != nil {
		writeError(fmt.Sprintf("failed to init logger: %v", err))
		os.Exit(1)
	}
	defer logger.Close()

	cfg, err := storage.LoadConfig()
	if err != nil {
		logger.Warn("config load failed, using defaults", "error", err.Error())
		cfg = storage.DefaultConfig()
	}

	cacheDB, err := storage.OpenCacheDB()
	if err != nil {
		logger.Warn("cache db open failed, proceeding without cache", "error", err.Error())
	}
	if cacheDB != nil {
		defer cacheDB.Close()
	}

	vtAPIKey := os.Getenv("VIRUSTOTAL_API_KEY")
	if vtAPIKey == "" {
		vtAPIKey, _ = storage.GetKeychainSecret("VIRUSTOTAL_API_KEY")
	}

	command := os.Args[1]
	switch command {
	case "lookup-domain":
		if len(os.Args) < 3 {
			writeError("usage: osint-engine lookup-domain <domain>")
			os.Exit(1)
		}
		domain := os.Args[2]
		logger.Info("lookup-domain started", "domain", domain)

		engine := osint.NewDomainEngine(cfg, cacheDB, vtAPIKey, logger)
		result, err := engine.Lookup(domain)
		if err != nil {
			logger.Error("lookup-domain failed", "domain", domain, "error", err.Error())
			writeError(err.Error())
			os.Exit(1)
		}
		writeJSON(result)

	case "search-username":
		if len(os.Args) < 3 {
			writeError("usage: osint-engine search-username <username>")
			os.Exit(1)
		}
		username := os.Args[2]
		logger.Info("search-username started", "username", username)

		engine := osint.NewUsernameEngine(cfg, cacheDB, logger)
		result, err := engine.Search(username)
		if err != nil {
			logger.Error("search-username failed", "username", username, "error", err.Error())
			writeError(err.Error())
			os.Exit(1)
		}
		writeJSON(result)

	case "clear-cache":
		if cacheDB == nil {
			writeError("cache not available")
			os.Exit(1)
		}
		if err := cacheDB.ClearAll(); err != nil {
			logger.Error("clear-cache failed", "error", err.Error())
			writeError(err.Error())
			os.Exit(1)
		}
		logger.Info("cache cleared")
		writeJSON(api.ClearCacheResult{Success: true})

	default:
		writeError(fmt.Sprintf("unknown command: %s", command))
		os.Exit(1)
	}
}

func writeJSON(v interface{}) {
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(v); err != nil {
		writeError(fmt.Sprintf("json encode failed: %v", err))
		os.Exit(1)
	}
}

func writeError(msg string) {
	result := api.ErrorResult{Error: msg}
	enc := json.NewEncoder(os.Stderr)
	_ = enc.Encode(result)
}
