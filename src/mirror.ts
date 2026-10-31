// Chế độ "mirror": copy issue từ project nguồn sang project đích, tạo issue mới ở đích.
// Thường dùng cho chiều Backlog khách -> Backlog nội bộ (task khách đã plan thành task nội bộ).
import { BacklogClient } from "./backlog.ts";
import { credentials, readJson, writeJson, hasFlag, argValue } from "./config.ts";
import type { CustomField, CustomFieldItem, Issue, MirrorProfile, Named, ParamValue, RunContext } from "./types.ts";

interface MirrorState {
  lastSync: string | null;
  issues: Record<string, string>; // sourceKey -> destKey
}

interface ResolvedCustomField {
  field: CustomField;
  key: string;
  value: ParamValue;
  label: string;
}

// "Nguyen Van An (D3.React)" -> "nguyen van an", "Đức" -> "duc"
// Bỏ phần trong ngoặc vì suffix hai bên thường khác nhau (vd khách D3.React vs nội bộ R2.React).
export function normalizeName(name: string | null | undefined): string {
  return (name || "")
    .replace(/\([^)]*\)/g, " ")
    // đ/Đ không tách được bằng NFD nên phải thay tay, nếu không "Đức" -> "uc".
    .replace(/[đĐ]/g, "d")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim().toLowerCase();
}

function byName(list: Named[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of list) map.set(item.name.trim().toLowerCase(), item.id);
  return map;
}

// Resolve a source value to a dest id, using config overrides then name match then fallback.
function resolveId(
  sourceName: string | undefined,
  destByName: Map<string, number>,
  overrides: Record<string, string> | undefined,
  fallbackId: number | undefined,
  label: string,
): number | undefined {
  if (!sourceName) return fallbackId;
  const key = sourceName.trim().toLowerCase();
  const overridden = overrides?.[sourceName];
  if (overridden && destByName.has(overridden.trim().toLowerCase()))
    return destByName.get(overridden.trim().toLowerCase());
  if (destByName.has(key)) return destByName.get(key);
  console.warn(`  ! No ${label} match for "${sourceName}" -> using fallback`);
  return fallbackId;
}

// map.assignee đổi người phụ trách khi sang nội bộ (khách assign A nhưng nội bộ giao B làm).
// Khớp theo tên đã chuẩn hoá nên khai trong config không cần đúng suffix trong ngoặc.
function resolveAssigneeId(
  sourceName: string | undefined,
  destUserByName: Map<string, number>,
  overrides: Record<string, string> | undefined,
): number | undefined {
  if (!sourceName) return undefined;
  const key = normalizeName(sourceName);
  for (const [from, to] of Object.entries(overrides || {})) {
    if (normalizeName(from) !== key) continue;
    const id = destUserByName.get(normalizeName(to));
    if (id) return id;
    console.warn(`  ! map.assignee "${from}" -> "${to}": đích không có user này -> thử khớp tên gốc`);
    break;
  }
  return destUserByName.get(key);
}

const KEY_ONLY = /^\s*\[?([A-Z][A-Z0-9_]*-\d+)\]?/;

// Quét project đích, dựng map { sourceKey -> destKey } từ prefix trong summary.
// Đây là nguồn chống trùng chính: state file có thể mất hoặc chưa từng tồn tại
// (các issue trước đây được tạo tay), lúc đó chỉ dựa vào state sẽ tạo trùng toàn bộ.
async function discoverExistingMirrors(dest: BacklogClient, destProjectId: number, sourceProjectKey: string) {
  const mirrors: Record<string, string> = {};
  const destIssues = await dest.getAllIssues(destProjectId);
  for (const issue of destIssues) {
    const m = issue.summary.match(KEY_ONLY);
    if (m && m[1].startsWith(`${sourceProjectKey}-`)) mirrors[m[1]] = issue.issueKey;
  }
  return { mirrors, scanned: destIssues.length };
}

// Một số project đích bắt buộc custom field theo issue type (vd type Bug cần "Bug Weight" + "Bug Type").
// profile.dest.customFields khai theo TÊN field -> tên item (hoặc giá trị thô cho field text/số).
// Resolve một lần lúc bắt đầu chạy (kể cả dry-run) để field/item sai tên lộ ra ngay, không đợi lúc tạo thật.
export function resolveCustomFields(
  defaults: MirrorProfile["dest"]["customFields"],
  destCustomFields: CustomField[],
): ResolvedCustomField[] {
  const resolved: ResolvedCustomField[] = [];
  for (const [fieldName, wanted] of Object.entries(defaults || {})) {
    const field = destCustomFields.find((f) => f.name.trim().toLowerCase() === fieldName.trim().toLowerCase());
    if (!field) {
      console.warn(`  ! Không tìm thấy custom field "${fieldName}" ở đích -> bỏ qua`);
      continue;
    }
    const entry = { field, key: `customField_${field.id}` };
    const fieldItems = field.items || [];
    if (!fieldItems.length) { resolved.push({ ...entry, value: wanted, label: String(wanted) }); continue; }
    const wantedItems = Array.isArray(wanted) ? wanted : [wanted];
    const items: CustomFieldItem[] = [];
    for (const name of wantedItems) {
      const item = fieldItems.find((i) => i.name.trim().toLowerCase() === String(name).trim().toLowerCase());
      if (item) items.push(item);
      else console.warn(`  ! Custom field "${fieldName}" không có item "${name}" -> bỏ qua`);
    }
    if (!items.length) continue;
    // Một giá trị -> scalar; nhiều giá trị -> mảng, client gửi lặp key customField_<id> (không "[]").
    const ids = items.map((i) => i.id);
    resolved.push({ ...entry, value: ids.length === 1 ? ids[0] : ids, label: items.map((i) => i.name).join("+") });
  }
  return resolved;
}

const appliesTo = (field: CustomField, issueTypeId: number | undefined) =>
  !field.applicableIssueTypes?.length ||
  (issueTypeId !== undefined && field.applicableIssueTypes.includes(issueTypeId));

// Field đã khai và áp dụng cho issue type đang tạo; cảnh báo (mỗi cặp type/field một lần) field
// bắt buộc của type đó mà profile chưa khai — tạo thật sẽ bị Backlog báo "... is required".
export function customFieldsFor(
  resolved: ResolvedCustomField[],
  destCustomFields: CustomField[],
  issueTypeId: number | undefined,
  warned: Set<string>,
) {
  const fields = resolved.filter((c) => appliesTo(c.field, issueTypeId));
  for (const f of destCustomFields) {
    if (!f.required || !appliesTo(f, issueTypeId) || fields.some((c) => c.field.id === f.id)) continue;
    const once = `${issueTypeId}:${f.id}`;
    if (warned.has(once)) continue;
    warned.add(once);
    console.warn(`  ! Custom field bắt buộc "${f.name}" chưa khai ở dest.customFields -> tạo issue type này sẽ lỗi`);
  }
  return {
    body: Object.fromEntries(fields.map((c) => [c.key, c.value])),
    labels: fields.map((c) => `${c.field.name}=${c.label}`),
  };
}

function toDateOnly(value: string | null | undefined): string | undefined {
  return value ? String(value).slice(0, 10) : undefined;
}

export async function run({ config, profile, profileName }: RunContext<MirrorProfile>): Promise<void> {
  const DRY_RUN = hasFlag("dry-run");
  // Mặc định CHỈ tạo issue mới. Muốn ghi đè summary/description/date/status của issue
  // đã có ở đích thì phải bật --update (issue ở đích thường đã được sửa tay ở nội bộ).
  const ALLOW_UPDATE = hasFlag("update");
  const STATE_FILE = profile.state || `state/${profileName}.json`;

  // --assignee=An,Binh  (khớp lỏng theo tên, bỏ dấu và bỏ phần trong ngoặc)
  const ASSIGNEE_FILTER = (argValue("assignee") || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .concat(profile.filter?.assignees || []);
  // --since=YYYY-MM-DD  (chỉ lấy issue có dueDate >= ngày này)
  const DUE_SINCE = argValue("since");

  function matchesAssigneeFilter(issue: Issue): boolean {
    if (!ASSIGNEE_FILTER.length) return true;
    const actual = normalizeName(issue.assignee?.name);
    if (!actual) return false;
    return ASSIGNEE_FILTER.some((wanted) => {
      const w = normalizeName(wanted);
      // Tên quá ngắn sau khi chuẩn hoá sẽ match bừa (vd "an" khớp cả "Lan" lẫn "Tuan").
      if (w.length < 3) throw new Error(`--assignee="${wanted}" quá ngắn/không hợp lệ sau khi chuẩn hoá ("${w}")`);
      return actual.includes(w);
    });
  }

  const source = new BacklogClient(credentials(config, profile.source.space));
  const dest = new BacklogClient(credentials(config, profile.dest.space));

  const state = readJson<MirrorState>(STATE_FILE, { lastSync: null, issues: {} });

  console.log(`Profile: ${profileName} (mode=mirror)`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no writes)" : "LIVE"}`);
  console.log(`Source (khách): ${source.host} / ${profile.source.projectKey}`);
  console.log(`Dest (nội bộ):  ${dest.host} / ${profile.dest.projectKey}`);
  if (ASSIGNEE_FILTER.length) console.log(`Assignee filter: ${ASSIGNEE_FILTER.join(", ")}`);
  if (DUE_SINCE) console.log(`Due date từ: ${DUE_SINCE}`);
  console.log(`Last sync: ${state.lastSync || "never"}\n`);

  const srcProject = await source.getProject(profile.source.projectKey);
  const destProject = await dest.getProject(profile.dest.projectKey);

  const [destStatuses, destIssueTypes, destPriorities, destUsers, destCustomFields] = await Promise.all([
    dest.getStatuses(destProject.id),
    dest.getIssueTypes(destProject.id),
    dest.getPriorities(),
    dest.getProjectUsers(destProject.id),
    dest.getCustomFields(destProject.id),
  ]);
  const destStatusByName = byName(destStatuses);
  const destTypeByName = byName(destIssueTypes);
  const destPriorityByName = byName(destPriorities);
  const destUserByName = new Map(destUsers.map((u) => [normalizeName(u.name), u.id]));
  const customFields = resolveCustomFields(profile.dest?.customFields, destCustomFields);
  const warnedRequired = new Set<string>();

  const fallbackTypeId = destIssueTypes[0]?.id;
  const fallbackPriorityId =
    destPriorityByName.get("normal") || destPriorities[2]?.id || destPriorities[0]?.id;

  const { mirrors, scanned } = await discoverExistingMirrors(
    dest, destProject.id, profile.source.projectKey
  );
  const known: Record<string, string> = { ...mirrors, ...state.issues };
  console.log(`Đã quét ${scanned} issue ở đích -> ${Object.keys(mirrors).length} issue đã sync.`);

  // Lấy toàn bộ issue nguồn rồi lọc (không dùng updatedSince: state có thể không khớp thực tế).
  const allIssues = await source.getAllIssues(srcProject.id);
  const skipped = { assignee: 0, noDueDate: 0, tooOld: 0, alreadySynced: 0 };
  const issues = allIssues.filter((issue) => {
    if (!matchesAssigneeFilter(issue)) { skipped.assignee++; return false; }
    if (profile.filter?.requireDueDate !== false && !issue.dueDate) { skipped.noDueDate++; return false; }
    const due = toDateOnly(issue.dueDate);
    if (DUE_SINCE && due !== undefined && due < DUE_SINCE) { skipped.tooOld++; return false; }
    return true;
  });
  console.log(
    `Nguồn: ${allIssues.length} issue -> ${issues.length} đủ điều kiện ` +
    `(bỏ ${skipped.assignee} sai assignee, ${skipped.noDueDate} chưa có due date, ${skipped.tooOld} due trước ${DUE_SINCE}).\n`
  );

  let created = 0, updated = 0, statusChanges = 0;

  for (const issue of issues) {
    const typeId = resolveId(
      issue.issueType?.name, destTypeByName, profile.map?.issueType, fallbackTypeId, "issueType"
    );
    const priorityId = resolveId(
      issue.priority?.name, destPriorityByName, profile.map?.priority, fallbackPriorityId, "priority"
    );

    const fields = {
      // Convention: "<SRC>-4889 <title gốc>" — prefix issue key là cơ sở chống trùng ở trên.
      // Không thêm marker/link vào description — truy vết bằng prefix issueKey ở summary.
      summary: `${issue.issueKey} ${issue.summary}`,
      description: issue.description || "",
      startDate: toDateOnly(issue.startDate),
      dueDate: toDateOnly(issue.dueDate),
    };

    // Assignee khớp theo tên đã chuẩn hoá (sau khi áp map.assignee);
    // không tìm thấy thì để trống (PM tự phân).
    const assigneeId = resolveAssigneeId(issue.assignee?.name, destUserByName, profile.map?.assignee);
    if (issue.assignee && !assigneeId) {
      console.warn(`  ! Không tìm thấy "${issue.assignee.name}" ở ${profile.dest.projectKey} -> để trống assignee`);
    }

    const existingKey = known[issue.issueKey];

    if (!existingKey) {
      const custom = customFieldsFor(customFields, destCustomFields, typeId, warnedRequired);
      const customNote = custom.labels.length ? `  [${custom.labels.join(", ")}]` : "";
      console.log(`+ CREATE  ${issue.issueKey}  ${issue.summary}${customNote}`);
      created++;
      if (!DRY_RUN) {
        const createdIssue = await dest.createIssue({
          projectId: destProject.id,
          issueTypeId: typeId,
          priorityId,
          assigneeId,
          ...fields,
          ...custom.body,
        });
        state.issues[issue.issueKey] = createdIssue.issueKey;
        known[issue.issueKey] = createdIssue.issueKey;
        // Backlog không cho set status khi tạo -> set ngay sau khi tạo.
        const statusId = resolveId(
          issue.status?.name, destStatusByName, profile.map?.status, undefined, "status"
        );
        if (statusId && statusId !== createdIssue.status?.id) {
          await dest.updateIssue(createdIssue.issueKey, { statusId });
          statusChanges++;
        }
      }
    } else if (!ALLOW_UPDATE) {
      // Mặc định: đã có ở đích -> bỏ qua, không ghi đè công việc đã sửa tay bên nội bộ.
      skipped.alreadySynced++;
      state.issues[issue.issueKey] = existingKey;
    } else {
      console.log(`~ UPDATE  ${issue.issueKey} -> ${existingKey}  ${issue.summary}`);
      updated++;
      if (!DRY_RUN) {
        state.issues[issue.issueKey] = existingKey; // ghi lại mirror phát hiện qua summary
        await dest.updateIssue(existingKey, { ...fields, priorityId });
        const statusId = resolveId(
          issue.status?.name, destStatusByName, profile.map?.status, undefined, "status"
        );
        if (statusId) {
          await dest.updateIssue(existingKey, { statusId });
          statusChanges++;
        }
      }
    }
  }

  state.lastSync = new Date().toISOString();
  if (!DRY_RUN) writeJson(STATE_FILE, state);

  console.log(
    `\nDone. Created: ${created}, Updated: ${updated}, ` +
    `Đã có sẵn (bỏ qua): ${skipped.alreadySynced}, Status set: ${statusChanges}.`
  );
  if (!ALLOW_UPDATE && skipped.alreadySynced) {
    console.log("(dùng --update nếu muốn ghi đè issue đã có ở đích)");
  }
  if (DRY_RUN) console.log("(dry-run: state file not modified)");
}
