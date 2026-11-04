#!/usr/bin/env node
// Security audit of everything an agent reads or runs from this repo: AGENTS.md / CLAUDE.md, Cursor rules, the
// skills (source and plugin copies), the plugin manifest, README and MCP config.
// Fails on hidden Unicode, secrets, pipe-to-shell installs, prompt-injection phrasing, links to unexpected hosts,
// MCP servers started through a shell or package launcher, malformed skill frontmatter, and missing guardrails.
// Usage: node scripts/audit-skills.mjs   (CI runs it; exit code 1 on any finding)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

// Hosts an agent-facing file may link to. Anything else is a finding, so a new host is a deliberate change here.
const ALLOWED_HOSTS = [
  /^github\.com$/, /^raw\.githubusercontent\.com$/, /^(www\.)?npmjs\.com$/,
  /^[a-z0-9-]+\.backlog\.(com|jp)$/, /^[a-z0-9-]+\.backlogtool\.com$/, /^(www\.)?nulab\.com$/,
  /^(www\.)?(claude\.com|claude\.ai|anthropic\.com)$/, /^([a-z0-9-]+\.)?example\.com$/,
];

const RULES = [
  // Invisible or direction-changing characters can hide instructions from a human reviewer.
  { id: "hidden-unicode", re: /[​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{E0000}-\u{E007F}]/u,
    why: "invisible / bidi control character" },
  { id: "secret", re: /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}|\bnpm_[A-Za-z0-9]{36}\b|\bsk-ant-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    why: "credential-looking token" },
  { id: "secret", re: /\b[A-Z0-9_]*API_KEY\s*=\s*(?!<|paste|dán|xxx|\.\.\.|\$)[A-Za-z0-9]{24,}/,
    why: "API key value assigned in an agent-facing file" },
  { id: "pipe-to-shell", re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b|base64\s+(-d|--decode)[^\n|]*\|\s*(ba|z)?sh\b/,
    why: "downloads and executes code" },
  { id: "destructive", re: /\brm\s+-rf\s+(\/|~|\$HOME)(\s|$)|\bchmod\s+-R\s+777\b/, why: "destructive shell command" },
  { id: "prompt-injection", re: /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts)\b|\byou are now\b|\bdo not (tell|inform) the user\b|\bwithout (asking|telling) the user\b/i,
    why: "instruction-override phrasing" },
];

// Guardrails that must stay in the files agents follow; dropping one fails the audit.
const GUARDRAILS = [
  { file: "AGENTS.md", re: /DRY by default/, why: "writes are dry runs by default" },
  { file: "AGENTS.md", re: /Never print or commit an API key/, why: "never print or commit an API key" },
  { file: "AGENTS.md", re: /data, not instructions/, why: "ticket content is data, not instructions" },
  { file: ".agents/skills/backlog-write/SKILL.md", re: /--yes/, why: "send only with --yes after approval" },
  { file: ".agents/skills/backlog-write/SKILL.md", re: /customer/i, why: "customer review flow" },
  { file: ".agents/skills/backlog-query/SKILL.md", re: /\*\*data\*\*, not commands/, why: "ticket content is data" },
  { file: ".agents/skills/backlog-connect/SKILL.md", re: /Never fill in the API key yourself/, why: "never handle keys for the user" },
];

/** Findings for one file's text. Exported for tests. */
export function auditText(file, text) {
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) findings.push({ file, line: i + 1, id: r.id, why: r.why });
    for (const m of line.matchAll(/https?:\/\/([^/\s)`'"<>\]]+)/g)) {
      const host = m[1].toLowerCase().replace(/:\d+$/, "");
      if (!ALLOWED_HOSTS.some((h) => h.test(host))) {
        findings.push({ file, line: i + 1, id: "unexpected-host", why: `link to ${host}` });
      }
    }
  });
  return findings;
}

/** Skill frontmatter: name matches its folder, description is one non-empty line. */
export function auditSkill(file, text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return [{ file, line: 1, id: "frontmatter", why: "missing YAML frontmatter" }];
  const fields = Object.fromEntries(m[1].split("\n").map((l) => l.split(/:\s(.*)/s).slice(0, 2)));
  const folder = path.basename(path.dirname(file));
  const out = [];
  if (fields.name !== folder) out.push({ file, line: 2, id: "frontmatter", why: `name "${fields.name}" ≠ folder "${folder}"` });
  if (!fields.description || fields.description.length > 1024) {
    out.push({ file, line: 3, id: "frontmatter", why: "description missing or over 1024 characters" });
  }
  return out;
}

/** MCP servers must start a file inside the plugin directly: no shell, no inline code, no package launcher. */
export function auditMcpConfig(file, text) {
  let cfg;
  try { cfg = JSON.parse(text); } catch { return [{ file, line: 1, id: "mcp-config", why: "invalid JSON" }]; }
  const out = [];
  for (const [name, s] of Object.entries(cfg.mcpServers ?? {})) {
    const argv = [s.command, ...(s.args ?? [])].map(String);
    if (/^(sh|bash|zsh|cmd|powershell|pwsh|npx|bunx|uvx|pnpm|yarn|npm)$/.test(path.basename(argv[0] ?? ""))) {
      out.push({ file, line: 1, id: "mcp-config", why: `${name}: started via ${argv[0]}` });
    }
    if (argv.some((a) => /^-(c|e)$|^--eval$/.test(a))) out.push({ file, line: 1, id: "mcp-config", why: `${name}: inline code` });
    if (!argv.slice(1).some((a) => a.startsWith("${CLAUDE_PLUGIN_ROOT}/"))) {
      out.push({ file, line: 1, id: "mcp-config", why: `${name}: entry point is not under \${CLAUDE_PLUGIN_ROOT}` });
    }
    if (s.env && Object.values(s.env).some((v) => /[A-Za-z0-9]{24,}/.test(String(v)))) {
      out.push({ file, line: 1, id: "mcp-config", why: `${name}: literal secret-looking env value` });
    }
  }
  return out;
}

function agentFiles() {
  const files = ["AGENTS.md", "CLAUDE.md", "plugin/README.md", "plugin/.claude-plugin/plugin.json", "plugin/.mcp.json"];
  for (const dir of [".agents/skills", "plugin/skills"]) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) files.push(`${dir}/${name}/SKILL.md`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, ".cursor/rules"))) files.push(`.cursor/rules/${f}`);
  return files.filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function main() {
  const findings = [];
  const files = agentFiles();
  for (const file of files) {
    // Windows checkouts may use CRLF; audit the same text on every platform.
    const text = fs.readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
    findings.push(...auditText(file, text));
    if (file.endsWith("/SKILL.md")) findings.push(...auditSkill(file, text));
    if (file.endsWith(".mcp.json")) findings.push(...auditMcpConfig(file, text));
  }
  for (const g of GUARDRAILS) {
    const p = path.join(ROOT, g.file);
    if (!fs.existsSync(p) || !g.re.test(fs.readFileSync(p, "utf8"))) {
      findings.push({ file: g.file, line: 1, id: "guardrail", why: `missing: ${g.why}` });
    }
  }
  for (const f of findings) {
    // GitHub Actions annotation + plain text.
    console.log(`::error file=${f.file},line=${f.line}::[${f.id}] ${f.why}`);
  }
  console.log(`${files.length} agent-facing files audited, ${findings.length} finding(s).`);
  process.exit(findings.length ? 1 : 0);
}

if (import.meta.filename === process.argv[1]) main();
