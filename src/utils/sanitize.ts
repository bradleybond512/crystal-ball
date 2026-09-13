const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

// Guard on null/undefined only, NOT falsiness: a numeric 0 or a boolean false
// reaching this through an `any` boundary must render as "0" / "false", not as
// an empty string. Most callers already wrap in String(...), so this only
// changes the unwrapped case — and there it fixes silent content loss.
// Empty string still returns '' (''.replace(...) === '').
export function escapeHtml(str: string): string {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

/**
 * Strip trailing dots from a hostname ("example.com." === "example.com").
 *
 * Done with a loop rather than /\.+$/ deliberately: that pattern backtracks
 * quadratically on a hostname of many dots, which is attacker-influenced input
 * here. This is linear and needs no lint suppression.
 */
function stripTrailingDots(host: string): string {
  let end = host.length;
  while (end > 0 && host[end - 1] === '.') end -= 1;
  return host.slice(0, end);
}

/**
 * Normalise an IPv4-mapped IPv6 literal to dotted-quad form, in both spellings:
 * `::ffff:127.0.0.1` and the hex form `::ffff:7f00:1`. Returns the input
 * unchanged when it is not IPv4-mapped.
 *
 * The hex form is the one most hand-rolled SSRF filters miss — it reaches the
 * same address without ever containing a dot.
 */
function normalizeIpv4Mapped(ipCandidate: string): string {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ipCandidate);
  if (dotted) return dotted[1] ?? '';

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipCandidate);
  if (!hex) return ipCandidate;

  const hi = Number.parseInt(hex[1] ?? '0', 16);
  const lo = Number.parseInt(hex[2] ?? '0', 16);
  return [(hi >> 8) & 0xFF, hi & 0xFF, (lo >> 8) & 0xFF, lo & 0xFF].join('.');
}

/**
 * Private / loopback / link-local / multicast check for a dotted-quad IPv4.
 * Returns false for anything that is not a well-formed IPv4 address, including
 * octets above 255 — those are not addresses we need to block.
 */
function isPrivateIpv4(ipCandidate: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipCandidate);
  if (!match) return false;

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;

  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8
  return a >= 224; // multicast / reserved
}

/** True for IPv6 loopback, unique-local (fc00::/7) and link-local (fe80::/10). */
function isPrivateIpv6(ipCandidate: string): boolean {
  if (ipCandidate === '::1' || ipCandidate === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ipCandidate)) return true; // fc00::/7 unique-local
  return /^fe[89ab][0-9a-f]:/i.test(ipCandidate); // fe80::/10 link-local
}

/**
 * Return true if the hostname resolves to a private / loopback / link-local
 * address range.  Used by {@link sanitizeUrl} to mitigate client-side SSRF.
 */
function isPrivateHostname(hostname: string): boolean {
  const h = stripTrailingDots(hostname.toLowerCase());

  // eslint-disable-next-line no-restricted-syntax -- intentional: SSRF protection checking hostname values per RFC 6761; not constructing URLs
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;

  const bare = h.replace(/^\[|\]$/g, '');
  if (isPrivateIpv6(bare)) return true;

  return isPrivateIpv4(normalizeIpv4Mapped(bare));
}

function isAllowedProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

export function sanitizeUrl(url: string): string {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (isAllowedProtocol(parsed.protocol)) {
      if (isPrivateHostname(parsed.hostname)) return '';
      return escapeAttr(parsed.toString());
    }
  } catch {
    // Not an absolute URL, continue and validate as relative.
  }

  if (!/^(\/|\.\/|\.\.\/|\?|#)/.test(trimmed)) {
    return '';
  }

  try {
    const base = typeof window === 'undefined' ? 'https://example.com' : window.location.origin;
    const resolved = new URL(trimmed, base);
    if (!isAllowedProtocol(resolved.protocol)) {
      return '';
    }
    return escapeAttr(trimmed);
  } catch {
    return '';
  }
}

export function escapeAttr(str: string): string {
  return escapeHtml(str);
}
