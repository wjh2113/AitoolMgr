/**
 * Lightweight integration checks against a running local agent.
 * Usage: node scripts/smoke.mjs
 */
const base = process.env.TOOLMGR_URL || "http://127.0.0.1:7788";

async function main() {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  console.log("health", health);

  const task = await fetch(`${base}/api/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Quick smoke: finish without approval",
      tool: "fake",
    }),
  }).then((r) => r.json());
  console.log("dispatch", task.id, task.status);

  await new Promise((r) => setTimeout(r, 2800));

  const hook = await fetch(`${base}/hooks/claude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hook_event_name: "Notification",
      session_id: "smoke-claude",
      message: "needs input",
      notification_type: "permission_prompt",
    }),
  }).then((r) => r.json());
  console.log("claude hook", hook);

  const hb = await fetch(`${base}/hub/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-toolmgr-token": process.env.TOOLMGR_PAIRING_TOKEN || "change-me",
    },
    body: JSON.stringify({
      machine: {
        id: "machine_remote_smoke",
        name: "smoke-laptop",
        host: "10.0.0.9:7788",
        os: "linux-x64",
        isHub: false,
        online: true,
        lastSeenAt: new Date().toISOString(),
      },
      sessions: [
        {
          id: "sess_remote_smoke",
          machineId: "machine_remote_smoke",
          tool: "codex",
          title: "remote codex",
          state: "busy",
          lastEventAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      tasks: [],
    }),
  }).then((r) => r.json());
  console.log("heartbeat", hb);

  if (task.id) {
    const handoff = await fetch(`${base}/api/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        targetTool: "fake",
        notes: "smoke handoff",
      }),
    }).then((r) => r.json());
    console.log("handoff", handoff.id, handoff.status, handoff.sourceTaskId);
  }

  const snap = await fetch(`${base}/api/snapshot`).then((r) => r.json());
  console.log(
    "snapshot machines=",
    snap.machines.map((m) => `${m.name}:${m.online}`).join(", "),
  );
  console.log(
    "attention=",
    snap.sessions.filter((s) => s.state === "needs_attention").length,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
