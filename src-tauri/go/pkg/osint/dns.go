// Package osint implements DNS record lookups for domain intelligence.
package osint

import (
	"net"
	"sort"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
)

// LookupDNS resolves A, MX, NS, and TXT records for a domain using the
// system resolver.
func LookupDNS(domain string) api.DNSRecords {
	records := api.DNSRecords{}

	// A records
	addrs, err := net.LookupHost(domain)
	if err == nil {
		for _, addr := range addrs {
			// Filter for IPv4 only (A records)
			if ip := net.ParseIP(addr); ip != nil && ip.To4() != nil {
				records.A = append(records.A, addr)
			}
		}
		sort.Strings(records.A)
	}

	// MX records
	mxs, err := net.LookupMX(domain)
	if err == nil {
		for _, mx := range mxs {
			records.MX = append(records.MX, api.MXRecord{
				Host:     mx.Host,
				Priority: mx.Pref,
			})
		}
	}

	// NS records
	nss, err := net.LookupNS(domain)
	if err == nil {
		for _, ns := range nss {
			records.NS = append(records.NS, ns.Host)
		}
		sort.Strings(records.NS)
	}

	// TXT records
	txts, err := net.LookupTXT(domain)
	if err == nil {
		records.TXT = txts
	}

	if records.A == nil {
		records.A = []string{}
	}
	if records.MX == nil {
		records.MX = []api.MXRecord{}
	}
	if records.NS == nil {
		records.NS = []string{}
	}
	if records.TXT == nil {
		records.TXT = []string{}
	}

	return records
}
