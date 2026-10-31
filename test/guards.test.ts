import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkKey, safeCommentFile } from "../src/guards.ts";

test("checkKey: only PROJECT-123 shaped keys pass", () => {
  assert.equal(checkKey("DEV-42"), "DEV-42");
  assert.equal(checkKey("ACME_JP-1"), "ACME_JP-1");
  for (const bad of ["../projects/X", "DEV-1/../../x", "dev-1", "DEV-", "DEV-1?x=1", ""]) {
    assert.throws(() => checkKey(bad), /không hợp lệ/, bad);
  }
});

// Home giả có .env, config.json, state/ và một bản nháp hợp lệ (vd home là repo config của team).
let home: string, outside: string;
before(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "bb-guard-home-"));
  fs.mkdirSync(path.join(home, "state"));
  fs.mkdirSync(path.join(home, "notes"));
  fs.writeFileSync(path.join(home, ".env"), "ACME_API_KEY=secret\n");
  fs.writeFileSync(path.join(home, "config.json"), "{}");
  fs.writeFileSync(path.join(home, "state", "mapping.json"), "{}");
  fs.writeFileSync(path.join(home, "notes", "reply.txt"), "draft");
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "bb-guard-out-"));
  fs.writeFileSync(path.join(outside, "ok.txt"), "hello");
  fs.writeFileSync(path.join(outside, ".env.local"), "X=1");
  fs.symlinkSync(path.join(home, ".env"), path.join(outside, "innocent.txt"));
  fs.symlinkSync(path.join(home, "state", "mapping.json"), path.join(outside, "also-innocent.txt"));
  process.env.BACKLOG_BRIDGE_HOME = home;
  delete process.env.BACKLOG_BRIDGE_CONFIG;
});

test("safeCommentFile: blocks .env*, state/, the config file — also through symlinks", () => {
  for (const f of [
    path.join(home, ".env"),
    path.join(home, "config.json"),
    path.join(home, "state", "mapping.json"),
    path.join(outside, ".env.local"),
    path.join(outside, "innocent.txt"),
    path.join(outside, "also-innocent.txt"),
  ]) {
    assert.throws(() => safeCommentFile(f), /secret/, f);
  }
});

test("safeCommentFile: allows ordinary files, including drafts inside the home directory", () => {
  assert.equal(safeCommentFile(path.join(outside, "ok.txt")), fs.realpathSync(path.join(outside, "ok.txt")));
  assert.ok(safeCommentFile(path.join(home, "notes", "reply.txt")));
});
