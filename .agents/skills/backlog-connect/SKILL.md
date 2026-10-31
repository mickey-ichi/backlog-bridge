---
name: backlog-connect
description: Connect another Backlog space (e.g. a new customer's xxx.backlog.jp) to backlog-bridge, or check whether the API keys of connected spaces still work. Use when the user says "add a Backlog space", "connect the customer's Backlog", "Backlog key returns 401", "which Backlogs are connected".
---

# Connect a Backlog space

backlog-bridge reads and writes **many** Backlog spaces through `node src/bl.ts`.
Each space is one `<PREFIX>_SPACE` + `<PREFIX>_API_KEY` pair in the `.env` of the home directory
(`$BACKLOG_BRIDGE_HOME`, default `~/.config/backlog-bridge`) — **not** inside the repo.
`node src/bl.ts home` shows which home / config / `.env` is in use.

## Check connected spaces

```bash
node src/bl.ts spaces --check
```

One line per space: name · host · env prefix · `OK as <key owner>` or `LỖI ...` (error).
`401` = expired or wrong key → the user must create a new key. `403 Inactive Licence` = the space itself is inactive.

## Add a space

1. Ask the user for the Backlog host (`acme.backlog.com` or `acme.backlog.jp`) and a short name (`acme`).
2. **Never fill in the API key yourself** — the user creates it under *Personal Settings → API → Register new API key*
   on that space and pastes it into `.env` in the home directory (path from `node src/bl.ts home`).
   Only tell them the two lines to add:

   ```
   ACME_SPACE=acme
   ACME_API_KEY=<key>
   ```

   - `.backlog.com` host → just the name (`acme`); any other host → the full host (`acme.backlog.jp`).
   - No comment on the same line as a value.
3. It works immediately: the space is auto-discovered as the lowercase prefix (`acme`). Run `spaces --check` again.
4. For a sync profile, just write `"space": "acme"` (see skill `backlog-sync`); `config.json` → `spaces` is only needed
   when the env prefix differs from the space name.

## Notes

- Never commit `.env`, never print a key in chat or logs; `.env` should be `chmod 600`.
- A source space only needs a read-capable key; a destination space needs permission to edit issues.
