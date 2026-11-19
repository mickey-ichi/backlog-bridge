import { test } from "node:test";
import assert from "node:assert/strict";
import { findNamed, findPriority, findStatus } from "../src/names.ts";

const EN = [
  { id: 1, name: "Open" }, { id: 2, name: "In Progress" }, { id: 24904, name: "Review" },
  { id: 3, name: "Resolved" }, { id: 4, name: "Closed" },
];
const JA = [{ id: 1, name: "未対応" }, { id: 2, name: "処理中" }, { id: 3, name: "処理済み" }, { id: 4, name: "完了" }];
const PRIORITIES = [{ id: 2, name: "高" }, { id: 3, name: "中" }, { id: 4, name: "低" }];

test("status: exact name, any case and spacing", () => {
  assert.equal(findStatus(EN, "in progress", "DEV").id, 2);
  assert.equal(findStatus(EN, "IN_PROGRESS", "DEV").id, 2);
  assert.equal(findStatus(EN, "review", "DEV").id, 24904);
});

test("status: default statuses answer to English, Japanese and Vietnamese names in any space", () => {
  assert.equal(findStatus(EN, "処理中", "DEV").id, 2);
  assert.equal(findStatus(JA, "In Progress", "DEV").id, 2);
  assert.equal(findStatus(JA, "Đang xử lý", "DEV").id, 2);
  assert.equal(findStatus(JA, "resolved", "DEV").id, 3);
  assert.equal(findStatus(EN, "完了", "DEV").id, 4);
});

test("status: unknown name lists the valid ones", () => {
  assert.throws(() => findStatus(EN, "Testing", "DEV"), /DEV has no status "Testing"\. Use one of: Open, In Progress, Review, Resolved, Closed/);
});

test("priority: Japanese space, English or Vietnamese name", () => {
  assert.equal(findPriority(PRIORITIES, "high").id, 2);
  assert.equal(findPriority(PRIORITIES, "trung bình").id, 3);
  assert.equal(findPriority(PRIORITIES, "低").id, 4);
});

test("named lists: exact match, id, ambiguity", () => {
  const types = [{ id: 10, name: "Task" }, { id: 11, name: "Bug" }, { id: 12, name: "bug" }];
  assert.equal(findNamed(types, "task", "issue type", "DEV").id, 10);
  assert.equal(findNamed(types, "11", "issue type", "DEV").id, 11);
  assert.throws(() => findNamed(types, "BUG", "issue type", "DEV"), /several issue type "BUG"/);
});
