import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { credentials, allSpaces, homeDir, setting, ROOT } from "../src/config.ts";

const saved = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (/_SPACE$|_API_KEY$|^BACKLOG_(BRIDGE|SYNC)_/.test(k)) delete process.env[k];
  }
  Object.assign(process.env, Object.fromEntries(
    Object.entries(saved).filter(([k]) => !/_SPACE$|_API_KEY$|^BACKLOG_(BRIDGE|SYNC)_/.test(k)),
  ));
});

test("credentials: prefix defaults to the upper-cased space name", () => {
  process.env.ACME_JP_SPACE = "acme.backlog.jp";
  process.env.ACME_JP_API_KEY = "k";
  assert.deepEqual(credentials({}, "acme_jp"), { space: "acme.backlog.jp", apiKey: "k" });
});

test("credentials: host and key always come from the same prefix", () => {
  process.env.AA_SPACE = "a";            // AA has no key
  process.env.BB_SPACE = "b";
  process.env.BB_API_KEY = "kb";
  const config = { spaces: { x: { env: "AA", envFallback: "BB" } } };
  assert.deepEqual(credentials(config, "x"), { space: "b", apiKey: "kb" });
});

test("credentials: missing pair throws without leaking values", () => {
  process.env.ZZ_SPACE = "z";
  assert.throws(() => credentials({}, "zz"), /ZZ_SPACE \/ ZZ_API_KEY/);
});

test("allSpaces: discovers env pairs, including underscores; ignores halves and legacy prefixes", () => {
  process.env.ACME_JP_SPACE = "acme.backlog.jp";
  process.env.ACME_JP_API_KEY = "k";
  process.env.HALF_SPACE = "half";        // no key -> ignored
  process.env.SOURCE_SPACE = "s";         // legacy fallback prefix -> ignored
  process.env.SOURCE_API_KEY = "k";
  const spaces = allSpaces({});
  assert.ok(spaces.acme_jp);
  assert.equal(spaces.acme_jp.from, "env");
  assert.equal(spaces.half, undefined);
  assert.equal(spaces.source, undefined);
});

test("setting: BACKLOG_BRIDGE_* wins over legacy BACKLOG_SYNC_*", () => {
  process.env.BACKLOG_SYNC_PROFILE = "old";
  assert.equal(setting("PROFILE"), "old");
  process.env.BACKLOG_BRIDGE_PROFILE = "new";
  assert.equal(setting("PROFILE"), "new");
});

test("homeDir: explicit BACKLOG_BRIDGE_HOME is used as-is", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-home-"));
  process.env.BACKLOG_BRIDGE_HOME = dir;
  assert.equal(homeDir(), dir);
  assert.notEqual(homeDir(), ROOT);
});
