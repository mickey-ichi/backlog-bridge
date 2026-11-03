# Backlog Bridge — Claude plugin

Connects Claude to **many Backlog (Nulab) spaces at once** — your internal space and your customers' — so you can
paste any Backlog link and read, search or update it from the same conversation. backlog-bridge picks the right space
and API key from the link. Every write is a preview until you approve it, and replies to a customer follow your review
mode (`bilingual` or `translate`).

Source, CLI and full documentation: https://github.com/mickey-ichi/backlog-bridge

## What's inside

- **Skills** `backlog-connect`, `backlog-query`, `backlog-write`, `backlog-sync`: how to connect spaces, read
  issues, write safely (preview → approval → send) and preview syncs.
- **MCP server** (local, stdio): tools `list_spaces`, `home_info`, `create_data_folder`, `get_issue`,
  `get_comments`, `search_issues`, `list_activities`, `list_projects`, `api_get`, `add_comment`,
  `update_issue`, `list_sync_profiles`, `sync_preview`.

The MCP server runs on your computer, so it works in **Claude Code** and in **Cowork sessions on your computer**.
Chat in the Claude app ignores local servers — use the Desktop Extension (`.mcpb`) from the GitHub Releases there.

## Setup

1. **Node.js 20 or newer** on your `PATH` (`node -v`).
2. Ask Claude to *"set up backlog-bridge"* — the `create_data_folder` tool creates `~/.config/backlog-bridge/.env`
   (readable only by you) from a template.
3. Open that file yourself and add one pair of lines per space (API key from *Personal Settings → API* on each space):

   ```ini
   ACME_SPACE=acme.backlog.jp
   ACME_API_KEY=<your key>
   ```

   Never paste a key into the chat. Optionally set `BACKLOG_BRIDGE_REVIEW=bilingual` or `=translate`.
4. Ask *"list my Backlog spaces and check the keys"*.

## What it runs, reads and sends

- **Runs:** `node server/dist/cli.js mcp` (the MCP server); each tool runs the same CLI as a child process. No
  shell, no package downloads, no install scripts.
- **Reads:** `~/.config/backlog-bridge/.env` (your API keys), `config.json` and `state/` in that folder
  (`$BACKLOG_BRIDGE_HOME` if you set it).
- **Sends:** HTTPS requests to the Backlog API (`https://<space>/api/v2/...`) of the spaces listed in your `.env`
  only, each with that space's own API key. Nothing else — no telemetry, no third-party services.
- **Writes:** to Backlog only through `add_comment` / `update_issue`, and only when called with `send: true` after a
  preview. Locally, `create_data_folder` creates the data folder and `.env` template and never overwrites a file.

## Privacy

backlog-bridge has no server of its own and collects nothing. Your API keys stay in a local file and are sent only to
the Backlog space they belong to. Issue and comment content goes from Backlog to Claude only when you ask for it; it
is then handled under your Claude plan's terms. Backlog's own privacy policy applies to the data on Backlog.

## License

MIT — see `LICENSE`.
