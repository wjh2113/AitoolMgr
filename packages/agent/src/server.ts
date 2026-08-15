import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { AgentConfig, DispatchRequest, HandoffRequest } from "@toolmgr/core";
import type { OfficeEngine } from "@aitoolmgr/adapter-sdk";
import type { Orchestrator } from "./orchestrator.js";

import type { Store } from "./store.js";

export function createApp(
  orchestrator: Orchestrator,
  config: AgentConfig,
  office?: OfficeEngine,
  store?: Store,
) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  const auth = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const token = req.header("x-toolmgr-token");
    const remote =
      req.ip &&
      req.ip !== "127.0.0.1" &&
      req.ip !== "::1" &&
      req.ip !== ":ffff:127.0.0.1";
    if (remote && token !== config.pairingToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      machineId: orchestrator.machineId,
      db: store?.path,
    });
  });

  app.get("/api/db/stats", auth, (_req, res) => {
    if (!store) {
      res.status(404).json({ error: "store unavailable" });
      return;
    }
    res.json({
      path: store.path,
      machines: store.listMachines().length,
      sessions: store.listSessions().length,
      tasks: store.listTasks().length,
      events: store.listEvents(500).length,
      seats: store.listSeats().length,
      openAlerts: store.listOpenAlerts().length,
    });
  });

  app.get("/api/snapshot", auth, (_req, res) => {
    res.json(orchestrator.getSnapshot());
  });

  app.get("/api/office", auth, (_req, res) => {
    if (!office) {
      res.json({
        generatedAt: new Date().toISOString(),
        simulatedMode: false,
        machines: [],
        tools: [],
        agents: [],
        seats: [],
        alerts: [],
        tasks: [],
        note: "Office engine disabled (TOOLMGR_SIMULATOR=false and no adapters)",
      });
      return;
    }
    res.json(office.snapshot());
  });

  app.post("/api/office/sim/start", auth, (req, res) => {
    if (!office) {
      res.status(400).json({ error: "Simulator offline" });
      return;
    }
    const snap = office.snapshot();
    const tool =
      snap.tools.find((t) => t.id === req.body?.toolInstanceId) ||
      snap.tools.find((t) => t.toolType === "openclaw") ||
      snap.tools[0];
    if (!tool) {
      res.status(400).json({ error: "No simulated tool" });
      return;
    }
    office.ingest({
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      machineId: tool.machineId,
      toolType: tool.toolType,
      toolInstanceId: tool.id,
      agentId: req.body?.agentId,
      state: "STARTING",
      summary: String(req.body?.task || "Simulated task").slice(0, 200),
      needsAttention: false,
      confidence: 1,
      evidenceSource: "simulated",
      evidenceType: "api.office.sim.start",
      sensitivity: "metadata_only",
      simulated: true,
    });
    res.json({ ok: true, toolInstanceId: tool.id });
  });

  app.post("/api/dispatch", auth, async (req, res) => {
    try {
      const task = await orchestrator.dispatch(req.body as DispatchRequest);
      res.json(task);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/handoff", auth, async (req, res) => {
    try {
      const task = await orchestrator.handoff(req.body as HandoffRequest);
      res.json(task);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/sessions/:id/cancel", auth, async (req, res) => {
    try {
      await orchestrator.cancelSession(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/sessions/:id/approve", auth, async (req, res) => {
    try {
      const decision = req.body?.decision === "deny" ? "deny" : "allow";
      await orchestrator.approve(req.params.id, decision);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/sessions/:id/reply", auth, async (req, res) => {
    try {
      await orchestrator.reply(req.params.id, String(req.body?.text ?? ""));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/placement", auth, (req, res) => {
    const tools = String(req.query.tools || "fake")
      .split(",")
      .filter(Boolean) as never[];
    const cwd = req.query.cwd ? String(req.query.cwd) : undefined;
    res.json(orchestrator.suggestPlacement(tools, cwd));
  });

  app.post("/hooks/claude", (req, res) => {
    const session = orchestrator.ingestClaudeHook(req.body ?? {});
    res.json({ ok: true, sessionId: session?.id });
  });

  app.post("/hooks/cursor", (req, res) => {
    const session = orchestrator.ingestCursorHook(req.body ?? {});
    res.json({ ok: true, sessionId: session?.id });
  });

  app.post("/hub/heartbeat", auth, (req, res) => {
    if (!config.isHub) {
      res.status(400).json({ error: "This agent is not a hub" });
      return;
    }
    orchestrator.ingestRemoteSnapshot(req.body);
    res.json({ ok: true });
  });

  app.get("/hub/snapshot", auth, (_req, res) => {
    res.json(orchestrator.getSnapshot());
  });

  app.post("/api/notify/test", auth, async (_req, res) => {
    try {
      const result = await orchestrator.testFeishu();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return app;
}

export async function startServer(
  orchestrator: Orchestrator,
  config: AgentConfig,
  office?: OfficeEngine,
  store?: Store,
) {
  const app = createApp(orchestrator, config, office, store);
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  const broadcast = (data: unknown) => {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  };

  orchestrator.onEvent((event) => {
    broadcast({ type: "event", event, snapshot: orchestrator.getSnapshot() });
  });

  office?.onChange((officeSnapshot) => {
    broadcast({ type: "office", office: officeSnapshot });
  });

  wss.on("connection", (socket) => {
    socket.send(
      JSON.stringify({
        type: "snapshot",
        snapshot: orchestrator.getSnapshot(),
        office: office?.snapshot(),
      }),
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(config.port, config.host, () => resolve());
  });

  return { app, server, wss, broadcast };
}
