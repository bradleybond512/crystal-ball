# UX-055 — Show when a credential was last verified

Approved November 3, 2026 against canonical main `cd459dfec`. With open PR claims included, the roadmap selected UX-055 at priority S. This changes how the UI describes evidence about credentials and how the existing verification boundary handles failures. The operator approved the design, draft claim and local implementation.

## What the present code does

The Key Dashboard and setup wizard store a Boolean-derived status, a timestamp and sometimes an upstream error under `cb:key-status:<key>`. The dashboard reads the status without its timestamp and can display it even when the credential is absent. Testing an unsaved draft can overwrite the status for the saved credential. Standalone Settings labels a local presence or format check “Valid.” Browser, sidecar and buffered settings paths interpret an unavailable check differently.

In a production dashboard DOM fixture with synthetic values, a 306-day-old result displayed as valid with no age. Removing the credential still left that display valid. A simulated Groq HTTP 503 persisted as valid on web and invalid on desktop. A simulated Anthropic HTTP 429 persisted as valid on desktop. The fixture used no operator credentials or external requests. Baseline suites passed 19/19 settings tests and 21/21 plus 15/15 secret-boundary tests.

A public control illustrates the difference between a reachable endpoint and proof of a credential. Without sending credentials, `GET https://openrouter.ai/api/v1/models` returned HTTP 200 and 454 entries in `data`. The same unauthenticated control at `https://api.groq.com/openai/v1/models` returned HTTP 401 with a structured `error` object. A successful public model list cannot verify the supplied OpenRouter credential. These observations do not establish the status of any operator key.

## Approved operator policy

* Separate whether a value is present, whether its format is acceptable, and what a provider actually established. Use dated “Provider verified” or “Provider rejected” only for conclusive, provider-specific evidence. Show “Could not verify” for an outage, local transport/authentication failure, rate limit, bot challenge, inconclusive permissions, malformed body or public no-auth endpoint. Show “Not tested” for settings without a supported credential probe. A URL reachable or model available is a different result.
* Show elapsed age and an accessible exact timestamp for conclusive evidence. Mark it stale at **24 hours**, for rejected as well as verified results. Age changes the wording only. A failed new attempt shows its own time and reason and leaves the last conclusive result identifiable as historical. Missing, malformed, future or unbound timestamps cannot establish a fresh result. Refresh the displayed age when the settings surface is visible without issuing network traffic.
* Test an unsaved value only as a draft. Saving a value without a conclusive check yields “Saved, not verified.” Preserve the wizard’s save-first behavior and existing local validation safeguards. An unavailable provider does not by itself block explicitly saving a well-formed value. Keep existing feature enablement and operator-configured secrets independent of validation age. Never replace, remove or rotate a stored value as a side effect of checking it.
* Probe only on **explicit Test or Save-and-verify**. Coalesce overlapping requests for one credential, cap concurrent probes at two, and enforce a 60-second repeat cooldown per credential without queuing a retry. Apply a total deadline including response-body reads and fallbacks (up to eight seconds in the browser and twelve seconds in the desktop validator), a bounded response size, and destination/redirect restrictions. If a provider contract cannot be safely or conclusively checked with its existing endpoint, report that limitation. No scheduled or startup revalidation.

## Evidence, UI and secret boundaries

Use a small allowlisted, versioned receipt containing outcome, timestamps and fixed reason codes. Treat old Boolean records as historical and unverified for the current value. Ignore free-form legacy errors and replace obsolete records when safely written. On storage denial, keep the result scoped to the current operation. Never persist or emit raw provider text, request URLs containing credentials, credential-derived hashes, prefixes, values or partner secrets.

Invalidate current-result eligibility on credential replacement, removal, vault lock/reset, pending native writes, and cross-window changes. Check attempt identity again before applying asynchronous results. Cover dependent pairs such as OpenSky. Only a result bound to the tested saved value can describe it as current. After a restart, an external change or any ambiguous binding, use historical wording. A missing credential must always display as absent. Test stored desktop secrets using the existing authenticated sidecar route and its stored copy, preserving the value-free renderer boundary.

Use the same presentation rules in the in-app API Keys dashboard, setup wizard, and standalone settings window. Use an explicit evidence outcome at the provider boundary. Do not derive evidence from message text, loose truthiness, or a sidecar HTTP status alone. A provider rejection requires an established authentication-specific signal. Scope/plan restrictions and machine-local bearer failures must not label a credential invalid. Send only the companion fields needed for a paired probe.

## Verification, ownership and rollback

| Owner | Work and acceptance |
| --- | --- |
| Provider and sidecar | Audit existing verification branches and classify conclusive evidence conservatively. Test authenticated success, explicit bad credential, 403 challenge/permissions, local 401, 429, timeout, malformed data and public 200 with synthetic inputs. Prove deadline and destination limits. |
| Settings UI and state | Exercise dashboard, wizard and standalone settings, fresh and stale outcomes, missing/future timestamps, historical records, typed tests, failed saves, replacement/removal and simultaneous windows. Preserve focus and announce checks without exposing values. |
| Verification | Use temporary browser/desktop profiles, stubbed transports and secret canaries. Count attempts, confirm no implicit rechecks, and inspect the rendered feedback, stored metadata, logs and request destinations for leaks. Run relevant secret-boundary/settings/sidecar suites and the repository gate. Attach isolated mutation proofs and independent reviews. |

Rollback restores prior presentation and probing code. Keep versioned receipts separate or safely ignorable by prior readers. No keychain/vault migration or credential rotation is needed. The claim and implementation will stay local until their corresponding approvals. Installation, auto-merge and delivery remain paused.
