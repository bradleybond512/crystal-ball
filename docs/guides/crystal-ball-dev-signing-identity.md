# The "Crystal Ball Dev" signing identity

Main-sync now refuses to build or install Crystal Ball unless the app is
signed with your stable "Crystal Ball Dev" identity (R3-SEC-003 phase A).
This guide is for you to follow by hand. No script or agent in this repo
creates, reads or changes Keychain items.

## Why it matters

macOS remembers your Keychain "Always Allow" answer and your Location
permission by the app's signature.

- **Ad hoc builds** get a new signature on every rebuild. macOS then asks
  again after each install, and a missed prompt is what makes Crystal Ball
  fall back to its backup copy of your keys, with saves paused.
- **A stable identity** keeps the same signature across rebuilds. You answer
  once, and it stays answered.

## 1. Check whether you already have it

Open **System Diagnostic** in Crystal Ball, choose the **Self-Test** tab,
and look at the **Keys & signing** row under the local engine status.

- "signed as Crystal Ball Dev" means you are set; nothing else to do.
- "ad hoc build" means create the identity (step 2).

If the app is not running, check in Keychain Access instead:

1. Open **Keychain Access**. Spotlight finds it if you type "Keychain
   Access".
2. Select the **login** keychain, then the **My Certificates** tab.
3. Look for **Crystal Ball Dev**.

## 2. Create it, once

1. In Keychain Access, choose **Keychain Access ▸ Certificate Assistant ▸
   Create a Certificate…**.
2. Fill in:
   - **Name:** `Crystal Ball Dev` (exactly).
   - **Identity Type:** Self Signed Root.
   - **Certificate Type:** Code Signing.
3. Tick **Let me override defaults**, then **Continue**.
4. Set **Validity Period (days)** to `3650`. The default is one year, and an
   expired identity would stop main-sync again.
5. Keep **Continue** on the remaining screens with their defaults, until
   **Create**.
6. Make sure **Keychain** is set to **login**, then finish.

## 3. Let builds use it without asking

Main-sync runs unattended, so the first signing prompt has to be answered
once by hand. From `~/Developer/crystalball`, run:

```sh
npm run desktop:build:app:full -- --require-stable-identity
```

When macOS asks to let `codesign` use the "Crystal Ball Dev" key, enter your
login password and click **Always Allow**. The build should end without the
"STABLE SIGNING FAILED" banner.

The first launch of a stable-signed build asks for Keychain access one last
time. Click **Always Allow**. Later rebuilds keep that answer.

## 4. Confirm

- System Diagnostic (Self-Test tab) shows "Keys & signing: signed as
  Crystal Ball Dev · keys from the Keychain".
- The main-sync status no longer reports "Built app is ad hoc signed;
  refusing to install it".

## If something goes wrong

- **Main-sync is blocked with "ad hoc signed" or "not signed with a stable
  identity".** The identity is missing, misspelled, expired, or `codesign`
  was not allowed to use it. Repeat steps 2 and 3.
- **You want a different name.** Set `CRYSTALBALL_SIGN_IDENTITY` to that
  name in the environment of every build, main-sync included. The default,
  `Crystal Ball Dev`, needs no setting.
- **Manual builds** without `--require-stable-identity` still fall back to
  ad hoc with a loud warning. Only main-sync requires the identity.
