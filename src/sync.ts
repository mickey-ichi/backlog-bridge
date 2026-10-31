#!/usr/bin/env node
// backlog-bridge sync CLI — chạy thủ công, chọn cặp project bằng --profile.
//
//   node src/sync.ts --list                              # xem các profile
//   node src/sync.ts --profile=acme --dry-run            # khách -> nội bộ (mirror)
//   node src/sync.ts --profile=acme-progress             # nội bộ -> khách (progress)
//
// mode=mirror   : tạo/cập nhật issue mirror ở đích. Mặc định LIVE, có --dry-run.
// mode=progress : chỉ update tiến độ lên issue có sẵn ở đích, không tạo issue mới.
//                 Mặc định DRY-RUN (đích là Backlog khách) — phải --live mới ghi.
import { loadEnv, loadConfig, getProfile, hasFlag, argValue } from "./config.ts";

loadEnv();

async function main(): Promise<void> {
  const config = loadConfig();

  if (hasFlag("list")) {
    console.log(`Default profile: ${config.defaultProfile ?? "(chưa có — xem config.example.json)"}\n`);
    for (const [name, p] of Object.entries(config.profiles || {})) {
      console.log(`${name}  (mode=${p.mode})`);
      console.log(`  ${p.source.space}/${p.source.projectKey}  ->  ${p.dest.space}/${p.dest.projectKey}`);
      if (p.note) console.log(`  ${p.note}`);
      console.log("");
    }
    return;
  }

  const { profileName, profile } = getProfile(config, argValue("profile"));
  // Import lười: chỉ nạp module của mode đang chạy.
  if (profile.mode === "mirror") {
    await (await import("./mirror.ts")).run({ config, profile, profileName });
  } else if (profile.mode === "progress") {
    await (await import("./progress.ts")).run({ config, profile, profileName });
  } else {
    const mode = (profile as { mode: string }).mode;
    throw new Error(`Profile "${profileName}": mode "${mode}" không hỗ trợ (mirror | progress)`);
  }
}

main().catch((err: Error) => {
  console.error("\nSync failed:", err.message);
  process.exit(1);
});
