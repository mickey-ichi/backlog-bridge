#!/usr/bin/env node
// Builds the Claude Desktop Extension: build/backlog-bridge-<version>.mcpb
// Claude Desktop runs it with its own bundled Node, so users need no Node install. The bundle holds the
// committed dist/ build plus a manifest; API keys stay in ~/.config/backlog-bridge/.env as for the CLI.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TOOLS } from "../src/mcp.ts";

const ROOT = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const stage = path.join(ROOT, "build", "mcpb");
const out = path.join(ROOT, "build", `backlog-bridge-${pkg.version}.mcpb`);

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.cpSync(path.join(ROOT, "dist"), path.join(stage, "dist"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "assets", "icon.png"), path.join(stage, "icon.png"));
for (const f of ["LICENSE", "README.md", "CHANGELOG.md", "config.example.json"]) {
  fs.copyFileSync(path.join(ROOT, f), path.join(stage, f));
}
// mcpb ignores dotfiles; `setup --data-only` falls back to env.example.
fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(stage, "env.example"));
// dist/ is ESM and reads its version from package.json.
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(
  { name: pkg.name, version: pkg.version, type: "module", license: pkg.license }, null, 2) + "\n");

const manifest = {
  manifest_version: "0.3",
  name: "backlog-bridge",
  display_name: "Backlog Bridge",
  version: pkg.version,
  description: "Read and write many Backlog (Nulab) spaces at once — issues, comments, search, sync previews.",
  long_description:
    "backlog-bridge connects Claude to every Backlog space you have an API key for — your internal one and your " +
    "customers' — at the same time. Paste any Backlog link and it picks the right space and key. Writes are dry " +
    "runs until you approve them, and customer-facing replies follow your review mode (bilingual or translate). " +
    "API keys live in ~/.config/backlog-bridge/.env (one <PREFIX>_SPACE / <PREFIX>_API_KEY pair per space).",
  author: { name: "mickey-ichi", url: "https://github.com/mickey-ichi" },
  repository: { type: "git", url: "https://github.com/mickey-ichi/backlog-bridge" },
  homepage: "https://github.com/mickey-ichi/backlog-bridge",
  support: "https://github.com/mickey-ichi/backlog-bridge/issues",
  license: "MIT",
  keywords: ["backlog", "nulab", "project-management", "multi-space"],
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "dist/cli.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/dist/cli.js", "mcp"],
      env: { BACKLOG_BRIDGE_HOME: "${user_config.home_dir}" },
    },
  },
  user_config: {
    home_dir: {
      type: "directory",
      title: "Data folder",
      description:
        "Folder holding .env (API keys), config.json and state/. Default: ~/.config/backlog-bridge — create it " +
        "with `backlog-bridge setup` or by hand.",
      required: false,
      default: "${HOME}/.config/backlog-bridge",
    },
  },
  tools: TOOLS.map(({ name, description }) => ({ name, description })),
  // No `compatibility` block on purpose: without one Claude Desktop runs the server on its built-in Node
  // ("UtilityProcess"), as with Nulab's own Backlog extension — users need no Node install. dist/ needs >= 20.11.
};
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const mcpb = (...args) => execFileSync("npx", ["--yes", "@anthropic-ai/mcpb@2.1.2", ...args], { stdio: "inherit" });
mcpb("validate", path.join(stage, "manifest.json"));
fs.rmSync(out, { force: true });
mcpb("pack", stage, out);
console.log(`\n${path.relative(ROOT, out)}`);
