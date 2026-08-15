#!/usr/bin/env node
/**
 * Install Claude Code hooks that POST lifecycle events to toolmgr-agent.
 * Usage: node scripts/install-hooks/install-claude-hooks.mjs [agentUrl]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const agentUrl = process.argv[2] || "http://127.0.0.1:7788";
const home = os.homedir();
const settingsPath = path.join(home, ".claude", "settings.json");
const hookDir = path.join(home, ".claude", "hooks");
const hookScript = path.join(hookDir, "toolmgr-hook.mjs");

fs.mkdirSync(hookDir, { recursive: true });

const script = `#!/usr/bin/env node
import fs from "node:fs";

const AGENT = ${JSON.stringify(agentUrl)};

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { payload = { raw }; }
  try {
    await fetch(AGENT + "/hooks/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    fs.appendFileSync(
      new URL("./toolmgr-hook.log", import.meta.url),
      String(err) + "\\n",
    );
  }
  process.exit(0);
});
`;

fs.writeFileSync(hookScript, script, "utf8");

let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    settings = {};
  }
}

const command = `node "${hookScript.replace(/\\/g, "/")}"`;
const events = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Stop",
  "Notification",
  "PreToolUse",
  "PostToolUse",
];

settings.hooks = settings.hooks || {};
for (const event of events) {
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const filtered = list.filter(
    (h) => !(h?.hooks || []).some((x) => String(x.command || "").includes("toolmgr-hook")),
  );
  filtered.push({
    hooks: [{ type: "command", command }],
  });
  settings.hooks[event] = filtered;
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log(`Installed Claude Code hooks → ${settingsPath}`);
console.log(`Hook script → ${hookScript}`);
console.log(`Agent URL → ${agentUrl}`);
