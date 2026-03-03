// Package osint implements SSL/TLS certificate inspection for domain intelligence.
package osint

import (
	"crypto/tls"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/bradleybond512/crystal-ball/osint/pkg/api"
)

const sslTimeout = 10 * time.Second

// LookupSSL fetches the TLS certificate for the given domain on port 443.
func LookupSSL(domain string) (*api.SSLCertificate, error) {
	dialer := &net.Dialer{Timeout: sslTimeout}
	conn, err := tls.DialWithDialer(
		dialer,
		"tcp",
		domain+":443",
		&tls.Config{
			ServerName: domain,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("TLS connect to %s: %w", domain, err)
	}
	defer conn.Close()

	certs := conn.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return nil, fmt.Errorf("no certificates returned by %s", domain)
	}

	cert := certs[0]
	now := time.Now()

	subject := cert.Subject.CommonName
	if subject == "" {
		subject = strings.Join(cert.Subject.Organization, ", ")
	}

	issuer := cert.Issuer.CommonName
	if issuer == "" {
		issuer = strings.Join(cert.Issuer.Organization, ", ")
	}

	sans := cert.DNSNames
	if sans == nil {
		sans = []string{}
	}

	return &api.SSLCertificate{
		Subject:    subject,
		Issuer:     issuer,
		ValidFrom:  cert.NotBefore.UTC().Format(time.RFC3339),
		ValidUntil: cert.NotAfter.UTC().Format(time.RFC3339),
		SANs:       sans,
		IsExpired:  now.After(cert.NotAfter),
	}, nil
}
