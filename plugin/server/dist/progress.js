// "progress" mode: push PROGRESS from the internal project onto existing issues in the customer project.
// NEVER creates new issues on the customer side.
//
// The two sides split tasks along different axes:
//   - Internal: 1 Epic numbered [NN] (milestone Phase 1) containing [FE] [BE] [Infra] [Integrate API] [QA].
//   - Customer: WBS "1.2.3" with 3 fixed leaves by last segment — .3 実装 / .4 単体テスト / .5 受入確認.
//             API units are in sections 1-2, screen units in section 3.
//
// Agreed rules:
//   [BE]/[Infra]/[Integrate API] -> rollup of API units    (group "api")
//   [FE]                         -> rollup of screen units (group "screen")
//   [QA]                         -> counted in EVERY group, never written to the customer's test leaf
//   Write to the 実装 leaf; when rollup = done, also write the 受入確認 leaf (Resolved, not Closed).
//   The 単体テスト leaf is never touched.
import { BacklogClient } from "./backlog.js";
import { credentials, readJson, writeJson, resolvePath, hasFlag, argValue } from "./config.js";
import { normalizeName } from "./mirror.js";
const groupUnits = (pair, group) => {
    const v = pair[group];
    return Array.isArray(v) ? v : [];
};
const STATE_LABEL = {
    not_started: "not started",
    in_progress: "in progress",
    pending: "paused",
    done: "done",
};
const ROLE_BY_SEGMENT = { 3: "impl", 4: "unitTest", 5: "acceptance" };
function toDateOnly(v) { return v ? String(v).slice(0, 10) : null; }
function minDate(a, b) { return !a ? b : !b ? a : (a < b ? a : b); }
function maxDate(a, b) { return !a ? b : !b ? a : (a > b ? a : b); }
function summaryPrefix(summary) {
    const m = String(summary).match(/^\s*\[([^\]]+)\]/);
    return m ? m[1].trim() : "";
}
function collectDescendants(issue, childrenByParent, out = []) {
    for (const child of childrenByParent.get(issue.id) || []) {
        out.push(child);
        collectDescendants(child, childrenByParent, out);
    }
    return out;
}
// State + % of a group of tasks, derived from each task's status.
// % is weighted by estimatedHours (a task without an estimate counts as 1 hour).
export function rollup(items, rules) {
    const done = new Set(rules.doneStatuses || []);
    const active = new Set(rules.activeStatuses || []);
    const pending = new Set(rules.pendingStatuses || []);
    const ignore = new Set(rules.ignoreStatuses || []);
    const counted = items.filter((i) => !ignore.has(i.status?.name ?? ""));
    let weightTotal = 0, weightDone = 0;
    const counts = { done: 0, active: 0, pending: 0, other: 0 };
    let start = null, due = null;
    for (const it of counted) {
        const w = Number(it.estimatedHours) > 0 ? Number(it.estimatedHours) : 1;
        weightTotal += w;
        const name = it.status?.name ?? "";
        if (done.has(name)) {
            counts.done++;
            weightDone += w;
        }
        else if (active.has(name))
            counts.active++;
        else if (pending.has(name))
            counts.pending++;
        else
            counts.other++;
        start = minDate(start, toDateOnly(it.startDate));
        due = maxDate(due, toDateOnly(it.dueDate));
    }
    let state;
    if (!counted.length)
        state = "not_started";
    else if (counts.done === counted.length)
        state = "done";
    else if (counts.active > 0 || counts.done > 0)
        state = "in_progress";
    else if (counts.pending > 0 && counts.pending + counts.done === counted.length)
        state = "pending";
    else
        state = "not_started";
    return {
        state,
        percent: weightTotal ? Math.round((weightDone / weightTotal) * 100) : 0,
        total: counted.length,
        counts, start, due,
    };
}
// Group customer-side issues into WBS units: "1.2.3" -> { leaves: {impl, unitTest, acceptance} }
export function buildUnits(destIssues) {
    const units = new Map();
    for (const issue of destIssues) {
        const m = issue.summary.match(/^\s*(\d+(?:\.\d+)+)\s*(.*)$/);
        if (!m)
            continue;
        const segments = m[1].split(".");
        // 4 levels = leaf of a 3-level unit; 3 levels = standalone checkpoint (section 4.x).
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
        const unit = units.get(number);
        unit.all.push(issue);
        if (role && !unit.leaves[role])
            unit.leaves[role] = issue;
    }
    return units;
}
export async function run({ config, profile, profileName }) {
    // Writing to the customer's Backlog is externally visible -> preview only by default; --live is required to write.
    const LIVE = hasFlag("live");
    const LIST_UNITS = hasFlag("units");
    const WRITE_COMMENT = hasFlag("comment") || profile.dest.write?.comment === true;
    const WRITE_DATES = argValue("dates") || profile.dest.write?.dates || "none";
    const ALLOW_REGRESS = hasFlag("allow-regress") || profile.dest.write?.allowRegress === true;
    const ONLY = (argValue("only") || "").split(",").map((s) => s.trim()).filter(Boolean);
    // Focus: only write to leaves the CUSTOMER has assigned to this person, and report what they assigned
    // that is not paired internally. --mine = the owner of the API key in use.
    const FOCUS_ARG = argValue("assignee") || (hasFlag("mine") ? "@me" : profile.dest.focusAssignee);
    const src = new BacklogClient(credentials(config, profile.source.space));
    const dst = new BacklogClient(credentials(config, profile.dest.space));
    const STATE_FILE = profile.state || `state/${profileName}.json`;
    const state = readJson(STATE_FILE, { lastSync: null, issues: {} });
    let focusName = FOCUS_ARG;
    if (FOCUS_ARG === "@me")
        focusName = (await dst.getMyself()).name;
    const focusKey = focusName ? normalizeName(focusName) : null;
    if (focusKey && focusKey.length < 3) {
        throw new Error(`--assignee="${focusName}" is too short/invalid after normalization ("${focusKey}")`);
    }
    const matchesFocus = (issue) => !focusKey || normalizeName(issue?.assignee?.name).includes(focusKey);
    console.log(`Profile: ${profileName} (mode=progress)`);
    console.log(`Mode: ${LIVE ? "LIVE — WRITING TO CUSTOMER BACKLOG" : "DRY-RUN (nothing is written)"}`);
    console.log(`Source (internal): ${src.host} / ${profile.source.projectKey}`);
    console.log(`Dest (customer):   ${dst.host} / ${profile.dest.projectKey}`);
    if (focusName)
        console.log(`Focus: only write leaves the customer assigned to "${focusName}"`);
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
        console.log(`${units.size} customer-side WBS units (use these to fill in pairFile):\n`);
        const sorted = [...units.values()].sort((a, b) => cmpWbs(a.number, b.number));
        for (const u of sorted) {
            const leaves = ["impl", "unitTest", "acceptance"]
                .map((r) => (u.leaves[r] ? `${r}=${u.leaves[r].issueKey}/${u.leaves[r].status?.name}` : null))
                .filter(Boolean).join("  ");
            console.log(`${u.number.padEnd(8)} ${(u.tag || "-").padEnd(14)} ${u.title.slice(0, 34).padEnd(36)} ${leaves}`);
        }
        return;
    }
    // 1. Internal-side features.
    // A feature's key = the [NN] number if the epic is numbered, otherwise = the epic's issueKey
    // (e.g. an unnumbered infrastructure epic that still maps to a customer unit).
    const featureCfg = profile.source.feature || {};
    const epicPattern = new RegExp(featureCfg.epicPattern || "^\\s*\\[Epic\\]");
    const numberPattern = new RegExp(featureCfg.numberPattern || featureCfg.summaryPattern || "\\[(\\d+)\\]");
    const wantMilestone = featureCfg.milestone;
    const childrenByParent = new Map();
    for (const i of srcIssues) {
        if (!i.parentIssueId)
            continue;
        if (!childrenByParent.has(i.parentIssueId))
            childrenByParent.set(i.parentIssueId, []);
        childrenByParent.get(i.parentIssueId).push(i);
    }
    const features = new Map();
    for (const issue of srcIssues) {
        if (!epicPattern.test(issue.summary))
            continue;
        // An epic with the same number but a different milestone is an old plan (already Closed) -> exclude it,
        // otherwise the feature's progress would be counted as done.
        if (wantMilestone && !(issue.milestone || []).some((v) => v.name === wantMilestone))
            continue;
        const m = issue.summary.match(numberPattern);
        const key = m ? m[1].padStart(2, "0") : issue.issueKey;
        if (!features.has(key))
            features.set(key, { number: key, numbered: Boolean(m), epics: [], children: [] });
        const f = features.get(key);
        f.epics.push(issue);
        f.children.push(...collectDescendants(issue, childrenByParent));
    }
    const featureList = [...features.values()].sort((a, b) => {
        if (a.numbered !== b.numbered)
            return a.numbered ? -1 : 1;
        return a.number.localeCompare(b.number, undefined, { numeric: true });
    });
    console.log(`Internal: ${srcIssues.length} issue -> ${featureList.length} epic` +
        `${wantMilestone ? ` (milestone "${wantMilestone}")` : ""} ` +
        `(${featureList.filter((f) => f.numbered).length} numbered, ${featureList.filter((f) => !f.numbered).length} unnumbered), ` +
        `${featureList.reduce((n, f) => n + f.children.length, 0)} child tasks.`);
    console.log(`Customer: ${dstIssues.length} issue -> ${units.size} WBS units.\n`);
    // 2. Pairing + rollup by group.
    const groups = profile.source.childGroups || {};
    const alwaysCount = new Set(profile.source.alwaysCount || []);
    const rules = profile.source.rollup || {};
    const pairFile = profile.dest.match?.pairFile || `state/pairs-${profileName}.json`;
    const pairs = readJson(pairFile, null);
    if (!pairs)
        throw new Error(`Cannot read pairFile ${resolvePath(pairFile)} — run --units to get the unit list, then pair them.`);
    const statusByName = new Map(dstStatuses.map((s) => [s.name, s]));
    const statusMap = profile.dest.write?.status || {};
    const neverTouch = new Set(profile.dest.write?.neverTouchStatuses || []);
    const targetRoles = profile.dest.write?.targets || ["impl"];
    const acceptanceOnlyWhenDone = profile.dest.write?.acceptanceOnlyWhenDone !== false;
    // Aggregate per customer unit: several internal features can point to the same unit
    // (e.g. 3.2.11 利用状況・分析 receives both [45] and [46]) -> accumulate the tasks first, then compute
    // the rollup once; writing them one by one would let a later feature overwrite the earlier one's progress.
    const perUnit = new Map();
    const unmapped = [];
    const noWork = [];
    for (const f of featureList) {
        if (ONLY.length && !ONLY.includes(f.number))
            continue;
        const pair = pairs[f.number];
        const epicTitle = f.epics[0].summary.replace(/^\s*\[Epic\]\s*\[\d+\]\s*/, "");
        if (!pair || !Object.keys(groups).some((g) => groupUnits(pair, g).length)) {
            unmapped.push({ f, epicTitle, note: pair?.note });
            continue;
        }
        for (const [groupName, prefixes] of Object.entries(groups)) {
            const unitNumbers = groupUnits(pair, groupName);
            if (!unitNumbers.length)
                continue;
            const prefixSet = new Set(prefixes);
            // [QA] (alwaysCount) counts in every group, but a group only counts as having work if it has its own tasks.
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
                    console.warn(`  ! [${f.number}] ${groupName}: unit "${unitNumber}" not found on the customer side`);
                    continue;
                }
                if (!perUnit.has(unitNumber))
                    perUnit.set(unitNumber, { unit, items: [], features: new Map() });
                const entry = perUnit.get(unitNumber);
                const seen = new Set(entry.items.map((i) => i.id));
                for (const it of items)
                    if (!seen.has(it.id))
                        entry.items.push(it);
                entry.features.set(f.number, { f, epicTitle, groupName });
            }
        }
    }
    const writes = [];
    let outOfFocus = 0;
    for (const [unitNumber, entry] of [...perUnit.entries()].sort((a, b) => cmpWbs(a[0], b[0]))) {
        const r = rollup(entry.items, rules);
        for (const role of targetRoles) {
            if (role === "acceptance" && acceptanceOnlyWhenDone && r.state !== "done")
                continue;
            const destIssue = entry.unit.leaves[role];
            if (!destIssue)
                continue;
            if (!matchesFocus(destIssue)) {
                outOfFocus++;
                continue;
            }
            writes.push(planWrite({
                entry, unit: entry.unit, role, r, destIssue,
                statusMap, statusByName, neverTouch, ALLOW_REGRESS, WRITE_DATES, dstStatuses,
            }));
        }
    }
    // 3. Print the plan.
    console.log("Plan for writes to the customer (rollup per customer unit)");
    console.log("-".repeat(112));
    let willWrite = 0;
    const byUnit = new Map();
    for (const w of writes) {
        if (!byUnit.has(w.unit.number))
            byUnit.set(w.unit.number, []);
        byUnit.get(w.unit.number).push(w);
    }
    for (const [unitNumber, list] of [...byUnit.entries()].sort((a, b) => cmpWbs(a[0], b[0]))) {
        const w0 = list[0];
        const from = [...w0.entry.features.values()]
            .map((x) => `[${x.f.number}]${x.groupName === "screen" ? " FE" : " BE"}`).join(" ");
        console.log(`\n${unitNumber}  ${(w0.unit.tag || "-")}  ${w0.unit.title.slice(0, 40)}   ← ${from}`);
        console.log(`   ${w0.detail}`);
        for (const w of list) {
            console.log(`   ${w.role.padEnd(11)}${(STATE_LABEL[w.r.state] + " " + w.r.percent + "%").padEnd(17)}` +
                `${w.destIssue.issueKey.padEnd(14)}${w.note}`);
            if (Object.keys(w.fields).length)
                willWrite++;
        }
    }
    if (focusKey) {
        // Customer units confirmed as out of our scope -> no longer reported as gaps.
        const outOfScope = new Set(pairs._outOfScope || []);
        const unitNotes = pairs._notes || {};
        const mapped = new Set(perUnit.keys());
        const gaps = [];
        for (const unit of units.values()) {
            const mine = unit.all.filter(matchesFocus);
            if (!mine.length)
                continue;
            if (mapped.has(unit.number) || outOfScope.has(unit.number))
                continue;
            gaps.push({ unit, mine, note: unitNotes[unit.number] });
        }
        gaps.sort((a, b) => cmpWbs(a.unit.number, b.unit.number));
        console.log(`\nFOCUS — assigned by the customer to "${focusName}" but not paired internally (${gaps.length} units):`);
        for (const g of gaps) {
            console.log(`  ${g.unit.number.padEnd(8)}${(g.unit.tag || "-").padEnd(14)}${g.unit.title.slice(0, 34).padEnd(36)}` +
                `${g.mine.map((i) => `${i.issueKey}/${i.status?.name}`).join(" ")}`);
            if (g.note)
                console.log(`  ${" ".repeat(8)}-> ${g.note}`);
        }
        if (outOfScope.size)
            console.log(`  (skipped ${outOfScope.size} units confirmed out of scope: ${[...outOfScope].join(", ")})`);
        if (outOfFocus)
            console.log(`  (${outOfFocus} paired leaves not assigned to "${focusName}" by the customer -> skipped)`);
    }
    if (noWork.length) {
        console.log(`\nGroups with no internal tasks yet -> skipped (${noWork.length}):`);
        for (const n of noWork) {
            console.log(`  [${n.f.number}] ${n.groupName} -> ${n.unitNumbers.join(", ")}  (${n.epicTitle.slice(0, 60)})`);
        }
    }
    const unmappedNumbered = unmapped.filter((u) => u.f.numbered);
    const unmappedOther = unmapped.filter((u) => !u.f.numbered);
    if (unmappedNumbered.length) {
        console.log(`\nNumbered epics not paired -> NOTHING written (${unmappedNumbered.length}):`);
        for (const u of unmappedNumbered) {
            console.log(`  [${u.f.number}] ${u.epicTitle.slice(0, 70)}${u.note ? `\n         note: ${u.note}` : ""}`);
        }
    }
    if (unmappedOther.length) {
        console.log(`\nUnnumbered epics, not paired (${unmappedOther.length}):`);
        for (const u of unmappedOther) {
            console.log(`  ${u.f.number} ${u.epicTitle.slice(0, 66)}${u.note ? `\n         note: ${u.note}` : ""}`);
        }
    }
    if (unmapped.length)
        console.log(`  -> fill in ${pairFile} (run --units to see the customer unit list).`);
    // 4. Write.
    let wrote = 0, comments = 0;
    for (const w of writes) {
        const hasFieldWrite = Object.keys(w.fields).length > 0;
        const prev = state.issues[w.destIssue.issueKey];
        const changed = !prev || prev.state !== w.r.state || prev.percent !== w.r.percent;
        const needComment = WRITE_COMMENT && w.role === "impl" && changed;
        if (!hasFieldWrite && !needComment)
            continue;
        if (!LIVE)
            continue;
        if (hasFieldWrite) {
            await dst.updateIssue(w.destIssue.issueKey, w.fields);
            wrote++;
        }
        if (needComment) {
            const marker = profile.dest.write?.commentMarker || "<!-- backlog-bridge-progress -->";
            const content = renderComment(marker, w, profile.dest.write?.orgName);
            // Update the existing progress comment in place so the customer's board isn't spammed.
            const existing = (await dst.getComments(w.destIssue.issueKey))
                .find((c) => typeof c.content === "string" && c.content.includes(marker));
            if (existing)
                await dst.updateComment(w.destIssue.issueKey, existing.id, content);
            else
                await dst.addComment(w.destIssue.issueKey, content);
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
    console.log(`\nDone. Customer units paired: ${perUnit.size}, features not paired: ${unmapped.length}, ` +
        `customer leaves to write: ${willWrite}, written: ${wrote}, comments: ${comments}.`);
    if (!LIVE)
        console.log("(dry-run: nothing written to the customer's Backlog. Add --live to actually write.)");
}
// Decide what to write to one customer leaf + safety guards.
function planWrite(ctx) {
    const { r, destIssue, statusMap, statusByName, neverTouch, ALLOW_REGRESS, WRITE_DATES, dstStatuses } = ctx;
    const fields = {};
    const wantName = statusMap[r.state];
    const curName = destIssue.status?.name;
    let note;
    if (!wantName) {
        note = `unchanged (${curName})`;
    }
    else if (wantName === curName) {
        note = `already (${curName})`;
    }
    else if (curName && neverTouch.has(curName)) {
        note = `SKIP — customer is at "${curName}"`;
    }
    else if (!ALLOW_REGRESS && (statusByName.get(wantName)?.displayOrder ?? 0) < (destIssue.status?.displayOrder ?? 0)) {
        note = `SKIP moving status backwards "${curName}" -> "${wantName}"`;
    }
    else if (!statusByName.has(wantName)) {
        note = `!! customer has no status "${wantName}" (available: ${dstStatuses.map((s) => s.name).join(", ")})`;
    }
    else {
        fields.statusId = statusByName.get(wantName).id;
        note = `"${curName}" -> "${wantName}"`;
    }
    if (WRITE_DATES === "children") {
        if (r.start)
            fields.startDate = r.start;
        if (r.due)
            fields.dueDate = r.due;
    }
    const detail = `children: ${r.total} (done ${r.counts.done}, in progress ${r.counts.active}, paused ${r.counts.pending}, not started ${r.counts.other})` +
        `${r.start || r.due ? `  internal schedule ${r.start || "?"} → ${r.due || "?"}` : ""}`;
    return { ...ctx, fields, note, detail };
}
// Progress comment for the customer — in Japanese, with a hidden marker so the next run updates it in place.
// orgName (dest.write.orgName) is our side's name shown in the footnote, e.g. "Acme" -> "Acme 側の内部タスク".
function renderComment(marker, { r, unit }, orgName) {
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
function jpState(state) {
    return { not_started: "未着手", in_progress: "進行中", pending: "保留", done: "完了" }[state] || state;
}
function cmpWbs(a, b) {
    const A = a.split(".").map(Number), B = b.split(".").map(Number);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
        if ((A[i] || 0) !== (B[i] || 0))
            return (A[i] || 0) - (B[i] || 0);
    }
    return 0;
}
