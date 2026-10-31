---
name: backlog-write
description: Comment on, change status/assignee/due date of, or edit the summary of an issue on any connected Backlog space (internal or customer) via bl, always previewing before writing. Use when the user says "comment on the customer ticket", "move this task to Resolved", "assign it to X", "change the due date", "post the translation to Backlog".
---

# Write to Backlog across spaces

Every write command of `bl` is **DRY by default**: it prints the request and stops. Add `--yes` only
after showing the preview to the user and getting a clear yes.

## Flow

1. Read the current state: `bl issue <ref>` (see skill `backlog-query` for `<ref>`).
2. Run the write **without** `--yes` → show the user the space, issue key and the exact content.
3. If the space is a **customer's** (not the user's own internal space) → ask again before sending, even if the user
   approved a similar write earlier. Match the customer's language and tone.
4. Run the same command again with `--yes`.

## Commands

```bash
# comment — put long / multi-line text in a file first
bl comment <ref> --file=reply.txt
bl comment internal DEV-42 --text="Fixed, please re-test"

# update — status/assignee by NAME (resolved to ids in the project); other fields go straight to API v2
bl update <ref> status=Resolved
bl update <ref> assignee=An dueDate=2026-10-30
bl update <ref> summary="ACME-123 [impl] ..."

# any other endpoint (wiki, links, …)
bl api <space> POST /wikis projectId=12345 name="Release note" content="..."
```

Append `--yes` to actually send.

`--file` refuses `.env*` files and anything in the home directory or `state/` — secrets are never posted.

## Don't

- Don't create or delete issues in bulk by hand — mirroring is `bl sync` (skill `backlog-sync`).
- Don't close (`Closed`) a customer's issue — the customer closes it; go up to `Resolved` at most.
- Don't delete issues or comments (API `DELETE`) unless the user names that exact item.
