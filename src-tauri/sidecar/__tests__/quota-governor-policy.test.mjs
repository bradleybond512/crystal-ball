import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createQuotaGovernor, bucketMsFor } from '../quota-governor.mjs';
import { QUOTA_RULES, QUOTA_TTL_MS } from '../quota-policy.mjs';
const NOW = Date.UTC(2026, 10, 8);
const quiet = { warn() {} };
// Exact original own304e504a policy snapshot, not inferred provider entitlements.
const originalRules = [
  {
    "id": "greynoise",
    "label": "GreyNoise Community",
    "host": "api.greynoise.io",
    "pathPrefix": "/v3/community/",
    "unit": "lookups",
    "secretKeys": [
      "GREYNOISE_API_KEY"
    ],
    "windows": [
      {
        "ms": 604_800_000,
        "limit": 50
      }
    ]
  },
  {
    "id": "abuseipdb-blacklist",
    "label": "AbuseIPDB blacklist",
    "host": "api.abuseipdb.com",
    "pathPrefix": "/api/v2/blacklist",
    "unit": "requests",
    "secretKeys": [
      "ABUSEIPDB_API_KEY"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 5
      }
    ]
  },
  {
    "id": "abuseipdb-check",
    "label": "AbuseIPDB check",
    "host": "api.abuseipdb.com",
    "pathPrefix": "/api/v2/check",
    "unit": "requests",
    "secretKeys": [
      "ABUSEIPDB_API_KEY"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 1000
      }
    ]
  },
  {
    "id": "opensky-states",
    "label": "OpenSky states",
    "host": "opensky-network.org",
    "pathPrefix": "/api/states/",
    "unit": "credits",
    "secretKeys": [
      "OPENSKY_CLIENT_ID",
      "OPENSKY_CLIENT_SECRET"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 4000
      }
    ],
    "cost": "function:openskyStatesCost"
  },
  {
    "id": "newsapi",
    "label": "NewsAPI",
    "host": "newsapi.org",
    "pathPrefix": "/v2/",
    "unit": "requests",
    "secretKeys": [
      "NEWSAPI_KEY"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 100
      }
    ]
  },
  {
    "id": "purpleair",
    "label": "PurpleAir",
    "host": "api.purpleair.com",
    "pathPrefix": "/v1/",
    "unit": "points",
    "estimate": true,
    "secretKeys": [
      "PURPLEAIR_API_KEY"
    ],
    "windows": [
      {
        "ms": 2_592_000_000,
        "limit": null
      }
    ],
    "pointsPerRow": "function:purpleairFieldCount"
  },
  {
    "id": "openweathermap",
    "label": "OpenWeatherMap",
    "host": "api.openweathermap.org",
    "pathPrefix": "/",
    "unit": "requests",
    "secretKeys": [
      "OWM_API_KEY"
    ],
    "windows": [
      {
        "ms": 2_592_000_000,
        "limit": 1_000_000
      },
      {
        "ms": 60_000,
        "limit": 60
      }
    ]
  },
  {
    "id": "virustotal",
    "label": "VirusTotal",
    "host": "www.virustotal.com",
    "pathPrefix": "/api/v3/",
    "unit": "requests",
    "secretKeys": [
      "VIRUSTOTAL_API_KEY"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 500
      },
      {
        "ms": 60_000,
        "limit": 4
      }
    ]
  },
  {
    "id": "geonames",
    "label": "GeoNames",
    "host": "secure.geonames.org",
    "pathPrefix": "/",
    "unit": "credits",
    "secretKeys": [
      "GEONAMES_USERNAME"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 10_000
      },
      {
        "ms": 3_600_000,
        "limit": 1000
      }
    ]
  },
  {
    "id": "newsdata",
    "label": "NewsData.io",
    "host": "newsdata.io",
    "pathPrefix": "/api/1/",
    "unit": "credits",
    "unverified": true,
    "secretKeys": [
      "NEWSDATA_API_KEY"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 200
      }
    ]
  },
  {
    "id": "openrouter",
    "label": "OpenRouter (free models)",
    "host": "openrouter.ai",
    "pathPrefix": "/api/v1/",
    "unit": "requests",
    "secretKeys": [
      "OPENROUTER_API_KEY"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": 50
      },
      {
        "ms": 60_000,
        "limit": 20
      }
    ]
  },
  {
    "id": "groq",
    "label": "Groq",
    "host": "api.groq.com",
    "pathPrefix": "/openai/v1/",
    "unit": "requests",
    "secretKeys": [
      "GROQ_API_KEY"
    ],
    "windows": [
      {
        "ms": 86_400_000,
        "limit": null
      }
    ]
  },
  {
    "id": "anthropic",
    "label": "Anthropic",
    "host": "api.anthropic.com",
    "pathPrefix": "/v1/messages",
    "unit": "requests",
    "tracksTokens": true,
    "secretKeys": [
      "ANTHROPIC_API_KEY"
    ],
    "windows": [
      {
        "ms": 2_592_000_000,
        "limit": null
      }
    ]
  }
];

test('all thirteen original policy records, matchers, units and values remain exact', () => {
  const actual = JSON.parse(JSON.stringify(QUOTA_RULES, (_key, value) => typeof value === 'function' ? `function:${value.name}` : value));
  assert.equal(actual.length, 13);
  assert.deepEqual(actual, originalRules);
  assert.deepEqual(QUOTA_TTL_MS, { greynoiseSeeds: 604_800_000, abuseipdbBlacklist: 28_800_000, newsapi: 1_200_000, openskyStates: 120_000 });
});

for (const rule of QUOTA_RULES) {
  const url = `https://${rule.host}${rule.pathPrefix}fixture`;
  test(`${rule.id}: exact host/path matching and pre-send charge`, () => {
    const g = createQuotaGovernor({ now: () => NOW, logger: quiet });
    assert.equal(g.admit(url.replace(rule.host, `${rule.host}.invalid`)).ruleId, null);
    if (rule.pathPrefix !== '/') assert.equal(g.admit(`https://${rule.host}/unmatched`).ruleId, null);
    const ticket = g.admit(url);
    assert.equal(ticket.ruleId, rule.id);
    assert.equal(ticket.allowed, true);
    const before = g.status().providers.find(p => p.id === rule.id).windows.map(w => w.used);
    assert.deepEqual(before, rule.windows.map(() => ticket.cost));
    g.observe(ticket, { status: 500 });
    assert.deepEqual(g.status().providers.find(p => p.id === rule.id).windows.map(w => w.used), before, 'failed attempts are not refunded');
    assert.equal(g.admit(url.replace(rule.host, `${rule.host.toUpperCase()}.`)).ruleId, rule.id);
  });
  for (const window of rule.windows.filter(w => w.limit !== null)) test(`${rule.id}: exact ${window.ms} window budget boundary and interactive bypass`, (t) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'quota-rule-'));t.after(() => rmSync(dir, { recursive: true, force: true }));
    const filePath = path.join(dir, 'ledger.json');
    const cost = createQuotaGovernor({ now: () => NOW, logger: quiet }).admit(url).cost;
    const ceiling = Math.floor(window.limit * 0.8);
    writeFileSync(filePath, JSON.stringify({ version: 1, rules: { [rule.id]: { windows: [[[Math.floor(NOW / bucketMsFor(window.ms)) * bucketMsFor(window.ms), ceiling - cost]]] } } }));
    const g = createQuotaGovernor({ rules: [{ ...rule, windows: [window] }], filePath, now: () => NOW, logger: quiet });
    assert.equal(g.admit(url).allowed, true);
    assert.equal(g.status().providers[0].windows[0].used, ceiling);
    assert.equal(g.admit(url).allowed, false);
    assert.equal(g.admit(url, { priority: 'interactive' }).allowed, true);
    assert.equal(g.status().providers[0].windows[0].used, ceiling + cost);
    g.flush();
  });
}

for (const id of ['purpleair', 'groq', 'anthropic']) for (const [status, headers, reason] of [
  [429, {}, 'provider_429'], [402, {}, 'provider_out_of_credit'], [200, { 'x-ratelimit-remaining': '0' }, 'provider_remaining_0'],
]) test(`${id}: null numeric limit still honors ${reason} for background only`, () => {
  const rule = QUOTA_RULES.find(r => r.id === id);const url = `https://${rule.host}${rule.pathPrefix}fixture`;
  const g = createQuotaGovernor({ now: () => NOW, logger: quiet });
  g.observe(g.admit(url), { status, headers });
  assert.equal(g.admit(url).allowed, false);
  assert.equal(g.admit(url, { priority: 'interactive' }).allowed, true);
  const p = g.status().providers.find(p => p.id === id);
  assert.equal(p.observeOnly, true);assert.equal(p.cooldownReason, reason);assert.equal(p.windows[0].limit, null);
});

test('synchronous concurrent admission cannot overspend a background ceiling', async () => {
  const g = createQuotaGovernor({ now: () => NOW, logger: quiet });
  const results = await Promise.all(Array.from({ length: 20 }, () => Promise.resolve().then(() => g.admit('https://api.abuseipdb.com/api/v2/blacklist'))));
  assert.equal(results.filter(r => r.allowed).length, 4);
  assert.equal(g.status().providers.find(p => p.id === 'abuseipdb-blacklist').windows[0].used, 4);
});

test('rolling edge bucket remains counted until its conservative end expires', () => {
  const window = 24 * 60 * 60 * 1000; const bucket = bucketMsFor(window); let now = NOW + 1;
  const g = createQuotaGovernor({ now: () => now, logger: quiet }); const url = 'https://api.abuseipdb.com/api/v2/blacklist';
  for (let i = 0; i < 4; i++) g.admit(url);
  now = NOW + window;
  assert.equal(g.admit(url).allowed, false);
  now = NOW + window + bucket;
  assert.equal(g.admit(url).allowed, true);
});
