#!/usr/bin/env node
// backlog-bridge sync CLI — run manually, pick the project pair with --profile.
//
//   node src/sync.ts --list                              # list profiles
//   node src/sync.ts --profile=acme --dry-run            # customer -> internal (mirror)
//   node src/sync.ts --profile=acme-progress             # internal -> customer (progress)
//
// mode=mirror   : create/update mirror issues at the destination. LIVE by default, --dry-run available.
// mode=progress : only update progress on existing issues at the destination, never create new ones.
//                 DRY-RUN by default (the destination is the customer's Backlog) — --live is required to write.
import { loadEnv, loadConfig, getProfile, hasFlag, argValue } from "./config.ts";

loadEnv();

async function main(): Promise<void> {
  const config = loadConfig();

  if (hasFlag("list")) {
    console.log(`Default profile: ${config.defaultProfile ?? "(none — see config.example.json)"}\n`);
    for (const [name, p] of Object.entries(config.profiles || {})) {
      console.log(`${name}  (mode=${p.mode})`);
      console.log(`  ${p.source.space}/${p.source.projectKey}  ->  ${p.dest.space}/${p.dest.projectKey}`);
      if (p.note) console.log(`  ${p.note}`);
      console.log("");
    }
    return;
  }

  const { profileName, profile } = getProfile(config, argValue("profile"));
  // Lazy import: only load the module for the mode being run.
  if (profile.mode === "mirror") {
    await (await import("./mirror.ts")).run({ config, profile, profileName });
  } else if (profile.mode === "progress") {
    await (await import("./progress.ts")).run({ config, profile, profileName });
  } else {
    const mode = (profile as { mode: string }).mode;
    throw new Error(`Profile "${profileName}": mode "${mode}" not supported (mirror | progress)`);
  }
}

main().catch((err: Error) => {
  console.error("\nSync failed:", err.message);
  process.exit(1);
});
