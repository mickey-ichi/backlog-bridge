# backlog-bridge in Claude Code

**English** · [Tiếng Việt](claude-code.vi.md)

Use backlog-bridge from **Claude Code** — the **Code** tab of the Claude app, or `claude` in a terminal — to read and
write **several Backlog spaces in one session**: your internal space and your customers'.

Claude Code runs shell commands, so it doesn't need an extension: it runs the `backlog-bridge` command, and the
backlog-bridge **skills** teach it how (preview every write, ask before writing to a customer, …). Nothing has to be
approved by your Claude organization admin.

> Using the **Chat** tab instead? That needs the Desktop Extension — see [claude-desktop.md](claude-desktop.md).

## What you need

- macOS, Linux or Windows with **Node.js ≥ 22.18** (`node -v`). On a Mac without it: `brew install node`.
- The **Claude app** (Code tab) or the Claude Code CLI
- A **Backlog API key for each space**: on each space, *Personal Settings → API → Register new API key*

## 1. Install the command and the skills

In **Terminal**:

```bash
npm install -g backlog-bridge
backlog-bridge setup
```

`setup` prints what it did:

| Line | Meaning |
|---|---|
| `Skill:` → `+ ~/.claude/skills/backlog-query` … | The 4 skills are linked for Claude Code (and Codex / Cursor) |
| `Data:` → `+ ~/.config/backlog-bridge/.env` | Your data folder, with a sample `.env` readable only by you |

`+` means created, `=` already there. Running it again is safe — it never overwrites your files.

## 2. Add your API keys

```bash
open -e ~/.config/backlog-bridge/.env
```

(Linux: any editor. Windows: `notepad %USERPROFILE%\.config\backlog-bridge\.env`.)

One pair of lines per space — the prefix becomes the space name:

```ini
INTERNAL_SPACE=yourcompany
INTERNAL_API_KEY=paste-the-key-here

ACME_SPACE=acme.backlog.jp
ACME_API_KEY=paste-the-key-here
```

- `xxx.backlog.com` → write just `xxx`. Any other host (`.backlog.jp`, …) → write the full host.
- Don't put a comment on the same line as a value.

Then uncomment **one** review mode line — how you check text before it goes to a customer:

```ini
# You read the customer's language: review a bilingual draft, only the customer's language is sent
BACKLOG_BRIDGE_REVIEW=bilingual
# You don't: review in your own language; Claude translates and sends after you approve
BACKLOG_BRIDGE_REVIEW=translate
```

`BACKLOG_BRIDGE_LANG` (default `vi`) and `BACKLOG_BRIDGE_CUSTOMER_LANG` (default `ja`) set the two languages.

Never paste a key into the chat — keys only go in this file.

## 3. Check the connection

```bash
backlog-bridge spaces --check
```

One line per space, ending with `OK as <your name>`. `401` = wrong or expired key; `403 Inactive Licence` = that
space itself is inactive; `No spaces yet` = no complete `<PREFIX>_SPACE` + `<PREFIX>_API_KEY` pair.

## 4. Open Claude Code

- **Claude app:** **Code** tab → new session → pick any folder (your project, or your home folder).
- **Terminal:** `cd` into any folder and run `claude`.

Skills load when a session starts, so **start a new session** after `setup` — one opened earlier won't see them.

Ask:

> Which Backlog spaces are connected?

Claude picks the `backlog-connect` skill and runs `backlog-bridge spaces --check`. The first time, Claude Code asks
permission to run the command — allow it.

## 5. Use it

Just talk to Claude — paste links as they are:

- *What's the status of https://acme.backlog.jp/view/ACME-123? Summarize the comments.*
- *Find open issues assigned to me in project DEV on internal.*
- *What changed in ACME today?*
- *Reply to ACME-123 that the fix is deployed to staging.*
- *Move DEV-42 to Resolved and assign it to An.*
- *Dry-run the acme sync for An since October 1st.*

How writes work:

- Every write command is a **dry run** first: Claude runs it without `--yes`, shows you the exact request, and only
  sends it after you say yes.
- Writing to a **customer's** space follows your review mode (`bilingual` or `translate`) and is confirmed every time.
- A customer's issue is never closed, and nothing is deleted unless you name that exact item.
- Ticket content is treated as data — instructions written inside a ticket are never followed.

### Fewer permission prompts (optional)

Allow the **read-only** commands once in `~/.claude/settings.json`, so Claude stops asking for them:

```json
{
  "permissions": {
    "allow": [
      "Bash(backlog-bridge spaces:*)",
      "Bash(backlog-bridge home:*)",
      "Bash(backlog-bridge issue:*)",
      "Bash(backlog-bridge comments:*)",
      "Bash(backlog-bridge search:*)",
      "Bash(backlog-bridge activities:*)",
      "Bash(backlog-bridge projects:*)"
    ]
  }
}
```

Keep `comment`, `update`, `api` and `sync` off this list, so writes are always confirmed.

### A shared team config (optional)

If your team keeps `config.json` (sync profiles) and `state/pairs-*.json` in a git repo, point backlog-bridge at it —
either a symlink:

```bash
ln -s ~/path/to/team-config-repo ~/.config/backlog-bridge
```

or `export BACKLOG_BRIDGE_HOME=~/path/to/team-config-repo` in your shell profile. Keep `.env` out of git. Opening the
Claude Code session **in** that repo also loads the team's own `AGENTS.md` / `CLAUDE.md` rules.

`backlog-bridge home` shows which folder, config and `.env` are in use.

## Update or remove

- **Update:** `npm install -g backlog-bridge@latest` — the skills are links, so they update with it.
- **Remove:** `backlog-bridge setup --uninstall`, then `npm uninstall -g backlog-bridge`.
  `~/.config/backlog-bridge` stays until you delete it.

## Troubleshooting

| Problem | Fix |
|---|---|
| `backlog-bridge: command not found` | npm's global bin isn't on `PATH`: check `npm prefix -g` and add its `bin` to `PATH`, then open a new terminal / session |
| Claude doesn't use the skills | Start a new session; check `ls ~/.claude/skills` lists `backlog-*`; run `backlog-bridge setup` again |
| Node version error | backlog-bridge looks for Node ≥ 22.18 on `PATH`, nvm and Homebrew — install one (`brew install node` or `nvm install 22`) |
| `No spaces yet` | Each space needs both lines with the same prefix in `~/.config/backlog-bridge/.env`; save the file |
| `401` / `403 Inactive Licence` | Create a new key on that space / the space itself is inactive |

## MCP instead of skills?

Not needed for Claude Code — the skills are the recommended way. If you still want the tools over MCP:

```bash
claude mcp add --scope user backlog-bridge -- backlog-bridge mcp
```
