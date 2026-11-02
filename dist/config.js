// Load .env + resolve spaces/profiles from config.json.
//
// Private data (API keys, config.json, state/) does NOT live in the repo but in the "home" directory:
//   $BACKLOG_BRIDGE_HOME  >  ~/.config/backlog-bridge  >  ~/.config/backlog-sync (old name)  >  repo root
// (a ~/.config directory is only picked if it already exists). The config file can be set separately with $BACKLOG_BRIDGE_CONFIG.
// Old-name BACKLOG_SYNC_* variables are still accepted as a fallback so installs from before the rename don't break.
// Without config.json, the CLI still runs using only the <PREFIX>_SPACE / <PREFIX>_API_KEY environment variables.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// src/ when running .ts directly, dist/ when running the build — both sit directly under the repo root.
export const ROOT = path.join(import.meta.dirname, "..");
export const DEFAULT_HOME = path.join(os.homedir(), ".config", "backlog-bridge");
export const LEGACY_HOME = path.join(os.homedir(), ".config", "backlog-sync");
export function setting(name) {
    return process.env[`BACKLOG_BRIDGE_${name}`] || process.env[`BACKLOG_SYNC_${name}`];
}
export function reviewPrefs() {
    const raw = process.env.BACKLOG_BRIDGE_REVIEW?.trim().toLowerCase();
    const valid = raw === "bilingual" || raw === "translate";
    return {
        mode: valid ? raw : undefined,
        invalid: raw && !valid ? raw : undefined,
        lang: process.env.BACKLOG_BRIDGE_LANG?.trim() || "vi",
        customerLang: process.env.BACKLOG_BRIDGE_CUSTOMER_LANG?.trim() || "ja",
    };
}
export function homeDir() {
    const configured = setting("HOME");
    if (configured)
        return path.resolve(configured);
    return [DEFAULT_HOME, LEGACY_HOME].find((d) => fs.existsSync(d)) || ROOT;
}
// The .env files being read (home first, then repo).
export function envFiles() {
    return [...new Set([homeDir(), ROOT])].map((d) => path.join(d, ".env")).filter((p) => fs.existsSync(p));
}
// .env holds API keys -> only the machine owner may read it (chmod 600).
export function looseEnvFiles() {
    return envFiles().filter((p) => (fs.statSync(p).mode & 0o077) !== 0);
}
export function configPath() {
    const configured = setting("CONFIG");
    return configured ? path.resolve(configured) : path.join(homeDir(), "config.json");
}
// Tiny .env parser (no external dependencies). Variables already in the environment always win;
// the home .env is read first, the repo .env only fills in what is missing (while gradually moving to home).
export function loadEnv() {
    for (const p of envFiles()) {
        for (const line of fs.readFileSync(p, "utf8").split("\n")) {
            if (/^\s*#/.test(line))
                continue;
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
            if (m && !(m[1] in process.env))
                process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
    }
}
export function loadConfig() {
    const p = configPath();
    const config = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { spaces: {}, profiles: {} };
    config.defaultProfile = setting("PROFILE") || config.defaultProfile;
    return config;
}
// spaces."<name>" -> { env, envFallback } -> read <PREFIX>_SPACE / <PREFIX>_API_KEY.
export function credentials(config, spaceName) {
    // Not declared in config.json -> use prefix = uppercased space name (acme -> ACME_*, acme_jp -> ACME_JP_*).
    const spec = config.spaces?.[spaceName] || { env: spaceName.toUpperCase().replace(/[^A-Z0-9_]/g, "_") };
    // Host and key must come from the SAME prefix: pairing one prefix's SPACE with another prefix's API_KEY
    // would send space A's key to space B's host.
    const prefix = [spec.env, spec.envFallback].find((p) => p && process.env[`${p}_SPACE`] && process.env[`${p}_API_KEY`]);
    const space = prefix && process.env[`${prefix}_SPACE`];
    const apiKey = prefix && process.env[`${prefix}_API_KEY`];
    if (!space || !apiKey) {
        throw new Error(`Missing ${spec.env}_SPACE / ${spec.env}_API_KEY in .env (space "${spaceName}"). See .env.example.`);
    }
    return { space, apiKey };
}
// All usable spaces: declared in config.json + auto-detected <PREFIX>_SPACE/<PREFIX>_API_KEY pairs
// in .env (space name = lowercased prefix). So connecting another Backlog only takes 2 lines in .env.
export function allSpaces(config) {
    const out = {};
    const usedPrefixes = new Set(["SOURCE", "DEST"]);
    for (const [name, spec] of Object.entries(config.spaces || {})) {
        [spec.env, spec.envFallback].forEach((p) => p && usedPrefixes.add(p));
        try {
            out[name] = { ...credentials(config, name), env: spec.env, from: "config" };
        }
        catch {
            out[name] = { env: spec.env, from: "config", missing: true };
        }
    }
    for (const key of Object.keys(process.env)) {
        const m = key.match(/^([A-Z0-9][A-Z0-9_]*)_SPACE$/);
        if (!m || usedPrefixes.has(m[1]) || !process.env[`${m[1]}_API_KEY`])
            continue;
        out[m[1].toLowerCase()] = {
            space: process.env[key], apiKey: process.env[`${m[1]}_API_KEY`], env: m[1], from: "env",
        };
    }
    return out;
}
export function hostOf(space) {
    return space.includes(".") ? space : `${space}.backlog.com`;
}
export function getProfile(config, name) {
    const profileName = name || config.defaultProfile || "";
    const profile = config.profiles?.[profileName];
    if (!profile) {
        throw new Error(`No profile "${profileName}". Available: ${Object.keys(config.profiles || {}).join(", ")}`);
    }
    return { profileName, profile };
}
// Relative paths in config.json (state, pairFile) are resolved from the home directory.
export function resolvePath(relative) {
    return path.isAbsolute(relative) ? relative : path.join(homeDir(), relative);
}
export function readJson(relative, fallback) {
    try {
        return JSON.parse(fs.readFileSync(resolvePath(relative), "utf8"));
    }
    catch {
        return fallback;
    }
}
export function writeJson(relative, data) {
    const p = resolvePath(relative);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return p;
}
// --flag / --flag=value
export function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}
export function argValue(name) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
}
