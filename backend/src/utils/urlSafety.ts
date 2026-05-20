// URL safety helpers — used to vet user-supplied URLs before the backend
// fetches them on behalf of a caller. The single legitimate caller today is
// /api/link-preview, where any authenticated user supplies a URL and the
// backend retrieves it to extract OpenGraph metadata. Without these checks,
// that endpoint is a server-side request forgery (SSRF) primitive that can
// probe the Railway internal network and cloud-metadata endpoints.
//
// Defense layers applied here:
//   1. Scheme allowlist: only http:// and https://. Blocks file://, ftp://,
//      gopher://, dict://, etc. (Node's fetch refuses file:// already, but
//      explicit is better than implicit.)
//   2. No userinfo in the URL: a credentials-in-URL like
//      `http://user:pass@victim.example/` could trick downstream logging
//      into believing the request originated from `user:pass`.
//   3. DNS resolution: resolve every A/AAAA record for the hostname, reject
//      if ANY resolved address is private/loopback/link-local/wildcard or
//      an IPv4-mapped IPv6 form of one.
//   4. The caller MUST also use `redirect: 'manual'` so a 3xx Location
//      to an internal URL can't bypass the pre-fetch check.
//
// Residual risk: DNS rebinding (the hostname resolves to a public IP at
// check time, then the attacker's DNS flips to a private IP before fetch()
// does its own lookup). Closing this requires pinning the resolved IP into
// the fetch via an undici Dispatcher. Out of scope here; the 5s fetch
// timeout and refusal-to-follow-redirects bound the practical impact.

import { promises as dns } from 'dns';
import { isIP } from 'net';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// IPv4 blocklist as [startInteger, endInteger] inclusive ranges.
// Built once at module load.
type Range = [bigint, bigint];

function ip4ToInt(addr: string): bigint {
  const parts = addr.split('.');
  if (parts.length !== 4) throw new Error(`invalid ipv4: ${addr}`);
  let n = 0n;
  for (const p of parts) {
    const byte = Number(p);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`invalid ipv4: ${addr}`);
    }
    n = (n << 8n) | BigInt(byte);
  }
  return n;
}

function cidr4(cidr: string): Range {
  const [addr, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const base = ip4ToInt(addr);
  const hostBits = BigInt(32 - bits);
  const mask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  const start = base & ~mask & 0xffffffffn;
  const end = start | mask;
  return [start, end];
}

const IPV4_BLOCKED: Range[] = [
  '0.0.0.0/8',        // "this network" / wildcard
  '10.0.0.0/8',       // RFC 1918 private
  '100.64.0.0/10',    // carrier-grade NAT
  '127.0.0.0/8',      // loopback
  '169.254.0.0/16',   // link-local (cloud metadata lives here)
  '172.16.0.0/12',    // RFC 1918 private
  '192.0.0.0/24',     // IETF protocol assignments
  '192.0.2.0/24',     // TEST-NET-1 (docs)
  '192.168.0.0/16',   // RFC 1918 private
  '198.18.0.0/15',    // benchmarking
  '198.51.100.0/24',  // TEST-NET-2 (docs)
  '203.0.113.0/24',   // TEST-NET-3 (docs)
  '224.0.0.0/4',      // multicast
  '240.0.0.0/4',      // reserved
  '255.255.255.255/32', // broadcast
].map(cidr4);

function ip4InBlocklist(addr: string): boolean {
  const n = ip4ToInt(addr);
  for (const [lo, hi] of IPV4_BLOCKED) {
    if (n >= lo && n <= hi) return true;
  }
  return false;
}

// Expand an IPv6 address (which may use :: shorthand) to its eight 16-bit
// groups, then concatenate into a 128-bit BigInt.
function ip6ToInt(addr: string): bigint {
  // Normalize: lowercase, strip zone id (`fe80::1%eth0`)
  let a = addr.toLowerCase();
  const pct = a.indexOf('%');
  if (pct >= 0) a = a.slice(0, pct);

  // Handle IPv4-mapped form like ::ffff:1.2.3.4 by converting the trailing
  // dotted-quad to two 16-bit hex groups first.
  const lastColon = a.lastIndexOf(':');
  if (lastColon >= 0 && a.slice(lastColon + 1).includes('.')) {
    const dotted = a.slice(lastColon + 1);
    const v4 = ip4ToInt(dotted);
    const hi = (v4 >> 16n) & 0xffffn;
    const lo = v4 & 0xffffn;
    a = a.slice(0, lastColon + 1) + hi.toString(16) + ':' + lo.toString(16);
  }

  // Expand ::
  const dbl = a.indexOf('::');
  let groups: string[];
  if (dbl === -1) {
    groups = a.split(':');
  } else {
    const left = a.slice(0, dbl) ? a.slice(0, dbl).split(':') : [];
    const right = a.slice(dbl + 2) ? a.slice(dbl + 2).split(':') : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) throw new Error(`invalid ipv6: ${addr}`);
    groups = [...left, ...Array(fill).fill('0'), ...right];
  }
  if (groups.length !== 8) throw new Error(`invalid ipv6: ${addr}`);

  let n = 0n;
  for (const g of groups) {
    const v = parseInt(g || '0', 16);
    if (!Number.isFinite(v) || v < 0 || v > 0xffff) {
      throw new Error(`invalid ipv6 group: ${g}`);
    }
    n = (n << 16n) | BigInt(v);
  }
  return n;
}

function cidr6(cidr: string): Range {
  const [addr, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const base = ip6ToInt(addr);
  const hostBits = BigInt(128 - bits);
  const mask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  const start = base & ~mask & ((1n << 128n) - 1n);
  const end = start | mask;
  return [start, end];
}

const IPV6_BLOCKED: Range[] = [
  '::1/128',            // loopback
  '::/128',             // unspecified
  'fc00::/7',           // unique local (ULA)
  'fe80::/10',          // link-local
  'ff00::/8',           // multicast
  '2001:db8::/32',      // documentation
  '64:ff9b::/96',       // NAT64 prefix
  '100::/64',           // discard prefix
].map(cidr6);

// ::ffff:0:0/96 — IPv4-mapped IPv6. We don't block by range here; we unwrap
// to the underlying IPv4 and run that through ip4InBlocklist. That catches
// every attacker variant including `::ffff:127.0.0.1`.
const IPV4_MAPPED_BASE = ip6ToInt('::ffff:0:0');
const IPV4_MAPPED_MASK = ip6ToInt('ffff:ffff:ffff:ffff:ffff:ffff::');

function ip6InBlocklist(addr: string): boolean {
  const n = ip6ToInt(addr);
  // Unwrap IPv4-mapped IPv6 → IPv4 and check the v4 blocklist.
  if ((n & IPV4_MAPPED_MASK) === IPV4_MAPPED_BASE) {
    const v4 = Number(n & 0xffffffffn);
    const dotted = [v4 >>> 24 & 0xff, v4 >>> 16 & 0xff, v4 >>> 8 & 0xff, v4 & 0xff].join('.');
    return ip4InBlocklist(dotted);
  }
  for (const [lo, hi] of IPV6_BLOCKED) {
    if (n >= lo && n <= hi) return true;
  }
  return false;
}

export interface UrlSafetyOk { ok: true; hostname: string; }
export interface UrlSafetyFail { ok: false; reason: string; }

/**
 * Validates that a user-supplied URL is safe for the backend to fetch.
 *
 * - The scheme must be http(s).
 * - The URL must not embed userinfo (`user:pass@host`).
 * - The hostname must resolve only to public IPs (no loopback / private /
 *   link-local / multicast / cloud-metadata ranges, in either IPv4 or IPv6
 *   including IPv4-mapped IPv6 forms).
 *
 * The caller MUST use `redirect: 'manual'` on the subsequent fetch — a 3xx
 * Location header would otherwise let an attacker bypass these checks by
 * pointing a public URL at an internal target.
 */
export async function isUrlSafeToFetch(urlStr: string): Promise<UrlSafetyOk | UrlSafetyFail> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, reason: `disallowed scheme: ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials in URL not allowed' };
  }

  // Strip brackets from IPv6 literals: new URL("http://[::1]/") gives
  // hostname "[::1]" — and isIP wants the unbracketed form.
  let host = parsed.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return { ok: false, reason: 'empty hostname' };

  // If the host is itself an IP literal, check directly without DNS.
  const literal = isIP(host);
  if (literal === 4) {
    if (ip4InBlocklist(host)) return { ok: false, reason: `blocked private/loopback IPv4: ${host}` };
    return { ok: true, hostname: host };
  }
  if (literal === 6) {
    if (ip6InBlocklist(host)) return { ok: false, reason: `blocked private/loopback IPv6: ${host}` };
    return { ok: true, hostname: host };
  }

  // DNS resolution. dns.lookup with `all: true` returns every A and AAAA
  // record so a single private hit fails the whole check.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'DNS resolution failed' };
  }
  if (addrs.length === 0) return { ok: false, reason: 'DNS returned no addresses' };

  for (const a of addrs) {
    if (a.family === 4 && ip4InBlocklist(a.address)) {
      return { ok: false, reason: `resolves to blocked IPv4 ${a.address}` };
    }
    if (a.family === 6 && ip6InBlocklist(a.address)) {
      return { ok: false, reason: `resolves to blocked IPv6 ${a.address}` };
    }
  }

  return { ok: true, hostname: host };
}
