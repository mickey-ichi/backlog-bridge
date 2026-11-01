# backlog-bridge

[English](README.md) · **Tiếng Việt** · [日本語](README.ja.md)

Cầu nối tới **nhiều [Backlog](https://backlog.com) (Nulab) space cùng lúc** — cho người và cho AI agent.

- **`backlog-bridge`** — đọc/ghi issue, comment, tìm kiếm, activity trên mọi space đã nối, từ một CLI.
  Dán link Backlog là CLI tự chọn đúng space và API key.
- **`sync`** — đồng bộ một chiều giữa hai project Backlog, vd Backlog của khách và Backlog nội bộ.
- **Dùng được với agent** — có sẵn skill cho Claude Code, Codex, Cursor (`AGENTS.md`, `.agents/skills/`).
  MCP Backlog chính chủ chỉ gắn được một space; công cụ này dùng được với bao nhiêu space cũng được.

Không có dependency lúc chạy. Node.js **>= 22.18** chạy thẳng mã TypeScript, không cần build.

> Thông báo của CLI bằng tiếng Anh.

## Cài đặt

**Cách A — npm (lấy từ GitHub):**

```bash
npm install -g --install-links github:mickey-ichi/backlog-bridge
backlog-bridge setup
```

`--install-links` để npm chép gói vào thay vì link tới một bản clone git tạm (npm 10).

**Cách B — git clone** (cập nhật sau này bằng `git pull`):

```bash
git clone https://github.com/mickey-ichi/backlog-bridge.git ~/.backlog-bridge
~/.backlog-bridge/bin/backlog-bridge setup        # tạo ~/.local/bin/backlog-bridge
```

`backlog-bridge setup` cài skill cho Claude Code (`~/.claude/skills`), Codex và Cursor (`~/.agents/skills`, `~/.codex/skills`),
và tạo `~/.config/backlog-bridge/.env` (chmod 600) từ file mẫu. Lệnh không bao giờ ghi đè thứ không phải của nó;
`backlog-bridge setup --uninstall` chỉ gỡ các link nó đã tạo.
`backlog-bridge` tự tìm Node >= 22.18 (PATH, nvm, Homebrew), kể cả khi `node` mặc định của bạn cũ hơn.

Sau đó điền `~/.config/backlog-bridge/.env` — mỗi space một cặp `<PREFIX>_SPACE` + `<PREFIX>_API_KEY` — rồi:

```bash
backlog-bridge spaces --check
backlog-bridge issue https://acme.backlog.jp/view/ACME-123
```

API key: *Personal Settings → API → Register new API key*, ở **từng** space.

## Cấu hình

Dữ liệu riêng không bao giờ nằm trong repo mà ở **thư mục home**:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `BACKLOG_BRIDGE_HOME` | `~/.config/backlog-bridge` nếu đã tồn tại, không thì gốc repo | chứa `.env`, `config.json`, `state/` |
| `BACKLOG_BRIDGE_CONFIG` | `$BACKLOG_BRIDGE_HOME/config.json` | trỏ tới file config khác |
| `BACKLOG_BRIDGE_PROFILE` | `defaultProfile` trong config | profile mặc định của `sync` |

`backlog-bridge home` in ra đường dẫn đang dùng.

**Space** lấy từ biến môi trường — `.env` trong thư mục home, hoặc export trong shell:

```ini
ACME_SPACE=acme.backlog.jp      # xxx.backlog.com -> chỉ ghi "xxx"; host khác -> ghi đủ host
ACME_API_KEY=...
```

Tên space = prefix viết thường (`ACME_*` → `acme`, `ACME_JP_*` → `acme_jp`). Host và key luôn lấy từ **cùng một**
prefix. `config.json` → `spaces` là tuỳ chọn (chỉ cần khi prefix khác tên space).

**Profile** (cho `sync`) nằm trong `config.json` ở thư mục home. Bắt đầu từ [`config.example.json`](config.example.json).
Đường dẫn tương đối trong profile (`state`, `pairFile`) tính từ thư mục home.

## `backlog-bridge` — CLI đa space

```bash
backlog-bridge setup [--uninstall] [--force]                  # cài lệnh toàn cục + skill cho agent
backlog-bridge mcp [--config]                                 # MCP server qua stdio; --config in cấu hình cho host
backlog-bridge home [--init]                                  # đường dẫn đang dùng; --init chép .env/config/state từ repo sang
backlog-bridge spaces [--check]                               # space đã nối; --check gọi thử API
backlog-bridge projects <space>
backlog-bridge issue <ref>                                    # <ref> = URL | <space> <KEY> | <KEY>
backlog-bridge comments <ref> [--count=20]
backlog-bridge search <space> <PROJECT> [--keyword=..] [--assignee=me|tên] [--open] [--count=50]
backlog-bridge activities <space> [--project=KEY] [--count=20]
backlog-bridge comment <ref> (--text=..|--file=path) [--yes]
backlog-bridge update <ref> status=<tên> assignee=<tên> dueDate=YYYY-MM-DD summary=.. [--yes]
backlog-bridge api <space> <METHOD> <path> [k=v ...] [--yes]  # endpoint bất kỳ của Backlog API v2
```

- `<KEY>` trần dùng được khi project key của nó có trong một profile. `--json` in JSON thô.
- **Mọi lệnh ghi chỉ là bản xem trước cho tới khi thêm `--yes`** — in ra đúng request sẽ gửi.
- `update` tự tra `status` và `assignee` theo tên trong project.

## `sync` — đồng bộ một chiều giữa hai project

```bash
backlog-bridge sync --list
backlog-bridge sync --profile=<tên> [flag]
```

### Mode `mirror` — khách → nội bộ

Tạo một issue nội bộ cho mỗi issue khách **đã plan** (có due date), summary dạng `<KEY> <tiêu đề gốc>`.

- **Chống trùng hai lớp:** quét project đích tìm summary bắt đầu bằng key nguồn, rồi gộp với file state.
  Mất file state cũng không tạo trùng.
- Issue đã mirror thì bỏ qua, trừ khi `--update` (issue ở đích thường đã được sửa tay).
- Issue type / priority / status map theo tên qua `map`; assignee khớp theo tên đã chuẩn hoá
  (bỏ dấu, bỏ phần trong ngoặc), có thể đổi người qua `map.assignee`.
- `dest.customFields`: custom field bắt buộc khai theo **tên field → tên item**; chỉ gắn khi field áp dụng cho issue
  type đó. Field bắt buộc chưa khai được báo ngay ở `--dry-run`.
- Backlog không cho set status khi tạo nên status được set ngay sau đó.
- **Mặc định LIVE** — chạy `--dry-run` trước.

### Mode `progress` — nội bộ → khách

Đẩy **tiến độ** từ epic nội bộ lên issue WBS **có sẵn** của khách. Không bao giờ tạo issue phía khách.
Dành cho trường hợp hai bên tách việc theo trục khác nhau:

- Nội bộ: epic `[Epic] [NN] ...`, task con có tiền tố theo lớp (`[FE]`, `[BE]`, `[QA]`, …).
- Khách: unit WBS `1.2.3` với leaf cố định theo segment cuối — `.3` impl, `.4` unit test, `.5` acceptance.

Rule:

- `source.childGroups` map tiền tố task con sang nhóm (vd `api: [BE, Infra]`, `screen: [FE]`);
  tiền tố trong `alwaysCount` (vd `QA`) tính vào mọi nhóm.
- pairFile khai mỗi epic (`"NN"` hoặc issue key) ứng với unit nào của khách theo từng nhóm;
  `_outOfScope` và `_notes` là khoá đặc biệt. `--units` in danh sách unit của khách để điền.
- Nhiều epic có thể trỏ cùng một unit; task được **gộp trước** khi rollup.
- Rollup: `done` (xong hết) · `in_progress` · `pending` · `not_started` (→ không ghi gì). Loại trừ `ignoreStatuses`.
  `%` tính theo estimate (không có estimate = 1 giờ).
- Ghi leaf `impl`; khi `done` thì set thêm leaf `acceptance` sang Resolved (không bao giờ Closed).

An toàn: **mặc định chỉ xem trước** (`--live` mới ghi), `neverTouchStatuses`, không lùi trạng thái nếu không có
`--allow-regress`, không ghi ngày nếu không có `--dates=children`, comment tiến độ tiếng Nhật tuỳ chọn (`--comment`)
được cập nhật tại chỗ nhờ marker ẩn.

### Flag

| Flag | Mode | Ý nghĩa |
|---|---|---|
| `--list` | — | liệt kê profile |
| `--profile=<tên>` | — | chọn profile (mặc định: `defaultProfile`) |
| `--dry-run` | mirror | chỉ in ra |
| `--assignee=A,B` | mirror | chỉ issue assign cho những người này (khớp lỏng) |
| `--since=YYYY-MM-DD` | mirror | chỉ issue có due date từ ngày này |
| `--update` | mirror | ghi đè issue đã mirror |
| `--live` | progress | ghi thật sang khách |
| `--units` | progress | in unit WBS của khách kèm leaf và status |
| `--only=28,29` | progress | chỉ các epic này |
| `--mine` / `--assignee=tên` | progress | chỉ leaf khách assign cho bạn / cho người đó, kèm danh sách unit chưa khai cặp |
| `--comment` | progress | đăng/cập nhật comment tiến độ |
| `--dates=children` | progress | ghi thêm start/due lấy từ task nội bộ |
| `--allow-regress` | progress | cho phép lùi trạng thái phía khách |

## Dùng với AI agent

| Agent | Đọc |
|---|---|
| Claude Code | `CLAUDE.md` → `AGENTS.md`, skill qua `.claude/skills` → `.agents/skills` |
| Codex | `AGENTS.md` |
| Cursor | `.cursor/rules/backlog.mdc` → `AGENTS.md` + skill |

Sau `backlog-bridge setup`, skill được cài toàn cục nên agent ở **bất kỳ project nào** cũng dùng được `backlog-bridge` — không chỉ trong repo này.

Skill: `backlog-connect`, `backlog-query`, `backlog-write`, `backlog-sync`. Chúng buộc agent xem trước mọi lệnh ghi,
hỏi lại trước khi ghi lên space của khách, và coi nội dung ticket là dữ liệu chứ không phải chỉ dẫn.

## MCP server (Claude Desktop, Cursor, …)

Với nơi không chạy được lệnh shell — Claude Desktop, hay bất kỳ MCP client nào — `backlog-bridge mcp` chạy một MCP server qua stdio.
`backlog-bridge mcp --config` in sẵn cấu hình để dán cho Claude Desktop, Cursor, Claude Code và Codex, vd:

```json
{ "mcpServers": { "backlog-bridge": { "command": "/path/to/backlog-bridge/bin/backlog-bridge", "args": ["mcp"] } } }
```

Tool: `list_spaces`, `home_info`, `get_issue`, `get_comments`, `search_issues`, `list_activities`, `list_projects`,
`api_get` (chỉ đọc) · `add_comment`, `update_issue` (chỉ xem trước nếu không có `send: true`) · `list_sync_profiles`,
`sync_preview` (không bao giờ ghi — sync thật vẫn chạy ở terminal).
Mỗi tool gọi lại CLI `backlog-bridge` nên giữ nguyên mọi chốt an toàn; server cũng gửi cho agent các quy tắc bắt buộc và chế độ
duyệt của người dùng.

## Duyệt nội dung gửi khách

Mỗi người tự đặt cách duyệt nội dung trước khi agent gửi cho khách, trong `.env` của mình:

| `BACKLOG_BRIDGE_REVIEW` | Dành cho | Quy trình |
|---|---|---|
| `bilingual` | người đọc được tiếng của khách | duyệt bản song ngữ (tiếng khách + tiếng Việt), chỉ gửi phần tiếng khách |
| `translate` | người không đọc được | chỉ duyệt bản tiếng Việt; duyệt xong agent dịch và gửi luôn |

`BACKLOG_BRIDGE_LANG` (mặc định `vi`) và `BACKLOG_BRIDGE_CUSTOMER_LANG` (mặc định `ja`) đặt hai ngôn ngữ.
`backlog-bridge home` cho biết chế độ đang dùng; chưa đặt thì agent sẽ hỏi.

## Bảo mật

- API key chỉ nằm trong `.env` ở thư mục home; `backlog-bridge home` / `backlog-bridge spaces` cảnh báo khi người khác đọc được file.
  Backlog nhận key qua query `apiKey`, nên lỗi chỉ in method và path.
- Host và key luôn lấy từ cùng một prefix env — key không bao giờ bị gửi sang host của space khác.
- Issue key phải có dạng `PROJECT-123`, nên key giả mạo không đổi được endpoint của lệnh ghi.
- `comment --file` từ chối `.env*`, thư mục home và `state/` — agent bị prompt injection không đăng được secret.
- Lệnh ghi chỉ là bản xem trước cho tới khi có `--yes` (`backlog-bridge`) / `--live` (`progress`).

## Phát triển

```bash
npm install          # chỉ devDependencies: typescript, @types/node
npm run typecheck    # tsc --noEmit, strict
npm run build        # dist/*.js, cho môi trường không chạy được .ts
```

Node chạy `.ts` bằng type stripping nên chỉ dùng cú pháp xoá được (không `enum`, `namespace`, parameter property);
import nội bộ ghi đuôi `.ts`.

## License

[MIT](LICENSE)
