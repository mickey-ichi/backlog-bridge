// Load .env + resolve spaces/profiles từ config.json.
//
// Dữ liệu riêng (API key, config.json, state/) KHÔNG nằm trong repo mà ở thư mục "home":
//   $BACKLOG_BRIDGE_HOME  >  ~/.config/backlog-bridge  >  ~/.config/backlog-sync (tên cũ)  >  gốc repo
// (thư mục ~/.config chỉ được chọn nếu đã tồn tại). File config chỉ định riêng bằng $BACKLOG_BRIDGE_CONFIG.
// Biến tên cũ BACKLOG_SYNC_* vẫn nhận làm fallback để máy cài trước khi đổi tên không bị vỡ.
// Không có config.json thì vẫn chạy được bl.ts chỉ với biến môi trường <PREFIX>_SPACE / <PREFIX>_API_KEY.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config, Credentials, Profile } from "./types.ts";

// src/ khi chạy thẳng .ts, dist/ khi chạy bản build — cả hai đều nằm ngay dưới gốc repo.
export const ROOT = path.join(import.meta.dirname, "..");
export const DEFAULT_HOME = path.join(os.homedir(), ".config", "backlog-bridge");
export const LEGACY_HOME = path.join(os.homedir(), ".config", "backlog-sync");

export function setting(name: "HOME" | "CONFIG" | "PROFILE"): string | undefined {
  return process.env[`BACKLOG_BRIDGE_${name}`] || process.env[`BACKLOG_SYNC_${name}`];
}

// Cách duyệt nội dung trước khi gửi khách — theo từng người, nên đặt trong .env của mình:
//   BACKLOG_BRIDGE_REVIEW=bilingual  đọc được tiếng của khách: duyệt bản song ngữ, chỉ gửi bản tiếng khách
//   BACKLOG_BRIDGE_REVIEW=translate  không đọc được: chỉ duyệt bản tiếng mình, agent dịch rồi gửi luôn
//   BACKLOG_BRIDGE_LANG (mặc định vi), BACKLOG_BRIDGE_CUSTOMER_LANG (mặc định ja)
export type ReviewMode = "bilingual" | "translate";
export interface ReviewPrefs {
  mode?: ReviewMode;
  invalid?: string;
  lang: string;
  customerLang: string;
}

export function reviewPrefs(): ReviewPrefs {
  const raw = process.env.BACKLOG_BRIDGE_REVIEW?.trim().toLowerCase();
  const valid = raw === "bilingual" || raw === "translate";
  return {
    mode: valid ? raw : undefined,
    invalid: raw && !valid ? raw : undefined,
    lang: process.env.BACKLOG_BRIDGE_LANG?.trim() || "vi",
    customerLang: process.env.BACKLOG_BRIDGE_CUSTOMER_LANG?.trim() || "ja",
  };
}

export interface SpaceEntry extends Partial<Credentials> {
  env: string;
  from: "config" | "env";
  missing?: boolean;
}

export function homeDir(): string {
  const configured = setting("HOME");
  if (configured) return path.resolve(configured);
  return [DEFAULT_HOME, LEGACY_HOME].find((d) => fs.existsSync(d)) || ROOT;
}

// Các file .env đang được đọc (home trước, repo sau).
export function envFiles(): string[] {
  return [...new Set([homeDir(), ROOT])].map((d) => path.join(d, ".env")).filter((p) => fs.existsSync(p));
}

// .env chứa API key -> chỉ chủ máy được đọc (chmod 600).
export function looseEnvFiles(): string[] {
  return envFiles().filter((p) => (fs.statSync(p).mode & 0o077) !== 0);
}

export function configPath(): string {
  const configured = setting("CONFIG");
  return configured ? path.resolve(configured) : path.join(homeDir(), "config.json");
}

// Tiny .env parser (không dùng dependency ngoài). Biến đã có trong môi trường luôn thắng;
// .env ở home đọc trước, .env ở repo chỉ bù phần còn thiếu (giai đoạn chuyển dần sang home).
export function loadEnv(): void {
  for (const p of envFiles()) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function loadConfig(): Config {
  const p = configPath();
  const config: Config = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { spaces: {}, profiles: {} };
  config.defaultProfile = setting("PROFILE") || config.defaultProfile;
  return config;
}

// spaces."<name>" -> { env, envFallback } -> đọc <PREFIX>_SPACE / <PREFIX>_API_KEY.
export function credentials(config: Config, spaceName: string): Credentials {
  // Không khai trong config.json -> dùng prefix = tên space viết hoa (acme -> ACME_*, acme_jp -> ACME_JP_*).
  const spec = config.spaces?.[spaceName] || { env: spaceName.toUpperCase().replace(/[^A-Z0-9_]/g, "_") };
  // Host và key phải lấy từ CÙNG một prefix: ghép SPACE của prefix này với API_KEY của prefix khác
  // là gửi key của space A sang host của space B.
  const prefix = [spec.env, spec.envFallback].find(
    (p) => p && process.env[`${p}_SPACE`] && process.env[`${p}_API_KEY`]
  );
  const space = prefix && process.env[`${prefix}_SPACE`];
  const apiKey = prefix && process.env[`${prefix}_API_KEY`];
  if (!space || !apiKey) {
    throw new Error(
      `Thiếu ${spec.env}_SPACE / ${spec.env}_API_KEY trong .env (space "${spaceName}"). Xem .env.example.`
    );
  }
  return { space, apiKey };
}

// Mọi space dùng được: khai trong config.json + tự phát hiện cặp <PREFIX>_SPACE/<PREFIX>_API_KEY
// trong .env (tên space = prefix viết thường). Nhờ vậy nối thêm 1 Backlog chỉ cần thêm 2 dòng .env.
export function allSpaces(config: Config): Record<string, SpaceEntry> {
  const out: Record<string, SpaceEntry> = {};
  const usedPrefixes = new Set(["SOURCE", "DEST"]);
  for (const [name, spec] of Object.entries(config.spaces || {})) {
    [spec.env, spec.envFallback].forEach((p) => p && usedPrefixes.add(p));
    try { out[name] = { ...credentials(config, name), env: spec.env, from: "config" }; }
    catch { out[name] = { env: spec.env, from: "config", missing: true }; }
  }
  for (const key of Object.keys(process.env)) {
    const m = key.match(/^([A-Z0-9][A-Z0-9_]*)_SPACE$/);
    if (!m || usedPrefixes.has(m[1]) || !process.env[`${m[1]}_API_KEY`]) continue;
    out[m[1].toLowerCase()] = {
      space: process.env[key], apiKey: process.env[`${m[1]}_API_KEY`], env: m[1], from: "env",
    };
  }
  return out;
}

export function hostOf(space: string): string {
  return space.includes(".") ? space : `${space}.backlog.com`;
}

export function getProfile(config: Config, name?: string): { profileName: string; profile: Profile } {
  const profileName = name || config.defaultProfile || "";
  const profile = config.profiles?.[profileName];
  if (!profile) {
    throw new Error(
      `Không có profile "${profileName}". Đang có: ${Object.keys(config.profiles || {}).join(", ")}`
    );
  }
  return { profileName, profile };
}

// Đường dẫn tương đối trong config.json (state, pairFile) tính từ thư mục home.
export function resolvePath(relative: string): string {
  return path.isAbsolute(relative) ? relative : path.join(homeDir(), relative);
}

export function readJson<T>(relative: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(resolvePath(relative), "utf8")); }
  catch { return fallback; }
}

export function writeJson(relative: string, data: unknown): string {
  const p = resolvePath(relative);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

// --flag / --flag=value
export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
export function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
