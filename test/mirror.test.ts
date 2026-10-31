import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, resolveCustomFields, customFieldsFor } from "../src/mirror.ts";
import type { CustomField } from "../src/types.ts";

test("normalizeName: drops accents, đ, and anything in parentheses", () => {
  assert.equal(normalizeName("Nguyễn Văn An (D3.React)"), "nguyen van an");
  assert.equal(normalizeName("Đức"), "duc");
  assert.equal(normalizeName("  Lê   Thị-Hoa "), "le thi hoa");
  assert.equal(normalizeName(undefined), "");
});

const BUG = 2, TASK = 1;
const fields: CustomField[] = [
  {
    id: 7, name: "Bug Weight", required: true, applicableIssueTypes: [BUG],
    items: [{ id: 11, name: "Low" }, { id: 12, name: "Medium" }],
  },
  {
    id: 8, name: "Bug Type", required: true, applicableIssueTypes: [BUG],
    items: [{ id: 21, name: "Function" }, { id: 22, name: "UI" }],
  },
  { id: 9, name: "Note", applicableIssueTypes: [] },
];

test("resolveCustomFields: list items by name -> ids; scalar for one, array for many", (t) => {
  t.mock.method(console, "warn", () => {});
  const r = resolveCustomFields({ "bug weight": "Medium", "Bug Type": ["Function", "UI"], Note: "hello" }, fields);
  assert.deepEqual(r.map((c) => [c.key, c.value]), [
    ["customField_7", 12],
    ["customField_8", [21, 22]],
    ["customField_9", "hello"],
  ]);
});

test("resolveCustomFields: unknown field / item is skipped with a warning", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const r = resolveCustomFields({ Nope: "x", "Bug Weight": "Huge" }, fields);
  assert.equal(r.length, 0);
  assert.equal(warn.mock.callCount(), 2);
});

test("customFieldsFor: only fields applicable to the issue type are attached", (t) => {
  t.mock.method(console, "warn", () => {});
  const resolved = resolveCustomFields({ "Bug Weight": "Low", "Bug Type": "UI", Note: "n" }, fields);
  const task = customFieldsFor(resolved, fields, TASK, new Set());
  assert.deepEqual(task.body, { customField_9: "n" });
  const bug = customFieldsFor(resolved, fields, BUG, new Set());
  assert.deepEqual(bug.body, { customField_7: 11, customField_8: 22, customField_9: "n" });
  assert.deepEqual(bug.labels, ["Bug Weight=Low", "Bug Type=UI", "Note=n"]);
});

test("customFieldsFor: warns once per issue type about a required field left out", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const resolved = resolveCustomFields({ "Bug Weight": "Low" }, fields);
  const warned = new Set<string>();
  customFieldsFor(resolved, fields, BUG, warned);
  customFieldsFor(resolved, fields, BUG, warned);
  const messages = warn.mock.calls.map((c) => String(c.arguments[0]));
  assert.equal(messages.filter((m) => m.includes("Bug Type")).length, 1);
});
