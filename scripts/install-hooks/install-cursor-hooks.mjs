#!/usr/bin/env node
/**
 * Write a Cursor hooks.json snippet that POSTs to toolmgr-agent.
 * Usage: node scripts/install-hooks/install-cursor-hooks.mjs [projectDir] [agentUrl]
 */
import fs from "node:fs";
import path from "node:path";

const projectDir = process.argv[2] || process.cwd();
const agentUrl = process.argv[3] || "http://127.0.0.1:7788";
const cursorDir = path.join(projectDir, ".cursor");
const hooksPath = path.join(cursorDir, "hooks.json");
const scriptPath = path.join(cursorDir, "toolmgr-cursor-hook.mjs");

fs.mkdirSync(cursorDir, { recursive: true });

const script = `#!/usr/bin/env node
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", async () => {
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { payload = { raw }; }
  payload.event = payload.hook_event_name || payload.event || process.env.CURSOR_HOOK_EVENT;
  try {
    await fetch(${JSON.stringify(agentUrl)} + "/hooks/cursor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {}
  process.exit(0);
});
`;

fs.writeFileSync(scriptPath, script, "utf8");

const command = `node "${scriptPath.replace(/\\/g, "/")}"`;
const hooks = {
  version: 1,
  hooks: {
    stop: [{ command }],
    beforeShellExecution: [{ command }],
    beforeMCPExecution: [{ command }],
  },
};

fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));
console.log(`Wrote Cursor hooks → ${hooksPath}`);
console.log(`Agent URL → ${agentUrl}`);
