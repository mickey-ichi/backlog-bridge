#!/usr/bin/env node
// npm entry point of backlog-bridge, on every platform (Windows included — npm can't run the POSIX
// launcher bin/backlog-bridge there). Runs the committed dist/ build:
//   backlog-bridge <command ...>  -> dist/cli.js
//   backlog-bridge sync [...]     -> dist/sync.js
// If this Node is too old (dist/ needs >= 20.11), it looks for a newer one — $BACKLOG_BRIDGE_NODE, nvm,
// Homebrew — and re-runs itself with it, so an older default `node` still works.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MIN = [20, 11];
const okVersion = (v) => {
  const [a, b] = v.split(".").map(Number);
  return a > MIN[0] || (a === MIN[0] && b >= MIN[1]);
};

function findNode() {
  const candidates = [process.env.BACKLOG_BRIDGE_NODE];
  const nvm = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  try {
    const versions = fs.readdirSync(path.join(nvm, "versions", "node"))
      .sort((x, y) => y.localeCompare(x, undefined, { numeric: true }));
    for (const v of versions) candidates.push(path.join(nvm, "versions", "node", v, "bin", "node"));
  } catch { /* no nvm */ }
  candidates.push("/opt/homebrew/bin/node", "/usr/local/bin/node");
  for (const node of candidates) {
    if (!node || !fs.existsSync(node)) continue;
    const r = spawnSync(node, ["-p", "process.versions.node"], { encoding: "utf8" });
    if (r.status === 0 && okVersion(r.stdout.trim())) return node;
  }
  return undefined;
}

if (!okVersion(process.versions.node)) {
  const node = findNode();
  if (!node) {
    console.error(`backlog-bridge needs Node.js >= ${MIN.join(".")} (running ${process.version}).`);
    console.error("Install one (e.g. nvm install 22) or set BACKLOG_BRIDGE_NODE=/path/to/node");
    process.exit(1);
  }
  const r = spawnSync(node, [process.argv[1], ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const entry = process.argv[2] === "sync" ? "sync" : "cli";
if (entry === "sync") process.argv.splice(2, 1);
await import(new URL(`../dist/${entry}.js`, import.meta.url));
