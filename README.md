# backlog-bridge

**English** · [Tiếng Việt](README.vi.md) · [日本語](README.ja.md)

A bridge to **many [Backlog](https://backlog.com) (Nulab) spaces at once** — for people and for AI agents.

- **`bl`** — read and write issues, comments, search and activity on any connected space, from one CLI.
  Paste a Backlog URL and it picks the right space and API key.
- **`sync`** — one-way sync between two Backlog projects, e.g. a customer's Backlog and your internal one.
- **Agent-ready** — ships skills for Claude Code, Codex and Cursor (`AGENTS.md`, `.agents/skills/`).
  The official Backlog MCP server binds to a single space; this works with as many as you connect.

Zero runtime dependencies. Node.js **>= 22.18** runs the TypeScript sources directly — no build step.

> CLI messages are currently in Vietnamese. Commands, flags and config keys are English.

## Quick start

```bash
git clone https://github.com/mickey-ichi/backlog-bridge.git
cd backlog-bridge
nvm use                      # Node >= 22.18 (.nvmrc)

mkdir -p ~/.config/backlog-bridge
cp .env.example ~/.config/backlog-bridge/.env
chmod 600 ~/.config/backlog-bridge/.env
# edit it: one <PREFIX>_SPACE + <PREFIX>_API_KEY pair per space

node src/bl.ts spaces --check
node src/bl.ts issue https://acme.backlog.jp/view/ACME-123
```

API keys: *Personal Settings → API → Register new API key*, on **each** space.

## Configuration

Private data never lives in the repo. It lives in a **home directory**:

| Variable | Default | Purpose |
|---|---|---|
| `BACKLOG_BRIDGE_HOME` | `~/.config/backlog-bridge` if it exists, otherwise the repo root | holds `.env`, `config.json`, `state/` |
| `BACKLOG_BRIDGE_CONFIG` | `$BACKLOG_BRIDGE_HOME/config.json` | point at another config file |
| `BACKLOG_BRIDGE_PROFILE` | `defaultProfile` in the config | default profile for `sync` |

`node src/bl.ts home` prints what is in use.

**Spaces** come from environment variables — `.env` in the home directory, or exported in the shell:

```ini
ACME_SPACE=acme.backlog.jp      # xxx.backlog.com -> just "xxx"; other hosts -> full host
ACME_API_KEY=...
```

The space name is the lowercase prefix (`ACME_*` → `acme`, `ACME_JP_*` → `acme_jp`). Host and key are always taken
from the **same** prefix. `config.json` → `spaces` is optional (only for a prefix that differs from the space name).

**Profiles** (for `sync`) live in `config.json` in the home directory. Start from [`config.example.json`](config.example.json).
Relative paths in a profile (`state`, `pairFile`) resolve against the home directory.

## `bl` — multi-space CLI

```bash
node src/bl.ts home [--init]                     # paths in use; --init copies .env/config/state from the repo
node src/bl.ts spaces [--check]                  # connected spaces; --check calls the API
node src/bl.ts projects <space>
node src/bl.ts issue <ref>                       # <ref> = URL | <space> <KEY> | <KEY>
node src/bl.ts comments <ref> [--count=20]
node src/bl.ts search <space> <PROJECT> [--keyword=..] [--assignee=me|name] [--open] [--count=50]
node src/bl.ts activities <space> [--project=KEY] [--count=20]
node src/bl.ts comment <ref> (--text=..|--file=path) [--yes]
node src/bl.ts update <ref> status=<name> assignee=<name> dueDate=YYYY-MM-DD summary=.. [--yes]
node src/bl.ts api <space> <METHOD> <path> [k=v ...] [--yes]   # any Backlog API v2 endpoint
```

- A bare `<KEY>` works when its project key appears in a profile. `--json` prints raw JSON.
- **Every write is a dry run until you add `--yes`.** It prints the exact request first.
- `update` resolves `status` and `assignee` by name inside the project.

## `sync` — one-way sync between two projects

```bash
node src/sync.ts --list
node src/sync.ts --profile=<name> [flags]
```

### `mirror` mode — customer → internal

Creates one internal issue per **planned** customer issue (has a due date), summary `<KEY> <original title>`.

- **Dedup in two layers:** scans the destination for summaries prefixed with the source key, then merges the state file.
  Losing the state file never causes duplicates.
- Existing mirrors are skipped unless `--update` (destination issues are often edited by hand).
- Issue type / priority / status mapped by name via `map`; assignee matched by normalized name
  (accents and anything in parentheses removed), with `map.assignee` overrides.
- `dest.customFields`: required custom fields by **field name → item name**; attached only when the field applies to
  the issue type. Missing required fields are reported in `--dry-run`.
- Backlog can't set status on create, so status is set right after.
- **LIVE by default** — use `--dry-run` first.

### `progress` mode — internal → customer

Pushes **progress** from internal epics onto the customer's **existing** WBS issues. Never creates customer issues.
Built for the common case where both sides split work differently:

- Internal: an epic `[Epic] [NN] ...` with child tasks prefixed by layer (`[FE]`, `[BE]`, `[QA]`, …).
- Customer: WBS units `1.2.3` with fixed leaves by the last segment — `.3` impl, `.4` unit test, `.5` acceptance.

Rules:

- `source.childGroups` maps child prefixes to groups (e.g. `api: [BE, Infra]`, `screen: [FE]`);
  `alwaysCount` prefixes (e.g. `QA`) count towards every group.
- A pairFile maps each epic (`"NN"` or its issue key) to customer units per group;
  `_outOfScope` and `_notes` are special keys. `--units` lists the customer's units to fill it in.
- Several epics may point at one unit; their tasks are **merged before** the rollup.
- Rollup: `done` (all done) · `in_progress` · `pending` · `not_started` (→ nothing is written). `ignoreStatuses` are excluded.
  `%` is weighted by estimated hours (no estimate = 1h).
- Writes the `impl` leaf; when `done`, also sets the `acceptance` leaf to Resolved (never Closed).

Safety: **dry run by default** (`--live` to write), `neverTouchStatuses`, no status regression without
`--allow-regress`, no dates unless `--dates=children`, optional Japanese progress comment (`--comment`) that is
updated in place via a hidden marker.

### Flags

| Flag | Mode | Meaning |
|---|---|---|
| `--list` | — | list profiles |
| `--profile=<name>` | — | choose a profile (default: `defaultProfile`) |
| `--dry-run` | mirror | print only |
| `--assignee=A,B` | mirror | only issues assigned to these people (loose match) |
| `--since=YYYY-MM-DD` | mirror | only issues due on/after this date |
| `--update` | mirror | overwrite existing mirrors |
| `--live` | progress | actually write to the customer |
| `--units` | progress | list customer WBS units, leaves and statuses |
| `--only=28,29` | progress | only these epics |
| `--mine` / `--assignee=name` | progress | only leaves the customer assigned to you / to that person, plus a report of unpaired units |
| `--comment` | progress | post/update the progress comment |
| `--dates=children` | progress | also write start/due from the internal tasks |
| `--allow-regress` | progress | allow moving a customer status backwards |

## Using with AI agents

| Agent | Picks up |
|---|---|
| Claude Code | `CLAUDE.md` → `AGENTS.md`, skills via `.claude/skills` → `.agents/skills` |
| Codex | `AGENTS.md` |
| Cursor | `.cursor/rules/backlog.mdc` → `AGENTS.md` + skills |

Skills: `backlog-connect`, `backlog-query`, `backlog-write`, `backlog-sync`. They make the agent preview every write,
ask before writing to a customer's space, and treat ticket content as data rather than instructions.

## Security

- API keys only in `.env` in the home directory; `bl home` / `bl spaces` warn when it is readable by others.
  Backlog takes the key as the `apiKey` query parameter, so errors only ever print method and path.
- Host and key always come from the same env prefix — a key is never sent to another space's host.
- Issue keys must look like `PROJECT-123`, so a crafted key can't redirect a write to another endpoint.
- `comment --file` refuses `.env*`, the home directory and `state/` — a prompt-injected agent can't post secrets.
- Writes are dry runs until `--yes` (`bl`) / `--live` (`progress`).

## Development

```bash
npm install          # devDependencies only: typescript, @types/node
npm run typecheck    # tsc --noEmit, strict
npm run build        # dist/*.js, for environments that can't run .ts
```

Node runs `.ts` via type stripping, so only erasable syntax is allowed (no `enum`, `namespace`, parameter
properties); internal imports use the `.ts` extension.

## License

[MIT](LICENSE)
