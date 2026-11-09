# npm signature diagnostic output

## Scope and preserved policy

This Standard observability change adds only `--json` to the existing direct
`npm audit signatures` workflow command. It does not change verifier algorithms,
trust roots, registry configuration, concurrency, cache handling, retries,
permissions, runtime selection, trusted events, installation prerequisites or
exit semantics. No signature verification is repeated to recover display counts.

The official npm 10.9.9 implementation sets failure status for invalid or missing
signatures before selecting JSON output. JSON includes `invalid` and `missing`
entries; invalid-attestation entries include the underlying verifier message and
predicate type. It does not promise a recursive error cause stack. Successful
JSON output omits the human-format verified-package and attestation counts;
empty arrays must not be interpreted as a measured package census. Future npm
versions may change output details.

## Evidence and limits

On base `348cd27064ff9150842feb9ee6d4b646e138a611`, the unchanged old command
produced exactly two intended assertion failures in the focused workflow tests.
After the one-scalar change, both tests passed. The parsed actual run command is
executed against a synthetic npm shell fixture for success, invalid attestation,
missing signature and unexpected error, preserving stdout and statuses 0, 1
and 7. This is shell wiring evidence, not cryptographic verification or a real
registry audit.

The first local attempt produced the intended test failures but encountered a
supervisor process-identity startup race. It is retained as failed harness
qualification, not accepted red evidence. A separately reviewed direct-Node
proof driver waited for explicit guard admission, then captured the exact child
result. The qualified red and green runs both completed within their resource
limits with independently verified empty process groups. No shared guard change
or ignored guard error was used.

Committed-source mutations, complete workflow suites, normal hooks, aggregate,
independent Sonnet review and genuine hosted Security Audit remain pending.
Current source is not yet a completed or published qualification. Private raw
receipts are retained under `/tmp/cb-signature-json-evidence`.

## Public-data boundary and gates

The declared hosted workflow has no signature-step credentials or private
registry settings. Checkout retains no credentials, lifecycle scripts remain
disabled, and tracked npm configuration contains no authentication fields.
Reviewed root lock URLs use the public npm registry without userinfo or query.
No user/global settings or secrets were inspected. Raw verifier messages are
not universally redacted; discovering credential-bearing inputs requires
reassessment before widening output. No environment/config/debug dump or new
artifact publication is added.

The CI workflow path still requires `dependency-change-approved` under the
unchanged dependency policy and retains its CODEOWNER. The existing delegation
allows that label after technical review, not before assessment. No dependency
version, lock, bin or lifecycle surface changes: neither an age waiver nor the
human-only `install-scripts-reviewed` label is indicated. All actual required
reviews and checks remain mandatory.

## Rollback and non-goals

Revert the single output-format flag and its corresponding tests if necessary;
never suppress a verifier failure. This change improves evidence for future
failures, not their underlying cause. The prior different-package hosted
attestation failures remain unexplained despite successful separately bounded
verification and approved hosted retries. No automatic retry policy is added.
