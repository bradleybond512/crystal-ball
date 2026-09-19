# UX-000 runtime error-preservation mutation proof

Commit: `564d281818a8557ec4d4bbec04125e2553ec7a52`.

Worktree: `/Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919`.

All network and IPC outcomes in this browser matrix are synthetic fixtures executing the real runtime fetch patch. This proves response/error preservation and boundary behavior, not provider availability or packaged acceptance. No real credentials or running desktop endpoints were used.

## Result

Five independent mutations killed; zero survivors. Baseline and final restored suite: **11 pass / 0 fail**.

| Run | Pass | Fail |
| --- | ---: | ---: |
| baseline | 11 | 0 |
| http-synthetic-503 | 8 | 3 |
| error-synthetic-503 | 9 | 2 |
| await-http-cloud | 10 | 1 |
| allow-local-only | 9 | 2 |
| bypass-missing-key | 6 | 5 |
| final-restored | 11 | 0 |

## Command and restoration evidence

Each run used the same 11 behavior scenarios:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH E2E_PORT=4204 npm run test:e2e:runtime -- --grep 'runtime preserves' --output=<per-run-artifact-directory>
```

Exact per-run commands and exit codes are in the adjacent `*-result.json` files. Full actual output is retained in `*.log`; readable copies in `*-plain.log`.

Each mutation started with empty `git status --short`, and both source and test checksums were captured. Its exact applied diff was captured and inspected before running the test command. After the command, original source bytes were restored from the pinned commit, both checksums matched and status was empty. The test file was never mutated.

SHA-256 before and after every run:

```text
9be31aedb40860176a940495e04ed5854c3e614a8ca1fe2288659726dce40ff7  src/services/runtime.ts
8b6e0b67fa4b3315a0ae54e22a7c616495216ea0388c595de232316c656a6665  e2e/runtime-fetch.spec.ts
```

The five mutants independently target: original HTTP failure being masked by synthetic503, original exception being swallowed by synthetic503, cloud failures being caught/retried twice, local-only data being sent to cloud, and requests sent without a configured cloud key.

## Applied diffs and actual assertions

### http-synthetic-503

```diff
diff --git a/src/services/runtime.ts b/src/services/runtime.ts
index ec0a784b1..c924afb6c 100644
--- a/src/services/runtime.ts
+++ b/src/services/runtime.ts
@@ -390,7 +390,7 @@ export function installRuntimeFetchPatch(): void {
  return response;
  }
  if (debug) console.log(`[fetch] local ${response.status}, falling back to cloud`);
- return cloudFallback(() => response);
+ return cloudFallback(() => Response.json({ error: 'CRYSTALBALL_API_KEY not configured' }, { status: 503, headers: { 'Content-Type': 'application/json' } }));
  }
  return response;
  } catch (error) {
```

```text
  1) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves rate-limited response without a cloud key 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 429
    Received: 503

      821 |       expect(local).toHaveLength(scenario.localCalls);
      822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
    > 823 |       expect(result.status).toBe(scenario.status);
          |                             ^
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
      826 |       expect(local.every((call) => call.cloudKey === null)).toBe(true);
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:823:29

  2) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves rate-limited response with a whitespace cloud key 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 429
    Received: 503

      821 |       expect(local).toHaveLength(scenario.localCalls);
      822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
    > 823 |       expect(result.status).toBe(scenario.status);
          |                             ^
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
      826 |       expect(local.every((call) => call.cloudKey === null)).toBe(true);
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:823:29

  3) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves final unauthorized response after token refresh 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 401
    Received: 503

      821 |       expect(local).toHaveLength(scenario.localCalls);
      822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
    > 823 |       expect(result.status).toBe(scenario.status);
          |                             ^
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
      826 |       expect(local.every((call) => call.cloudKey === null)).toBe(true);
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:823:29
```

### error-synthetic-503

```diff
diff --git a/src/services/runtime.ts b/src/services/runtime.ts
index ec0a784b1..abc61c20f 100644
--- a/src/services/runtime.ts
+++ b/src/services/runtime.ts
@@ -398,7 +398,7 @@ export function installRuntimeFetchPatch(): void {
  if (!allowCloudFallback) {
  throw error;
  }
- return cloudFallback(() => { throw error; });
+ return cloudFallback(() => Response.json({ error: 'CRYSTALBALL_API_KEY not configured' }, { status: 503, headers: { 'Content-Type': 'application/json' } }));
  }
   };
```

```text
  1) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves final connection error after four local attempts 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 0
    Received: 503

      821 |       expect(local).toHaveLength(scenario.localCalls);
      822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
    > 823 |       expect(result.status).toBe(scenario.status);
          |                             ^
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
      826 |       expect(local.every((call) => call.cloudKey === null)).toBe(true);
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:823:29

  2) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves caller abort after one local attempt 

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: 0
    Received: 503

      821 |       expect(local).toHaveLength(scenario.localCalls);
      822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
    > 823 |       expect(result.status).toBe(scenario.status);
          |                             ^
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
      826 |       expect(local.every((call) => call.cloudKey === null)).toBe(true);
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:823:29
```

### await-http-cloud

```diff
diff --git a/src/services/runtime.ts b/src/services/runtime.ts
index ec0a784b1..1beb18faa 100644
--- a/src/services/runtime.ts
+++ b/src/services/runtime.ts
@@ -390,7 +390,7 @@ export function installRuntimeFetchPatch(): void {
  return response;
  }
  if (debug) console.log(`[fetch] local ${response.status}, falling back to cloud`);
- return cloudFallback(() => response);
+ return await cloudFallback(() => response);
  }
  return response;
  } catch (error) {
```

```text
  1) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves keyed cloud rejection after local HTTP failure 

    Error: expect(received).toHaveLength(expected)

    Expected length: 1
    Received length: 2
    Received array:  [{"authorization": null, "cloudKey": "wm_test_key_1234567890abcdef", "local": false, "sameCallerSignal": false}, {"authorization": null, "cloudKey": "wm_test_key_1234567890abcdef", "local": false, "sameCallerSignal": false}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21
```

### allow-local-only

```diff
diff --git a/src/services/runtime.ts b/src/services/runtime.ts
index ec0a784b1..a9b06f50f 100644
--- a/src/services/runtime.ts
+++ b/src/services/runtime.ts
@@ -347,7 +347,7 @@ export function installRuntimeFetchPatch(): void {
 
  const localUrl = `${getApiBaseUrl()}${target}`;
  if (debug) console.log(`[fetch] intercept → ${target}`);
- const allowCloudFallback = !isLocalOnlyApiTarget(target);
+ const allowCloudFallback = true;
 
  const cloudFallback = async (onUnavailable: () => Response) => {
  if (!allowCloudFallback) {
```

```text
  1) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves keyed local-only prefix response 

    Error: expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"authorization": null, "cloudKey": "wm_test_key_1234567890abcdef", "local": false, "sameCallerSignal": false}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21

  2) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves keyed local-only exact-path error 

    Error: expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"authorization": null, "cloudKey": "wm_test_key_1234567890abcdef", "local": false, "sameCallerSignal": false}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21
```

### bypass-missing-key

```diff
diff --git a/src/services/runtime.ts b/src/services/runtime.ts
index ec0a784b1..dfc6d2f15 100644
--- a/src/services/runtime.ts
+++ b/src/services/runtime.ts
@@ -357,7 +357,7 @@ export function installRuntimeFetchPatch(): void {
  if (debug) console.log(`[fetch] cloud fallback → ${cloudUrl}`);
  const cloudHeaders = new Headers(init?.headers);
  const cloudApiKey = await getCrystalBallCloudApiKey();
- if (!cloudApiKey) {
+ if (false) {
  return onUnavailable();
  }
  cloudHeaders.set('X-CrystalBall-Key', cloudApiKey);
```

```text
  1) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves rate-limited response without a cloud key 

    Error: expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"authorization": null, "cloudKey": "null", "local": false, "sameCallerSignal": false}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21

  2) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves rate-limited response with a whitespace cloud key 

    Error: expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"authorization": null, "cloudKey": "null", "local": false, "sameCallerSignal": false}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21

  3) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves final unauthorized response after token refresh 

    Error: expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"authorization": null, "cloudKey": "null", "local": false, "sameCallerSignal": false}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21

  4) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves final connection error after four local attempts 

    Error: expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"authorization": null, "cloudKey": "null", "local": false, "sameCallerSignal": false}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21

  5) [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves caller abort after one local attempt 

    Error: expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"authorization": null, "cloudKey": "null", "local": false, "sameCallerSignal": true}]

      820 |       const cloud = result.calls.filter((call) => !call.local);
      821 |       expect(local).toHaveLength(scenario.localCalls);
    > 822 |       expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
          |                     ^
      823 |       expect(result.status).toBe(scenario.status);
      824 |       expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      825 |       expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
        at /Users/bradleybond/Developer/crystalball/.worktrees/ux000-runtime-mutation-20260919/e2e/runtime-fetch.spec.ts:822:21
```

## Final restoration

Final run actual output:

```text
  ✓   8 [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves keyed local-only exact-path error (955ms)
  ✓   9 [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves keyed cloud response after local failure (174ms)
  ✓  10 [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves keyed cloud rejection after local HTTP failure (172ms)
  ✓  11 [chromium] › e2e/runtime-fetch.spec.ts:730:5 › desktop runtime routing guardrails › runtime preserves keyed cloud rejection after local connection failure (937ms)

  11 passed (6.8s)
```

Source and fixture checksums match the initial values; `final-restored-restored-status.txt` is empty. Original Home mutation evidence and checkout were not changed.
