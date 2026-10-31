// Chế độ "progress": đẩy TIẾN ĐỘ từ project nội bộ sang issue có sẵn ở project khách.
// KHÔNG BAO GIỜ tạo issue mới ở phía khách.
//
// Hai bên tách task theo trục khác nhau:
//   - Nội bộ: 1 Epic đánh số [NN] (milestone Phase 1) gồm [FE] [BE] [Infra] [Integrate API] [QA].
//   - Khách:  WBS "1.2.3" gồm 3 leaf cố định theo segment cuối — .3 実装 / .4 単体テスト / .5 受入確認.
//             Unit API nằm ở mục 1-2, unit màn hình ở mục 3.
//
// Rule đã chốt:
//   [BE]/[Infra]/[Integrate API] -> rollup của unit API   (nhóm "api")
//   [FE]                         -> rollup của unit màn hình (nhóm "screen")
//   [QA]                         -> tính vào MỌI nhóm, không ghi lên leaf test của khách
//   Ghi lên leaf 実装; khi rollup = done thì ghi thêm leaf 受入確認 (Resolved, không Closed).
//   Leaf 単体テスト không bao giờ bị đụng.
import { BacklogClient } from "./backlog.ts";
import { credentials, readJson, writeJson, resolvePath, hasFlag, argValue } from "./config.ts";
import { normalizeName } from "./mirror.ts";
import type {
  Issue, LeafRole, Params, ProgressProfile, RollupRules, RollupState, RunContext, Status,
} from "./types.ts";

export interface RollupResult {
  state: RollupState;
  percent: number;
  total: number;
  counts: { done: number; active: number; pending: number; other: number };
  start: string | null;
  due: string | null;
}

export interface Unit {
  number: string;
  tag: string | null;
  title: string;
  leaves: Partial<Record<LeafRole, Issue>>;
  all: Issue[];
}

interface Feature {
  number: string;
  numbered: boolean;
  epics: Issue[];
  children: Issue[];
}

interface FeatureRef {
  f: Feature;
  epicTitle: string;
  groupName: string;
}

interface UnitEntry {
  unit: Unit;
  items: Issue[];
  features: Map<string, FeatureRef>;
}

// pairFile: "<NN>" | "<issueKey>" -> { <nhóm>: [unit...], note }, cộng hai khoá đặc biệt _outOfScope / _notes.
interface PairEntry {
  note?: string;
  [group: string]: string[] | string | undefined;
}

interface ProgressState {
  lastSync: string | null;
  issues: Record<string, { unit: string; role: LeafRole; features: string[]; state: RollupState; percent: number }>;
}

interface PlanContext {
  entry: UnitEntry;
  unit: Unit;
  role: LeafRole;
  r: RollupResult;
  destIssue: Issue;
  statusMap: Partial<Record<RollupState, string>>;
  statusByName: Map<string, Status>;
  neverTouch: Set<string>;
  ALLOW_REGRESS: boolean;
  WRITE_DATES: string;
  dstStatuses: Status[];
}

interface PlannedWrite extends PlanContext {
  fields: Params;
  note: string;
  detail: string;
}

const groupUnits = (pair: PairEntry, group: string): string[] => {
  const v = pair[group];
  return Array.isArray(v) ? v : [];
};

const STATE_LABEL: Record<RollupState, string> = {
  not_started: "chưa bắt đầu",
  in_progress: "đang làm",
  pending: "tạm dừng",
  done: "đã xong",
};
const ROLE_BY_SEGMENT: Record<string, LeafRole> = { 3: "impl", 4: "unitTest", 5: "acceptance" };

type DateOnly = string | null;
function toDateOnly(v: string | null | undefined): DateOnly { return v ? String(v).slice(0, 10) : null; }
function minDate(a: DateOnly, b: DateOnly): DateOnly { return !a ? b : !b ? a : (a < b ? a : b); }
function maxDate(a: DateOnly, b: DateOnly): DateOnly { return !a ? b : !b ? a : (a > b ? a : b); }
function summaryPrefix(summary: string): string {
  const m = String(summary).match(/^\s*\[([^\]]+)\]/);
  return m ? m[1].trim() : "";
}

function collectDescendants(issue: Issue, childrenByParent: Map<number, Issue[]>, out: Issue[] = []): Issue[] {
  for (const child of childrenByParent.get(issue.id) || []) {
    out.push(child);
    collectDescendants(child, childrenByParent, out);
  }
  return out;
}

// Trạng thái + % của một nhóm task, suy ra từ trạng thái từng task.
// % tính theo estimatedHours (task không có estimate coi như 1 giờ).
export function rollup(items: Issue[], rules: RollupRules): RollupResult {
  const done = new Set(rules.doneStatuses || []);
  const active = new Set(rules.activeStatuses || []);
  const pending = new Set(rules.pendingStatuses || []);
  const ignore = new Set(rules.ignoreStatuses || []);

  const counted = items.filter((i) => !ignore.has(i.status?.name ?? ""));
  let weightTotal = 0, weightDone = 0;
  const counts = { done: 0, active: 0, pending: 0, other: 0 };
  let start: DateOnly = null, due: DateOnly = null;

  for (const it of counted) {
    const w = Number(it.estimatedHours) > 0 ? Number(it.estimatedHours) : 1;
    weightTotal += w;
    const name = it.status?.name ?? "";
    if (done.has(name)) { counts.done++; weightDone += w; }
    else if (active.has(name)) counts.active++;
    else if (pending.has(name)) counts.pending++;
    else counts.other++;
    start = minDate(start, toDateOnly(it.startDate));
    due = maxDate(due, toDateOnly(it.dueDate));
  }

  let state: RollupState;
  if (!counted.length) state = "not_started";
  else if (counts.done === counted.length) state = "done";
  else if (counts.active > 0 || counts.done > 0) state = "in_progress";
  else if (counts.pending > 0 && counts.pending + counts.done === counted.length) state = "pending";
  else state = "not_started";

  return {
    state,
    percent: weightTotal ? Math.round((weightDone / weightTotal) * 100) : 0,
    total: counted.length,
    counts, start, due,
  };
}

// Gom issue phía khách thành unit WBS: "1.2.3" -> { leaves: {impl, unitTest, acceptance} }
export function buildUnits(destIssues: Issue[]): Map<string, Unit> {
  const units = new Map<string, Unit>();
  for (const issue of destIssues) {
    const m = issue.summary.match(/^\s*(\d+(?:\.\d+)+)\s*(.*)$/);
    if (!m) continue;
    const segments = m[1].split(".");
    // 4 tầng = leaf của unit 3 tầng; 3 tầng = checkpoint đứng một mình (mục 4.x).
    const number = segments.slice(0, 3).join(".");
    const role = segments.length >= 4 ? ROLE_BY_SEGMENT[segments[3]] : "impl";
    if (!units.has(number)) {
      units.set(number, {
        number,
        tag: (m[2].match(/\[([A-Z][A-Z0-9-]+)\]/) || [])[1] || null,
        title: m[2].split("|")[0].replace(/(実装|単体テスト|受入確認|設計|検証|構築|テスト)\s*$/, "").trim(),
        leaves: {},
        all: [],
      });
    }
    const unit = units.get(number)!;
    unit.all.push(issue);
    if (role && !unit.leaves[role]) unit.leaves[role] = issue;
  }
  return units;
}

export async function run({ config, profile, profileName }: RunContext<ProgressProfile>): Promise<void> {
  // Ghi sang Backlog khách là việc lộ ra ngoài -> mặc định chỉ xem trước, phải --live mới ghi.
  const LIVE = hasFlag("live");
  const LIST_UNITS = hasFlag("units");
  const WRITE_COMMENT = hasFlag("comment") || profile.dest.write?.comment === true;
  const WRITE_DATES = argValue("dates") || profile.dest.write?.dates || "none";
  const ALLOW_REGRESS = hasFlag("allow-regress") || profile.dest.write?.allowRegress === true;
  const ONLY = (argValue("only") || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Focus: chỉ ghi lên leaf mà KHÁCH đang assign cho người này, và báo phần họ giao
  // mà nội bộ chưa khai cặp. --mine = chính chủ API key đang dùng.
  const FOCUS_ARG = argValue("assignee") || (hasFlag("mine") ? "@me" : profile.dest.focusAssignee);

  const src = new BacklogClient(credentials(config, profile.source.space));
  const dst = new BacklogClient(credentials(config, profile.dest.space));
  const STATE_FILE = profile.state || `state/${profileName}.json`;
  const state = readJson<ProgressState>(STATE_FILE, { lastSync: null, issues: {} });

  let focusName = FOCUS_ARG;
  if (FOCUS_ARG === "@me") focusName = (await dst.getMyself()).name;
  const focusKey = focusName ? normalizeName(focusName) : null;
  if (focusKey && focusKey.length < 3) {
    throw new Error(`--assignee="${focusName}" quá ngắn/không hợp lệ sau khi chuẩn hoá ("${focusKey}")`);
  }
  const matchesFocus = (issue: Issue | undefined) =>
    !focusKey || normalizeName(issue?.assignee?.name).includes(focusKey);

  console.log(`Profile: ${profileName} (mode=progress)`);
  console.log(`Mode: ${LIVE ? "LIVE — GHI VÀO BACKLOG KHÁCH" : "DRY-RUN (không ghi gì)"}`);
  console.log(`Source (nội bộ): ${src.host} / ${profile.source.projectKey}`);
  console.log(`Dest (khách):    ${dst.host} / ${profile.dest.projectKey}`);
  if (focusName) console.log(`Focus: chỉ ghi leaf khách assign cho "${focusName}"`);
  console.log(`Last sync: ${state.lastSync || "never"}\n`);

  const srcProject = await src.getProject(profile.source.projectKey);
  const dstProject = await dst.getProject(profile.dest.projectKey);
  const [srcIssues, dstIssues, dstStatuses] = await Promise.all([
    src.getAllIssues(srcProject.id),
    dst.getAllIssues(dstProject.id),
    dst.getStatuses(dstProject.id),
  ]);

  const units = buildUnits(dstIssues);

  if (LIST_UNITS) {
    console.log(`${units.size} unit WBS phía khách (dùng để điền pairFile):\n`);
    const sorted = [...units.values()].sort((a, b) => cmpWbs(a.number, b.number));
    for (const u of sorted) {
      const leaves = (["impl", "unitTest", "acceptance"] as const)
        .map((r) => (u.leaves[r] ? `${r}=${u.leaves[r].issueKey}/${u.leaves[r].status?.name}` : null))
        .filter(Boolean).join("  ");
      console.log(`${u.number.padEnd(8)} ${(u.tag || "-").padEnd(14)} ${u.title.slice(0, 34).padEnd(36)} ${leaves}`);
    }
    return;
  }

  // 1. Tính năng phía nội bộ.
  // Khoá của một tính năng = số [NN] nếu epic có đánh số, ngược lại = issueKey của epic
  // (vd một epic hạ tầng không đánh số nhưng vẫn ứng với một unit của khách).
  const featureCfg: NonNullable<ProgressProfile["source"]["feature"]> = profile.source.feature || {};
  const epicPattern = new RegExp(featureCfg.epicPattern || "^\\s*\\[Epic\\]");
  const numberPattern = new RegExp(featureCfg.numberPattern || featureCfg.summaryPattern || "\\[(\\d+)\\]");
  const wantMilestone = featureCfg.milestone;
  const childrenByParent = new Map<number, Issue[]>();
  for (const i of srcIssues) {
    if (!i.parentIssueId) continue;
    if (!childrenByParent.has(i.parentIssueId)) childrenByParent.set(i.parentIssueId, []);
    childrenByParent.get(i.parentIssueId)!.push(i);
  }
  const features = new Map<string, Feature>();
  for (const issue of srcIssues) {
    if (!epicPattern.test(issue.summary)) continue;
    // Epic cùng số nhưng khác milestone là bản kế hoạch cũ (đã Closed) -> loại,
    // nếu không tiến độ của tính năng bị tính là đã xong.
    if (wantMilestone && !(issue.milestone || []).some((v) => v.name === wantMilestone)) continue;
    const m = issue.summary.match(numberPattern);
    const key = m ? m[1].padStart(2, "0") : issue.issueKey;
    if (!features.has(key)) features.set(key, { number: key, numbered: Boolean(m), epics: [], children: [] });
    const f = features.get(key)!;
    f.epics.push(issue);
    f.children.push(...collectDescendants(issue, childrenByParent));
  }
  const featureList = [...features.values()].sort((a, b) => {
    if (a.numbered !== b.numbered) return a.numbered ? -1 : 1;
    return a.number.localeCompare(b.number, undefined, { numeric: true });
  });
  console.log(
    `Nội bộ: ${srcIssues.length} issue -> ${featureList.length} epic` +
    `${wantMilestone ? ` (milestone "${wantMilestone}")` : ""} ` +
    `(${featureList.filter((f) => f.numbered).length} đánh số, ${featureList.filter((f) => !f.numbered).length} chưa đánh số), ` +
    `${featureList.reduce((n, f) => n + f.children.length, 0)} task con.`
  );
  console.log(`Khách: ${dstIssues.length} issue -> ${units.size} unit WBS.\n`);

  // 2. Ghép cặp + rollup theo nhóm.
  const groups: Record<string, string[]> = profile.source.childGroups || {};
  const alwaysCount = new Set(profile.source.alwaysCount || []);
  const rules = profile.source.rollup || {};
  const pairFile = profile.dest.match?.pairFile || `state/pairs-${profileName}.json`;
  const pairs = readJson<Record<string, unknown> | null>(pairFile, null);
  if (!pairs) throw new Error(`Không đọc được pairFile ${resolvePath(pairFile)} — chạy --units để lấy danh sách unit rồi khai cặp.`);

  const statusByName = new Map(dstStatuses.map((s) => [s.name, s]));
  const statusMap = profile.dest.write?.status || {};
  const neverTouch = new Set(profile.dest.write?.neverTouchStatuses || []);
  const targetRoles = profile.dest.write?.targets || ["impl"];
  const acceptanceOnlyWhenDone = profile.dest.write?.acceptanceOnlyWhenDone !== false;

  // Gộp theo unit khách: nhiều tính năng nội bộ có thể trỏ cùng 1 unit
  // (vd 3.2.11 利用状況・分析 nhận cả [45] và [46]) -> phải cộng dồn task rồi mới tính
  // rollup một lần, nếu ghi lần lượt thì tính năng sau đè tiến độ của tính năng trước.
  const perUnit = new Map<string, UnitEntry>();
  const unmapped: Array<{ f: Feature; epicTitle: string; note?: string }> = [];
  const noWork: Array<{ f: Feature; epicTitle: string; groupName: string; unitNumbers: string[] }> = [];

  for (const f of featureList) {
    if (ONLY.length && !ONLY.includes(f.number)) continue;
    const pair = pairs[f.number] as PairEntry | undefined;
    const epicTitle = f.epics[0].summary.replace(/^\s*\[Epic\]\s*\[\d+\]\s*/, "");
    if (!pair || !Object.keys(groups).some((g) => groupUnits(pair, g).length)) {
      unmapped.push({ f, epicTitle, note: pair?.note });
      continue;
    }

    for (const [groupName, prefixes] of Object.entries(groups)) {
      const unitNumbers = groupUnits(pair, groupName);
      if (!unitNumbers.length) continue;
      const prefixSet = new Set(prefixes);
      // [QA] (alwaysCount) tính vào mọi nhóm nhưng bản thân nhóm phải có task riêng mới coi là có việc.
      const items = f.children.filter((c) => {
        const p = summaryPrefix(c.summary);
        return prefixSet.has(p) || alwaysCount.has(p);
      });
      if (!items.some((c) => prefixSet.has(summaryPrefix(c.summary)))) {
        noWork.push({ f, epicTitle, groupName, unitNumbers });
        continue;
      }

      for (const unitNumber of unitNumbers) {
        const unit = units.get(unitNumber);
        if (!unit) {
          console.warn(`  ! [${f.number}] ${groupName}: không thấy unit "${unitNumber}" bên khách`);
          continue;
        }
        if (!perUnit.has(unitNumber)) perUnit.set(unitNumber, { unit, items: [], features: new Map() });
        const entry = perUnit.get(unitNumber)!;
        const seen = new Set(entry.items.map((i) => i.id));
        for (const it of items) if (!seen.has(it.id)) entry.items.push(it);
        entry.features.set(f.number, { f, epicTitle, groupName });
      }
    }
  }

  const writes: PlannedWrite[] = [];
  let outOfFocus = 0;
  for (const [unitNumber, entry] of [...perUnit.entries()].sort((a, b) => cmpWbs(a[0], b[0]))) {
    const r = rollup(entry.items, rules);
    for (const role of targetRoles) {
      if (role === "acceptance" && acceptanceOnlyWhenDone && r.state !== "done") continue;
      const destIssue = entry.unit.leaves[role];
      if (!destIssue) continue;
      if (!matchesFocus(destIssue)) { outOfFocus++; continue; }
      writes.push(planWrite({
        entry, unit: entry.unit, role, r, destIssue,
        statusMap, statusByName, neverTouch, ALLOW_REGRESS, WRITE_DATES, dstStatuses,
      }));
    }
  }

  // 3. In kế hoạch.
  console.log("Kế hoạch ghi sang khách (rollup theo unit của khách)");
  console.log("-".repeat(112));
  let willWrite = 0;
  const byUnit = new Map<string, PlannedWrite[]>();
  for (const w of writes) {
    if (!byUnit.has(w.unit.number)) byUnit.set(w.unit.number, []);
    byUnit.get(w.unit.number)!.push(w);
  }
  for (const [unitNumber, list] of [...byUnit.entries()].sort((a, b) => cmpWbs(a[0], b[0]))) {
    const w0 = list[0];
    const from = [...w0.entry.features.values()]
      .map((x) => `[${x.f.number}]${x.groupName === "screen" ? " FE" : " BE"}`).join(" ");
    console.log(`\n${unitNumber}  ${(w0.unit.tag || "-")}  ${w0.unit.title.slice(0, 40)}   ← ${from}`);
    console.log(`   ${w0.detail}`);
    for (const w of list) {
      console.log(
        `   ${w.role.padEnd(11)}${(STATE_LABEL[w.r.state] + " " + w.r.percent + "%").padEnd(17)}` +
        `${w.destIssue.issueKey.padEnd(14)}${w.note}`
      );
      if (Object.keys(w.fields).length) willWrite++;
    }
  }

  if (focusKey) {
    // Unit khách đã xác nhận ngoài phạm vi phía mình -> không báo hụt nữa.
    const outOfScope = new Set((pairs._outOfScope as string[] | undefined) || []);
    const unitNotes = (pairs._notes as Record<string, string> | undefined) || {};
    const mapped = new Set(perUnit.keys());
    const gaps: Array<{ unit: Unit; mine: Issue[]; note?: string }> = [];
    for (const unit of units.values()) {
      const mine = unit.all.filter(matchesFocus);
      if (!mine.length) continue;
      if (mapped.has(unit.number) || outOfScope.has(unit.number)) continue;
      gaps.push({ unit, mine, note: unitNotes[unit.number] });
    }
    gaps.sort((a, b) => cmpWbs(a.unit.number, b.unit.number));
    console.log(`\nFOCUS — khách giao cho "${focusName}" nhưng nội bộ chưa khai cặp (${gaps.length} unit):`);
    for (const g of gaps) {
      console.log(
        `  ${g.unit.number.padEnd(8)}${(g.unit.tag || "-").padEnd(14)}${g.unit.title.slice(0, 34).padEnd(36)}` +
        `${g.mine.map((i) => `${i.issueKey}/${i.status?.name}`).join(" ")}`
      );
      if (g.note) console.log(`  ${" ".repeat(8)}-> ${g.note}`);
    }
    if (outOfScope.size) console.log(`  (bỏ qua ${outOfScope.size} unit đã xác nhận ngoài scope: ${[...outOfScope].join(", ")})`);
    if (outOfFocus) console.log(`  (${outOfFocus} leaf đã ghép cặp nhưng khách không assign cho "${focusName}" -> bỏ qua)`);
  }

  if (noWork.length) {
    console.log(`\nNhóm chưa có task nội bộ -> bỏ qua (${noWork.length}):`);
    for (const n of noWork) {
      console.log(`  [${n.f.number}] ${n.groupName} -> ${n.unitNumbers.join(", ")}  (${n.epicTitle.slice(0, 60)})`);
    }
  }
  const unmappedNumbered = unmapped.filter((u) => u.f.numbered);
  const unmappedOther = unmapped.filter((u) => !u.f.numbered);
  if (unmappedNumbered.length) {
    console.log(`\nEpic đánh số chưa khai cặp -> KHÔNG ghi gì (${unmappedNumbered.length}):`);
    for (const u of unmappedNumbered) {
      console.log(`  [${u.f.number}] ${u.epicTitle.slice(0, 70)}${u.note ? `\n         ghi chú: ${u.note}` : ""}`);
    }
  }
  if (unmappedOther.length) {
    console.log(`\nEpic chưa đánh số, chưa khai cặp (${unmappedOther.length}):`);
    for (const u of unmappedOther) {
      console.log(`  ${u.f.number} ${u.epicTitle.slice(0, 66)}${u.note ? `\n         ghi chú: ${u.note}` : ""}`);
    }
  }
  if (unmapped.length) console.log(`  -> điền ${pairFile} (chạy --units để xem danh sách unit khách).`);

  // 4. Ghi.
  let wrote = 0, comments = 0;
  for (const w of writes) {
    const hasFieldWrite = Object.keys(w.fields).length > 0;
    const prev = state.issues[w.destIssue.issueKey];
    const changed = !prev || prev.state !== w.r.state || prev.percent !== w.r.percent;
    const needComment = WRITE_COMMENT && w.role === "impl" && changed;
    if (!hasFieldWrite && !needComment) continue;
    if (!LIVE) continue;

    if (hasFieldWrite) { await dst.updateIssue(w.destIssue.issueKey, w.fields); wrote++; }
    if (needComment) {
      const marker = profile.dest.write?.commentMarker || "<!-- backlog-bridge-progress -->";
      const content = renderComment(marker, w, profile.dest.write?.orgName);
      // Update lại chính comment tiến độ cũ để không spam board khách.
      const existing = (await dst.getComments(w.destIssue.issueKey))
        .find((c) => typeof c.content === "string" && c.content.includes(marker));
      if (existing) await dst.updateComment(w.destIssue.issueKey, existing.id, content);
      else await dst.addComment(w.destIssue.issueKey, content);
      comments++;
    }
    state.issues[w.destIssue.issueKey] = {
      unit: w.unit.number, role: w.role,
      features: [...w.entry.features.keys()],
      state: w.r.state, percent: w.r.percent,
    };
  }

  if (LIVE) {
    state.lastSync = new Date().toISOString();
    writeJson(STATE_FILE, state);
  }

  console.log(
    `\nDone. Unit khách được ghép: ${perUnit.size}, tính năng chưa khai cặp: ${unmapped.length}, ` +
    `leaf khách cần ghi: ${willWrite}, đã ghi: ${wrote}, comment: ${comments}.`
  );
  if (!LIVE) console.log("(dry-run: chưa ghi gì sang Backlog khách. Thêm --live để ghi thật.)");
}

// Quyết định ghi gì lên 1 leaf của khách + các chốt an toàn.
function planWrite(ctx: PlanContext): PlannedWrite {
  const { r, destIssue, statusMap, statusByName, neverTouch, ALLOW_REGRESS, WRITE_DATES, dstStatuses } = ctx;
  const fields: Params = {};
  const wantName = statusMap[r.state];
  const curName = destIssue.status?.name;
  let note: string;

  if (!wantName) {
    note = `giữ nguyên (${curName})`;
  } else if (wantName === curName) {
    note = `đã đúng (${curName})`;
  } else if (curName && neverTouch.has(curName)) {
    note = `BỎ QUA — khách đang "${curName}"`;
  } else if (!ALLOW_REGRESS && (statusByName.get(wantName)?.displayOrder ?? 0) < (destIssue.status?.displayOrder ?? 0)) {
    note = `BỎ QUA lùi trạng thái "${curName}" -> "${wantName}"`;
  } else if (!statusByName.has(wantName)) {
    note = `!! khách không có status "${wantName}" (có: ${dstStatuses.map((s) => s.name).join(", ")})`;
  } else {
    fields.statusId = statusByName.get(wantName)!.id;
    note = `"${curName}" -> "${wantName}"`;
  }

  if (WRITE_DATES === "children") {
    if (r.start) fields.startDate = r.start;
    if (r.due) fields.dueDate = r.due;
  }

  const detail = `con: ${r.total} (xong ${r.counts.done}, đang ${r.counts.active}, dừng ${r.counts.pending}, chưa ${r.counts.other})` +
    `${r.start || r.due ? `  lịch nội bộ ${r.start || "?"} → ${r.due || "?"}` : ""}`;

  return { ...ctx, fields, note, detail };
}

// Comment tiến độ gửi khách — tiếng Nhật, marker ẩn để lần sau update lại chính nó.
// orgName (dest.write.orgName) là tên phía mình hiện trong câu chú thích, vd "Acme" -> "Acme 側の内部タスク".
function renderComment(marker: string, { r, unit }: PlannedWrite, orgName?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    marker,
    `【進捗】${today} 時点：${jpState(r.state)}（${r.percent}%）`,
    `- 完了 ${r.counts.done} / ${r.total} 件`,
    `- 進行中 ${r.counts.active} 件・保留 ${r.counts.pending} 件・未着手 ${r.counts.other} 件`,
    r.start || r.due ? `- 社内予定：${r.start || "?"} 〜 ${r.due || "?"}` : null,
    `※ ${unit.number} に対応する${orgName ? ` ${orgName} 側の` : ""}内部タスク（結合・QA を含む）を集計した数値です。`,
  ].filter(Boolean).join("\n");
}
function jpState(state: RollupState): string {
  return { not_started: "未着手", in_progress: "進行中", pending: "保留", done: "完了" }[state] || state;
}
function cmpWbs(a: string, b: string): number {
  const A = a.split(".").map(Number), B = b.split(".").map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) - (B[i] || 0);
  }
  return 0;
}
