// Chốt an toàn dùng chung cho lệnh ghi của bl (tách riêng để test được).
import fs from "node:fs";
import path from "node:path";
import { ROOT, DEFAULT_HOME, LEGACY_HOME, homeDir, configPath } from "./config.ts";

// Issue key đi thẳng vào path của request ghi (/issues/<key>) -> chỉ nhận đúng dạng PROJECT-123,
// không để chuỗi như "../projects/X" đổi endpoint.
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
export function checkKey(key: string): string {
  if (!ISSUE_KEY.test(key)) throw new Error(`Issue key không hợp lệ: "${key}" (dạng PROJECT-123)`);
  return key;
}

const realpath = (p: string) => { try { return fs.realpathSync(p); } catch { return undefined; } };

// --file đọc nội dung để đăng lên Backlog (có thể là space khách) và in ra ở bản DRY. Chặn đúng những
// thứ chứa secret / dữ liệu riêng: .env*, thư mục state/ (của home tên mới, tên cũ, $BACKLOG_BRIDGE_HOME
// và repo) và file config — kể cả qua symlink. Các file khác trong home (vd bản nháp trả lời khách khi
// home là một repo config riêng) vẫn đăng được.
export function safeCommentFile(file: string): string {
  const p = fs.realpathSync(path.resolve(file));
  const stateDirs = [homeDir(), DEFAULT_HOME, LEGACY_HOME, ROOT]
    .map((d) => realpath(path.join(d, "state")))
    .filter((d): d is string => Boolean(d));
  const configFiles = [configPath(), path.join(homeDir(), "config.json")]
    .map(realpath)
    .filter((f): f is string => Boolean(f));
  const inState = stateDirs.some((d) => p === d || p.startsWith(d + path.sep));
  if (/^\.env/.test(path.basename(p)) || inState || configFiles.includes(p)) {
    throw new Error(`Không đăng nội dung file ${p}: file chứa secret / dữ liệu riêng`);
  }
  return p;
}
