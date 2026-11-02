import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The npm launcher (bin/backlog-bridge.js) runs the committed dist/ build on every platform.
const ROOT = path.join(import.meta.dirname, "..");
const LAUNCHER = path.join(ROOT, "bin", "backlog-bridge.js");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "bb-launcher-"));
const run = (...args: string[]) =>
  spawnSync(process.execPath, [LAUNCHER, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, BACKLOG_BRIDGE_HOME: home },
  });

test("--version, -v and version print the package.json version", () => {
  for (const arg of ["--version", "-v", "version"]) {
    const r = run(arg);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `backlog-bridge ${VERSION}`);
  }
});

test("`sync` is routed to the sync entry point", () => {
  const r = run("sync", "--list");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Default profile:/);
});

test("other commands go to the CLI", () => {
  const r = run("spaces");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No spaces yet/);
});
