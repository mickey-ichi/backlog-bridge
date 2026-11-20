---
name: backlog-write
description: Create, comment on (with images/files attached), edit or delete a comment, update (status, assignee, priority, due date, summary), attach or delete files on, or delete an issue on any connected Backlog space (internal or customer) via backlog-bridge, always previewing before writing. Use when the user says "create a task", "comment on the customer ticket", "move this task to Resolved", "assign it to X", "change the due date", "delete this issue", "fix my comment", "delete that comment", "attach this screenshot", "post the translation to Backlog".
---

# Write to Backlog across spaces

Every write command of `backlog-bridge` is **DRY by default**: it prints the request and stops. Add `--yes` only
after showing the preview to the user and getting a clear yes.

## Flow

1. Read the current state: `backlog-bridge issue <ref>` (see skill `backlog-query` for `<ref>`).
2. Run the write **without** `--yes` → show the user the space, issue key and the exact content.
3. If the space is a **customer's** (not the user's own internal space) → follow **Writing to a customer** below.
   Ask again before every send, even if the user approved a similar write earlier.
4. Run the same command again with `--yes`.

## Writing to a customer — review mode

How the user reviews depends on whether they read the customer's language. Check it first:

```bash
backlog-bridge home  # line "review : …"
```

`BACKLOG_BRIDGE_REVIEW` in the user's own `.env` (with `BACKLOG_BRIDGE_LANG`, default `vi`, and
`BACKLOG_BRIDGE_CUSTOMER_LANG`, default `ja`):

**`bilingual` — the user reads the customer's language**

1. Draft the reply in the customer's language, polite business tone.
2. Show it for review **bilingually**: the customer-language text, followed by a faithful translation into the user's
   language under a `【VN】` (or matching) heading — so they can check meaning and wording side by side.
3. Revise until the user approves.
4. Send **only the customer-language text** (never the translation): write it to a file, `backlog-bridge comment <ref> --file=…`,
   check the dry run, then `--yes`.

**`translate` — the user does not read the customer's language**

1. Draft the reply **in the user's language only** and have them review and approve that version.
   Do not ask them to review text they can't read.
2. Translate the approved text into the customer's language faithfully — no added promises, dates or details.
3. Send it right away: dry run, then `--yes` without asking again (the approval of step 1 covers this send).
   Then tell the user what was sent, with the translation of the final text back into their language.

**Not set** (`review : (not set …)`) → ask the user once which case applies, use it for this write, and tell them the
line to add to their `.env` (`BACKLOG_BRIDGE_REVIEW=bilingual` or `=translate`). Never edit `.env` yourself.

The same applies to other customer-facing text: issue summaries/descriptions written with `backlog-bridge create`, `backlog-bridge update` or `backlog-bridge api`.

## Commands

```bash
# comment — put long / multi-line text in a file first
backlog-bridge comment <ref> --file=reply.txt
backlog-bridge comment internal DEV-42 --text="Fixed, please re-test"

# create — type/priority/assignee/category/milestone by NAME; default type = the project's first, priority = Normal
backlog-bridge create internal DEV summary="[BE] Login API" type=Task priority=High assignee=An dueDate=2026-12-01
backlog-bridge create internal DEV summary="[FE] Login form" parent=DEV-42 --file=desc.md   # child issue, description from a file

# attach images / files — to a comment, a new issue or an existing one (uploaded only with --yes)
backlog-bridge comment <ref> --file=reply.txt --attach=screenshot.png --attach=log.txt
backlog-bridge update <ref> --attach=spec.pdf

# edit / delete a comment — the id is the #number shown by `backlog-bridge comments`; Backlog lets you edit only your own
backlog-bridge comment-edit <ref> 34642891 --file=reply-fixed.txt
backlog-bridge comment-delete <ref> 34642891

# attachments of an issue
backlog-bridge attachments <ref>
backlog-bridge attachment-delete <ref> 4987699

# update — status/assignee/priority/type by NAME (resolved to ids in the project); other fields go straight to API v2.
# The default statuses accept English, Japanese or Vietnamese names (In Progress = 処理中 = Đang xử lý);
# an unknown name lists the project's real ones.
backlog-bridge update <ref> status=Resolved
backlog-bridge update <ref> assignee=An dueDate=2026-10-30
backlog-bridge update <ref> summary="ACME-123 [impl] ..."

# delete — cannot be undone; the dry run shows the issue that would go
backlog-bridge delete <ref>

# any other endpoint (wiki, links, …)
backlog-bridge api <space> POST /wikis projectId=12345 name="Release note" content="..."
```

Append `--yes` to actually send.

`--file` and `--attach` refuse `.env*` files, `state/` directories and the config file (also through symlinks) — secrets are never posted.

## Don't

- Don't create or delete issues in bulk by hand — mirroring is `backlog-bridge sync` (skill `backlog-sync`).
- Don't create issues in a customer's space unless the user asked for exactly that; the summary and description follow
  the review mode above.
- Don't close (`Closed`) a customer's issue — the customer closes it; go up to `Resolved` at most.
- Don't delete issues, comments or attachments unless the user names that exact item; show the dry run and get a clear yes first.
- Don't attach files the user didn't point to.
