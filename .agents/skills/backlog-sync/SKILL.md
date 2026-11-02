---
name: backlog-sync
description: Run or add a one-way sync profile between two Backlog spaces with backlog-bridge sync — mirror mode (create internal mirror issues from planned customer tasks) and progress mode (push internal progress onto the customer's existing issues). Use when the user says "sync the customer tasks", "mirror ACME into DEV", "push progress to the customer", "add a sync for a new customer", "dry-run the sync".
---

# Sync between two Backlogs

The rules of each mode are in `README.md` — read the relevant section before changing a profile.

## List profiles

```bash
backlog-bridge sync --list
```

## Run — always preview first

| Mode | Default | Preview | Real write |
|---|---|---|---|
| `mirror` (destination = internal) | **LIVE** | `--dry-run` | drop `--dry-run` |
| `progress` (destination = customer) | **DRY** | (default) | `--live` |

```bash
# mirror: filter by member + due date
backlog-bridge sync --profile=acme --dry-run --assignee=An --since=2026-10-01
backlog-bridge sync --profile=acme --assignee=An --since=2026-10-01

# progress: review the rollup, then write to the customer
backlog-bridge sync --profile=acme-progress
backlog-bridge sync --profile=acme-progress --live --comment
```

Flow: run the preview → summarize for the user (how many creates / updates / `!` warnings) → run the real write only
after they agree. `progress` writes to the **customer's** Backlog → always ask again.
Don't use `--update` (mirror) or `--allow-regress` (progress) unless the user explicitly asks.

## Common warnings

- `! No status/priority/issueType match` → add it to `profiles.<name>.map`.
- `! "<name>" not found in <PROJECT>` → add `map.assignee` if names differ between the two spaces.
- `! Required custom field ... is not set` / `... is required` → declare `dest.customFields` (by field name + item name).
- `401` → key expired; `403 Inactive Licence` → the space is inactive. See skill `backlog-connect`.

## Add a profile for a new project pair

1. Connect both spaces (skill `backlog-connect`). Profiles live in the config in the home directory
   (`backlog-bridge home` shows the path); start from `config.example.json` (its path is printed by `backlog-bridge setup`).
2. Fetch the real status / issue type names on both sides to build `map`:

   ```bash
   backlog-bridge api <srcSpace> GET /projects/<SRC>/statuses
   backlog-bridge api <srcSpace> GET /projects/<SRC>/issueTypes
   backlog-bridge api <dstSpace> GET /projects/<DST>/statuses
   backlog-bridge api <dstSpace> GET /projects/<DST>/issueTypes
   ```

3. Copy the `acme` (mirror) profile, change `source` / `dest` / `state` (its own state file, relative to the home
   directory), `map`, `note`. `progress` is more involved — read the README section first.
4. `backlog-bridge sync --profile=<name> --dry-run` and show the result to the user before running for real.
