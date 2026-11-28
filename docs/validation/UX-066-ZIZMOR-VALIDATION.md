# Zizmor 1.32.0 verification

The UX-066 candidate updates the workflow scanner from 1.31.1 to 1.32.0.
The workflow still runs the same offline command with a medium severity
threshold and installs only hash-pinned binary distributions. The change
corrects the provenance comment in `.github/tools/zizmor/requirements.txt`.
The file's SHA-256 is `060babcb98bb3c6fd7c487847141dccf837839b7af7e309dce65518e995ff5ec`.

## Artifact inspection

The candidate's requirement body matches [PR #1897](https://github.com/bradleybond512/crystal-ball/pull/1897).
All twelve hashes match the [PyPI release metadata](https://pypi.org/pypi/zizmor/1.32.0/json).
For each version we downloaded the macOS ARM64 and Linux x86-64 wheels,
checked their bytes against the pins and verified every hashed RECORD entry
before installation. Each contained six expected regular files, including one
native executable, MIT license and a CycloneDX software inventory. Neither
version declared Python dependencies or included Python startup hooks.

| Downloaded wheel | 1.31.1 SHA-256 | 1.32.0 SHA-256 |
| --- | --- | --- |
| macOS ARM64 | `4a70ee3c2721122aff04d5bbad5e448d15384f45de2ecb3c9493fe9dac2bc95f` | `0a999c98015becd9f69919ce01febadfb1c2be9b8ec2ce9ef7eb13ff23ba8eba` |
| Linux x86-64 | `58e878eb2dbd2c6183c105e1ac28c14f7dd1eca44a783f1fe2a69647d012c410` | `84a6acb975accc13408786a2bd274b572537ca19c933ebbc13e78f3988562071` |

Both licenses matched the tagged upstream license bytes. All bundled component
names and versions appeared in the corresponding upstream Cargo.lock. The new
inventory adds `pkg-config` 0.3.34. Native system library dependencies matched
across versions on each platform. PyPI reports Trusted Publishing. The tagged
upstream workflows disable attestation generation, and the public provenance
endpoints supplied no signed build-to-wheel attestation. Other distributions
received metadata digest comparison only.

## Coverage and detection

The harness exported the 23 tracked workflows and ignore inputs from
`5955a8d9860ad2f616008a3d738d423fbb8e5415` into disposable directories.
Both verified macOS binaries ran in separate temporary environments with
network access denied. The harness captured the CI command's exit code,
diagnostics and completed paths. Fixture workflows were static scanner inputs.

```sh
zizmor --offline --min-severity medium --format github .github/workflows
```

| Check | 1.31.1 | 1.32.0 |
| --- | --- | --- |
| Production workflows, eight runs per version | 23/23 completed each run, exit 0 | 23/23 completed each run, exit 0 |
| Findings at the CI threshold | 0 | 0 |
| Direct expression fixture | 1 finding, exit 14 | 1 finding, exit 14 |
| Corrected fixture | 0 findings, exit 0 | 0 findings, exit 0 |
| Wrapped expression fixture | 0 findings, exit 0 | 1 template-injection finding, exit 14 |
| Median wall time including process startup | 83.125 ms | 83.967 ms |

The wrapped-expression assertion named `.github/workflows/inert.yml:13`.
It reported `0 pass / 1 fail` on the old scanner and `1 pass / 0 fail` on the
candidate. The missing-path control began with `23 pass / 0 fail`. Its recorded
Git diff deletes `.github/workflows/variant-e2e.yml` in the disposable fixture.
The assertion reported `22 pass / 1 fail`. Restoration returned
`23 pass / 0 fail`, a clean scratch tree and SHA-256
`31681b5f978015bfb2ff6552736ea5ee6f1cb721b676efdd0c60204b31deda1b`.

The 102-file comparison evidence index verified all entries. Its SHA-256 is
`2dc71d5b670fdce052d46fcb5423af495e28c833a4ab225fcffe99c853b9bc18`.
The local UX-066 evidence directory contains `zizmor-scans/REPRODUCE.md`,
the harness, raw outputs, timings, mutation diff and artifact receipts.

Local execution covered macOS ARM64. Linux wheels received static inspection.
The earlier [Linux Zizmor job on #1897](https://github.com/bradleybond512/crystal-ball/actions/runs/42724006906/job/129524847539)
installed 1.32.0 successfully on that PR. Hosted Linux validation of this
candidate requires publication of its implementation commit.

## Repository checks

| Suite on the supported Node 22 toolchain | Passed | Failed |
| --- | ---: | ---: |
| `test:workflow-security` | 96 | 0 |
| `test:supply-chain-gates` | 27 | 0 |
| `test:roadmap-controller` | 135 | 0 |

An earlier run under the host's Node 26.3.0 and npm 11.16.0 failed three
dependency-override assertions in each of the first two suites. The repository
declares Node 22, which passed those assertions.

The full validation gate ran the three named suites, strict linting, both
TypeScript checks, secret scanning, documentation checks and the build.
Its final output included:

```text
Agentic validation gate passed.
Tests run: test:workflow-security test:supply-chain-gates test:roadmap-controller
```

## Rollback

Restore `.github/tools/zizmor/requirements.txt` from the documentation claim
tip `ad4d014e920bc4f4fc7969e9f287e9d8f0309053` and rerun the workflow
security and supply-chain suites and the original offline scanner command.
