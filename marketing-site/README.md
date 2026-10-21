# Crystal Ball website

The public landing page for
[Crystal Ball](https://github.com/bradleybond512/crystal-ball), Bradley
Bond's open-source situational-awareness app for macOS.

The site explains the product, links to the latest release and source code, and
invites supporters to fund continued development through
[GitHub Sponsors](https://github.com/sponsors/bradleybond512).

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

## Verification

```bash
npm run build
npm run lint
./node_modules/.bin/tsc --noEmit
node --test tests/marketing.test.mjs
```

## Source and release review

Imported from confirmed Sites project `appgprj_6a67d6f7f5fc8191ace93399c51b354c`, source commit `8fee5e7919ea51918c9585c0cceaddc481c7b70e`. The original lives in the task workspace at `work/crystal-ball`.

`npm run generate` reads panel catalogs, the MCP registry, build targets and the latest GitHub release into ignored `data/generated.json`. It generates a static sitemap. Release discovery failures discard stale asset links and use `/releases/latest`. Update only human-reviewed copy and URLs in `data/site.json`. Review `CLAIMS.md` when refreshing facts. Do not deploy or merge without Bradley’s review.

## Visual and link review

After `npm ci` at the repository root and in this directory, run `npm test`, start the production build on port 4173, then run `node scripts/capture-review.mjs`. It uses the repository’s Playwright and installed Chrome. `node scripts/check-links.mjs` audits the built worker and external links. Section screenshots temporarily hide the sticky header to show the whole section; separate navigation captures preserve the actual header.

Build-only minifiers `lightningcss` (MPL-2.0) and `terser` (BSD-2-Clause) were already transitive dependencies; pinning them makes direct use reproducible. They minify inline CSS/JS at build time and add no browser runtime dependency. HTML removes inter-tag whitespace. Responses remain uncompressed inside the app; the hosting edge owns transfer compression and its Content-Encoding header.
