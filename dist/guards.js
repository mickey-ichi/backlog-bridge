// Shared safety checks for the CLI's write commands (kept separate so they can be tested).
import fs from "node:fs";
import path from "node:path";
import { ROOT, DEFAULT_HOME, LEGACY_HOME, homeDir, configPath } from "./config.js";
// The issue key goes straight into the write request path (/issues/<key>) -> accept only the PROJECT-123 form,
// so strings like "../projects/X" cannot change the endpoint.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
export function checkKey(key) {
    if (!ISSUE_KEY.test(key))
        throw new Error(`Invalid issue key: "${key}" (expected PROJECT-123)`);
    return key;
}
const realpath = (p) => { try {
    return fs.realpathSync(p);
}
catch {
    return undefined;
} };
// --file reads content to post to Backlog (possibly a customer space) and prints it in the DRY run. Block exactly
// what holds secrets / private data: .env*, the state/ directories (of the new-name home, the old-name home,
// $BACKLOG_BRIDGE_HOME and the repo) and the config file — symlinks included. Other files in home (e.g. drafts of
// customer replies when home is a separate config repo) can still be posted.
export function safeCommentFile(file) {
    const p = fs.realpathSync(path.resolve(file));
    const stateDirs = [homeDir(), DEFAULT_HOME, LEGACY_HOME, ROOT]
        .map((d) => realpath(path.join(d, "state")))
        .filter((d) => Boolean(d));
    const configFiles = [configPath(), path.join(homeDir(), "config.json")]
        .map(realpath)
        .filter((f) => Boolean(f));
    const inState = stateDirs.some((d) => p === d || p.startsWith(d + path.sep));
    if (/^\.env/.test(path.basename(p)) || inState || configFiles.includes(p)) {
        throw new Error(`Refusing to post ${p}: it holds secrets / private data`);
    }
    return p;
}
