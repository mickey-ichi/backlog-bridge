import { test } from "node:test";
import assert from "node:assert/strict";
import { rollup, buildUnits } from "../src/progress.ts";
import type { Issue } from "../src/types.ts";

let id = 0;
const issue = (summary: string, status: string, extra: Partial<Issue> = {}): Issue => ({
  id: ++id, issueKey: `T-${id}`, summary, status: { id: 1, name: status }, ...extra,
});

const rules = {
  doneStatuses: ["Closed", "Resolved"],
  activeStatuses: ["In Progress"],
  pendingStatuses: ["Pending"],
  ignoreStatuses: ["Reject"],
};

test("rollup: no tasks -> not_started", () => {
  assert.equal(rollup([], rules).state, "not_started");
});

test("rollup: all done -> done, 100%", () => {
  const r = rollup([issue("[BE] a", "Closed"), issue("[BE] b", "Resolved")], rules);
  assert.equal(r.state, "done");
  assert.equal(r.percent, 100);
});

test("rollup: something active or partly done -> in_progress", () => {
  assert.equal(rollup([issue("a", "In Progress"), issue("b", "Open")], rules).state, "in_progress");
  assert.equal(rollup([issue("a", "Closed"), issue("b", "Open")], rules).state, "in_progress");
});

test("rollup: rest only pending -> pending; only open -> not_started", () => {
  assert.equal(rollup([issue("a", "Pending"), issue("b", "Pending")], rules).state, "pending");
  assert.equal(rollup([issue("a", "Open"), issue("b", "Open")], rules).state, "not_started");
});

test("rollup: ignored statuses are excluded from the calculation", () => {
  const r = rollup([issue("a", "Closed"), issue("b", "Reject")], rules);
  assert.equal(r.state, "done");
  assert.equal(r.total, 1);
});

test("rollup: percent weighted by estimatedHours, missing estimate = 1h", () => {
  const r = rollup([
    issue("a", "Closed", { estimatedHours: 3 }),
    issue("b", "Open"),
  ], rules);
  assert.equal(r.percent, 75);
});

test("rollup: date range spans the earliest start and latest due", () => {
  const r = rollup([
    issue("a", "Open", { startDate: "2026-01-05T00:00:00Z", dueDate: "2026-01-10T00:00:00Z" }),
    issue("b", "Open", { startDate: "2026-01-02T00:00:00Z", dueDate: "2026-02-01T00:00:00Z" }),
  ], rules);
  assert.equal(r.start, "2026-01-02");
  assert.equal(r.due, "2026-02-01");
});

test("buildUnits: leaf role comes from the last WBS segment, not the title", () => {
  const units = buildUnits([
    issue("1.2.3.3 [API-01] Login API 構築", "Open"),
    issue("1.2.3.4 [API-01] Login API 構築", "Open"),
    issue("1.2.3.5 [API-01] Login API 構築", "Open"),
  ]);
  const u = units.get("1.2.3")!;
  assert.equal(u.tag, "API-01");
  assert.equal(u.leaves.impl?.summary.startsWith("1.2.3.3"), true);
  assert.equal(u.leaves.unitTest?.summary.startsWith("1.2.3.4"), true);
  assert.equal(u.leaves.acceptance?.summary.startsWith("1.2.3.5"), true);
  assert.equal(u.all.length, 3);
});

test("buildUnits: a 3-level number is a standalone checkpoint -> impl leaf", () => {
  const units = buildUnits([issue("4.1.2 Release checkpoint", "Open")]);
  assert.ok(units.get("4.1.2")?.leaves.impl);
});

test("buildUnits: issues without a WBS number are ignored", () => {
  assert.equal(buildUnits([issue("Random task", "Open")]).size, 0);
});
