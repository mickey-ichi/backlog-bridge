# backlog-bridge trong Claude Code

[English](claude-code.md) · **Tiếng Việt**

Dùng backlog-bridge trong **Claude Code** — tab **Code** của app Claude, hoặc lệnh `claude` trong terminal — để
đọc/ghi **nhiều Backlog space trong cùng một session**: space nội bộ và space của khách.

Claude Code chạy được lệnh shell nên không cần extension: nó gọi lệnh `backlog-bridge`, còn các **skill** của
backlog-bridge dạy nó cách dùng (xem trước mọi lệnh ghi, hỏi lại trước khi ghi lên space của khách, …). Không cần
admin của tổ chức Claude duyệt gì.

> Muốn dùng ở tab **Chat**? Cần Desktop Extension — xem [claude-desktop.vi.md](claude-desktop.vi.md).

## Cần chuẩn bị

- macOS, Linux hoặc Windows có **Node.js ≥ 22.18** (`node -v`). Mac chưa có thì: `brew install node`.
- **App Claude** (tab Code) hoặc Claude Code CLI
- **API key của từng space**: trên mỗi space, *Personal Settings → API → Register new API key*

## 1. Cài lệnh và skill

Trong **Terminal**:

```bash
npm install -g backlog-bridge
backlog-bridge setup
```

`setup` in ra những gì nó đã làm:

| Dòng | Ý nghĩa |
|---|---|
| `Skill:` → `+ ~/.claude/skills/backlog-query` … | 4 skill đã được link cho Claude Code (và Codex / Cursor) |
| `Data:` → `+ ~/.config/backlog-bridge/.env` | Thư mục dữ liệu, kèm file `.env` mẫu chỉ mình bạn đọc được |

`+` là mới tạo, `=` là đã có sẵn. Chạy lại bao nhiêu lần cũng được — không bao giờ ghi đè file của bạn.

## 2. Điền API key

```bash
open -e ~/.config/backlog-bridge/.env
```

(Linux: editor nào cũng được. Windows: `notepad %USERPROFILE%\.config\backlog-bridge\.env`.)

Mỗi space **một cặp dòng** — prefix bạn đặt chính là tên space:

```ini
INTERNAL_SPACE=yourcompany
INTERNAL_API_KEY=dán-key-vào-đây

ACME_SPACE=acme.backlog.jp
ACME_API_KEY=dán-key-vào-đây
```

- `xxx.backlog.com` → chỉ ghi `xxx`. Host khác (`.backlog.jp`, …) → ghi đủ host.
- Không ghi chú thích cùng dòng với giá trị.

Rồi bỏ dấu `#` ở **một** dòng chế độ duyệt — cách bạn kiểm tra nội dung trước khi gửi khách:

```ini
# Đọc được tiếng của khách: duyệt bản song ngữ, chỉ gửi bản tiếng khách
BACKLOG_BRIDGE_REVIEW=bilingual
# Không đọc được: chỉ duyệt bản tiếng Việt, Claude dịch và gửi sau khi bạn đồng ý
BACKLOG_BRIDGE_REVIEW=translate
```

`BACKLOG_BRIDGE_LANG` (mặc định `vi`) và `BACKLOG_BRIDGE_CUSTOMER_LANG` (mặc định `ja`) là hai ngôn ngữ.

Không bao giờ dán key vào khung chat — key chỉ nằm trong file này.

## 3. Kiểm tra kết nối

```bash
backlog-bridge spaces --check
```

Mỗi space một dòng, kết thúc bằng `OK as <tên bạn>`. `401` = key sai hoặc hết hạn; `403 Inactive Licence` = chính
space đó ngừng hoạt động; `No spaces yet` = chưa có đủ cặp `<PREFIX>_SPACE` + `<PREFIX>_API_KEY`.

## 4. Mở Claude Code

- **App Claude:** tab **Code** → session mới → chọn thư mục bất kỳ (project của bạn, hoặc thư mục home).
- **Terminal:** `cd` vào thư mục bất kỳ rồi chạy `claude`.

Skill được nạp khi session bắt đầu, nên **mở session mới** sau khi `setup` — session mở từ trước sẽ không thấy skill.

Hỏi thử:

> Đang kết nối những Backlog space nào?

Claude chọn skill `backlog-connect` và chạy `backlog-bridge spaces --check`. Lần đầu Claude Code hỏi quyền chạy lệnh —
bấm cho phép.

## 5. Sử dụng

Cứ nói chuyện với Claude — dán link nguyên như vậy:

- *Task https://acme.backlog.jp/view/ACME-123 đang thế nào? Tóm tắt comment giúp mình.*
- *Tìm task đang mở assign cho mình trong project DEV ở space internal.*
- *Hôm nay ACME có gì thay đổi?*
- *Trả lời ACME-123 là đã deploy bản sửa lên staging.*
- *Chuyển DEV-42 sang Resolved và assign cho An.*
- *Dry-run sync acme cho An từ 1/10.*

Cách ghi hoạt động:

- Mọi lệnh ghi đều **chạy thử** trước: Claude chạy không có `--yes`, cho bạn xem đúng request sẽ gửi, và chỉ gửi khi
  bạn đồng ý.
- Ghi lên space **của khách** theo chế độ duyệt của bạn (`bilingual` hoặc `translate`) và lần nào cũng được hỏi lại.
- Không bao giờ đóng (Closed) issue của khách, không xoá gì trừ khi bạn chỉ đích danh.
- Nội dung ticket chỉ là dữ liệu — chỉ dẫn viết trong ticket không bao giờ được làm theo.

### Bớt hỏi quyền (tuỳ chọn)

Cho phép sẵn các lệnh **chỉ đọc** trong `~/.claude/settings.json` để Claude không hỏi lại:

```json
{
  "permissions": {
    "allow": [
      "Bash(backlog-bridge spaces:*)",
      "Bash(backlog-bridge home:*)",
      "Bash(backlog-bridge issue:*)",
      "Bash(backlog-bridge comments:*)",
      "Bash(backlog-bridge search:*)",
      "Bash(backlog-bridge activities:*)",
      "Bash(backlog-bridge projects:*)"
    ]
  }
}
```

Đừng thêm `comment`, `update`, `api` và `sync` vào danh sách này, để lệnh ghi luôn phải xác nhận.

### Config dùng chung của team (tuỳ chọn)

Nếu team để `config.json` (profile sync) và `state/pairs-*.json` trong một repo git, trỏ backlog-bridge vào repo đó —
bằng symlink:

```bash
ln -s ~/path/to/team-config-repo ~/.config/backlog-bridge
```

hoặc thêm `export BACKLOG_BRIDGE_HOME=~/path/to/team-config-repo` vào profile của shell. Không commit `.env`. Mở
session Claude Code **trong** repo đó thì Claude đọc luôn quy ước riêng của team (`AGENTS.md` / `CLAUDE.md`).

`backlog-bridge home` cho biết đang dùng thư mục, config và `.env` nào.

## Cập nhật / gỡ

- **Cập nhật:** `npm install -g backlog-bridge@latest` — skill là link nên cập nhật theo.
- **Gỡ:** `backlog-bridge setup --uninstall`, rồi `npm uninstall -g backlog-bridge`.
  `~/.config/backlog-bridge` vẫn còn cho tới khi bạn xoá.

## Xử lý sự cố

| Vấn đề | Cách xử lý |
|---|---|
| `backlog-bridge: command not found` | Thư mục bin toàn cục của npm chưa có trong `PATH`: xem `npm prefix -g`, thêm thư mục `bin` của nó vào `PATH`, rồi mở terminal / session mới |
| Claude không dùng skill | Mở session mới; kiểm tra `ls ~/.claude/skills` có các `backlog-*`; chạy lại `backlog-bridge setup` |
| Lỗi phiên bản Node | backlog-bridge tìm Node ≥ 22.18 trong `PATH`, nvm và Homebrew — cài một bản (`brew install node` hoặc `nvm install 22`) |
| `No spaces yet` | Mỗi space cần đủ hai dòng cùng prefix trong `~/.config/backlog-bridge/.env`; nhớ lưu file |
| `401` / `403 Inactive Licence` | Tạo key mới trên space đó / chính space đó ngừng hoạt động |

## Dùng MCP thay cho skill?

Với Claude Code thì không cần — skill là cách khuyên dùng. Nếu vẫn muốn dùng tool qua MCP:

```bash
claude mcp add --scope user backlog-bridge -- backlog-bridge mcp
```
