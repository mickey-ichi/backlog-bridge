#!/usr/bin/env node
// Builds plugin/ — the Claude plugin (directory listing, Claude Code, Cowork): the 4 skills + the MCP server.
// plugin/ is committed (the directory installs straight from GitHub) and must only hold real files: no symlinks,
// no top-level bin/, readable source. CI rebuilds it and fails if the committed copy is stale.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "plugin");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, ".claude-plugin"), { recursive: true });

const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true });
  fs.writeFileSync(path.join(OUT, rel), text);
};
const json = (v) => JSON.stringify(v, null, 2) + "\n";

write(".claude-plugin/plugin.json", json({
  name: "backlog-bridge",
  displayName: "Backlog Bridge",
  version: pkg.version,
  description:
    "Read and write many Backlog (Nulab) spaces at once — issues, comments, search, activity, sync previews. " +
    "Writes are previewed and confirmed; customer replies follow your review mode.",
  author: { name: "mickey-ichi", url: "https://github.com/mickey-ichi" },
  homepage: "https://github.com/mickey-ichi/backlog-bridge",
  repository: "https://github.com/mickey-ichi/backlog-bridge",
  license: pkg.license,
  keywords: ["backlog", "nulab", "project-management", "multi-space"],
}));

// Local stdio server: started as a plain file under ${CLAUDE_PLUGIN_ROOT} — no shell, no npx, no npm script.
write(".mcp.json", json({
  mcpServers: {
    "backlog-bridge": { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server/dist/cli.js", "mcp"] },
  },
}));

// Server: the committed dist/ build. dist/ reads its version from package.json and the .env template from
// env.example (same layout as the .mcpb bundle).
fs.cpSync(path.join(ROOT, "dist"), path.join(OUT, "server", "dist"), { recursive: true });
fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(OUT, "server", "env.example"));
fs.copyFileSync(path.join(ROOT, "config.example.json"), path.join(OUT, "server", "config.example.json"));
write("server/package.json", json({ name: pkg.name, version: pkg.version, type: "module", license: pkg.license }));
fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(OUT, "LICENSE"));
// Listing icon: the directory reads .claude-plugin/icon.png (square PNG, 512–2048 px).
fs.copyFileSync(path.join(ROOT, "assets", "icon.png"), path.join(OUT, ".claude-plugin", "icon.png"));

// Skills: copies (symlinks aren't allowed), with a note mapping CLI commands to this plugin's MCP tools.
const NOTE = `
> **Claude plugin:** when the \`backlog-bridge\` command isn't installed, use this plugin's MCP tools instead —
> \`list_spaces\`, \`home_info\`, \`create_data_folder\`, \`get_issue\`, \`get_comments\`, \`search_issues\`,
> \`list_activities\`, \`list_projects\`, \`api_get\`, \`add_comment\`, \`update_issue\`, \`list_sync_profiles\`,
> \`sync_preview\`. The same rules apply: writes return a preview first and are sent (\`send: true\`) only after the
> user approves. Real sync runs need the CLI: \`npm install -g backlog-bridge\`.
`;
const skillsDir = path.join(ROOT, ".agents", "skills");
for (const name of fs.readdirSync(skillsDir).sort()) {
  const src = fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
  const end = src.indexOf("\n---\n", 4) + 5; // after the closing frontmatter fence
  write(`skills/${name}/SKILL.md`, src.slice(0, end) + NOTE + src.slice(end));
}

write("README.md", `# Backlog Bridge — Claude plugin

Connects Claude to **many Backlog (Nulab) spaces at once** — your internal space and your customers' — so you can
paste any Backlog link and read, search or update it from the same conversation. backlog-bridge picks the right space
and API key from the link. Every write is a preview until you approve it, and replies to a customer follow your review
mode (\`bilingual\` or \`translate\`).

Source, CLI and full documentation: https://github.com/mickey-ichi/backlog-bridge

## What's inside

- **Skills** \`backlog-connect\`, \`backlog-query\`, \`backlog-write\`, \`backlog-sync\`: how to connect spaces, read
  issues, write safely (preview → approval → send) and preview syncs.
- **MCP server** (local, stdio): tools \`list_spaces\`, \`home_info\`, \`create_data_folder\`, \`get_issue\`,
  \`get_comments\`, \`search_issues\`, \`list_activities\`, \`list_projects\`, \`api_get\`, \`add_comment\`,
  \`update_issue\`, \`list_sync_profiles\`, \`sync_preview\`.

The MCP server runs on your computer, so it works in **Claude Code** and in **Cowork sessions on your computer**.
Chat in the Claude app ignores local servers — use the Desktop Extension (\`.mcpb\`) from the GitHub Releases there.

## Setup

1. **Node.js 20 or newer** on your \`PATH\` (\`node -v\`).
2. Ask Claude to *"set up backlog-bridge"* — the \`create_data_folder\` tool creates \`~/.config/backlog-bridge/.env\`
   (readable only by you) from a template.
3. Open that file yourself and add one pair of lines per space (API key from *Personal Settings → API* on each space):

   \`\`\`ini
   ACME_SPACE=acme.backlog.jp
   ACME_API_KEY=<your key>
   \`\`\`

   Never paste a key into the chat. Optionally set \`BACKLOG_BRIDGE_REVIEW=bilingual\` or \`=translate\`.
4. Ask *"list my Backlog spaces and check the keys"*.

## What it runs, reads and sends

- **Runs:** \`node server/dist/cli.js mcp\` (the MCP server); each tool runs the same CLI as a child process. No
  shell, no package downloads, no install scripts.
- **Reads:** \`~/.config/backlog-bridge/.env\` (your API keys), \`config.json\` and \`state/\` in that folder
  (\`$BACKLOG_BRIDGE_HOME\` if you set it).
- **Sends:** HTTPS requests to the Backlog API (\`https://<space>/api/v2/...\`) of the spaces listed in your \`.env\`
  only, each with that space's own API key. Nothing else — no telemetry, no third-party services.
- **Writes:** to Backlog only through \`add_comment\` / \`update_issue\`, and only when called with \`send: true\` after a
  preview. Locally, \`create_data_folder\` creates the data folder and \`.env\` template and never overwrites a file.

## Privacy

backlog-bridge has no server of its own and collects nothing. Your API keys stay in a local file and are sent only to
the Backlog space they belong to. Issue and comment content goes from Backlog to Claude only when you ask for it; it
is then handled under your Claude plan's terms. Backlog's own privacy policy applies to the data on Backlog.

## License

MIT — see \`LICENSE\`.
`);

console.log(`plugin/ built (v${pkg.version})`);
