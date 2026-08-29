# Little Snitch local traffic feed

Crystal Ball reads a private, sanitized snapshot from:

`~/Library/Application Support/Crystal Ball/little-snitch-traffic.json`

The scheduled exporter requires Little Snitch's **Allow access via Terminal**
setting. Install or repair it as your normal macOS account:

```bash
bash scripts/repair-little-snitch-exporter.sh
```

The setup requests administrator approval only to remove the unsafe legacy
daemon, pin and verify the Little Snitch reader, and install one exact
no-argument authorization rule. The five-minute scheduler, Node process,
sanitizer, output file, and baseline all run as the signed-in user. Raw traffic
CSV is kept in a bounded process pipe and is never written to disk.

The snapshot and 30-day first-seen baseline are mode `0600`. Exports older than
10 minutes, malformed files, insecure permissions, symlinks, unsupported
schemas, and oversized payloads fail closed. A valid window with no rows is a
healthy empty result.

To disable collection without restoring the legacy daemon:

```bash
launchctl bootout "gui/$(id -u)/com.crystalball.little-snitch-exporter"
```

The existing sanitized snapshot can remain private and inert. Removing the
root-owned helper, pinned reader, or sudoers rule requires administrator access.
