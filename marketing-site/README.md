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

Update `data/site.json` after checking the panel catalog, MCP registry and latest GitHub release. Release asset links are pinned to the latest verified tag so a later release cannot silently break versioned filenames. Review `CLAIMS.md` when refreshing facts. Do not deploy or merge without Bradley’s review.
