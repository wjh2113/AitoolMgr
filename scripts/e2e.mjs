/**
 * End-to-end checks: starts nothing — expects agent already running,
 * or set TOOLMGR_E2E_START=1 to spawn agent for this process.
 *
 * Usage:
 *   node scripts/e2e.mjs
 *   TOOLMGR_URL=http://127.0.0.1:7799 node scripts/e2e.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const port = process.env.TOOLMGR_PORT || "7798";
const base = process.env.TOOLMGR_URL || `http://127.0.0.1:${port}`;
const token = process.env.TOOLMGR_PAIRING_TOKEN || "change-me";

let child = null;
const failures = [];

function ok(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

async function waitHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return r.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`agent not healthy at ${base}`);
}

async function json(url, init) {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, body };
}

async function maybeStartAgent() {
  if (process.env.TOOLMGR_E2E_START !== "1") return;
  const dataDir = path.join(root, "data", "e2e");
  child = spawn(
    process.execPath,
    [path.join(root, "packages/agent/dist/cli.js")],
    {
      cwd: root,
      env: {
        ...process.env,
        TOOLMGR_PORT: port,
        TOOLMGR_HOST: "127.0.0.1",
        TOOLMGR_DATA_DIR: dataDir,
        TOOLMGR_IS_HUB: "true",
        TOOLMGR_SIMULATOR: "true",
        TOOLMGR_PAIRING_TOKEN: token,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout.on("data", (d) => process.stdout.write(`[agent] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[agent] ${d}`));
}

async function main() {
  await maybeStartAgent();
  const health = await waitHealth();
  ok("health", health.ok === true, `machine=${health.machineId}`);
  ok("health.db", typeof health.db === "string" && health.db.includes(".sqlite"), health.db);

  const db = await json(`${base}/api/db/stats`);
  ok("db.stats", db.ok, JSON.stringify(db.body));

  const office = await json(`${base}/api/office`);
  ok("office.snapshot", office.ok && Array.isArray(office.body.seats));
  ok(
    "office.simulated",
    office.body.simulatedMode === true,
    `seats=${office.body.seats?.length}`,
  );
  ok(
    "office.machines",
    Array.isArray(office.body.machines) && office.body.machines.length >= 1,
  );
  ok(
    "office.has-openclaw-agents",
    (office.body.seats || []).some((s) => s.toolType === "openclaw"),
  );

  const dispatch = await json(`${base}/api/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "E2E: finish without approval keyword",
      tool: "fake",
    }),
  });
  ok("dispatch", dispatch.ok && dispatch.body.id, dispatch.body.id);
  const taskId = dispatch.body.id;

  await new Promise((r) => setTimeout(r, 3000));

  const snap1 = await json(`${base}/api/snapshot`);
  ok("snapshot.after-dispatch", snap1.ok && snap1.body.tasks?.length >= 1);

  const hook = await json(`${base}/hooks/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hook_event_name: "Notification",
      session_id: "e2e-claude",
      message: "needs input",
      notification_type: "permission_prompt",
    }),
  });
  ok("hooks.claude", hook.ok && hook.body.sessionId);

  const hb = await json(`${base}/hub/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-toolmgr-token": token,
    },
    body: JSON.stringify({
      machine: {
        id: "machine_e2e_remote",
        name: "e2e-laptop",
        host: "10.0.0.8:7788",
        os: "darwin-arm64",
        isHub: false,
        online: true,
        lastSeenAt: new Date().toISOString(),
      },
      sessions: [
        {
          id: "sess_e2e_remote",
          machineId: "machine_e2e_remote",
          tool: "codex",
          title: "remote",
          state: "busy",
          lastEventAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      tasks: [],
    }),
  });
  ok("hub.heartbeat", hb.ok);

  if (taskId) {
    const handoff = await json(`${base}/api/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        targetTool: "fake",
        notes: "e2e handoff",
      }),
    });
    ok("handoff", handoff.ok && handoff.body.sourceTaskId === taskId);
  }

  const sim = await json(`${base}/api/office/sim/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: "researcher",
      task: "e2e simulated desk task",
    }),
  });
  ok("office.sim.start", sim.ok);

  await new Promise((r) => setTimeout(r, 500));
  const db2 = await json(`${base}/api/db/stats`);
  ok(
    "db.persisted",
    db2.ok &&
      Number(db2.body.machines) >= 1 &&
      Number(db2.body.seats) >= 1,
    JSON.stringify(db2.body),
  );

  const snap2 = await json(`${base}/api/snapshot`);
  ok(
    "multi-machine",
    (snap2.body.machines || []).some((m) => m.id === "machine_e2e_remote"),
  );

  console.log("\n--- summary ---");
  if (failures.length) {
    console.error(`${failures.length} failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("all checks passed");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  });
