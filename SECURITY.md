# Security policy

backlog-bridge handles Backlog API keys and writes to customers' Backlog spaces on behalf of AI agents, so security
reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub Security Advisories](https://github.com/mickey-ichi/backlog-bridge/security/advisories/new)
("Report a vulnerability"). You'll get a reply within a few days; once fixed, a patched release and an advisory are
published, with credit if you want it.

Especially in scope:

- API keys leaking (output, logs, MCP responses, posted comments, files written)
- Bypassing the write guards: sending without `--yes` / `send: true`, flag smuggling, posting secret files
- Prompt injection: Backlog content that makes an agent act through the skills or MCP tools
- The skills, plugin or Desktop Extension running something other than the published code

## Supported versions

Only the latest release receives fixes.

## How the project is checked

- [Security workflow](.github/workflows/security.yml) on every push, pull request and weekly: an audit of every
  agent-facing file (`scripts/audit-skills.mjs` — hidden Unicode, secrets, pipe-to-shell, prompt-injection
  phrasing, unexpected link hosts, MCP launch rules, required guardrails), gitleaks over the full history,
  `npm audit`, dependency review and CodeQL.
- [OpenSSF Scorecard](.github/workflows/scorecard.yml) and Dependabot for the supply chain.
- npm releases are published from CI with Trusted Publishing and provenance — never from a laptop.
- The Claude Desktop Extension (`.mcpb`) is built in CI and signed with a Sigstore build-provenance attestation
  (`.mcpb.sigstore.json` next to it on each release). Verify a download with
  `gh attestation verify backlog-bridge-<version>.mcpb --repo mickey-ichi/backlog-bridge`.
