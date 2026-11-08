# Foreign military news angle extraction

Bounded production change: adopt the existing exact nonempty angle-span helper,
without changing parser, feed/filter policies, classification, clipping, dates,
source precedence, freshness or cache behavior. This is text extraction, not HTML
sanitization. No shared-helper implementation changes.

The immutable full provider fixture is from main
6c8231a6bf240d16f693a8dba306d4dd0532ece5, blob
0e351de7b223d7d23798e14c80d45d518a84bc13, SHA256
2531231c226e748ea7a9c3e2a7db2816641705d1b46a8fe4f532e02faf2b940d.
Independent contexts compare full public output, raw Date/nonfinite fingerprints,
request and body behavior, real allSettled statuses, freshness and cache identity.
All five feeds remain filtered, failures remain fulfilled empty updates, and
first-source normalization/dedup occurs before severity/date ordering and clipping.

Node-only XML fixtures use installed happy-dom21.0.4 with script/resource/file
loading and navigation disabled. Its text/xml parser uses XMLParser; no real feed
requests occur. This is not browser parity. In discovery, valid CDATA produced
parsererror in this installed implementation; those failed initial assertions were
retained outside the repository. Escaped XML is therefore used for meaningful
nonempty differential and adversarial tests, not a patched parser. CDATA browser
behavior is not claimed qualified by this harness.

Tests-first evidence: original provider passed10 behavioral/routing cases, then
failed the added actual exported-fetch unmatched-angle case (300,000 '<' characters,
2-second deadline after READY/GO). The identical case passed after the production
helper substitution, with all11 tests passing. Compiler/runtime: TypeScript6.0.3,
Node22.23.3, unchanged root lock and qualified dependency tree. Child groups are
owned and killed on timeout; imports occur before READY. Scoped existing-plugin
lint passed. Source remains uncommitted: clean committed mutations, full QA,
new-plugin qualification, independent review and hosted acceptance remain pending.

Light strengthening adds mixed feed failures with exact proxy/options and body-read
assertions, a settlement-advancing clock proving post-settlement cache timestamps,
public severity classes and under-limit normalized-title collisions. The focused
suite now passes14/14. New-plugin scoped lint passes using the unchanged current
configuration with only the SonarJS import redirected to the previously qualified
4.2.2 graph; existing plugins and dependencies remain unchanged. This is a scoped
plugin-overlay check, not a newly resolved complete dependency-upgrade candidate.
A cross-realm prototype assertion setup failure was fixed by the existing raw
fingerprint conversion, with the failing log retained. No policy assertion removed.
