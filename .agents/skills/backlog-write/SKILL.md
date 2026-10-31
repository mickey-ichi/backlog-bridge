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
3. If the space is a **customer's** (not the user's own internal space) → follow **Writing to a customer** below.
   Ask again before every send, even if the user approved a similar write earlier.
4. Run the same command again with `--yes`.

## Writing to a customer — review mode

How the user reviews depends on whether they read the customer's language. Check it first:

```bash
bl home        # line "review : …"
```

`BACKLOG_BRIDGE_REVIEW` in the user's own `.env` (with `BACKLOG_BRIDGE_LANG`, default `vi`, and
`BACKLOG_BRIDGE_CUSTOMER_LANG`, default `ja`):

**`bilingual` — the user reads the customer's language**

1. Draft the reply in the customer's language, polite business tone.
2. Show it for review **bilingually**: the customer-language text, followed by a faithful translation into the user's
   language under a `【VN】` (or matching) heading — so they can check meaning and wording side by side.
3. Revise until the user approves.
4. Send **only the customer-language text** (never the translation): write it to a file, `bl comment <ref> --file=…`,
   check the dry run, then `--yes`.

**`translate` — the user does not read the customer's language**

1. Draft the reply **in the user's language only** and have them review and approve that version.
   Do not ask them to review text they can't read.
2. Translate the approved text into the customer's language faithfully — no added promises, dates or details.
3. Send it right away: dry run, then `--yes` without asking again (the approval of step 1 covers this send).
   Then tell the user what was sent, with the translation of the final text back into their language.

**Not set** (`review : (chưa đặt …)`) → ask the user once which case applies, use it for this write, and tell them the
line to add to their `.env` (`BACKLOG_BRIDGE_REVIEW=bilingual` or `=translate`). Never edit `.env` yourself.

The same applies to other customer-facing text: issue summaries/descriptions written with `bl update` or `bl api`.

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
