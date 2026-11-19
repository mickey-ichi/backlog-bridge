export const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[\s_-]+/g, " ").trim();
// Backlog's built-in statuses and priorities have the same ids in every space.
const STATUS_ALIASES = {
    1: ["open", "未対応", "mo", "chua xu ly", "todo", "to do", "new"],
    2: ["in progress", "処理中", "dang xu ly", "dang lam", "doing", "wip"],
    3: ["resolved", "処理済み", "da xu ly", "done", "xong"],
    4: ["closed", "完了", "dong", "da dong", "close"],
};
const PRIORITY_ALIASES = {
    2: ["high", "高", "cao"],
    3: ["normal", "中", "trung binh", "medium"],
    4: ["low", "低", "thap"],
};
function lookup(list, name, what, where, aliases = {}) {
    const n = norm(name);
    if (/^\d+$/.test(n)) {
        const byId = list.find((x) => x.id === Number(n));
        if (byId)
            return byId;
    }
    const exact = list.filter((x) => norm(x.name) === n);
    if (exact.length === 1)
        return exact[0];
    const aliased = list.filter((x) => aliases[x.id]?.some((a) => norm(a) === n));
    if (exact.length === 0 && aliased.length === 1)
        return aliased[0];
    throw new Error(`${where} has ${exact.length > 1 ? "several" : "no"} ${what} "${name}". Use one of: ${list.map((x) => x.name).join(", ") || "-"}`);
}
export const findStatus = (list, name, where) => lookup(list, name, "status", where, STATUS_ALIASES);
export const findPriority = (list, name) => lookup(list, name, "priority", "This space", PRIORITY_ALIASES);
export const findNamed = (list, name, what, where) => lookup(list, name, what, where);
