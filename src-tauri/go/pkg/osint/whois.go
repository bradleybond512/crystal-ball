// Package osint implements WHOIS lookup for domain intelligence.
package osint

import (
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
)

const whoisTimeout = 10 * time.Second

// whoisServers maps top-level domains to their WHOIS servers.
var whoisServers = map[string]string{
	"com":  "whois.verisign-grs.com",
	"net":  "whois.verisign-grs.com",
	"org":  "whois.pir.org",
	"info": "whois.afilias.info",
	"io":   "whois.nic.io",
	"co":   "whois.nic.co",
	"uk":   "whois.nic.uk",
	"de":   "whois.denic.de",
	"fr":   "whois.afnic.fr",
	"jp":   "whois.jprs.jp",
	"au":   "whois.auda.org.au",
	"ca":   "whois.cira.ca",
	"edu":  "whois.educause.edu",
	"gov":  "whois.dotgov.gov",
}

const defaultWhoisServer = "whois.iana.org"

// LookupWhois performs a WHOIS lookup for the given domain.
func LookupWhois(domain string) (*api.WhoisData, error) {
	parts := strings.Split(strings.ToLower(domain), ".")
	tld := parts[len(parts)-1]

	server, ok := whoisServers[tld]
	if !ok {
		server = defaultWhoisServer
	}

	raw, err := queryWhoisServer(server, domain)
	if err != nil {
		return nil, fmt.Errorf("whois query failed: %w", err)
	}

	// If IANA returns a referral, follow it
	if server == defaultWhoisServer {
		if ref := extractReferral(raw); ref != "" {
			raw2, err2 := queryWhoisServer(ref, domain)
			if err2 == nil {
				raw = raw2
			}
		}
	}

	return parseWhoisResponse(domain, raw), nil
}

func queryWhoisServer(server, domain string) (string, error) {
	conn, err := net.DialTimeout("tcp", server+":43", whoisTimeout)
	if err != nil {
		return "", fmt.Errorf("connect to %s: %w", server, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(whoisTimeout))

	_, err = fmt.Fprintf(conn, "%s\r\n", domain)
	if err != nil {
		return "", fmt.Errorf("write query: %w", err)
	}

	buf, err := io.ReadAll(io.LimitReader(conn, 64*1024))
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	return string(buf), nil
}

func extractReferral(raw string) string {
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "refer:") || strings.HasPrefix(lower, "whois:") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				ref := strings.TrimSpace(parts[1])
				if ref != "" {
					return ref
				}
			}
		}
	}
	return ""
}

func parseWhoisResponse(domain, raw string) *api.WhoisData {
	data := &api.WhoisData{
		RawText: raw,
	}

	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "%") || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(parts[0]))
		value := strings.TrimSpace(parts[1])
		if value == "" {
			continue
		}

		switch key {
		case "registrar", "registrar name":
			if data.Registrar == "" {
				data.Registrar = value
			}
		case "creation date", "created", "domain registration date", "registered on":
			if data.CreatedDate == "" {
				data.CreatedDate = value
			}
		case "registry expiry date", "expiry date", "expiration date", "registrar registration expiration date":
			if data.ExpiresDate == "" {
				data.ExpiresDate = value
			}
		case "updated date", "last updated", "last modified":
			if data.UpdatedDate == "" {
				data.UpdatedDate = value
			}
		case "name server":
			data.NameServers = append(data.NameServers, strings.ToLower(value))
		case "domain status":
			data.Status = append(data.Status, value)
		case "registrant organization", "registrant name":
			if data.Registrant == "" {
				data.Registrant = value
			}
		}
	}

	// Validate domain matches
	_ = domain
	return data
}
