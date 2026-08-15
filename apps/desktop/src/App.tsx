import { useCallback, useEffect, useMemo, useState } from "react";
import type { ToolKind, ToolSession } from "@toolmgr/core";
import { TOOL_LABELS, STATE_LABELS } from "@toolmgr/core";
import {
  approveSession,
  cancelSession,
  connectWs,
  dispatchTask,
  fetchOffice,
  fetchSnapshot,
  handoffTask,
  replySession,
  type Snapshot,
} from "./api";
import { FleetGraph } from "./FleetGraph";
import { DispatchDrawer } from "./DispatchDrawer";
import { AttentionInbox } from "./AttentionInbox";
import { DigitalOffice, type OfficeSnapshot } from "./DigitalOffice";

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [office, setOffice] = useState<OfficeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [snap, off] = await Promise.all([fetchSnapshot(), fetchOffice()]);
      setSnapshot(snap);
      setOffice(off);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const ws = connectWs((msg) => {
      const data = msg as {
        type?: string;
        snapshot?: Snapshot;
        office?: OfficeSnapshot;
        event?: { type: string };
      };
      if (data.snapshot) setSnapshot(data.snapshot);
      if (data.office) setOffice(data.office);
      if (data.event?.type === "needs_attention") {
        setToast("A tool needs your attention");
      }
    });
    const poll = setInterval(() => void refresh(), 8000);
    return () => {
      ws.close();
      clearInterval(poll);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const selected = useMemo(
    () => snapshot?.sessions.find((s) => s.id === selectedId) ?? null,
    [snapshot, selectedId],
  );

  const attention = useMemo(
    () =>
      (snapshot?.sessions ?? []).filter((s) => s.state === "needs_attention"),
    [snapshot],
  );

  async function onDispatch(input: {
    prompt: string;
    tool: ToolKind;
    cwd?: string;
    machineId?: string;
  }) {
    setBusy(true);
    try {
      await dispatchTask({
        prompt: input.prompt,
        tool: input.tool,
        preferredTools: [input.tool],
        cwd: input.cwd,
        machineId: input.machineId,
      });
      setToast("Task dispatched");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onHandoff(session: ToolSession, targetTool: ToolKind) {
    const task = snapshot?.tasks.find((t) => t.assignedSessionId === session.id);
    if (!task) {
      // create then handoff via new dispatch with notes
      setBusy(true);
      try {
        await dispatchTask({
          prompt: session.summary || "Continue previous work",
          tool: targetTool,
          preferredTools: [targetTool],
          cwd: session.cwd,
          handoffNotes: `Handoff from ${session.tool} session ${session.id}`,
        });
        setToast(`Handed off to ${TOOL_LABELS[targetTool]}`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await handoffTask({
        taskId: task.id,
        targetTool,
        cwd: session.cwd,
        notes: `Switch from ${session.tool}`,
      });
      setToast(`Handed off to ${TOOL_LABELS[targetTool]}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          AiTool<span>Mgr</span>
        </div>
        <div className="top-meta">
          <span className="pill">
            {snapshot?.machine.name ?? "…"} · {snapshot?.machine.os ?? ""}
          </span>
          <span className="pill">
            OS runtime: {typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent)
              ? "macOS UI"
              : typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent)
                ? "Windows UI"
                : "Desktop UI"}
          </span>
          <span className="pill">
            {snapshot?.config.isHub ? "Hub" : "Worker"}
            {snapshot?.config.feishuConfigured ? " · Feishu on" : " · Feishu off"}
          </span>
          <span className="pill">
            {snapshot?.machines.filter((m) => m.online).length ?? 0} machines online
          </span>
          <button className="btn" onClick={() => void refresh()} disabled={busy}>
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="layout">
        <div className="stack">
          <DigitalOffice office={office} onRefresh={() => void refresh()} />

          <section className="panel">
            <div className="panel-head">
              <h2>Fleet map (legacy)</h2>
            </div>
            <div className="graph-wrap">
              {snapshot ? (
                <FleetGraph
                  machines={snapshot.machines}
                  sessions={snapshot.sessions}
                  tasks={snapshot.tasks}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ) : (
                <p className="empty">Connecting to agent…</p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Session board</h2>
            </div>
            <div className="session-list">
              {(snapshot?.sessions ?? []).map((s) => (
                <div
                  key={s.id}
                  className={`row ${selectedId === s.id ? "active" : ""}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div className={`state-dot state-${s.state}`} />
                  <div>
                    <h3>
                      {TOOL_LABELS[s.tool] ?? s.tool} · {s.title}
                    </h3>
                    <p>
                      {STATE_LABELS[s.state]}
                      {s.cwd ? ` · ${s.cwd}` : ""}
                    </p>
                    {s.summary ? <p>{s.summary}</p> : null}
                  </div>
                  <div className="actions">
                    {s.state === "needs_attention" ? (
                      <>
                        <button
                          className="btn primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            void approveSession(s.id, "allow").then(refresh);
                          }}
                        >
                          Approve
                        </button>
                        <button
                          className="btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            void approveSession(s.id, "deny").then(refresh);
                          }}
                        >
                          Deny
                        </button>
                      </>
                    ) : null}
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void cancelSession(s.id).then(refresh);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onHandoff(s, s.tool === "fake" ? "codex" : "fake");
                      }}
                    >
                      Handoff
                    </button>
                  </div>
                </div>
              ))}
              {!snapshot?.sessions.length ? (
                <p className="empty">No sessions yet.</p>
              ) : null}
            </div>
          </section>
        </div>

        <div className="stack">
          <AttentionInbox
            sessions={attention}
            onSelect={setSelectedId}
            onApprove={(id) => void approveSession(id, "allow").then(refresh)}
            onReply={(id, text) => void replySession(id, text).then(refresh)}
          />

          <DispatchDrawer
            machines={snapshot?.machines ?? []}
            adapters={snapshot?.adapters ?? []}
            busy={busy}
            onDispatch={onDispatch}
          />

          <section className="panel">
            <div className="panel-head">
              <h2>Recent tasks</h2>
            </div>
            <div className="task-list">
              {(snapshot?.tasks ?? []).slice(0, 12).map((t) => (
                <div key={t.id} className="row">
                  <div className={`state-dot state-${t.status === "running" ? "busy" : t.status === "failed" ? "error" : t.status === "blocked" ? "needs_attention" : "idle"}`} />
                  <div>
                    <h3>{t.status} · {t.preferredTools.join(", ")}</h3>
                    <p>{t.prompt.slice(0, 160)}</p>
                    {t.resultSummary ? <p>{t.resultSummary}</p> : null}
                    {t.error ? <p>{t.error}</p> : null}
                  </div>
                  <div />
                </div>
              ))}
              {!snapshot?.tasks.length ? <p className="empty">No tasks yet.</p> : null}
            </div>
          </section>

          {selected ? (
            <section className="panel">
              <h2>Selected session</h2>
              <p className="empty">
                {TOOL_LABELS[selected.tool]} · {selected.id}
                <br />
                {selected.summary || "No summary"}
              </p>
            </section>
          ) : null}

          <section className="panel">
            <h2>Settings</h2>
            <p className="empty">
              Hub: {snapshot?.config.isHub ? "yes" : "no"}
              <br />
              API: {snapshot?.config.host}:{snapshot?.config.port}
              <br />
              Feishu: {snapshot?.config.feishuConfigured ? "configured" : "set FEISHU_WEBHOOK_URL in .env"}
              <br />
              Pairing token: use TOOLMGR_PAIRING_TOKEN for remote agents
              <br />
              Hooks: <code>node scripts/install-hooks/install-claude-hooks.mjs</code>
            </p>
            <div className="actions">
              <button
                className="btn"
                type="button"
                onClick={() => {
                  void fetch("/api/notify/test", { method: "POST" })
                    .then(async (r) => {
                      const body = await r.json();
                      setToast(
                        body.skipped
                          ? `Feishu skipped: ${body.reason}`
                          : body.ok
                            ? "Feishu test sent"
                            : `Feishu failed: ${body.body || body.error || "unknown"}`,
                      );
                    })
                    .catch((err) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    );
                }}
              >
                Test Feishu
              </button>
            </div>
          </section>
        </div>
      </div>

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}
