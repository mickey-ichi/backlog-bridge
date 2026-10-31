#!/usr/bin/env node
// bl — CLI đọc/ghi NHIỀU Backlog space cùng lúc, dùng chung .env + config.json với sync.ts.
// Làm "cầu nối" cho agent (Claude Code / Codex / Cursor / workspace): MCP Backlog chính chủ
// chỉ gắn được 1 space, còn CLI này gọi được mọi space đã khai.
//
//   node src/bl.ts home [--init]                          # thư mục chứa .env/config/state; --init chép từ repo sang
//   node src/bl.ts spaces [--check]                       # liệt kê space, --check gọi thử API
//   node src/bl.ts projects <space>
//   node src/bl.ts issue <ref>                            # ref = URL | <space> <KEY> | <KEY>
//   node src/bl.ts comments <ref> [--count=20]
//   node src/bl.ts search <space> <PROJECT> [--keyword=..] [--assignee=me|tên] [--open] [--count=50]
//   node src/bl.ts activities <space> [--project=KEY] [--count=20]
//   node src/bl.ts comment <ref> (--text=..|--file=path) [--yes]
//   node src/bl.ts update <ref> field=value ... [--yes]   # status=<tên> assignee=<tên> dueDate=.. summary=..
//   node src/bl.ts api <space> <METHOD> <path> [k=v ...] [--yes]
//
// Mọi lệnh GHI mặc định chỉ in ra request dự kiến; phải thêm --yes mới gửi thật.
// --json: in JSON thô thay vì dạng rút gọn.
import fs from "node:fs";
import path from "node:path";
import {
  ROOT, DEFAULT_HOME, LEGACY_HOME, setting, homeDir, configPath, envFiles, looseEnvFiles, loadEnv, loadConfig, allSpaces, hostOf,
  hasFlag, argValue,
} from "./config.ts";
import { BacklogClient } from "./backlog.ts";
import type { Activity, Comment, Issue, Params, Project, User } from "./types.ts";

loadEnv();
const config = loadConfig();
const SPACES = allSpaces(config);
const JSON_OUT = hasFlag("json");
const YES = hasFlag("yes");
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));

interface Ref {
  space: string;
  key: string;
  rest: string[];
}

function client(name: string | undefined): BacklogClient {
  const s = name ? SPACES[name] : undefined;
  if (!s) throw new Error(`Không có space "${name}". Đang có: ${Object.keys(SPACES).join(", ")}`);
  if (s.missing || !s.space || !s.apiKey) {
    throw new Error(`Space "${name}" thiếu ${s.env}_SPACE / ${s.env}_API_KEY trong .env`);
  }
  return new BacklogClient({ space: s.space, apiKey: s.apiKey });
}

// Project key -> space, suy ra từ các profile trong config.json.
function spaceOfProject(projectKey: string): string | undefined {
  const hits = new Set<string>();
  for (const p of Object.values(config.profiles || {})) {
    for (const side of [p.source, p.dest]) {
      if (side?.projectKey === projectKey) hits.add(side.space);
    }
  }
  return hits.size === 1 ? [...hits][0] : undefined;
}

// Issue key đi thẳng vào path của request ghi (/issues/<key>) -> chỉ nhận đúng dạng PROJECT-123,
// không để chuỗi như "../projects/X" đổi endpoint.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
function checkKey(key: string): string {
  if (!ISSUE_KEY.test(key)) throw new Error(`Issue key không hợp lệ: "${key}" (dạng PROJECT-123)`);
  return key;
}

// Nhận: URL Backlog | "<space> <KEY>" | "<KEY>" (space suy từ profile). Trả { space, key, rest }.
function resolveRef(args: string[]): Ref {
  const [a, b] = args;
  if (!a) throw new Error("Thiếu issue: truyền URL, <space> <KEY> hoặc <KEY>");
  if (/^https?:\/\//.test(a)) {
    const url = new URL(a);
    const space = Object.keys(SPACES).find((n) => {
      const host = SPACES[n].space;
      return host && hostOf(host) === url.host;
    });
    if (!space) throw new Error(`Chưa có API key cho ${url.host}. Xem skill backlog-connect.`);
    const key = url.pathname.match(/\/view\/([A-Z0-9_]+-\d+)/)?.[1];
    if (!key) throw new Error(`URL không chứa issue key: ${a}`);
    return { space, key: checkKey(key), rest: args.slice(1) };
  }
  if (SPACES[a]) {
    if (!b) throw new Error(`Thiếu issue key sau space "${a}"`);
    return { space: a, key: checkKey(b), rest: args.slice(2) };
  }
  checkKey(a);
  const projectKey = a.replace(/-\d+$/, "");
  const space = spaceOfProject(projectKey);
  if (!space) {
    throw new Error(`Không suy ra được space của ${a}. Ghi rõ: <space> ${a} (space: ${Object.keys(SPACES).join(", ")})`);
  }
  return { space, key: a, rest: args.slice(1) };
}

// --file đọc nội dung để đăng lên Backlog (có thể là space khách) và in ra ở bản DRY. Chặn file chứa
// secret / dữ liệu riêng: .env*, thư mục home (cả tên mới, tên cũ, $BACKLOG_BRIDGE_HOME) và state/ trong repo
// — tránh agent bị prompt injection lừa đăng key.
function safeCommentFile(file: string): string {
  const p = fs.realpathSync(path.resolve(file));
  const root = fs.realpathSync(ROOT);
  const privateDirs = [homeDir(), DEFAULT_HOME, LEGACY_HOME, path.join(ROOT, "state")]
    .filter((d) => fs.existsSync(d))
    .map((d) => fs.realpathSync(d))
    .filter((d) => d !== root); // home = gốc repo (cách cũ) -> chỉ chặn state/, không chặn cả repo
  const inPrivate = privateDirs.some((d) => p === d || p.startsWith(d + path.sep));
  if (/^\.env/.test(path.basename(p)) || inPrivate) {
    throw new Error(`Không đăng nội dung file ${p}: file chứa secret / dữ liệu riêng`);
  }
  return p;
}

const short = (d: string | null | undefined) => (d ? d.slice(0, 10) : "-");
function issueLine(i: Issue): string {
  return `${i.issueKey}  [${i.status?.name}]  ${i.assignee?.name || "(chưa assign)"}  due:${short(i.dueDate)}  ${i.summary}`;
}
function print<T>(data: T, fmt?: (data: T) => string): void {
  if (JSON_OUT || !fmt) console.log(JSON.stringify(data, null, 2));
  else console.log(fmt(data));
}

// Ghi: không có --yes thì chỉ mô tả request.
async function write<T = any>(space: string, method: string, path: string, body: Params): Promise<T | null> {
  if (!YES) {
    console.log(`[DRY] ${space}: ${method} ${path}`);
    console.log(JSON.stringify(body, null, 2));
    console.log("→ thêm --yes để gửi thật.");
    return null;
  }
  return client(space).request<T>(method, path, { body });
}

// k=v ... -> object; key lặp lại thành mảng.
function kv(args: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const a of args) {
    const i = a.indexOf("=");
    if (i < 1) throw new Error(`Tham số phải dạng key=value: ${a}`);
    const [k, v] = [a.slice(0, i), a.slice(i + 1)];
    out[k] = k in out ? ([] as string[]).concat(out[k], v) : v;
  }
  return out;
}

const norm = (s: string | undefined) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();

async function findUser(bl: BacklogClient, projectKey: string, name: string): Promise<User> {
  if (name === "me") return bl.getMyself();
  const users = await bl.getProjectUsers(projectKey);
  const hits = users.filter((u) => norm(u.name).includes(norm(name)) || u.userId === name);
  if (hits.length !== 1) {
    throw new Error(`assignee "${name}" khớp ${hits.length} người ở ${projectKey}: ${hits.map((u) => u.name).join(", ") || "-"}`);
  }
  return hits[0];
}

function warnLooseEnv(): void {
  for (const p of looseEnvFiles()) console.warn(`! ${p} đang cho người khác đọc được — chạy: chmod 600 "${p}"`);
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  // --init: chép .env, config.json, state/*.json từ repo sang home (không ghi đè file đã có).
  async home() {
    if (hasFlag("init")) {
      const configured = setting("HOME");
      const target = configured ? path.resolve(configured) : DEFAULT_HOME;
      if (target === ROOT) throw new Error("BACKLOG_BRIDGE_HOME đang trỏ vào chính repo");
      fs.mkdirSync(path.join(target, "state"), { recursive: true });
      const files = [".env", "config.json"].concat(
        fs.existsSync(path.join(ROOT, "state"))
          ? fs.readdirSync(path.join(ROOT, "state")).filter((f) => f.endsWith(".json")).map((f) => `state/${f}`)
          : []
      );
      for (const f of files) {
        const from = path.join(ROOT, f);
        const to = path.join(target, f);
        if (!fs.existsSync(from)) continue;
        if (fs.existsSync(to)) { console.log(`bỏ qua ${f} (đã có ở home)`); continue; }
        fs.copyFileSync(from, to);
        if (f === ".env") fs.chmodSync(to, 0o600);
        console.log(`chép ${f}`);
      }
      console.log(`\nXong. Kiểm tra lại rồi có thể xoá .env / state/*.json trong repo.`);
    }
    const cfg = configPath();
    const hint = homeDir() === ROOT ? "  (gốc repo — chạy 'home --init' để chuyển ra ngoài)"
      : homeDir() === LEGACY_HOME ? `  (tên cũ — đổi bằng: mv "${LEGACY_HOME}" "${DEFAULT_HOME}")` : "";
    console.log(`home   : ${homeDir()}${hint}`);
    console.log(`config : ${cfg}${fs.existsSync(cfg) ? "" : "  (chưa có — chỉ dùng được space khai qua env)"}`);
    console.log(`.env   : ${envFiles().join(", ") || "(không có — dùng biến môi trường)"}`);
    warnLooseEnv();
  },

  async spaces() {
    warnLooseEnv();
    for (const [name, s] of Object.entries(SPACES)) {
      let line = `${name.padEnd(12)} ${s.missing || !s.space ? "(thiếu key)" : hostOf(s.space)}  env:${s.env}_*  [${s.from}]`;
      if (hasFlag("check") && !s.missing) {
        try {
          const me = await client(name).getMyself();
          line += `  OK as ${me.name}`;
        } catch (e) {
          line += `  LỖI ${(e as Error).message}`;
        }
      }
      console.log(line);
    }
  },

  async projects([space]) {
    const list = await client(space).request<Project[]>("GET", "/projects", { params: { archived: false } });
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
      x.description || "(không có mô tả)",
    ].join("\n"));
  },

  async comments(args) {
    const { space, key } = resolveRef(args);
    const list = await client(space).getComments(key, { count: Number(argValue("count") || 20) });
    print(list, (l: Comment[]) => l.filter((c) => c.content).reverse()
      .map((c) => `--- #${c.id} ${c.createdUser?.name} ${c.created}\n${c.content}`).join("\n"));
  },

  async search([space, projectKey]) {
    if (!projectKey) throw new Error("search <space> <PROJECT>");
    const bl = client(space);
    const project = await bl.getProject(projectKey);
    const params: Params = {
      projectId: [project.id],
      keyword: argValue("keyword"),
      count: Math.min(Number(argValue("count") || 50), 100),
      sort: "updated",
    };
    const assignee = argValue("assignee");
    if (assignee) params.assigneeId = [(await findUser(bl, projectKey, assignee)).id];
    if (hasFlag("open")) {
      const statuses = await bl.getStatuses(projectKey);
      params.statusId = statuses.filter((s) => s.name !== "Closed").map((s) => s.id);
    }
    const list = await bl.request<Issue[]>("GET", "/issues", { params });
    print(list, (l) => l.map(issueLine).join("\n") || "(không có issue)");
  },

  async activities([space]) {
    const bl = client(space);
    const params = { count: Number(argValue("count") || 20) };
    const path = argValue("project")
      ? `/projects/${argValue("project")}/activities`
      : "/space/activities";
    const list = await bl.request<Activity[]>("GET", path, { params });
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
    if (!content) throw new Error("Thiếu --text=... hoặc --file=path");
    const res = await write<Comment>(space, "POST", `/issues/${key}/comments`, { content });
    if (res) console.log(`Đã comment #${res.id} lên ${space} ${key}`);
  },

  async update(args) {
    const { space, key, rest } = resolveRef(args);
    const { status, assignee, ...raw } = kv(rest);
    const fields: Params = raw;
    const bl = client(space);
    const projectKey = key.replace(/-\d+$/, "");
    if (status) {
      const st = (await bl.getStatuses(projectKey)).find((s) => norm(s.name) === norm(String(status)));
      if (!st) throw new Error(`${projectKey} không có status "${status}"`);
      fields.statusId = st.id;
    }
    if (assignee) fields.assigneeId = (await findUser(bl, projectKey, String(assignee))).id;
    const res = await write<Issue>(space, "PATCH", `/issues/${key}`, fields);
    if (res) console.log(`Đã cập nhật ${space} ${res.issueKey}: ${issueLine(res)}`);
  },

  async api([space, rawMethod, path, ...rest]) {
    if (!space || !rawMethod || !path) throw new Error("api <space> <METHOD> <path> [k=v ...]");
    const method = rawMethod.toUpperCase();
    const fields = kv(rest);
    if (method === "GET") return print(await client(space).request("GET", path, { params: fields }));
    const res = await write(space, method, path, fields);
    if (res) print(res);
  },
};

async function main(): Promise<void> {
  const [cmd, ...args] = positional;
  const run = cmd ? COMMANDS[cmd] : undefined;
  if (!run) {
    console.log(fs.readFileSync(import.meta.filename, "utf8").split("\n").slice(1, 17).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(cmd ? 1 : 0);
  }
  await run(args);
}

main().catch((err: Error) => {
  console.error("Lỗi:", err.message);
  process.exit(1);
});
