# backlog-bridge trong Claude Desktop (macOS)

[English](claude-desktop.md) · **Tiếng Việt**

Dùng backlog-bridge trong Claude Desktop để đọc/ghi **nhiều Backlog space trong cùng một cuộc trò chuyện** — space
nội bộ và space của khách — không cần mở terminal.

Công cụ được đóng gói thành **Desktop Extension** (file `.mcpb`). Claude Desktop chạy nó bằng Node.js có sẵn bên
trong app, nên **không cần cài Node, npm hay gì thêm**.

## Cần chuẩn bị

- macOS với **Claude Desktop** bản mới
- **API key của từng space** muốn dùng: trên mỗi space, *Personal Settings → API → Register new API key*
- Khoảng 5 phút

## 1. Cài extension

1. Tải `backlog-bridge-<version>.mcpb` ở bản mới nhất trên
   [GitHub Releases](https://github.com/mickey-ichi/backlog-bridge/releases/latest).
2. Bấm đúp vào file, hoặc kéo thả vào Claude Desktop → **Settings → Extensions**. Hộp thoại cài đặt mở ra → bấm
   **Install**. (Không phải *Connectors → Add custom connector*: chỗ đó dành cho server từ xa có URL `https://`.)
3. Ô **Data folder** để nguyên (`~/.config/backlog-bridge`), trừ khi bạn để key ở chỗ khác.
4. Kiểm tra **Backlog Bridge** (nhãn *Custom*) có trong danh sách và đang bật ở Settings → Extensions. Đây là extension
   khác với **Backlog** của Nulab.

> **Gói Team / Enterprise:** nếu nút **Install** bị mờ hoặc extension báo *Not allowed in your current
> organization*, tổ chức đang giới hạn extension theo allowlist. Owner thêm một lần cho cả team: claude.ai →
> **Organization settings → Connectors → Desktop** → upload file `.mcpb` (bản mới: **Upload new version** trong menu
> `⋯`). Có thể mất một lúc mới tới máy thành viên. Trong lúc chờ, dùng [Claude Code](claude-code.vi.md) — không cần
> duyệt.

## 2. Tạo thư mục dữ liệu

Mở một cuộc trò chuyện mới và gõ:

> Set up backlog-bridge

Claude gọi tool `create_data_folder`, tạo `~/.config/backlog-bridge/.env` từ file mẫu, chỉ mình bạn đọc được
(`chmod 600`). Tool không bao giờ ghi đè file đã có và không bao giờ hỏi key trong khung chat.

## 3. Điền API key

Mở file bằng TextEdit — trong **Terminal**:

```bash
open -e ~/.config/backlog-bridge/.env
```

(Không dùng Terminal: trong Finder bấm **⌘⇧G**, gõ `~/.config/backlog-bridge`, rồi **⌘⇧.** để hiện file ẩn.)

Mỗi space **một cặp dòng** — prefix bạn đặt chính là tên space:

```ini
INTERNAL_SPACE=yourcompany
INTERNAL_API_KEY=dán-key-vào-đây

ACME_SPACE=acme.backlog.jp
ACME_API_KEY=dán-key-vào-đây
```

- `xxx.backlog.com` → chỉ ghi `xxx`. Host khác (`.backlog.jp`, …) → ghi đủ host.
- Không ghi chú thích cùng dòng với giá trị.

Rồi chọn **cách bạn duyệt nội dung trước khi gửi khách** — bỏ dấu `#` ở **một** dòng:

```ini
# Đọc được tiếng của khách: duyệt bản song ngữ, chỉ gửi bản tiếng khách
BACKLOG_BRIDGE_REVIEW=bilingual
# Không đọc được: chỉ duyệt bản tiếng Việt, Claude dịch và gửi sau khi bạn đồng ý
BACKLOG_BRIDGE_REVIEW=translate
```

`BACKLOG_BRIDGE_LANG` (mặc định `vi`) và `BACKLOG_BRIDGE_CUSTOMER_LANG` (mặc định `ja`) là hai ngôn ngữ.

Lưu file. Không cần khởi động lại — mỗi lần gọi tool đều đọc lại file.

## 4. Kiểm tra kết nối

> List my Backlog spaces and check the keys

Mỗi space một dòng, kết thúc bằng `OK as <tên bạn>`. Nếu lỗi:

| Thông báo | Ý nghĩa |
|---|---|
| `401 …` | Key sai hoặc hết hạn → tạo key mới trên space đó |
| `403 Inactive Licence` | Chính space Backlog đó đang ngừng hoạt động |
| `No spaces yet` | `.env` chưa có đủ cặp `<PREFIX>_SPACE` + `<PREFIX>_API_KEY` |

## 5. Sử dụng

Cứ nói chuyện với Claude — dán link nguyên như vậy:

- *Task https://acme.backlog.jp/view/ACME-123 đang thế nào? Tóm tắt comment giúp mình.*
- *Tìm task đang mở assign cho mình trong project DEV ở space internal.*
- *Hôm nay ACME có gì thay đổi?*
- *Trả lời ACME-123 là đã deploy bản sửa lên staging.* → Claude làm theo chế độ duyệt của bạn, đưa bản nháp và chỉ
  gửi khi bạn đồng ý.
- *Xem trước sync acme.* → `sync_preview` chỉ cho xem thay đổi; sync thật chạy ở terminal.

Cách ghi hoạt động:

- `add_comment` / `update_issue` luôn trả về **bản xem trước** (đúng request sẽ gửi) trước; chưa gửi gì cho tới khi
  bạn đồng ý.
- Ghi lên space **của khách** luôn được hỏi lại, theo chế độ duyệt của bạn.
- Không bao giờ đóng (Closed) issue của khách, không bao giờ xoá gì.

## Cập nhật / gỡ

- **Cập nhật:** tải file `.mcpb` mới trên Releases và cài lại — bản cũ được thay thế, thư mục dữ liệu giữ nguyên.
- **Kiểm tra chữ ký (tuỳ chọn):** mỗi file `.mcpb` do GitHub Actions build và ký. Với GitHub CLI:
  `gh attestation verify backlog-bridge-<version>.mcpb --repo mickey-ichi/backlog-bridge`.
- **Gỡ:** Settings → Extensions → Backlog Bridge → Uninstall. `~/.config/backlog-bridge` vẫn còn cho tới khi bạn xoá.

## Xử lý sự cố

| Vấn đề | Cách xử lý |
|---|---|
| Không thấy tool | Thoát hẳn Claude Desktop (**⌘Q**) rồi mở lại; kiểm tra extension đang bật |
| Nút **Install** bị mờ / *Not allowed in your current organization* | Allowlist của tổ chức — xem ghi chú Team / Enterprise ở bước 1 |
| Tool nào cũng trả về `(no output)` | Bản 0.1.2 trở về trước — cài file `.mcpb` mới nhất |
| Server báo lỗi | Xem log: `open ~/Library/Logs/Claude` → file `mcp-server-Backlog Bridge.log` (và `mcp.log`) |
| Vẫn `No spaces yet` sau khi sửa `.env` | Mỗi space cần đủ hai dòng cùng prefix; kiểm tra lỗi chính tả và đã lưu file chưa |
| Key để ở thư mục khác | Settings → Extensions → Backlog Bridge → đặt **Data folder** |

## Dùng thêm terminal hoặc Claude Code?

Hướng dẫn từng bước: [claude-code.vi.md](claude-code.vi.md).

Cài thêm CLI — dùng chung thư mục dữ liệu, kèm skill cho Claude Code, Codex và Cursor:

```bash
npm install -g backlog-bridge
backlog-bridge setup
```

Nâng cao: `backlog-bridge mcp --config` in ra mục `mcpServers` để tự thêm vào `claude_desktop_config.json`. Nên
dùng extension hơn — Claude Desktop có thể ghi lại file đó và làm mất mục tự thêm.
