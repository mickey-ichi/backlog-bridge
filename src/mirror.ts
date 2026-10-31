// "mirror" mode: copy issues from the source project to the destination project, creating new issues at the destination.
// Typically used for customer Backlog -> internal Backlog (planned customer tasks become internal tasks).
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
// Drop the parenthesized part because the suffix usually differs between sides (e.g. customer D3.React vs internal R2.React).
export function normalizeName(name: string | null | undefined): string {
  return (name || "")
    .replace(/\([^)]*\)/g, " ")
    // đ/Đ cannot be decomposed by NFD so it must be replaced by hand, otherwise "Đức" -> "uc".
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

// map.assignee changes the assignee on the internal side (customer assigns A but internally B does it).
// Matching uses normalized names, so config entries need not have the exact parenthesized suffix.
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
    console.warn(`  ! map.assignee "${from}" -> "${to}": destination has no such user -> trying the original name`);
    break;
  }
  return destUserByName.get(key);
}

const KEY_ONLY = /^\s*\[?([A-Z][A-Z0-9_]*-\d+)\]?/;

// Scan the destination project and build a { sourceKey -> destKey } map from the summary prefix.
// This is the main source of de-duplication: the state file may be lost or may never have existed
// (earlier issues were created by hand), in which case relying on state alone would duplicate everything.
async function discoverExistingMirrors(dest: BacklogClient, destProjectId: number, sourceProjectKey: string) {
  const mirrors: Record<string, string> = {};
  const destIssues = await dest.getAllIssues(destProjectId);
  for (const issue of destIssues) {
    const m = issue.summary.match(KEY_ONLY);
    if (m && m[1].startsWith(`${sourceProjectKey}-`)) mirrors[m[1]] = issue.issueKey;
  }
  return { mirrors, scanned: destIssues.length };
}

// Some destination projects require custom fields per issue type (e.g. type Bug needs "Bug Weight" + "Bug Type").
// profile.dest.customFields maps field NAME -> item name (or a raw value for text/number fields).
// Resolved once at the start of the run (dry-run included) so wrong field/item names surface immediately, not only at real creation time.
export function resolveCustomFields(
  defaults: MirrorProfile["dest"]["customFields"],
  destCustomFields: CustomField[],
): ResolvedCustomField[] {
  const resolved: ResolvedCustomField[] = [];
  for (const [fieldName, wanted] of Object.entries(defaults || {})) {
    const field = destCustomFields.find((f) => f.name.trim().toLowerCase() === fieldName.trim().toLowerCase());
    if (!field) {
      console.warn(`  ! Custom field "${fieldName}" not found at destination -> skipped`);
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
      else console.warn(`  ! Custom field "${fieldName}" has no item "${name}" -> skipped`);
    }
    if (!items.length) continue;
    // One value -> scalar; multiple values -> array, the client repeats the customField_<id> key (no "[]").
    const ids = items.map((i) => i.id);
    resolved.push({ ...entry, value: ids.length === 1 ? ids[0] : ids, label: items.map((i) => i.name).join("+") });
  }
  return resolved;
}

const appliesTo = (field: CustomField, issueTypeId: number | undefined) =>
  !field.applicableIssueTypes?.length ||
  (issueTypeId !== undefined && field.applicableIssueTypes.includes(issueTypeId));

// Fields that are declared and apply to the issue type being created; warns (once per type/field pair) about required
// fields of that type the profile has not declared — real creation would fail with Backlog's "... is required".
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
    console.warn(`  ! Required custom field "${f.name}" is not set in dest.customFields -> creating this issue type will fail`);
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
  // By default ONLY new issues are created. To overwrite summary/description/date/status of issues
  // already at the destination, pass --update (destination issues are often edited by hand internally).
  const ALLOW_UPDATE = hasFlag("update");
  const STATE_FILE = profile.state || `state/${profileName}.json`;

  // --assignee=An,Binh  (loose name match, ignoring diacritics and the parenthesized part)
  const ASSIGNEE_FILTER = (argValue("assignee") || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .concat(profile.filter?.assignees || []);
  // --since=YYYY-MM-DD  (only issues with dueDate >= this date)
  const DUE_SINCE = argValue("since");

  function matchesAssigneeFilter(issue: Issue): boolean {
    if (!ASSIGNEE_FILTER.length) return true;
    const actual = normalizeName(issue.assignee?.name);
    if (!actual) return false;
    return ASSIGNEE_FILTER.some((wanted) => {
      const w = normalizeName(wanted);
      // Names too short after normalization match arbitrarily (e.g. "an" matches both "Lan" and "Tuan").
      if (w.length < 3) throw new Error(`--assignee="${wanted}" is too short/invalid after normalization ("${w}")`);
      return actual.includes(w);
    });
  }

  const source = new BacklogClient(credentials(config, profile.source.space));
  const dest = new BacklogClient(credentials(config, profile.dest.space));

  const state = readJson<MirrorState>(STATE_FILE, { lastSync: null, issues: {} });

  console.log(`Profile: ${profileName} (mode=mirror)`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (no writes)" : "LIVE"}`);
  console.log(`Source (customer): ${source.host} / ${profile.source.projectKey}`);
  console.log(`Dest (internal):  ${dest.host} / ${profile.dest.projectKey}`);
  if (ASSIGNEE_FILTER.length) console.log(`Assignee filter: ${ASSIGNEE_FILTER.join(", ")}`);
  if (DUE_SINCE) console.log(`Due date from: ${DUE_SINCE}`);
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
  console.log(`Scanned ${scanned} issues at destination -> ${Object.keys(mirrors).length} already synced.`);

  // Fetch all source issues then filter (not using updatedSince: state may not match reality).
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
    `Source: ${allIssues.length} issues -> ${issues.length} eligible ` +
    `(skipped ${skipped.assignee} wrong assignee, ${skipped.noDueDate} no due date, ${skipped.tooOld} due before ${DUE_SINCE}).\n`
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
      // Convention: "<SRC>-4889 <original title>" — the issue key prefix is the basis for the de-duplication above.
      // No marker/link is added to the description — traceability is via the issueKey prefix in the summary.
      summary: `${issue.issueKey} ${issue.summary}`,
      description: issue.description || "",
      startDate: toDateOnly(issue.startDate),
      dueDate: toDateOnly(issue.dueDate),
    };

    // Assignee is matched by normalized name (after applying map.assignee);
    // if not found, leave unassigned (the PM assigns it).
    const assigneeId = resolveAssigneeId(issue.assignee?.name, destUserByName, profile.map?.assignee);
    if (issue.assignee && !assigneeId) {
      console.warn(`  ! "${issue.assignee.name}" not found in ${profile.dest.projectKey} -> leaving unassigned`);
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
        // Backlog doesn't allow setting status on create -> set it right after creating.
        const statusId = resolveId(
          issue.status?.name, destStatusByName, profile.map?.status, undefined, "status"
        );
        if (statusId && statusId !== createdIssue.status?.id) {
          await dest.updateIssue(createdIssue.issueKey, { statusId });
          statusChanges++;
        }
      }
    } else if (!ALLOW_UPDATE) {
      // Default: already at destination -> skip, don't overwrite work edited by hand internally.
      skipped.alreadySynced++;
      state.issues[issue.issueKey] = existingKey;
    } else {
      console.log(`~ UPDATE  ${issue.issueKey} -> ${existingKey}  ${issue.summary}`);
      updated++;
      if (!DRY_RUN) {
        state.issues[issue.issueKey] = existingKey; // record the mirror discovered via summary
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
    `Already existing (skipped): ${skipped.alreadySynced}, Status set: ${statusChanges}.`
  );
  if (!ALLOW_UPDATE && skipped.alreadySynced) {
    console.log("(use --update to overwrite issues already at the destination)");
  }
  if (DRY_RUN) console.log("(dry-run: state file not modified)");
}
