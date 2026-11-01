#!/usr/bin/env node
// bl — CLI to read/write MANY Backlog spaces at once; shares .env + config.json with sync.
// Acts as a "bridge" for agents (Claude Code / Codex / Cursor / workspace): the official Backlog MCP
// can attach only 1 space, while this CLI can call every configured space.
//
//   bl setup [--uninstall] [--force]                # install global bl command + skills for Claude/Codex/Cursor
//   bl home [--init]                                # directory holding .env/config/state; --init copies from repo
//   bl spaces [--check]                             # list spaces, --check makes a test API call
//   bl projects <space>
//   bl issue <ref>                                  # ref = URL | <space> <KEY> | <KEY>
//   bl comments <ref> [--count=20]
//   bl search <space> <PROJECT> [--keyword=..] [--assignee=me|name] [--open] [--count=50]
//   bl activities <space> [--project=KEY] [--count=20]
//   bl comment <ref> (--text=..|--file=path) [--yes]
//   bl update <ref> field=value ... [--yes]         # status=<name> assignee=<name> dueDate=.. summary=..
//   bl api <space> <METHOD> <path> [k=v ...] [--yes]
//   bl sync [--list | --profile=<name> ...]         # sync by profile (src/sync.ts)
//
// Not installed globally? Call directly: node src/bl.ts <command>  /  node src/sync.ts.
// Every WRITE command only prints the planned request by default; add --yes to actually send it.
// --json: print raw JSON instead of the condensed form.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, DEFAULT_HOME, LEGACY_HOME, setting, reviewPrefs, homeDir, configPath, envFiles, looseEnvFiles, loadEnv, loadConfig, allSpaces, hostOf, hasFlag, argValue, } from "./config.js";
import { BacklogClient } from "./backlog.js";
import { checkKey, safeCommentFile } from "./guards.js";
loadEnv();
const config = loadConfig();
const SPACES = allSpaces(config);
const JSON_OUT = hasFlag("json");
const YES = hasFlag("yes");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
function client(name) {
    const s = name ? SPACES[name] : undefined;
    if (!s)
        throw new Error(`No space "${name}". Available: ${Object.keys(SPACES).join(", ")}`);
    if (s.missing || !s.space || !s.apiKey) {
        throw new Error(`Space "${name}" is missing ${s.env}_SPACE / ${s.env}_API_KEY in .env`);
    }
    return new BacklogClient({ space: s.space, apiKey: s.apiKey });
}
// Project key -> space, inferred from the profiles in config.json.
function spaceOfProject(projectKey) {
    const hits = new Set();
    for (const p of Object.values(config.profiles || {})) {
        for (const side of [p.source, p.dest]) {
            if (side?.projectKey === projectKey)
                hits.add(side.space);
        }
    }
    return hits.size === 1 ? [...hits][0] : undefined;
}
// Accepts: Backlog URL | "<space> <KEY>" | "<KEY>" (space inferred from profiles). Returns { space, key, rest }.
function resolveRef(args) {
    const [a, b] = args;
    if (!a)
        throw new Error("Missing issue: pass a URL, <space> <KEY> or <KEY>");
    if (/^https?:\/\//.test(a)) {
        const url = new URL(a);
        const space = Object.keys(SPACES).find((n) => {
            const host = SPACES[n].space;
            return host && hostOf(host) === url.host;
        });
        if (!space)
            throw new Error(`No API key yet for ${url.host}. See the backlog-connect skill.`);
        const key = url.pathname.match(/\/view\/([A-Z0-9_]+-\d+)/)?.[1];
        if (!key)
            throw new Error(`URL contains no issue key: ${a}`);
        return { space, key: checkKey(key), rest: args.slice(1) };
    }
    if (SPACES[a]) {
        if (!b)
            throw new Error(`Missing issue key after space "${a}"`);
        return { space: a, key: checkKey(b), rest: args.slice(2) };
    }
    checkKey(a);
    const projectKey = a.replace(/-\d+$/, "");
    const space = spaceOfProject(projectKey);
    if (!space) {
        throw new Error(`Cannot infer the space of ${a}. Specify it: <space> ${a} (spaces: ${Object.keys(SPACES).join(", ")})`);
    }
    return { space, key: a, rest: args.slice(1) };
}
const short = (d) => (d ? d.slice(0, 10) : "-");
function issueLine(i) {
    return `${i.issueKey}  [${i.status?.name}]  ${i.assignee?.name || "(unassigned)"}  due:${short(i.dueDate)}  ${i.summary}`;
}
function print(data, fmt) {
    if (JSON_OUT || !fmt)
        console.log(JSON.stringify(data, null, 2));
    else
        console.log(fmt(data));
}
// Write: without --yes, only describe the request.
async function write(space, method, path, body) {
    if (!YES) {
        console.log(`[DRY] ${space}: ${method} ${path}`);
        console.log(JSON.stringify(body, null, 2));
        console.log("→ add --yes to actually send.");
        return null;
    }
    return client(space).request(method, path, { body });
}
// k=v ... -> object; repeated keys become an array.
function kv(args) {
    const out = {};
    for (const a of args) {
        const i = a.indexOf("=");
        if (i < 1)
            throw new Error(`Argument must be key=value: ${a}`);
        const [k, v] = [a.slice(0, i), a.slice(i + 1)];
        out[k] = k in out ? [].concat(out[k], v) : v;
    }
    return out;
}
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
async function findUser(bl, projectKey, name) {
    if (name === "me")
        return bl.getMyself();
    const users = await bl.getProjectUsers(projectKey);
    const hits = users.filter((u) => norm(u.name).includes(norm(name)) || u.userId === name);
    if (hits.length !== 1) {
        throw new Error(`assignee "${name}" matches ${hits.length} people in ${projectKey}: ${hits.map((u) => u.name).join(", ") || "-"}`);
    }
    return hits[0];
}
// --- bl setup: global install ------------------------------------------------------------
// Canonical skills live in ~/.agents/skills (Agent Skills standard: read by Codex + Cursor), then are
// symlinked into ~/.claude/skills (Claude Code) and ~/.codex/skills (older Codex) if those directories exist.
// Only touches symlinks pointing into this repo; any other file/directory with the same name is skipped (unless --force).
const USER_HOME = os.homedir();
const SKILL_ROOTS = [".agents/skills", ".claude/skills", ".codex/skills"].map((d) => path.join(USER_HOME, d));
const BIN_DIR = path.join(USER_HOME, ".local", "bin");
function linkTarget(p) {
    try {
        return fs.lstatSync(p).isSymbolicLink() ? path.resolve(path.dirname(p), fs.readlinkSync(p)) : undefined;
    }
    catch {
        return undefined;
    }
}
const exists = (p) => { try {
    fs.lstatSync(p);
    return true;
}
catch {
    return false;
} };
// Symlink link -> target. Returns a description of what was done.
function placeLink(link, target, force) {
    const current = linkTarget(link);
    if (current === target)
        return `= ${link}`;
    if (exists(link)) {
        const ours = current !== undefined && current.startsWith(ROOT + path.sep);
        if (!ours && !force)
            return `! skipped ${link} (something else with that name exists — use --force to replace)`;
        fs.rmSync(link, { recursive: !current, force: true });
    }
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link);
    return `+ ${link} -> ${target}`;
}
function setupInstall(force) {
    const skillsSrc = path.join(ROOT, ".agents", "skills");
    const names = fs.readdirSync(skillsSrc).filter((n) => fs.existsSync(path.join(skillsSrc, n, "SKILL.md")));
    console.log("Skill:");
    for (const name of names) {
        const canonical = path.join(SKILL_ROOTS[0], name);
        const result = placeLink(canonical, path.join(skillsSrc, name), force);
        console.log("  " + result);
        if (result.startsWith("!"))
            continue; // canonical skill is not ours -> don't point Claude/Codex at it
        for (const root of SKILL_ROOTS.slice(1)) {
            if (fs.existsSync(path.dirname(root)))
                console.log("  " + placeLink(path.join(root, name), canonical, force));
        }
    }
    // Installed via npm: npm already put bl on PATH; installed from a git clone: symlink into ~/.local/bin.
    if (!ROOT.includes(`${path.sep}node_modules${path.sep}`)) {
        console.log("Command:");
        console.log("  " + placeLink(path.join(BIN_DIR, "bl"), path.join(ROOT, "bin", "bl"), force));
        const onPath = (process.env.PATH || "").split(path.delimiter).includes(BIN_DIR);
        if (!onPath)
            console.log(`  ! ${BIN_DIR} is not on PATH — add: export PATH="$HOME/.local/bin:$PATH"`);
    }
    // Home directory + sample .env (chmod 600). Never overwrites an existing .env.
    const home = setting("HOME") ? path.resolve(setting("HOME")) : DEFAULT_HOME;
    fs.mkdirSync(path.join(home, "state"), { recursive: true, mode: 0o700 });
    const envFile = path.join(home, ".env");
    console.log("Data:");
    if (exists(envFile)) {
        console.log(`  = ${envFile}`);
    }
    else {
        fs.copyFileSync(path.join(ROOT, ".env.example"), envFile);
        fs.chmodSync(envFile, 0o600);
        console.log(`  + ${envFile} (sample — fill in <PREFIX>_SPACE / <PREFIX>_API_KEY for each space)`);
    }
    if (!exists(path.join(home, "config.json"))) {
        console.log(`  (no config.json yet — only needed for bl sync; sample: ${path.join(ROOT, "config.example.json")})`);
    }
    console.log("\nDone. Verify with: bl spaces --check");
}
function setupUninstall() {
    const links = [path.join(BIN_DIR, "bl")];
    for (const root of SKILL_ROOTS) {
        if (!fs.existsSync(root))
            continue;
        for (const name of fs.readdirSync(root))
            links.push(path.join(root, name));
    }
    // Remove symlinks pointing into this repo, and symlinks in ~/.claude|~/.codex pointing to its canonical skills in ~/.agents/skills.
    const ourCanonical = new Set();
    for (const link of links) {
        const t = linkTarget(link);
        if (t && t.startsWith(ROOT + path.sep)) {
            ourCanonical.add(link);
        }
    }
    for (const link of links) {
        const t = linkTarget(link);
        if (t && (t.startsWith(ROOT + path.sep) || ourCanonical.has(t))) {
            fs.unlinkSync(link);
            console.log(`- ${link}`);
        }
    }
    console.log(`Kept data in ${homeDir()} (.env, config.json, state/).`);
}
function warnLooseEnv() {
    for (const p of looseEnvFiles())
        console.warn(`! ${p} is readable by others — run: chmod 600 "${p}"`);
}
const COMMANDS = {
    async setup() {
        if (hasFlag("uninstall"))
            setupUninstall();
        else
            setupInstall(hasFlag("force"));
    },
    // --init: copy .env, config.json, state/*.json from the repo to home (never overwrites existing files).
    async home() {
        if (hasFlag("init")) {
            const configured = setting("HOME");
            const target = configured ? path.resolve(configured) : DEFAULT_HOME;
            if (target === ROOT)
                throw new Error("BACKLOG_BRIDGE_HOME points at the repo itself");
            fs.mkdirSync(path.join(target, "state"), { recursive: true });
            const files = [".env", "config.json"].concat(fs.existsSync(path.join(ROOT, "state"))
                ? fs.readdirSync(path.join(ROOT, "state")).filter((f) => f.endsWith(".json")).map((f) => `state/${f}`)
                : []);
            for (const f of files) {
                const from = path.join(ROOT, f);
                const to = path.join(target, f);
                if (!fs.existsSync(from))
                    continue;
                if (fs.existsSync(to)) {
                    console.log(`skipped ${f} (already in home)`);
                    continue;
                }
                fs.copyFileSync(from, to);
                if (f === ".env")
                    fs.chmodSync(to, 0o600);
                console.log(`copied ${f}`);
            }
            console.log(`\nDone. Double-check, then you can delete .env / state/*.json in the repo.`);
        }
        const cfg = configPath();
        const hint = homeDir() === ROOT ? "  (repo root — run 'home --init' to move it out)"
            : homeDir() === LEGACY_HOME ? `  (old name — rename with: mv "${LEGACY_HOME}" "${DEFAULT_HOME}")` : "";
        console.log(`home   : ${homeDir()}${hint}`);
        console.log(`config : ${cfg}${fs.existsSync(cfg) ? "" : "  (missing — only spaces declared via env are usable)"}`);
        console.log(`.env   : ${envFiles().join(", ") || "(none — using environment variables)"}`);
        const review = reviewPrefs();
        const reviewText = review.mode === "bilingual"
            ? `bilingual — review a bilingual ${review.customerLang} + ${review.lang} draft, send only ${review.customerLang}`
            : review.mode === "translate"
                ? `translate — review in ${review.lang}, then translate to ${review.customerLang} and send`
                : review.invalid
                    ? `! BACKLOG_BRIDGE_REVIEW="${review.invalid}" is invalid (bilingual | translate)`
                    : "(not set — add BACKLOG_BRIDGE_REVIEW=bilingual|translate to .env, see .env.example)";
        console.log(`review : ${reviewText}`);
        warnLooseEnv();
    },
    async spaces() {
        warnLooseEnv();
        if (!Object.keys(SPACES).length) {
            console.log(`No spaces yet — add <PREFIX>_SPACE / <PREFIX>_API_KEY pairs to ${envFiles()[0] || path.join(homeDir(), ".env")}`);
            return;
        }
        for (const [name, s] of Object.entries(SPACES)) {
            let line = `${name.padEnd(12)} ${s.missing || !s.space ? "(missing key)" : hostOf(s.space)}  env:${s.env}_*  [${s.from}]`;
            if (hasFlag("check") && !s.missing) {
                try {
                    const me = await client(name).getMyself();
                    line += `  OK as ${me.name}`;
                }
                catch (e) {
                    line += `  ERROR ${e.message}`;
                }
            }
            console.log(line);
        }
    },
    async projects([space]) {
        const list = await client(space).request("GET", "/projects", { params: { archived: false } });
        print(list, (l) => l.map((p) => `${p.projectKey.padEnd(14)} ${p.name}`).join("\n"));
    },
    async issue(args) {
        const { space, key } = resolveRef(args);
        const bl = client(space);
        const i = await bl.getIssue(key);
        print(i, (x) => [
            `${space}  https://${bl.host}/view/${x.issueKey}`,
            issueLine(x),
            `type:${x.issueType?.name}  priority:${x.priority?.name}  start:${short(x.startDate)}  updated:${short(x.updated)}`,
            "",
            x.description || "(no description)",
        ].join("\n"));
    },
    async comments(args) {
        const { space, key } = resolveRef(args);
        const list = await client(space).getComments(key, { count: Number(argValue("count") || 20) });
        print(list, (l) => l.filter((c) => c.content).reverse()
            .map((c) => `--- #${c.id} ${c.createdUser?.name} ${c.created}\n${c.content}`).join("\n"));
    },
    async search([space, projectKey]) {
        if (!projectKey)
            throw new Error("search <space> <PROJECT>");
        const bl = client(space);
        const project = await bl.getProject(projectKey);
        const params = {
            projectId: [project.id],
            keyword: argValue("keyword"),
            count: Math.min(Number(argValue("count") || 50), 100),
            sort: "updated",
        };
        const assignee = argValue("assignee");
        if (assignee)
            params.assigneeId = [(await findUser(bl, projectKey, assignee)).id];
        if (hasFlag("open")) {
            const statuses = await bl.getStatuses(projectKey);
            params.statusId = statuses.filter((s) => s.name !== "Closed").map((s) => s.id);
        }
        const list = await bl.request("GET", "/issues", { params });
        print(list, (l) => l.map(issueLine).join("\n") || "(no issues)");
    },
    async activities([space]) {
        const bl = client(space);
        const params = { count: Number(argValue("count") || 20) };
        const path = argValue("project")
            ? `/projects/${argValue("project")}/activities`
            : "/space/activities";
        const list = await bl.request("GET", path, { params });
        print(list, (l) => l.map((a) => {
            const c = a.content || {};
            const key = c.key_id ? `${a.project?.projectKey}-${c.key_id}` : "";
            return `${a.created}  ${a.createdUser?.name}  type:${a.type}  ${key} ${c.summary || ""}`;
        }).join("\n"));
    },
    async comment(args) {
        const { space, key } = resolveRef(args);
        const file = argValue("file");
        const content = argValue("text") ?? (file && fs.readFileSync(safeCommentFile(file), "utf8"));
        if (!content)
            throw new Error("Missing --text=... or --file=path");
        const res = await write(space, "POST", `/issues/${key}/comments`, { content });
        if (res)
            console.log(`Posted comment #${res.id} on ${space} ${key}`);
    },
    async update(args) {
        const { space, key, rest } = resolveRef(args);
        const { status, assignee, ...raw } = kv(rest);
        const fields = raw;
        const bl = client(space);
        const projectKey = key.replace(/-\d+$/, "");
        if (status) {
            const st = (await bl.getStatuses(projectKey)).find((s) => norm(s.name) === norm(String(status)));
            if (!st)
                throw new Error(`${projectKey} has no status "${status}"`);
            fields.statusId = st.id;
        }
        if (assignee)
            fields.assigneeId = (await findUser(bl, projectKey, String(assignee))).id;
        const res = await write(space, "PATCH", `/issues/${key}`, fields);
        if (res)
            console.log(`Updated ${space} ${res.issueKey}: ${issueLine(res)}`);
    },
    async api([space, rawMethod, path, ...rest]) {
        if (!space || !rawMethod || !path)
            throw new Error("api <space> <METHOD> <path> [k=v ...]");
        const method = rawMethod.toUpperCase();
        const fields = kv(rest);
        if (method === "GET")
            return print(await client(space).request("GET", path, { params: fields }));
        const res = await write(space, method, path, fields);
        if (res)
            print(res);
    },
};
async function main() {
    const [cmd, ...args] = positional;
    const run = cmd ? COMMANDS[cmd] : undefined;
    if (!run) {
        const lines = fs.readFileSync(import.meta.filename, "utf8").split("\n").slice(1);
        const header = lines.slice(0, lines.findIndex((l) => !l.startsWith("//")));
        console.log(header.map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
        process.exit(cmd ? 1 : 0);
    }
    await run(args);
}
main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
