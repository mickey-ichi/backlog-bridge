import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Real stdio session against `backlog-bridge mcp`, in an empty home with no spaces (no network needed).
let child: ChildProcessWithoutNullStreams;
let nextId = 0;
const waiters = new Map<number, (m: any) => void>();

function rpc(method: string, params: unknown = {}): Promise<any> {
  return new Promise((resolve) => {
    const id = ++nextId;
    waiters.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const callTool = (name: string, args: unknown = {}) => rpc("tools/call", { name, arguments: args });

before(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "bb-mcp-"));
  child = spawn(process.execPath, [path.join(import.meta.dirname, "..", "src", "cli.ts"), "mcp"], {
    env: { PATH: process.env.PATH, HOME: home, BACKLOG_BRIDGE_HOME: home, BACKLOG_BRIDGE_REVIEW: "translate" },
  });
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiters.get(m.id)?.(m);
    }
  });
});
after(() => child.kill());

test("initialize: echoes a supported protocol version, exposes tools and the review mode", async () => {
  const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.capabilities, { tools: {} });
  assert.equal(r.result.serverInfo.name, "backlog-bridge");
  assert.match(r.result.instructions, /Review mode of this user: translate/);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});

test("tools/list: writes are not marked read-only", async () => {
  const { result } = await rpc("tools/list");
  const byName = Object.fromEntries(result.tools.map((t: any) => [t.name, t]));
  assert.ok(byName.get_issue.annotations.readOnlyHint);
  assert.equal(byName.add_comment.annotations.readOnlyHint, false);
  assert.ok(byName.update_issue.annotations.destructiveHint);
  assert.ok(byName.sync_preview.annotations.readOnlyHint);
});

test("flag smuggling through ref / field names is rejected", async () => {
  for (const [name, args] of [
    ["add_comment", { ref: "internal DEV-1 --yes", content: "x" }],
    ["update_issue", { ref: "internal DEV-1", fields: { "--yes": "1" } }],
    ["search_issues", { space: "--yes", project: "DEV" }],
  ] as const) {
    const r = await callTool(name, args);
    assert.equal(r.result.isError, true, name);
    assert.match(r.result.content[0].text, /Invalid|Missing/, name);
  }
});

test("tools run the CLI: home_info and list_spaces in an empty home", async () => {
  const home = await callTool("home_info");
  assert.match(home.result.content[0].text, /review : translate/);
  const spaces = await callTool("list_spaces");
  assert.match(spaces.result.content[0].text, /No spaces yet/);
});

test("unknown tool and unknown method are JSON-RPC errors", async () => {
  assert.equal((await callTool("nope")).error.code, -32602);
  assert.equal((await rpc("nope/nope")).error.code, -32601);
});
