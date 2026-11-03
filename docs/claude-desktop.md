# backlog-bridge in Claude Desktop (macOS)

**English** · [Tiếng Việt](claude-desktop.vi.md)

Use backlog-bridge from Claude Desktop to read and write **several Backlog spaces in one conversation** — your
internal space and your customers' — without a terminal.

It ships as a **Desktop Extension** (`.mcpb` file). Claude Desktop runs it with its own built-in Node.js, so you
don't need to install Node, npm or anything else.

## What you need

- macOS with an up-to-date **Claude Desktop**
- A **Backlog API key for each space** you want to use: on each space, *Personal Settings → API → Register new API key*
- About 5 minutes

## 1. Install the extension

1. Download `backlog-bridge-<version>.mcpb` from the latest
   [GitHub Release](https://github.com/mickey-ichi/backlog-bridge/releases/latest).
2. Double-click the file. Claude Desktop opens an install dialog — click **Install**.
   (Or: Claude Desktop → **Settings → Extensions**, then install the downloaded file from there.)
3. Leave **Data folder** as it is (`~/.config/backlog-bridge`) unless you keep your keys somewhere else.
4. Make sure the extension **Backlog Bridge** is **enabled** in Settings → Extensions.

## 2. Create your data folder

In a new chat, type:

> Set up backlog-bridge

Claude calls the `create_data_folder` tool. It creates `~/.config/backlog-bridge/.env` from a template, readable
only by you (`chmod 600`). It never overwrites an existing file and never asks you for keys in the chat.

## 3. Add your API keys

Open the file in TextEdit — in **Terminal**:

```bash
open -e ~/.config/backlog-bridge/.env
```

(Without Terminal: in Finder press **⌘⇧G**, type `~/.config/backlog-bridge`, then **⌘⇧.** to show hidden files.)

Add **one pair of lines per space** — the prefix you choose becomes the space name:

```ini
INTERNAL_SPACE=yourcompany
INTERNAL_API_KEY=paste-the-key-here

ACME_SPACE=acme.backlog.jp
ACME_API_KEY=paste-the-key-here
```

- `xxx.backlog.com` → write just `xxx`. Any other host (`.backlog.jp`, …) → write the full host.
- Don't put a comment on the same line as a value.

Then set **how you review text before it is sent to a customer** — uncomment one line:

```ini
# You read the customer's language: review a bilingual draft, only the customer's language is sent
BACKLOG_BRIDGE_REVIEW=bilingual
# You don't: review in your own language; Claude translates and sends after you approve
BACKLOG_BRIDGE_REVIEW=translate
```

`BACKLOG_BRIDGE_LANG` (default `vi`) and `BACKLOG_BRIDGE_CUSTOMER_LANG` (default `ja`) set the two languages.

Save the file. No restart needed — every tool call reads it again.

## 4. Check the connection

> List my Backlog spaces and check the keys

You should see one line per space ending with `OK as <your name>`. Errors:

| Message | Meaning |
|---|---|
| `401 …` | Wrong or expired key → create a new one on that space |
| `403 Inactive Licence` | That Backlog space itself is inactive |
| `No spaces yet` | `.env` has no complete `<PREFIX>_SPACE` + `<PREFIX>_API_KEY` pair |

## 5. Use it

Just talk to Claude — paste links as they are:

- *What's the status of https://acme.backlog.jp/view/ACME-123? Summarize the comments.*
- *Find open issues assigned to me in project DEV on internal.*
- *What changed in ACME today?*
- *Reply to ACME-123 that the fix is deployed to staging.* → Claude follows your review mode, shows the draft, and
  only sends after you approve.
- *Preview the acme sync.* → `sync_preview` only shows what would change; real syncs run from the terminal.

How writes work:

- `add_comment` / `update_issue` first return a **dry run** — the exact request. Nothing is sent until you approve.
- Writing to a **customer's** space is always confirmed with you, in your review mode.
- A customer's issue is never closed and nothing is ever deleted.

## Update or remove

- **Update:** download the new `.mcpb` from Releases and install it again — it replaces the old version. Your data
  folder is kept.
- **Remove:** Settings → Extensions → Backlog Bridge → Uninstall. `~/.config/backlog-bridge` stays until you delete it.

## Troubleshooting

| Problem | Fix |
|---|---|
| Tools don't appear | Quit Claude Desktop completely (**⌘Q**) and open it again; check the extension is enabled |
| Server shows an error | Read the log: `open ~/Library/Logs/Claude` → the `mcp-server-Backlog Bridge.log` file (and `mcp.log`) |
| `No spaces yet` after editing `.env` | Each space needs both lines with the same prefix; check for typos and saved file |
| Keys in a different folder | Settings → Extensions → Backlog Bridge → set **Data folder** |

## Also using a terminal or Claude Code?

Install the CLI too — same data folder, plus skills for Claude Code, Codex and Cursor:

```bash
npm install -g backlog-bridge
backlog-bridge setup
```

Advanced: `backlog-bridge mcp --config` prints a manual `mcpServers` entry for `claude_desktop_config.json`. Prefer
the extension — Claude Desktop may rewrite that file and drop manual entries.
