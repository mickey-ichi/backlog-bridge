// Name -> id lookups for write commands (status, priority, issue type, category, milestone). Kept free of I/O so
// they can be tested. A space shows its default statuses and priorities in its own language (English 'In Progress',
// Japanese '処理中', …), so the defaults also answer to their names in English, Japanese and Vietnamese.
import type { Named } from "./types.ts";

export const norm = (s: string | undefined) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[\s_-]+/g, " ").trim();

// Backlog's built-in statuses and priorities have the same ids in every space.
const STATUS_ALIASES: Record<number, string[]> = {
  1: ["open", "未対応", "mo", "chua xu ly", "todo", "to do", "new"],
  2: ["in progress", "処理中", "dang xu ly", "dang lam", "doing", "wip"],
  3: ["resolved", "処理済み", "da xu ly", "done", "xong"],
  4: ["closed", "完了", "dong", "da dong", "close"],
};
const PRIORITY_ALIASES: Record<number, string[]> = {
  2: ["high", "高", "cao"],
  3: ["normal", "中", "trung binh", "medium"],
  4: ["low", "低", "thap"],
};

function lookup<T extends Named>(list: T[], name: string, what: string, where: string, aliases: Record<number, string[]> = {}): T {
  const n = norm(name);
  if (/^\d+$/.test(n)) {
    const byId = list.find((x) => x.id === Number(n));
    if (byId) return byId;
  }
  const exact = list.filter((x) => norm(x.name) === n);
  if (exact.length === 1) return exact[0];
  const aliased = list.filter((x) => aliases[x.id]?.some((a) => norm(a) === n));
  if (exact.length === 0 && aliased.length === 1) return aliased[0];
  throw new Error(`${where} has ${exact.length > 1 ? "several" : "no"} ${what} "${name}". Use one of: ${list.map((x) => x.name).join(", ") || "-"}`);
}

export const findStatus = (list: Named[], name: string, where: string) => lookup(list, name, "status", where, STATUS_ALIASES);
export const findPriority = (list: Named[], name: string) => lookup(list, name, "priority", "This space", PRIORITY_ALIASES);
export const findNamed = (list: Named[], name: string, what: string, where: string) => lookup(list, name, what, where);
