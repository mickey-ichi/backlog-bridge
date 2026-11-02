# Changelog

## 0.1.0 — first release

**CLI — `backlog-bridge`**
- Read and write many Backlog spaces from one command: `issue`, `comments`, `search`, `activities`, `projects`,
  `comment`, `update`, and `api` for any Backlog API v2 endpoint.
- Point at an issue by URL, `<space> <KEY>` or a bare key; the right space and API key are picked automatically.
- Every write is a dry run until `--yes`.
- Spaces come from `<PREFIX>_SPACE` / `<PREFIX>_API_KEY` pairs in `~/.config/backlog-bridge/.env`; no code or config
  changes needed to connect another space.

**Sync — `backlog-bridge sync`**
- `mirror` mode: customer → internal mirror issues for planned tasks, two-layer dedup, field/assignee mapping,
  required custom fields (checked in `--dry-run`).
- `progress` mode: internal epic progress → the customer's existing WBS issues, with rollup rules, focus by
  assignee, and safety rails (dry run by default, no regressions, never closes customer issues).

**AI agents**
- Skills for Claude Code, Codex and Cursor (`backlog-connect`, `backlog-query`, `backlog-write`, `backlog-sync`),
  installed globally by `backlog-bridge setup`.
- Per-user review mode for customer-facing text: `bilingual` (review a bilingual draft, send only the customer's
  language) or `translate` (review in your own language, then the agent translates and sends).
- MCP server (`backlog-bridge mcp`) for Claude Desktop, Cursor and other MCP hosts; `mcp --config` prints the setup.

**Install & platforms**
- `npm install -g --install-links github:mickey-ichi/backlog-bridge` or `git clone` + `bin/backlog-bridge setup`.
- macOS and Linux; Windows through the npm install.
- Finds a suitable Node (>= 22.18 for sources, >= 20.11 for the npm build) even when the default `node` is older.
- `backlog-bridge --version`.

**Security**
- API keys only in `.env` (warned when readable by others); host and key always from the same env prefix; issue keys
  validated; `comment --file` refuses `.env*`, `state/` and the config file; flags can't be smuggled through MCP
  arguments.
